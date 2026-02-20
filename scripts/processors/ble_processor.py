#!/usr/bin/env python3
"""
BLE (Bluetooth Low Energy) capture processor for HackRF.

Phase 2a: Energy detection — measure RF activity on BLE advertising channels.
Phase 2b: Packet decoding — GFSK demodulate, find access address, parse PDUs.

Manages hackrf_transfer as a subprocess, hopping across BLE advertising
channels 37 (2402 MHz), 38 (2426 MHz), 39 (2480 MHz).

Output: NDJSON observations to stdout (ble-energy and ble-adv).

Environment variables:
  HACKRF_SERIAL        - HackRF device serial. Default: auto-detect
  HACKRF_LNA_GAIN      - LNA gain 0-40 dB. Default: 32
  HACKRF_VGA_GAIN      - VGA gain 0-62 dB. Default: 40
  BLE_SAMPLE_RATE      - Sample rate in Hz. Default: 4000000
  BLE_CHANNEL_DWELL_MS - Dwell time per channel in ms. Default: 200
  BLE_DEDUP_SECONDS    - Dedup window per device. Default: 10
"""

import sys
import os
import json
import hashlib
import struct
import subprocess
import time
from datetime import datetime, timezone
from typing import Optional

import numpy as np


# --- Configuration ---
HACKRF_SERIAL = os.environ.get("HACKRF_SERIAL", "")
LNA_GAIN = int(os.environ.get("HACKRF_LNA_GAIN", "32"))
VGA_GAIN = int(os.environ.get("HACKRF_VGA_GAIN", "40"))
SAMPLE_RATE = int(os.environ.get("BLE_SAMPLE_RATE", "4000000"))
CHANNEL_DWELL_MS = int(os.environ.get("BLE_CHANNEL_DWELL_MS", "200"))
DEDUP_SECONDS = int(os.environ.get("BLE_DEDUP_SECONDS", "10"))

# BLE advertising channels
BLE_CHANNELS = {
    37: 2402000000,  # 2402 MHz
    38: 2426000000,  # 2426 MHz
    39: 2480000000,  # 2480 MHz
}

# BLE advertising access address
BLE_ACCESS_ADDRESS = 0x8E89BED6
BLE_AA_BITS = np.array([int(b) for b in format(BLE_ACCESS_ADDRESS, "032b")], dtype=np.int8)

# BLE symbol rate: 1 Msym/s
BLE_SYMBOL_RATE = 1000000

# Samples per dwell
SAMPLES_PER_DWELL = int(SAMPLE_RATE * CHANNEL_DWELL_MS / 1000)

# CRC-24 polynomial for BLE (x^24 + x^10 + x^9 + x^6 + x^4 + x^3 + x + 1)
BLE_CRC_POLY = 0x100065B
BLE_CRC_INIT = 0x555555  # Advertising channel CRC init

# Known BLE company identifiers
COMPANY_IDS = {
    "004c": "Apple",
    "0006": "Microsoft",
    "001d": "Qualcomm",
    "004f": "Nordic Semiconductor",
    "0059": "Nordic Semiconductor",
    "0075": "Samsung",
    "0087": "Garmin",
    "00e0": "Google",
    "0157": "Tile",
    "0171": "Amazon",
    "02e5": "Chipolo",
    "02ff": "Espressif",
}

# BLE advertising PDU types
ADV_TYPES = {
    0: "ADV_IND",
    1: "ADV_DIRECT_IND",
    2: "ADV_NONCONN_IND",
    3: "SCAN_REQ",
    4: "SCAN_RSP",
    5: "CONNECT_IND",
    6: "ADV_SCAN_IND",
}


def compute_signature(protocol: str, key_parts: str) -> str:
    sig_input = f"rf-telemetry-v1:{protocol}:{key_parts}"
    return hashlib.sha256(sig_input.encode()).hexdigest()


def hash_mac(mac_bytes: bytes) -> str:
    """SHA-256 hash a MAC address for privacy, truncated to 16 hex chars."""
    return hashlib.sha256(mac_bytes).hexdigest()[:16]


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str):
    print(f"[ble_processor] {msg}", file=sys.stderr, flush=True)


def output(obs: dict):
    print(json.dumps(obs), flush=True)


def crc24_ble(data: bytes) -> int:
    """Compute BLE CRC-24 over data bytes."""
    crc = BLE_CRC_INIT
    for byte in data:
        crc ^= byte << 16
        for _ in range(8):
            if crc & 0x800000:
                crc = (crc << 1) ^ BLE_CRC_POLY
            else:
                crc = crc << 1
            crc &= 0xFFFFFF
    return crc


def ble_dewhiten(data_bits: np.ndarray, channel: int) -> np.ndarray:
    """Reverse BLE data whitening (XOR with LFSR sequence).

    BLE uses a 7-bit LFSR with polynomial x^7 + x^4 + 1, seeded with
    the channel number (position 0 = LSB of channel, bit 6 = 1).
    The access address is NOT whitened; only header + payload + CRC are.
    """
    # LFSR initial state: bit6=1, bits 0-5 = channel number
    lfsr = (channel & 0x3F) | 0x40
    out = np.empty_like(data_bits)
    for i in range(len(data_bits)):
        # Output bit is LFSR bit 0
        out[i] = data_bits[i] ^ (lfsr & 1)
        # Feedback: new bit6 = bit0 XOR bit4
        feedback = (lfsr & 1) ^ ((lfsr >> 4) & 1)
        lfsr = (lfsr >> 1) | (feedback << 6)
    return out


def bits_to_bytes(bits: np.ndarray) -> bytes:
    """Convert bit array to bytes (LSB first within each byte, BLE convention)."""
    n = len(bits) // 8
    result = bytearray(n)
    for i in range(n):
        byte_bits = bits[i * 8:(i + 1) * 8]
        # BLE is LSB first
        val = 0
        for j in range(8):
            val |= int(byte_bits[j]) << j
        result[i] = val
    return bytes(result)


def parse_ad_structures(payload: bytes) -> dict:
    """Parse BLE advertising data (AD) structures."""
    fields: dict = {}
    i = 0
    while i < len(payload):
        if i + 1 >= len(payload):
            break
        length = payload[i]
        if length == 0 or i + 1 + length > len(payload):
            break
        ad_type = payload[i + 1]
        ad_data = payload[i + 2:i + 1 + length]

        # 0x01: Flags
        if ad_type == 0x01 and len(ad_data) >= 1:
            fields["flags"] = ad_data[0]

        # 0x08/0x09: Shortened/Complete Local Name
        elif ad_type in (0x08, 0x09):
            try:
                fields["deviceName"] = ad_data.decode("utf-8", errors="replace")
            except Exception:
                pass

        # 0x0A: TX Power Level
        elif ad_type == 0x0A and len(ad_data) >= 1:
            fields["txPower"] = struct.unpack("b", ad_data[:1])[0]

        # 0x02/0x03: Incomplete/Complete 16-bit UUID list
        elif ad_type in (0x02, 0x03):
            if len(ad_data) >= 2 and len(ad_data) % 2 == 0:
                uuids = []
                for j in range(0, len(ad_data), 2):
                    uuid16 = struct.unpack("<H", ad_data[j:j + 2])[0]
                    uuids.append(f"{uuid16:04x}")
                fields["serviceUuids"] = uuids

        # 0xFF: Manufacturer Specific Data
        elif ad_type == 0xFF and len(ad_data) >= 2:
            company_id = f"{struct.unpack('<H', ad_data[:2])[0]:04x}"
            fields["manufacturerId"] = company_id
            fields["manufacturerName"] = COMPANY_IDS.get(company_id, "Unknown")

        i += 1 + length

    return fields


# Apple Continuity sub-type names
APPLE_CONTINUITY_TYPES = {
    0x02: "iBeacon",
    0x05: "AirDrop",
    0x07: "AirPods",
    0x0C: "Handoff",
    0x0F: "NearbyAction",
    0x10: "NearbyInfo",
    0x12: "FindMy",
}


def parse_apple_continuity(mfg_data: bytes) -> dict:
    """Parse Apple Continuity Protocol from manufacturer-specific data.

    mfg_data starts after the 2-byte company ID (004c).
    Format: [sub-type (1 byte)] [length (1 byte)] [payload...]
    """
    fields: dict = {}
    if len(mfg_data) < 2:
        return fields

    sub_type = mfg_data[0]
    # sub_length = mfg_data[1]
    payload = mfg_data[2:]

    type_name = APPLE_CONTINUITY_TYPES.get(sub_type, f"Unknown-0x{sub_type:02x}")
    fields["continuityType"] = type_name

    if sub_type == 0x02 and len(payload) >= 20:
        # iBeacon: 16-byte UUID + 2-byte major + 2-byte minor + 1-byte TX power
        uuid = payload[:16].hex()
        fields["ibeaconUuid"] = f"{uuid[:8]}-{uuid[8:12]}-{uuid[12:16]}-{uuid[16:20]}-{uuid[20:]}"
        fields["ibeaconMajor"] = struct.unpack(">H", payload[16:18])[0]
        fields["ibeaconMinor"] = struct.unpack(">H", payload[18:20])[0]
        if len(payload) >= 21:
            fields["txPower"] = struct.unpack("b", payload[20:21])[0]

    elif sub_type == 0x10 and len(payload) >= 1:
        # Nearby Info: activity level in upper nibble
        activity = (payload[0] >> 4) & 0x0F
        fields["activityLevel"] = activity

    elif sub_type == 0x0F and len(payload) >= 1:
        # Nearby Action
        action_type = payload[0]
        fields["nearbyAction"] = f"0x{action_type:02x}"

    elif sub_type == 0x12:
        # Find My
        fields["trackerType"] = "Apple Find My"

    return fields


def detect_tracker_type(fields: dict) -> Optional[str]:
    """Identify known tracker types from advertising data fields."""
    mfg_id = fields.get("manufacturerId", "")
    service_uuids = fields.get("serviceUuids", [])

    # Apple Find My (continuity sub-type 0x12)
    if mfg_id == "004c" and fields.get("continuityType") == "FindMy":
        return "Apple Find My"

    # Tile (company ID 0157 or service UUID fe26)
    if mfg_id == "0157" or "fe26" in service_uuids:
        return "Tile"

    # Samsung SmartTag (company ID 0075 + typical service UUIDs)
    if mfg_id == "0075" and ("fd5a" in service_uuids or "fef5" in service_uuids):
        return "Samsung SmartTag"

    # Chipolo (company ID 02e5)
    if mfg_id == "02e5":
        return "Chipolo"

    return None


def compute_fingerprint(fields: dict, pdu_type: int, payload_length: int) -> str:
    """Compute a composite device fingerprint that persists across MAC rotations.

    Hashes: manufacturerId + sorted serviceUuids + pdu type + TX power +
    payload length + continuity type. This produces a stable identifier
    even when the MAC address rotates (every ~15 min on Apple/Android).
    """
    parts = [
        fields.get("manufacturerId", ""),
        ",".join(sorted(fields.get("serviceUuids", []))),
        str(pdu_type),
        str(fields.get("txPower", "")),
        str(payload_length),
        fields.get("continuityType", ""),
    ]
    raw = "|".join(parts)
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


class BleProcessor:
    def __init__(self):
        # Dedup: signature -> last emission timestamp
        self.last_seen: dict[str, float] = {}
        self.energy_count = 0
        self.adv_count = 0
        self.hop_count = 0
        # Per-channel noise floor baseline (Welford's online algorithm)
        self.noise_stats: dict[int, dict] = {}  # channel -> {n, mean, m2}

    def update_noise_baseline(self, channel: int, noise_db: float) -> dict:
        """Update per-channel noise floor running statistics (Welford's algorithm).
        Returns dict with baseline, stddev, deviation for the current sample."""
        if channel not in self.noise_stats:
            self.noise_stats[channel] = {"n": 0, "mean": 0.0, "m2": 0.0}

        stats = self.noise_stats[channel]
        stats["n"] += 1
        delta = noise_db - stats["mean"]
        stats["mean"] += delta / stats["n"]
        delta2 = noise_db - stats["mean"]
        stats["m2"] += delta * delta2

        variance = stats["m2"] / stats["n"] if stats["n"] > 1 else 0.0
        stddev = variance ** 0.5

        return {
            "noiseBaseline": round(stats["mean"], 2),
            "noiseStddev": round(stddev, 2),
            "noiseDeviation": round((noise_db - stats["mean"]) / stddev, 2) if stddev > 0 else 0.0,
        }

    def capture_channel(self, channel: int, freq_hz: int) -> Optional[np.ndarray]:
        """Capture IQ samples from a single BLE channel via hackrf_transfer."""
        cmd = [
            "hackrf_transfer",
            "-r", "-",           # Output raw IQ to stdout
            "-f", str(freq_hz),  # Center frequency
            "-s", str(SAMPLE_RATE),
            "-l", str(LNA_GAIN),
            "-g", str(VGA_GAIN),
            "-n", str(SAMPLES_PER_DWELL * 2),  # 2 bytes per I/Q sample
        ]
        if HACKRF_SERIAL:
            cmd.extend(["-d", HACKRF_SERIAL])

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=CHANNEL_DWELL_MS / 1000 + 5,  # generous timeout
            )
            if result.returncode != 0:
                return None

            raw = result.stdout
            if len(raw) < SAMPLES_PER_DWELL * 2:
                return None

            # Convert signed 8-bit I/Q to complex64
            iq_int8 = np.frombuffer(raw[:SAMPLES_PER_DWELL * 2], dtype=np.int8)
            iq = (iq_int8[0::2] + 1j * iq_int8[1::2]).astype(np.complex64) / 128.0
            return iq

        except (subprocess.TimeoutExpired, FileNotFoundError, OSError) as e:
            log(f"hackrf_transfer error: {e}")
            return None

    def process_energy(self, channel: int, freq_hz: int, iq: np.ndarray):
        """Phase 2a: Energy detection on the captured IQ data."""
        power = np.abs(iq) ** 2
        mean_power = float(np.mean(power))
        peak_power = float(np.max(power))

        # Convert to dBm (approximate, relative to full scale)
        rssi = 10 * np.log10(peak_power + 1e-12)
        noise = 10 * np.log10(mean_power + 1e-12)
        snr = rssi - noise if noise < rssi else 0.0

        # Detect energy bursts: segments where power exceeds 2x mean
        threshold = mean_power * 2
        above = power > threshold
        # Count transitions from below to above threshold
        transitions = np.diff(above.astype(np.int8))
        burst_count = int(np.sum(transitions == 1))

        # Update noise floor baseline
        noise_info = self.update_noise_baseline(channel, noise)

        sig = compute_signature("ble-energy", f"channel={channel}")

        obs = {
            "observedAt": now_iso(),
            "protocol": "ble-energy",
            "frequencyHz": freq_hz,
            "rssi": round(rssi, 1),
            "noise": round(noise, 1),
            "snr": round(snr, 1),
            "modulation": "GFSK",
            "signature": sig,
            "fields": {
                "channel": channel,
                "peakPower": round(rssi, 1),
                "burstCount": burst_count,
                "dwellMs": CHANNEL_DWELL_MS,
                **noise_info,
            },
        }
        output(obs)
        self.energy_count += 1

    def process_packets(self, channel: int, freq_hz: int, iq: np.ndarray):
        """Phase 2b: GFSK demodulation and BLE advertising packet decode."""
        if len(iq) < 100:
            return

        # FM demodulation: instantaneous frequency via phase difference
        phase_diff = np.angle(iq[1:] * np.conj(iq[:-1]))

        # Integrate-and-dump to symbol rate
        samples_per_symbol = SAMPLE_RATE // BLE_SYMBOL_RATE
        if samples_per_symbol < 1:
            return

        n_symbols = len(phase_diff) // samples_per_symbol
        if n_symbols < 64:  # Need at least preamble + access address + header
            return

        # Reshape and average each symbol period
        trimmed = phase_diff[:n_symbols * samples_per_symbol]
        symbols_avg = trimmed.reshape(n_symbols, samples_per_symbol).mean(axis=1)

        # Threshold to bits (positive = 1, negative = 0 for GFSK)
        bits = (symbols_avg > 0).astype(np.int8)

        # Search for BLE access address
        self._find_and_decode_packets(bits, channel, freq_hz, iq, phase_diff)

    def _find_and_decode_packets(self, bits: np.ndarray, channel: int,
                                 freq_hz: int, iq: np.ndarray,
                                 phase_diff: np.ndarray):
        """Search bitstream for BLE advertising access address and decode PDUs."""
        # Sliding correlation for access address
        aa_len = len(BLE_AA_BITS)
        n = len(bits) - aa_len - 40  # Need some space after AA for header

        if n <= 0:
            return

        for i in range(n):
            # Check match (allowing 1 bit error for robustness)
            mismatches = np.sum(bits[i:i + aa_len] != BLE_AA_BITS)
            if mismatches > 1:
                continue

            # Found access address at position i
            pdu_start = i + aa_len
            remaining_bits = bits[pdu_start:]

            # Reverse data whitening (AA is not whitened, everything after is)
            remaining_bits = ble_dewhiten(remaining_bits, channel)

            if len(remaining_bits) < 16:  # Need at least PDU header (2 bytes)
                continue

            # Extract PDU header (2 bytes = 16 bits)
            header_bytes = bits_to_bytes(remaining_bits[:16])
            if len(header_bytes) < 2:
                continue

            pdu_type = header_bytes[0] & 0x0F
            tx_add = (header_bytes[0] >> 6) & 0x01  # 1 = random address
            payload_length = header_bytes[1] & 0x3F

            # Sanity check
            if payload_length < 6 or payload_length > 37:
                continue

            total_bits_needed = 16 + payload_length * 8 + 24  # header + payload + CRC
            if len(remaining_bits) < total_bits_needed:
                continue

            # Extract payload
            payload_bits = remaining_bits[16:16 + payload_length * 8]
            payload_bytes = bits_to_bytes(payload_bits)

            # Extract CRC (3 bytes)
            crc_bits = remaining_bits[16 + payload_length * 8:
                                      16 + payload_length * 8 + 24]
            crc_bytes = bits_to_bytes(crc_bits)
            received_crc = (crc_bytes[0] | (crc_bytes[1] << 8) |
                            (crc_bytes[2] << 16)) if len(crc_bytes) >= 3 else 0

            # Verify CRC
            crc_data = header_bytes + payload_bytes
            computed_crc = crc24_ble(crc_data)
            crc_valid = received_crc == computed_crc

            # Extract MAC address (first 6 bytes of payload)
            if len(payload_bytes) < 6:
                continue
            mac_bytes = payload_bytes[:6]
            mac_hash = hash_mac(mac_bytes)

            # Parse advertising data (after MAC)
            ad_data = payload_bytes[6:]
            ad_fields = parse_ad_structures(ad_data)

            adv_type = ADV_TYPES.get(pdu_type, f"UNKNOWN_{pdu_type}")

            # Parse Apple Continuity if manufacturer is Apple (2A)
            if ad_fields.get("manufacturerId") == "004c" and len(ad_data) > 4:
                # mfg_data starts after AD type byte + company ID (2 bytes)
                # Find manufacturer data in raw ad_data
                mfg_payload = self._extract_mfg_payload(ad_data)
                if mfg_payload:
                    continuity = parse_apple_continuity(mfg_payload)
                    ad_fields.update(continuity)

            # Detect tracker type (2B)
            tracker = detect_tracker_type(ad_fields)
            if tracker:
                ad_fields["trackerType"] = tracker

            # Compute signal metrics from IQ at this position
            # Approximate sample position
            samples_per_symbol = SAMPLE_RATE // BLE_SYMBOL_RATE
            sample_start = i * samples_per_symbol
            sample_end = min(sample_start + total_bits_needed * samples_per_symbol // 8,
                             len(iq))
            if sample_start < len(iq):
                packet_iq = iq[sample_start:sample_end]
                pkt_power = np.abs(packet_iq) ** 2
                rssi = float(10 * np.log10(np.mean(pkt_power) + 1e-12))
            else:
                rssi = -99.0

            # Carrier Frequency Offset from preamble (2D)
            cfo_hz = 0.0
            preamble_symbols = 8  # BLE preamble is 8 symbols (01010101)
            pd_start = i * samples_per_symbol
            pd_end = pd_start + preamble_symbols * samples_per_symbol
            if pd_end < len(phase_diff):
                mean_phase = float(np.mean(phase_diff[pd_start:pd_end]))
                cfo_hz = mean_phase * SAMPLE_RATE / (2 * np.pi)

            # Compute composite fingerprint (2C)
            fingerprint_id = compute_fingerprint(ad_fields, pdu_type, payload_length)

            # Dedup check
            sig = compute_signature(
                "ble-adv",
                f"macHash={mac_hash}&advType={adv_type}"
            )

            now = time.time()
            if sig in self.last_seen and (now - self.last_seen[sig]) < DEDUP_SECONDS:
                continue
            self.last_seen[sig] = now

            # Build observation
            fields = {
                "channel": channel,
                "macHash": mac_hash,
                "advType": adv_type,
                "crcValid": crc_valid,
                "addressType": "random" if tx_add else "public",
                "fingerprintId": fingerprint_id,
                "cfoHz": round(cfo_hz, 1),
            }
            fields.update(ad_fields)

            obs = {
                "observedAt": now_iso(),
                "protocol": "ble-adv",
                "frequencyHz": freq_hz,
                "rssi": round(rssi, 1),
                "noise": round(rssi - 20, 1),  # Approximate
                "snr": 20.0,  # Placeholder
                "modulation": "GFSK",
                "signature": sig,
                "fields": fields,
            }
            output(obs)
            self.adv_count += 1

    @staticmethod
    def _extract_mfg_payload(ad_data: bytes) -> Optional[bytes]:
        """Extract manufacturer-specific payload (after company ID) from AD structures."""
        i = 0
        while i < len(ad_data):
            if i + 1 >= len(ad_data):
                break
            length = ad_data[i]
            if length == 0 or i + 1 + length > len(ad_data):
                break
            ad_type = ad_data[i + 1]
            if ad_type == 0xFF and length >= 3:
                # Skip company ID (2 bytes), return rest
                return ad_data[i + 4:i + 1 + length]
            i += 1 + length
        return None

    def cleanup_dedup(self):
        """Remove stale dedup entries."""
        now = time.time()
        cutoff = now - DEDUP_SECONDS * 2
        self.last_seen = {k: v for k, v in self.last_seen.items() if v > cutoff}

    def run(self):
        """Main capture loop: hop across BLE advertising channels."""
        log("Starting BLE capture processor")
        log(f"Config: sample_rate={SAMPLE_RATE}, dwell={CHANNEL_DWELL_MS}ms, "
            f"dedup={DEDUP_SECONDS}s")
        log(f"Gains: LNA={LNA_GAIN}dB, VGA={VGA_GAIN}dB")
        if HACKRF_SERIAL:
            log(f"Device serial: {HACKRF_SERIAL}")

        channels = list(BLE_CHANNELS.items())

        try:
            while True:
                for channel, freq_hz in channels:
                    iq = self.capture_channel(channel, freq_hz)
                    if iq is None:
                        log(f"No data from channel {channel} ({freq_hz} Hz)")
                        time.sleep(0.1)
                        continue

                    # Phase 2a: Energy detection (always)
                    self.process_energy(channel, freq_hz, iq)

                    # Phase 2b: Packet decoding (always attempt)
                    self.process_packets(channel, freq_hz, iq)

                    self.hop_count += 1

                # Periodic cleanup
                if self.hop_count % 30 == 0:
                    self.cleanup_dedup()

                # Log progress periodically
                if self.hop_count % 100 == 0:
                    log(f"Hops: {self.hop_count}, Energy: {self.energy_count}, "
                        f"Packets: {self.adv_count}, "
                        f"Tracked: {len(self.last_seen)} devices")

        except KeyboardInterrupt:
            pass
        finally:
            log(f"Stopped. Hops: {self.hop_count}, Energy: {self.energy_count}, "
                f"Packets: {self.adv_count}")


def main():
    processor = BleProcessor()
    processor.run()


if __name__ == "__main__":
    main()

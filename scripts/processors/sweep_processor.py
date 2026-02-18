#!/usr/bin/env python3
"""
Wideband spectrum anomaly detector for hackrf_sweep output.

Reads hackrf_sweep CSV from stdin, learns a per-bin power baseline using
Welford's online algorithm, then detects anomalies when a bin deviates
beyond a configurable number of standard deviations.

Output: NDJSON observations to stdout (spectrum-anomaly and spectrum-baseline).

Environment variables:
  SWEEP_BASELINE_SECONDS  - Learning phase duration (default: 300)
  SWEEP_ANOMALY_SIGMA     - Sigma threshold for anomaly detection (default: 3.0)
  SWEEP_EMIT_INTERVAL     - Emit baseline summary every N sweeps (default: 10)
  SWEEP_MIN_STREAK        - Min consecutive anomalous readings before emitting (default: 2)
"""

import sys
import os
import json
import hashlib
import math
from datetime import datetime, timezone
from typing import Optional

import numpy as np


# --- Configuration ---
BASELINE_SECONDS = int(os.environ.get("SWEEP_BASELINE_SECONDS", "300"))
ANOMALY_SIGMA = float(os.environ.get("SWEEP_ANOMALY_SIGMA", "3.0"))
EMIT_INTERVAL = int(os.environ.get("SWEEP_EMIT_INTERVAL", "10"))
MIN_STREAK = int(os.environ.get("SWEEP_MIN_STREAK", "2"))

# EMA decay factor for post-baseline adaptive tracking
EMA_ALPHA = 0.01

# Named frequency bands for grouping
NAMED_BANDS = [
    ("ISM 315M",   300e6,  330e6),
    ("ISM 433M",   420e6,  450e6),
    ("ISM 868M",   863e6,  870e6),
    ("ISM 915M",   902e6,  928e6),
    ("GPS L1",     1565e6, 1585e6),
    ("WiFi 2.4G",  2400e6, 2500e6),
    ("ISM 5.8G",   5725e6, 5875e6),
]


def compute_signature(protocol: str, key_parts: str) -> str:
    """Compute SHA-256 signature matching the rf-telemetry-v1 convention."""
    sig_input = f"rf-telemetry-v1:{protocol}:{key_parts}"
    return hashlib.sha256(sig_input.encode()).hexdigest()


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def freq_to_band_name(freq_hz: float) -> str:
    """Map a frequency to a named band, or format as generic label."""
    for name, lo, hi in NAMED_BANDS:
        if lo <= freq_hz <= hi:
            return name
    # Generic label: round to nearest MHz
    mhz = round(freq_hz / 1e6)
    if mhz >= 1000:
        return f"{mhz / 1000:.1f}G"
    return f"{mhz}M"


class BinStats:
    """Welford's online algorithm for running mean/variance, with EMA mode."""

    __slots__ = ("count", "mean", "m2", "ema_mean", "ema_var", "learning")

    def __init__(self):
        self.count: int = 0
        self.mean: float = 0.0
        self.m2: float = 0.0
        self.ema_mean: float = 0.0
        self.ema_var: float = 0.0
        self.learning: bool = True

    def update(self, value: float):
        if self.learning:
            self.count += 1
            delta = value - self.mean
            self.mean += delta / self.count
            delta2 = value - self.mean
            self.m2 += delta * delta2
        else:
            # Exponential moving average
            delta = value - self.ema_mean
            self.ema_mean += EMA_ALPHA * delta
            self.ema_var = (1 - EMA_ALPHA) * (self.ema_var + EMA_ALPHA * delta * delta)

    def finalize_learning(self):
        """Transition from learning to EMA tracking."""
        self.learning = False
        self.ema_mean = self.mean
        self.ema_var = self.variance
        if self.ema_var < 0.1:
            self.ema_var = 0.1  # Floor to avoid zero-variance false positives

    @property
    def variance(self) -> float:
        if self.count < 2:
            return 0.0
        return self.m2 / (self.count - 1)

    @property
    def stddev(self) -> float:
        if self.learning:
            return math.sqrt(self.variance) if self.variance > 0 else 0.0
        return math.sqrt(self.ema_var) if self.ema_var > 0 else 0.0

    @property
    def current_mean(self) -> float:
        return self.mean if self.learning else self.ema_mean

    def deviation_sigma(self, value: float) -> float:
        sd = self.stddev
        if sd < 0.01:
            return 0.0
        return (value - self.current_mean) / sd


class SweepProcessor:
    def __init__(self):
        # bin_key (center_freq_hz) -> BinStats
        self.bins: dict[int, BinStats] = {}
        # bin_key -> consecutive anomaly count
        self.streaks: dict[int, int] = {}
        # bin_key -> already emitted (dedup within streak)
        self.emitted: dict[int, bool] = {}

        self.start_time: Optional[float] = None
        self.learning = True
        self.sweep_count = 0
        self.anomaly_count = 0

    def process_line(self, line: str):
        """Parse one hackrf_sweep CSV line and process all bins."""
        line = line.strip()
        if not line or line.startswith("#"):
            return

        parts = line.split(",")
        if len(parts) < 7:
            return

        try:
            # hackrf_sweep CSV format:
            # date, time, hz_low, hz_high, hz_bin_width, num_samples, dB, dB, ...
            date_str = parts[0].strip()
            time_str = parts[1].strip()
            hz_low = float(parts[2].strip())
            hz_high = float(parts[3].strip())
            hz_bin_width = float(parts[4].strip())
            # parts[5] = num_samples (unused)
            db_values = [float(v.strip()) for v in parts[6:] if v.strip()]
        except (ValueError, IndexError):
            return

        if self.start_time is None:
            self.start_time = datetime.now(timezone.utc).timestamp()
            self._log(f"Baseline learning started ({BASELINE_SECONDS}s)")

        # Check if learning phase is done
        elapsed = datetime.now(timezone.utc).timestamp() - self.start_time
        if self.learning and elapsed >= BASELINE_SECONDS:
            self._finalize_learning()

        # Process each power bin
        for i, db in enumerate(db_values):
            center_freq = int(hz_low + hz_bin_width * i + hz_bin_width / 2)

            if center_freq not in self.bins:
                self.bins[center_freq] = BinStats()

            stats = self.bins[center_freq]
            stats.update(db)

            if not self.learning:
                sigma = stats.deviation_sigma(db)
                self._check_anomaly(center_freq, db, sigma, stats)

        # Track sweeps for baseline emission
        # A new "sweep" starts when we see hz_low near the beginning of the range
        if hz_low < 10e6:
            self.sweep_count += 1
            if not self.learning and self.sweep_count % EMIT_INTERVAL == 0:
                self._emit_baseline_summary()

    def _finalize_learning(self):
        """Transition all bins from learning to adaptive tracking."""
        self.learning = False
        valid = 0
        for stats in self.bins.values():
            if stats.count >= 3:
                stats.finalize_learning()
                valid += 1
        self._log(f"Baseline learned: {valid} bins with data, "
                  f"{len(self.bins)} total bins tracked")

    def _check_anomaly(self, freq_hz: int, power_db: float, sigma: float,
                       stats: BinStats):
        """Check if a bin reading is anomalous and emit if streak threshold met."""
        if sigma > ANOMALY_SIGMA:
            self.streaks[freq_hz] = self.streaks.get(freq_hz, 0) + 1

            if self.streaks[freq_hz] >= MIN_STREAK and not self.emitted.get(freq_hz, False):
                self._emit_anomaly(freq_hz, power_db, stats.current_mean, sigma)
                self.emitted[freq_hz] = True
                self.anomaly_count += 1
        else:
            # Reset streak
            if freq_hz in self.streaks:
                del self.streaks[freq_hz]
            if freq_hz in self.emitted:
                del self.emitted[freq_hz]

    def _emit_anomaly(self, freq_hz: int, power_db: float,
                      baseline_db: float, sigma: float):
        """Emit a spectrum-anomaly observation."""
        band = freq_to_band_name(freq_hz)
        anomaly_type = "power-spike" if power_db > baseline_db else "power-drop"

        obs = {
            "observedAt": now_iso(),
            "protocol": "spectrum-anomaly",
            "frequencyHz": freq_hz,
            "rssi": round(power_db, 1),
            "noise": round(baseline_db, 1),
            "signature": compute_signature(
                "spectrum-anomaly",
                f"band={band}&type={anomaly_type}"
            ),
            "fields": {
                "band": band,
                "binWidthHz": 1000000,
                "measuredPower": round(power_db, 1),
                "baselinePower": round(baseline_db, 1),
                "deviationSigma": round(sigma, 1),
                "anomalyType": anomaly_type,
            },
        }
        self._output(obs)

    def _emit_baseline_summary(self):
        """Emit per-band baseline summaries."""
        band_data: dict[str, list[float]] = {}

        for freq_hz, stats in self.bins.items():
            if stats.count < 3:
                continue
            band = freq_to_band_name(freq_hz)
            if band not in band_data:
                band_data[band] = []
            band_data[band].append(stats.current_mean)

        for band, powers in band_data.items():
            if not powers:
                continue
            arr = np.array(powers)
            # Pick a representative frequency for the band
            representative_freq = None
            for name, lo, hi in NAMED_BANDS:
                if name == band:
                    representative_freq = int((lo + hi) / 2)
                    break
            if representative_freq is None:
                # Generic band — try to parse freq from band name
                representative_freq = 0

            obs = {
                "observedAt": now_iso(),
                "protocol": "spectrum-baseline",
                "frequencyHz": representative_freq,
                "rssi": round(float(np.mean(arr)), 1),
                "noise": round(float(np.min(arr)), 1),
                "signature": compute_signature(
                    "spectrum-baseline",
                    f"band={band}"
                ),
                "fields": {
                    "band": band,
                    "meanPower": round(float(np.mean(arr)), 1),
                    "minPower": round(float(np.min(arr)), 1),
                    "maxPower": round(float(np.max(arr)), 1),
                    "stdPower": round(float(np.std(arr)), 2),
                    "binCount": len(powers),
                },
            }
            self._output(obs)

    def _output(self, obs: dict):
        """Write one NDJSON line to stdout."""
        print(json.dumps(obs), flush=True)

    def _log(self, msg: str):
        """Log to stderr (not captured by pipeline)."""
        print(f"[sweep_processor] {msg}", file=sys.stderr, flush=True)


def main():
    processor = SweepProcessor()
    processor._log("Starting wideband sweep processor")
    processor._log(f"Config: baseline={BASELINE_SECONDS}s, sigma={ANOMALY_SIGMA}, "
                   f"emit_interval={EMIT_INTERVAL}, min_streak={MIN_STREAK}")

    try:
        for line in sys.stdin:
            processor.process_line(line)
    except KeyboardInterrupt:
        pass
    finally:
        processor._log(f"Stopped. Sweeps: {processor.sweep_count}, "
                       f"Anomalies: {processor.anomaly_count}, "
                       f"Bins tracked: {len(processor.bins)}")


if __name__ == "__main__":
    main()

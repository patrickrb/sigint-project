#!/usr/bin/env bash
set -euo pipefail

# HackRF BLE (Bluetooth Low Energy) adapter for rf-collector
# Captures BLE advertising packets on channels 37/38/39 (2.4 GHz)
# Outputs observation NDJSON on stdout (ble-energy and ble-adv)
#
# Env vars:
#   HACKRF_SERIAL        - HackRF device serial. Default: auto-detect
#   HACKRF_LNA_GAIN      - LNA gain 0-40 dB. Default: 32
#   HACKRF_VGA_GAIN      - VGA gain 0-62 dB. Default: 40
#   BLE_SAMPLE_RATE      - Sample rate in Hz. Default: 4000000
#   BLE_CHANNEL_DWELL_MS - Dwell time per channel in ms. Default: 200
#   BLE_DEDUP_SECONDS    - Dedup window per device. Default: 10

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "[hackrf_ble] $*" >&2; }

# --- Dependency checks ---
check_deps() {
  local missing=()
  command -v hackrf_transfer &>/dev/null || missing+=("hackrf_transfer")
  command -v python3 &>/dev/null || missing+=("python3")

  if (( ${#missing[@]} > 0 )); then
    log "ERROR: Missing dependencies: ${missing[*]}"
    log "Run: ./scripts/setup-edge.sh"
    exit 1
  fi

  # Verify numpy is available
  if ! python3 -c "import numpy" 2>/dev/null; then
    log "ERROR: numpy not installed. Run: pip3 install numpy"
    exit 1
  fi

  # Verify processor exists
  local processor="${SCRIPT_DIR}/../processors/ble_processor.py"
  if [[ ! -f "$processor" ]]; then
    log "ERROR: ble_processor.py not found at $processor"
    exit 1
  fi
}

# --- Main ---
check_deps

# When multiple HackRFs are connected, hackrf_transfer requires a serial number
if [[ -z "${HACKRF_SERIAL:-}" ]]; then
  local_count=$(hackrf_info 2>/dev/null | grep -c "Serial number:" || true)
  if [[ "$local_count" -gt 1 ]]; then
    log "ERROR: Multiple HackRF devices detected but HACKRF_SERIAL not set."
    log "Run 'hackrf_info' to list serials, then set HACKRF_SERIAL or use --hackrf-serial."
    exit 1
  fi
fi

PROCESSOR="${SCRIPT_DIR}/../processors/ble_processor.py"

log "HackRF BLE adapter starting"
log "  Channels: 37 (2402 MHz), 38 (2426 MHz), 39 (2480 MHz)"
log "  LNA gain: ${HACKRF_LNA_GAIN:-32} dB, VGA gain: ${HACKRF_VGA_GAIN:-40} dB"
log "  Sample rate: ${BLE_SAMPLE_RATE:-4000000} Hz"
log "  Dwell: ${BLE_CHANNEL_DWELL_MS:-200} ms, Dedup: ${BLE_DEDUP_SECONDS:-10} s"

if [[ -n "${HACKRF_SERIAL:-}" ]]; then
  log "  Device serial: $HACKRF_SERIAL"
fi

# The Python processor manages hackrf_transfer internally (per-channel captures)
python3 "$PROCESSOR"

log "Finished."

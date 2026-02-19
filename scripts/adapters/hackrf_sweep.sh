#!/usr/bin/env bash
set -euo pipefail

# HackRF wideband sweep adapter for rf-collector
# Runs hackrf_sweep piped to sweep_processor.py for anomaly detection
# Outputs observation NDJSON on stdout
#
# Env vars:
#   HACKRF_SERIAL            - HackRF device serial. Default: auto-detect
#   HACKRF_SWEEP_MIN         - Min frequency in MHz. Default: 1
#   HACKRF_SWEEP_MAX         - Max frequency in MHz. Default: 6000
#   HACKRF_LNA_GAIN          - LNA gain 0-40 dB (8 dB steps). Default: 32
#   HACKRF_VGA_GAIN          - VGA gain 0-62 dB (2 dB steps). Default: 20
#   SWEEP_BASELINE_SECONDS   - Baseline learning duration. Default: 300
#   SWEEP_ANOMALY_SIGMA      - Sigma threshold for anomalies. Default: 3.0
#   SWEEP_EMIT_INTERVAL      - Emit baseline summary every N sweeps. Default: 10
#   SWEEP_MIN_STREAK         - Min consecutive anomalous readings. Default: 2

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "[hackrf_sweep] $*" >&2; }

# --- Defaults ---
SWEEP_MIN="${HACKRF_SWEEP_MIN:-1}"
SWEEP_MAX="${HACKRF_SWEEP_MAX:-6000}"
LNA_GAIN="${HACKRF_LNA_GAIN:-32}"
VGA_GAIN="${HACKRF_VGA_GAIN:-20}"

# --- Dependency checks ---
check_deps() {
  local missing=()
  command -v hackrf_sweep &>/dev/null || missing+=("hackrf_sweep")
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
  local processor="${SCRIPT_DIR}/../processors/sweep_processor.py"
  if [[ ! -f "$processor" ]]; then
    log "ERROR: sweep_processor.py not found at $processor"
    exit 1
  fi
}

# --- Main ---
check_deps

# When multiple HackRFs are connected, hackrf_sweep requires a serial number
if [[ -z "${HACKRF_SERIAL:-}" ]]; then
  local_count=$(hackrf_info 2>/dev/null | grep -c "Serial number:" || true)
  if [[ "$local_count" -gt 1 ]]; then
    log "ERROR: Multiple HackRF devices detected but HACKRF_SERIAL not set."
    log "Run 'hackrf_info' to list serials, then set HACKRF_SERIAL or use --hackrf-serial."
    exit 1
  fi
fi

PROCESSOR="${SCRIPT_DIR}/../processors/sweep_processor.py"

log "HackRF sweep adapter starting"
log "  Frequency range: ${SWEEP_MIN} - ${SWEEP_MAX} MHz"
log "  LNA gain: ${LNA_GAIN} dB, VGA gain: ${VGA_GAIN} dB"
log "  Baseline: ${SWEEP_BASELINE_SECONDS:-300}s, Sigma: ${SWEEP_ANOMALY_SIGMA:-3.0}"

# Build hackrf_sweep command
SWEEP_CMD=(hackrf_sweep
  -f "${SWEEP_MIN}:${SWEEP_MAX}"
  -l "$LNA_GAIN"
  -g "$VGA_GAIN"
)

if [[ -n "${HACKRF_SERIAL:-}" ]]; then
  SWEEP_CMD+=(-d "$HACKRF_SERIAL")
  log "  Device serial: $HACKRF_SERIAL"
fi

log "Starting: ${SWEEP_CMD[*]} | python3 sweep_processor.py"

# Pipe: hackrf_sweep (CSV power data) → sweep_processor.py (anomaly detection → NDJSON)
# hackrf_sweep stderr goes to adapter stderr (visible in logs), stdout (CSV) goes to processor
"${SWEEP_CMD[@]}" | python3 "$PROCESSOR"

log "Finished."

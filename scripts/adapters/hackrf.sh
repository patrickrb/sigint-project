#!/usr/bin/env bash
set -euo pipefail

# HackRF adapter for rf-collector
# Captures IQ data with hackrf_transfer, decodes with rtl_433
# Outputs observation NDJSON on stdout
#
# Env vars:
#   HACKRF_FREQ_MIN     - Minimum frequency (e.g. 300M). Default: 433M
#   HACKRF_FREQ_MAX     - Maximum frequency (e.g. 928M). Default: 434M
#   HACKRF_SERIAL       - HackRF device serial. Default: auto-detect
#   HACKRF_LNA_GAIN     - LNA gain 0-40 dB (8 dB steps). Default: 32
#   HACKRF_VGA_GAIN     - VGA gain 0-62 dB (2 dB steps). Default: 20
#   HACKRF_SAMPLE_RATE  - Sample rate. Default: 2000000 (2 MS/s)

log() { echo "[hackrf_adapter] $*" >&2; }

# Source shared normalization library
. "$(dirname "$0")/../lib/normalize.sh"

# --- Defaults ---
FREQ_MIN="${HACKRF_FREQ_MIN:-433M}"
FREQ_MAX="${HACKRF_FREQ_MAX:-434M}"
LNA_GAIN="${HACKRF_LNA_GAIN:-32}"
VGA_GAIN="${HACKRF_VGA_GAIN:-20}"
SAMPLE_RATE="${HACKRF_SAMPLE_RATE:-2000000}"

# --- Parse frequency to Hz ---
freq_to_hz() {
  local freq="$1"
  case "$freq" in
    *G) echo "${freq%G}000000000" | awk '{printf "%.0f", $1}' ;;
    *M) echo "${freq%M}000000" | awk '{printf "%.0f", $1}' ;;
    *k) echo "${freq%k}000" | awk '{printf "%.0f", $1}' ;;
    *)  echo "$freq" ;;
  esac
}

# --- Dependency checks ---
check_deps() {
  local missing=()
  command -v hackrf_transfer &>/dev/null || missing+=("hackrf_transfer")
  command -v rtl_433 &>/dev/null || missing+=("rtl_433")
  command -v jq &>/dev/null || missing+=("jq")

  # Cross-platform SHA-256
  if command -v sha256sum &>/dev/null; then
    SHA_CMD="sha256sum"
  elif command -v shasum &>/dev/null; then
    SHA_CMD="shasum -a 256"
  else
    missing+=("sha256sum or shasum")
  fi

  if (( ${#missing[@]} > 0 )); then
    log "ERROR: Missing dependencies: ${missing[*]}"
    log "Install HackRF tools: https://github.com/greatscottgadgets/hackrf"
    exit 1
  fi
}

# --- Main ---
check_deps

FREQ_MIN_HZ=$(freq_to_hz "$FREQ_MIN")
FREQ_MAX_HZ=$(freq_to_hz "$FREQ_MAX")

# Calculate center frequency for hackrf_transfer (takes center freq, not range)
CENTER_FREQ=$(awk "BEGIN {printf \"%.0f\", ($FREQ_MIN_HZ + $FREQ_MAX_HZ) / 2}")

log "HackRF adapter starting"
log "  Frequency range: $FREQ_MIN - $FREQ_MAX (center: $CENTER_FREQ Hz)"
log "  LNA gain: ${LNA_GAIN} dB, VGA gain: ${VGA_GAIN} dB"
log "  Sample rate: $SAMPLE_RATE"

COUNT=0
ERRORS=0

process_stream() {
  while IFS= read -r line || [[ -n "$line" ]]; do
    # Skip empty lines and non-JSON
    [[ -z "$line" ]] && continue
    [[ "$line" != "{"* ]] && continue

    if normalize_line "$line"; then
      COUNT=$((COUNT + 1))
      if (( COUNT % 100 == 0 )); then
        log "Processed $COUNT observations ($ERRORS errors)"
      fi
    else
      ERRORS=$((ERRORS + 1))
      log "Failed to normalize: ${line:0:120}..."
    fi
  done
}

# Build hackrf_transfer command
HACKRF_CMD=(hackrf_transfer -r - -f "$CENTER_FREQ" -s "$SAMPLE_RATE" -l "$LNA_GAIN" -g "$VGA_GAIN")

if [[ -n "${HACKRF_SERIAL:-}" ]]; then
  HACKRF_CMD+=(-d "$HACKRF_SERIAL")
fi

# Pipe: hackrf_transfer (IQ capture) → rtl_433 (decode from stdin) → normalize
log "Starting: ${HACKRF_CMD[*]} | rtl_433 -r - -F json -M time:utc -M level -M protocol -M noise:60"

"${HACKRF_CMD[@]}" | rtl_433 -r - -F json -M time:utc -M level -M protocol -M noise:60 | process_stream

log "Finished. Processed $COUNT observations, $ERRORS errors."

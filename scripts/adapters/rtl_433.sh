#!/usr/bin/env bash
set -euo pipefail

# RTL-SDR adapter for rf-collector
# Launches rtl_433, normalizes JSON output → observation NDJSON on stdout
#
# Env vars:
#   RTL_433_FREQ       - Single frequency (e.g. 315M, 433.92M). Default: rtl_433 default
#   RTL_433_FREQS      - Comma-separated frequencies for hopping (e.g. "433.92M,315M")
#   RTL_433_DEVICE     - Device index or serial. Default: rtl_433 default
#   RTL_433_GAIN       - Gain setting. Default: rtl_433 default
#   RTL_433_PROTOCOLS  - Protocol filter: "tpms" or empty for all. Default: all
#   RTL_433_EXTRA_ARGS - Extra args passed to rtl_433
#   RTL_433_STDIN      - If "true", read rtl_433-format JSON from stdin (testing)

log() { echo "[rtl_433_adapter] $*" >&2; }

# Source shared normalization library
. "$(dirname "$0")/../lib/normalize.sh"

# --- Dependency checks ---
check_deps() {
  local missing=()
  if [[ "${RTL_433_STDIN:-}" != "true" ]]; then
    command -v rtl_433 &>/dev/null || missing+=("rtl_433")
  fi
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
    exit 1
  fi
}

# --- Build rtl_433 command ---
build_rtl_433_cmd() {
  local cmd=(rtl_433 -F json -M time:utc -M level -M protocol -M noise:60)

  # Multi-frequency hopping takes priority over single frequency
  if [[ -n "${RTL_433_FREQS:-}" ]]; then
    local freq_count=0
    IFS=',' read -ra freqs <<< "$RTL_433_FREQS"
    for f in "${freqs[@]}"; do
      f=$(echo "$f" | tr -d ' ')
      [[ -n "$f" ]] && cmd+=(-f "$f") && freq_count=$((freq_count + 1))
    done
    # Add hop interval when multiple frequencies
    if (( freq_count > 1 )); then
      cmd+=(-H 30)
    fi
  elif [[ -n "${RTL_433_FREQ:-}" ]]; then
    cmd+=(-f "$RTL_433_FREQ")
  fi

  if [[ -n "${RTL_433_DEVICE:-}" ]]; then
    cmd+=(-d "$RTL_433_DEVICE")
  fi

  if [[ -n "${RTL_433_GAIN:-}" ]]; then
    cmd+=(-g "$RTL_433_GAIN")
  fi

  # TPMS-only protocol filter
  if [[ "${RTL_433_PROTOCOLS:-}" == "tpms" ]]; then
    # Known TPMS decoder IDs in rtl_433
    cmd+=(-R 59 -R 60 -R 88 -R 89 -R 90 -R 91 -R 92)
  fi

  # Extra args (word-split intentional)
  if [[ -n "${RTL_433_EXTRA_ARGS:-}" ]]; then
    # shellcheck disable=SC2206
    cmd+=($RTL_433_EXTRA_ARGS)
  fi

  echo "${cmd[@]}"
}

# --- Main ---
check_deps

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

if [[ "${RTL_433_STDIN:-}" == "true" ]]; then
  log "Reading rtl_433 JSON from stdin (test mode)"
  process_stream
else
  RTL_CMD=$(build_rtl_433_cmd)
  log "Starting: $RTL_CMD"
  $RTL_CMD | process_stream
fi

log "Finished. Processed $COUNT observations, $ERRORS errors."

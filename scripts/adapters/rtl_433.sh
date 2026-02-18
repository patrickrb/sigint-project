#!/usr/bin/env bash
set -euo pipefail

# RTL-SDR adapter for rf-collector
# Launches rtl_433, normalizes JSON output → observation NDJSON on stdout
#
# Env vars:
#   RTL_433_FREQ       - Frequency (e.g. 315M, 433.92M). Default: rtl_433 default
#   RTL_433_DEVICE     - Device index or serial. Default: rtl_433 default
#   RTL_433_GAIN       - Gain setting. Default: rtl_433 default
#   RTL_433_PROTOCOLS  - Protocol filter: "tpms" or empty for all. Default: all
#   RTL_433_EXTRA_ARGS - Extra args passed to rtl_433
#   RTL_433_STDIN      - If "true", read rtl_433-format JSON from stdin (testing)

log() { echo "[rtl_433_adapter] $*" >&2; }

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

# --- SHA-256 helper ---
compute_sha256() {
  echo -n "$1" | $SHA_CMD | cut -d' ' -f1
}

# --- TPMS model detection ---
is_tpms() {
  local model="$1" type="$2"
  # Explicit type field from rtl_433
  if [[ "$type" == "TPMS" ]]; then
    return 0
  fi
  # Known TPMS decoder model prefixes
  case "$model" in
    Schrader*|Toyota*|Citroen*|PMV-107J*|Ford*|Renault*|Hyundai*|Jansite*|Abarth*|Essex*) return 0 ;;
  esac
  return 1
}

# --- Normalize one rtl_433 JSON line → observation NDJSON ---
normalize_line() {
  local line="$1"

  # Extract key fields with jq (single pass)
  local extracted
  extracted=$(echo "$line" | jq -c '{
    time:           (.time // null),
    model:          (.model // null),
    type:           (.type // null),
    id:             (.id // null),
    pressure_kPa:   (.pressure_kPa // null),
    temperature_C:  (.temperature_C // null),
    flags:          (.flags // null),
    freq:           (.freq // null),
    rssi:           (.rssi // null)
  }' 2>/dev/null) || return 1

  local model type id time freq rssi pressure_kPa temperature_C flags
  model=$(echo "$extracted" | jq -r '.model // empty')
  type=$(echo "$extracted" | jq -r '.type // empty')
  id=$(echo "$extracted" | jq -r '.id // empty')
  time=$(echo "$extracted" | jq -r '.time // empty')
  freq=$(echo "$extracted" | jq -r '.freq // empty')
  rssi=$(echo "$extracted" | jq -r '.rssi // empty')
  pressure_kPa=$(echo "$extracted" | jq -r '.pressure_kPa // empty')
  temperature_C=$(echo "$extracted" | jq -r '.temperature_C // empty')
  flags=$(echo "$extracted" | jq -r '.flags // empty')

  # Skip lines without a model
  [[ -z "$model" ]] && return 0

  # Determine protocol
  local protocol
  if is_tpms "$model" "$type"; then
    protocol="tpms"
  else
    # Normalize model name as protocol
    protocol=$(echo "$model" | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
  fi

  # Convert observedAt to ISO 8601 (rtl_433 uses "YYYY-MM-DD HH:MM:SS" in UTC with -M time:utc)
  local observed_at
  if [[ -n "$time" ]]; then
    observed_at="${time/ /T}Z"
  else
    observed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  fi

  # Convert frequency MHz → Hz integer
  local freq_hz=""
  if [[ -n "$freq" && "$freq" != "null" ]]; then
    freq_hz=$(awk "BEGIN {printf \"%.0f\", $freq * 1000000}")
  fi

  # Build signature: only stable fields (id, model) sorted lexicographically
  local sig_parts=""
  # Sort: id before model alphabetically
  if [[ -n "$id" ]]; then
    sig_parts="id=${id}"
  fi
  if [[ -n "$model" ]]; then
    [[ -n "$sig_parts" ]] && sig_parts="${sig_parts}&"
    sig_parts="${sig_parts}model=${model}"
  fi
  local sig_input="rf-telemetry-v1:${protocol}:${sig_parts}"
  local signature
  signature=$(compute_sha256 "$sig_input")

  # Build fields object
  local fields_json
  if is_tpms "$model" "$type"; then
    # TPMS: curated fields
    fields_json=$(jq -cn \
      --arg model "$model" \
      --arg id "$id" \
      --arg pressure_kPa "$pressure_kPa" \
      --arg temperature_C "$temperature_C" \
      --arg flags "$flags" \
      '{model: $model} +
       (if $id != "" then {id: $id} else {} end) +
       (if $pressure_kPa != "" then {pressure_kPa: ($pressure_kPa | tonumber)} else {} end) +
       (if $temperature_C != "" then {temperature_C: ($temperature_C | tonumber)} else {} end) +
       (if $flags != "" then {flags: $flags} else {} end)')
  else
    # Non-TPMS: pass through all data fields (drop metadata: time, freq, rssi, snr, noise, mod, mic)
    fields_json=$(echo "$line" | jq -c 'del(.time, .freq, .rssi, .snr, .noise, .mod, .mic)')
  fi

  # Build observation JSON
  local obs_args=(
    --arg observedAt "$observed_at"
    --arg protocol "$protocol"
    --arg signature "$signature"
    --argjson fields "$fields_json"
    --arg raw "$line"
  )

  # Optional numeric fields
  local obs_template='{
    observedAt: $observedAt,
    protocol:   $protocol,
    signature:  $signature,
    fields:     $fields,
    raw:        $raw
  }'

  if [[ -n "$freq_hz" ]]; then
    obs_args+=(--argjson frequencyHz "$freq_hz")
    obs_template='{
      observedAt:  $observedAt,
      protocol:    $protocol,
      frequencyHz: $frequencyHz,
      signature:   $signature,
      fields:      $fields,
      raw:         $raw
    }'
  fi

  if [[ -n "$rssi" && "$rssi" != "null" ]]; then
    obs_args+=(--argjson rssi "$rssi")
    if [[ -n "$freq_hz" ]]; then
      obs_template='{
        observedAt:  $observedAt,
        protocol:    $protocol,
        frequencyHz: $frequencyHz,
        rssi:        $rssi,
        signature:   $signature,
        fields:      $fields,
        raw:         $raw
      }'
    else
      obs_template='{
        observedAt: $observedAt,
        protocol:   $protocol,
        rssi:       $rssi,
        signature:  $signature,
        fields:     $fields,
        raw:        $raw
      }'
    fi
  fi

  jq -cn "${obs_args[@]}" "$obs_template"
}

# --- Build rtl_433 command ---
build_rtl_433_cmd() {
  local cmd=(rtl_433 -F json -M time:utc -M level)

  if [[ -n "${RTL_433_FREQ:-}" ]]; then
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

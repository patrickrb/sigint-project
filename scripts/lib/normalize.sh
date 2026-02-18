#!/usr/bin/env bash
# Shared normalization functions for RF adapters
# Source this file: . "$(dirname "$0")/../lib/normalize.sh"

# --- SHA-256 helper ---
# Requires SHA_CMD to be set (sha256sum or shasum -a 256)
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

# --- Normalize one rtl_433-format JSON line -> observation NDJSON ---
# Expects: $line (raw JSON), $SHA_CMD (set by caller)
# Outputs: one observation JSON line to stdout
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
    rssi:           (.rssi // null),
    snr:            (.snr // null),
    noise:          (.noise // null),
    mod:            (.mod // null)
  }' 2>/dev/null) || return 1

  local model type id time freq rssi snr noise mod pressure_kPa temperature_C flags
  model=$(echo "$extracted" | jq -r '.model // empty')
  type=$(echo "$extracted" | jq -r '.type // empty')
  id=$(echo "$extracted" | jq -r '.id // empty')
  time=$(echo "$extracted" | jq -r '.time // empty')
  freq=$(echo "$extracted" | jq -r '.freq // empty')
  rssi=$(echo "$extracted" | jq -r '.rssi // empty')
  snr=$(echo "$extracted" | jq -r '.snr // empty')
  noise=$(echo "$extracted" | jq -r '.noise // empty')
  mod=$(echo "$extracted" | jq -r '.mod // empty')
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

  # Convert frequency MHz -> Hz integer
  local freq_hz=""
  if [[ -n "$freq" && "$freq" != "null" ]]; then
    freq_hz=$(awk "BEGIN {printf \"%.0f\", $freq * 1000000}")
  fi

  # Build signature: only stable fields (id, model) sorted lexicographically
  local sig_parts=""
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
    # Non-TPMS: pass through all data fields (drop metadata that's promoted to observation level)
    fields_json=$(echo "$line" | jq -c 'del(.time, .freq, .rssi, .snr, .noise, .mod, .mic, .protocol)')
  fi

  # Build observation JSON — start with required fields, add optional ones dynamically
  local obs_args=(
    --arg observedAt "$observed_at"
    --arg protocol "$protocol"
    --arg signature "$signature"
    --argjson fields "$fields_json"
    --arg raw "$line"
  )

  # Base object with required fields
  local obs_filter='{
    observedAt: $observedAt,
    protocol:   $protocol,
    signature:  $signature,
    fields:     $fields,
    raw:        $raw
  }'

  # Add optional numeric/string fields
  if [[ -n "$freq_hz" ]]; then
    obs_args+=(--argjson frequencyHz "$freq_hz")
    obs_filter="$obs_filter + {frequencyHz: \$frequencyHz}"
  fi

  if [[ -n "$rssi" && "$rssi" != "null" ]]; then
    obs_args+=(--argjson rssi "$rssi")
    obs_filter="$obs_filter + {rssi: \$rssi}"
  fi

  if [[ -n "$snr" && "$snr" != "null" ]]; then
    obs_args+=(--argjson snr "$snr")
    obs_filter="$obs_filter + {snr: \$snr}"
  fi

  if [[ -n "$noise" && "$noise" != "null" ]]; then
    obs_args+=(--argjson noise "$noise")
    obs_filter="$obs_filter + {noise: \$noise}"
  fi

  if [[ -n "$mod" && "$mod" != "null" ]]; then
    obs_args+=(--arg modulation "$mod")
    obs_filter="$obs_filter + {modulation: \$modulation}"
  fi

  jq -cn "${obs_args[@]}" "$obs_filter"
}

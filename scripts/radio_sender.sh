#!/usr/bin/env bash
set -euo pipefail

# Read NDJSON from stdin, batch, and send to RF Telemetry API
# Usage: ./scripts/generate_simulated_observations.sh | SENDER_TOKEN=xxx SENDER_ID=yyy ./scripts/radio_sender.sh [-H host]

# Parse command-line options
while [[ $# -gt 0 ]]; do
  case "$1" in
    -H|--host)
      API_URL="$2"
      shift 2
      ;;
    --freq)
      FREQ="$2"
      shift 2
      ;;
    --protocol)
      PROTOCOL="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: radio_sender.sh [-H|--host URL] [--freq FREQ] [--protocol PROTOCOL]" >&2
      exit 1
      ;;
  esac
done

API_URL="${API_URL:-http://localhost:4000}"
FREQ="${FREQ:-}"
PROTOCOL="${PROTOCOL:-}"
SENDER_TOKEN="${SENDER_TOKEN:?SENDER_TOKEN is required}"
SENDER_ID="${SENDER_ID:-sender-1}"
BATCH_SIZE="${SENDER_BATCH_SIZE:-50}"
BATCH_INTERVAL_MS="${SENDER_BATCH_INTERVAL_MS:-2000}"
MAX_RETRY_DELAY=30

BATCH=()
LAST_SEND=$(date +%s%N)
RETRY_DELAY=1

log() { echo "[radio_sender] $*" >&2; }

send_batch() {
  local count=${#BATCH[@]}
  if (( count == 0 )); then return 0; fi

  # Build JSON array
  local json_array
  json_array=$(printf '%s\n' "${BATCH[@]}" | jq -sc '.')

  local payload
  payload=$(jq -cn --argjson obs "$json_array" '{ observations: $obs }')

  BATCH=()
  LAST_SEND=$(date +%s%N)

  # Try WebSocket first (via websocat), fall back to HTTP
  if command -v websocat &>/dev/null; then
    send_ws "$payload" "$count" && return 0
    log "WebSocket failed, falling back to HTTP"
  fi

  send_http "$payload" "$count"
}

send_ws() {
  local payload="$1"
  local count="$2"
  local ws_url="${API_URL/http/ws}/ws/ingest?token=${SENDER_TOKEN}"

  local response
  response=$(echo "$payload" | websocat -1 "$ws_url" 2>/dev/null) || return 1

  local ok
  ok=$(echo "$response" | jq -r '.ok // empty' 2>/dev/null)
  if [[ "$ok" == "true" ]]; then
    RETRY_DELAY=1
    log "Sent $count observations via WebSocket"
    return 0
  fi
  return 1
}

send_http() {
  local payload="$1"
  local count="$2"

  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${API_URL}/api/ingest" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${SENDER_TOKEN}" \
    -d "$payload" \
    --max-time 10) || http_code=0

  if (( http_code >= 200 && http_code < 300 )); then
    RETRY_DELAY=1
    log "Sent $count observations via HTTP (${http_code})"
    return 0
  fi

  log "HTTP send failed (status: ${http_code}), retrying in ${RETRY_DELAY}s..."
  sleep "$RETRY_DELAY"
  RETRY_DELAY=$(( RETRY_DELAY * 2 ))
  if (( RETRY_DELAY > MAX_RETRY_DELAY )); then
    RETRY_DELAY=$MAX_RETRY_DELAY
  fi
  return 1
}

elapsed_ms() {
  local now
  now=$(date +%s%N)
  echo $(( (now - LAST_SEND) / 1000000 ))
}

log "Starting sender (batch_size=$BATCH_SIZE, interval=${BATCH_INTERVAL_MS}ms)"
log "API: $API_URL"

while IFS= read -r line || [[ -n "$line" ]]; do
  # Skip empty lines
  [[ -z "$line" ]] && continue

  # Validate JSON
  if ! echo "$line" | jq empty 2>/dev/null; then
    log "Skipping invalid JSON line"
    continue
  fi

  BATCH+=("$line")

  # Send if batch is full or interval elapsed
  if (( ${#BATCH[@]} >= BATCH_SIZE )) || (( $(elapsed_ms) >= BATCH_INTERVAL_MS )); then
    send_batch || true
  fi
done

# Send remaining
send_batch || true
log "Sender finished"

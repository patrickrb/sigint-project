#!/usr/bin/env bash
set -euo pipefail

# Generate simulated RF observations as NDJSON to stdout
# Usage: ./scripts/generate_simulated_observations.sh | ./scripts/radio_sender.sh

RATE="${SIMULATOR_RATE:-2}"  # observations per second
DELAY=$(awk "BEGIN {printf \"%.3f\", 1.0 / $RATE}")

# Known device IDs (will produce consistent signatures)
KNOWN_DEVICES=(
  "device_id=thermometer-kitchen:channel=1"
  "device_id=thermometer-garage:channel=2"
  "device_id=humidity-basement:channel=1"
  "device_id=door-front:channel=1"
  "device_id=weather-station-1:channel=3"
)

PROTOCOLS=("temperature" "humidity" "door_sensor" "motion" "weather_station")
FREQUENCIES=(433920000 315000000 868000000 915000000 433920000)

generate_known() {
  local idx=$((RANDOM % ${#KNOWN_DEVICES[@]}))
  local device="${KNOWN_DEVICES[$idx]}"
  local protocol="${PROTOCOLS[$idx]}"
  local freq="${FREQUENCIES[$idx]}"
  local rssi=$(( -(RANDOM % 60 + 30) ))

  # Parse device fields
  local device_id
  local channel
  device_id=$(echo "$device" | cut -d: -f1 | cut -d= -f2)
  channel=$(echo "$device" | cut -d: -f2 | cut -d= -f2)

  local value=""
  case "$protocol" in
    temperature)   value=$(awk "BEGIN {printf \"%.1f\", 15 + ($(( RANDOM % 200 )) / 10.0)}");;
    humidity)      value=$(( RANDOM % 60 + 30 ));;
    door_sensor)   value=$(( RANDOM % 2 ));;
    motion)        value=$(( RANDOM % 2 ));;
    weather_station) value=$(awk "BEGIN {printf \"%.1f\", -5 + ($(( RANDOM % 400 )) / 10.0)}");;
  esac

  jq -cn \
    --arg protocol "$protocol" \
    --argjson freq "$freq" \
    --argjson rssi "$rssi" \
    --arg device_id "$device_id" \
    --argjson channel "$channel" \
    --arg value "$value" \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
    '{
      observedAt: $ts,
      protocol: $protocol,
      frequencyHz: $freq,
      rssi: $rssi,
      fields: {
        device_id: $device_id,
        channel: $channel,
        value: $value
      }
    }'
}

generate_unknown() {
  local protocol="${PROTOCOLS[$((RANDOM % ${#PROTOCOLS[@]}))]}"
  local freq="${FREQUENCIES[$((RANDOM % ${#FREQUENCIES[@]}))]}"
  local rssi=$(( -(RANDOM % 60 + 30) ))
  local rnd_id="unknown-$(printf '%04x' $((RANDOM % 65536)))"

  jq -cn \
    --arg protocol "$protocol" \
    --argjson freq "$freq" \
    --argjson rssi "$rssi" \
    --arg device_id "$rnd_id" \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
    '{
      observedAt: $ts,
      protocol: $protocol,
      frequencyHz: $freq,
      rssi: $rssi,
      fields: {
        device_id: $device_id,
        channel: 0,
        value: "0"
      }
    }'
}

echo "Generating observations at ${RATE}/sec..." >&2

while true; do
  # 70% known, 30% unknown
  if (( RANDOM % 10 < 7 )); then
    generate_known
  else
    generate_unknown
  fi
  sleep "$DELAY"
done

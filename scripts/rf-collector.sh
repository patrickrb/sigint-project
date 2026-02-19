#!/usr/bin/env bash
set -euo pipefail

# RF Collector — launches a radio adapter and pipes output to radio_sender.sh
#
# Usage:
#   SENDER_TOKEN=xxx ./scripts/rf-collector.sh [--adapter rtl_433] [--freq 315M] [--protocol tpms]
#
# Env vars:
#   SENDER_TOKEN       - Required. Device JWT for API auth
#   API_URL            - API endpoint. Default: http://localhost:4000
#   RF_ADAPTER         - Adapter name. Default: rtl_433 (overridden by --adapter)
#   RTL_433_FREQ       - Frequency for rtl_433 (overridden by --freq)
#   RTL_433_DEVICE     - Device index/serial for rtl_433
#   RTL_433_GAIN       - Gain setting for rtl_433
#   RTL_433_PROTOCOLS  - Protocol filter for rtl_433 (e.g. "tpms")
#   RTL_433_EXTRA_ARGS - Extra args for rtl_433

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo "[rf-collector] $*" >&2; }

# --- Defaults ---
ADAPTER="${RF_ADAPTER:-rtl_433}"

# --- Parse args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --adapter)
      ADAPTER="$2"
      shift 2
      ;;
    --freq)
      export RTL_433_FREQ="$2"
      shift 2
      ;;
    --freqs)
      export RTL_433_FREQS="$2"
      shift 2
      ;;
    --protocol)
      export RTL_433_PROTOCOLS="$2"
      shift 2
      ;;
    --hackrf-freq-min)
      export HACKRF_FREQ_MIN="$2"
      shift 2
      ;;
    --hackrf-freq-max)
      export HACKRF_FREQ_MAX="$2"
      shift 2
      ;;
    --hackrf-serial)
      export HACKRF_SERIAL="$2"
      shift 2
      ;;
    --hackrf-lna-gain)
      export HACKRF_LNA_GAIN="$2"
      shift 2
      ;;
    --hackrf-vga-gain)
      export HACKRF_VGA_GAIN="$2"
      shift 2
      ;;
    --hackrf-sweep-min)
      export HACKRF_SWEEP_MIN="$2"
      shift 2
      ;;
    --hackrf-sweep-max)
      export HACKRF_SWEEP_MAX="$2"
      shift 2
      ;;
    --sweep-baseline)
      export SWEEP_BASELINE_SECONDS="$2"
      shift 2
      ;;
    --sweep-sigma)
      export SWEEP_ANOMALY_SIGMA="$2"
      shift 2
      ;;
    --sweep-interval)
      export SWEEP_EMIT_INTERVAL="$2"
      shift 2
      ;;
    --ble-dwell-ms)
      export BLE_CHANNEL_DWELL_MS="$2"
      shift 2
      ;;
    --ble-dedup)
      export BLE_DEDUP_SECONDS="$2"
      shift 2
      ;;
    --ble-sample-rate)
      export BLE_SAMPLE_RATE="$2"
      shift 2
      ;;
    --help|-h)
      cat >&2 <<EOF
RF Collector — capture radio observations and ship to API

Usage:
  SENDER_TOKEN=xxx ./scripts/rf-collector.sh [OPTIONS]

Options:
  --adapter NAME          Radio adapter (default: rtl_433)
                          Available: rtl_433, hackrf, hackrf_sweep, hackrf_ble
  --freq FREQ             Single frequency (e.g. 315M, 433.92M)
  --freqs FREQS           Comma-separated frequencies for hopping (e.g. 433.92M,315M)
  --protocol PROTO        Protocol filter (e.g. tpms)
  --hackrf-freq-min FREQ  HackRF minimum frequency (e.g. 300M)
  --hackrf-freq-max FREQ  HackRF maximum frequency (e.g. 928M)
  --hackrf-serial SN      HackRF device serial number
  --hackrf-lna-gain DB    HackRF LNA gain (0-40 dB)
  --hackrf-vga-gain DB    HackRF VGA gain (0-62 dB)

  Wideband Sweep (--adapter hackrf_sweep):
  --hackrf-sweep-min MHZ  Sweep start frequency in MHz (default: 1)
  --hackrf-sweep-max MHZ  Sweep end frequency in MHz (default: 6000)
  --sweep-baseline SECS   Baseline learning duration (default: 300)
  --sweep-sigma N         Anomaly sigma threshold (default: 3.0)
  --sweep-interval N      Emit baseline every N sweeps (default: 10)

  BLE Capture (--adapter hackrf_ble):
  --ble-dwell-ms MS       Dwell time per channel (default: 200)
  --ble-dedup SECS        Dedup window per device (default: 10)
  --ble-sample-rate HZ    Sample rate (default: 4000000)

  --help                  Show this help

Environment:
  SENDER_TOKEN       Required. Device JWT for API authentication
  API_URL            API endpoint (default: http://localhost:4000)
  RF_ADAPTER         Adapter name (default: rtl_433)
  RTL_433_DEVICE     Device index or serial number
  RTL_433_GAIN       Gain setting
  RTL_433_EXTRA_ARGS Additional rtl_433 arguments

Examples:
  # TPMS on US frequency
  SENDER_TOKEN=xxx ./scripts/rf-collector.sh --freq 315M --protocol tpms

  # Multi-frequency hopping
  SENDER_TOKEN=xxx ./scripts/rf-collector.sh --freqs 433.92M,315M

  # HackRF wide-band capture (sub-GHz ISM)
  SENDER_TOKEN=xxx ./scripts/rf-collector.sh --adapter hackrf --hackrf-freq-min 300M --hackrf-freq-max 928M

  # HackRF wideband sweep (1 MHz - 6 GHz anomaly detection)
  SENDER_TOKEN=xxx ./scripts/rf-collector.sh --adapter hackrf_sweep --hackrf-sweep-min 1 --hackrf-sweep-max 6000

  # HackRF BLE capture (2.4 GHz advertising channels)
  SENDER_TOKEN=xxx ./scripts/rf-collector.sh --adapter hackrf_ble --ble-dwell-ms 200
EOF
      exit 0
      ;;
    *)
      log "Unknown option: $1"
      exit 1
      ;;
  esac
done

# --- Validate ---
: "${SENDER_TOKEN:?SENDER_TOKEN is required}"

ADAPTER_PATH="${SCRIPT_DIR}/adapters/${ADAPTER}.sh"
if [[ ! -x "$ADAPTER_PATH" ]]; then
  log "ERROR: Adapter not found or not executable: $ADAPTER_PATH"
  log "Available adapters:"
  for f in "${SCRIPT_DIR}"/adapters/*.sh; do
    [[ -x "$f" ]] && log "  $(basename "$f" .sh)"
  done
  exit 1
fi

SENDER_PATH="${SCRIPT_DIR}/radio_sender.sh"
if [[ ! -x "$SENDER_PATH" ]]; then
  log "ERROR: radio_sender.sh not found at $SENDER_PATH"
  exit 1
fi

# --- Startup banner ---
log "============================================"
log " RF Collector"
log "============================================"
log " Adapter:   $ADAPTER"
log " API:       ${API_URL:-http://localhost:4000}"
[[ -n "${RTL_433_FREQS:-}" ]]      && log " Frequencies: $RTL_433_FREQS (hopping)"
[[ -n "${RTL_433_FREQ:-}" && -z "${RTL_433_FREQS:-}" ]] && log " Frequency: $RTL_433_FREQ"
[[ -n "${RTL_433_PROTOCOLS:-}" ]] && log " Protocols: $RTL_433_PROTOCOLS"
[[ -n "${RTL_433_DEVICE:-}" ]]    && log " Device:    $RTL_433_DEVICE"
[[ -n "${RTL_433_GAIN:-}" ]]      && log " Gain:      $RTL_433_GAIN"
[[ -n "${HACKRF_FREQ_MIN:-}" ]]       && log " HackRF Min:   $HACKRF_FREQ_MIN"
[[ -n "${HACKRF_FREQ_MAX:-}" ]]       && log " HackRF Max:   $HACKRF_FREQ_MAX"
[[ -n "${HACKRF_SERIAL:-}" ]]         && log " HackRF SN:    $HACKRF_SERIAL"
[[ -n "${HACKRF_SWEEP_MIN:-}" ]]      && log " Sweep Min:    ${HACKRF_SWEEP_MIN} MHz"
[[ -n "${HACKRF_SWEEP_MAX:-}" ]]      && log " Sweep Max:    ${HACKRF_SWEEP_MAX} MHz"
[[ -n "${SWEEP_BASELINE_SECONDS:-}" ]] && log " Baseline:     ${SWEEP_BASELINE_SECONDS}s"
[[ -n "${SWEEP_ANOMALY_SIGMA:-}" ]]   && log " Sigma:        $SWEEP_ANOMALY_SIGMA"
[[ -n "${BLE_CHANNEL_DWELL_MS:-}" ]]  && log " BLE Dwell:    ${BLE_CHANNEL_DWELL_MS}ms"
[[ -n "${BLE_DEDUP_SECONDS:-}" ]]     && log " BLE Dedup:    ${BLE_DEDUP_SECONDS}s"
log "============================================"

# --- Signal handling: kill entire process group on exit ---
cleanup() {
  trap - SIGINT SIGTERM EXIT
  log "Shutting down..."
  kill 0 2>/dev/null || true
  wait 2>/dev/null || true
  log "Stopped."
}
trap cleanup SIGINT SIGTERM EXIT

# --- Launch pipeline: adapter | sender ---
"$ADAPTER_PATH" | "$SENDER_PATH" &
wait $!

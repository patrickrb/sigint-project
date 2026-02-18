# RF Adapters

Adapters are executable scripts that interface with SDR hardware and produce normalized observation data.

## Adapter Contract

Every adapter in `scripts/adapters/` must follow this interface:

### Input
- **Configuration**: via environment variables (adapter-specific)
- **No stdin required** (unless in test mode)

### Output
- **stdout**: NDJSON — one observation JSON object per line matching the API observation schema:
  ```json
  {"observedAt":"2025-01-15T12:00:00Z","protocol":"acurite-tower","frequencyHz":433920000,"rssi":-45.2,"snr":18.5,"noise":-92.1,"modulation":"ASK","signature":"abc123...","fields":{...},"raw":"..."}
  ```
- **stderr**: logging only, prefixed with adapter name (e.g. `[rtl_433_adapter]`)

### Required Fields
| Field | Type | Description |
|-------|------|-------------|
| `observedAt` | ISO 8601 string | When the signal was observed |
| `protocol` | string | Protocol identifier (lowercase, hyphenated) |
| `signature` | string | SHA-256 device fingerprint |
| `fields` | object | Protocol-specific data fields |

### Optional Fields
| Field | Type | Description |
|-------|------|-------------|
| `frequencyHz` | integer | Frequency in Hz |
| `rssi` | number | Received signal strength (dBm) |
| `snr` | number | Signal-to-noise ratio (dB) |
| `noise` | number | Noise floor level (dBm) |
| `modulation` | string | Modulation type (ASK, FSK, OOK, etc.) |
| `raw` | string | Original raw JSON from hardware |

### Lifecycle
- Long-lived process: runs until killed (SIGINT/SIGTERM)
- Piped to `radio_sender.sh` by `rf-collector.sh`
- Must handle graceful shutdown

## Shared Library

All adapters should source the shared normalization library:
```bash
. "$(dirname "$0")/../lib/normalize.sh"
```

This provides:
- `normalize_line "$json_line"` — converts rtl_433-format JSON to observation NDJSON
- `compute_sha256 "$string"` — cross-platform SHA-256 hash (requires `$SHA_CMD` to be set)
- `is_tpms "$model" "$type"` — TPMS protocol detection

## Available Adapters

### rtl_433
RTL-SDR adapter using `rtl_433` for signal decoding.

| Env Var | Description |
|---------|-------------|
| `RTL_433_FREQ` | Single frequency (e.g. `433.92M`) |
| `RTL_433_FREQS` | Comma-separated frequencies for hopping (e.g. `433.92M,315M`) |
| `RTL_433_DEVICE` | Device index or serial number |
| `RTL_433_GAIN` | Gain setting |
| `RTL_433_PROTOCOLS` | Protocol filter (`tpms` for TPMS-only) |
| `RTL_433_EXTRA_ARGS` | Additional rtl_433 arguments |
| `RTL_433_STDIN` | Set to `true` to read JSON from stdin (testing) |

### hackrf
HackRF adapter using `hackrf_transfer` for IQ capture piped to `rtl_433` for decoding.

| Env Var | Description |
|---------|-------------|
| `HACKRF_FREQ_MIN` | Minimum frequency (e.g. `300M`) |
| `HACKRF_FREQ_MAX` | Maximum frequency (e.g. `928M`) |
| `HACKRF_SERIAL` | HackRF device serial number |
| `HACKRF_LNA_GAIN` | LNA gain (0-40 dB, 8 dB steps) |
| `HACKRF_VGA_GAIN` | VGA gain (0-62 dB, 2 dB steps) |
| `HACKRF_SAMPLE_RATE` | Sample rate (default: 2M) |

## Multi-SDR Setup

Run multiple collectors simultaneously, each with its own sender token:

```bash
# Terminal 1: RTL-SDR on 433/315 MHz
SENDER_TOKEN=token1 ./scripts/rf-collector.sh --adapter rtl_433 --freqs 433.92M,315M

# Terminal 2: HackRF sweeping wider spectrum
SENDER_TOKEN=token2 ./scripts/rf-collector.sh --adapter hackrf --hackrf-freq-min 300M --hackrf-freq-max 928M
```

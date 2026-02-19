# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RF Home Telemetry Dashboard — a privacy-minded, receive-only RF telemetry monitoring system. Ingests observation events from radio receivers, classifies them against a whitelist, and displays live telemetry in a web dashboard. Supports RTL-SDR (sub-GHz ISM), HackRF wideband spectrum sweep (1 MHz–6 GHz), and HackRF BLE capture (2.4 GHz advertising channels).

## Commands

### Development

```bash
# Docker dev (recommended) — starts all services with hot reload
cp .env.example .env
docker compose up --build

# Then seed the database (from host, DATABASE_URL pointing to localhost:5432)
npm run db:push
npm run db:seed

# Local dev (requires Node 20+, PostgreSQL running)
npm install
npm run db:generate    # Generate Prisma client
npm run db:push        # Push schema to DB
npm run db:seed        # Seed demo data
npm run dev:api        # Express API on port 4000
npm run dev:web        # Next.js dashboard on port 3000
npm run dev:worker     # Background classifier worker
```

### Testing

```bash
npm test                                  # All workspaces
cd src/shared && npx vitest run           # Shared tests (26 tests)
cd src/api && npx vitest run              # API tests (3 tests)
npx vitest run path/to/file.test.ts       # Single test file
```

### Building

```bash
npm run build                             # Build all workspaces
cd src/shared && npx tsc                  # Build shared (must be built before api/worker)
```

### Database

```bash
npm run db:generate    # Regenerate Prisma client after schema changes
npm run db:push        # Push schema to DB (dev)
npm run db:migrate     # Run migrations (prod)
npm run db:seed        # Seed demo data
```

### Simulating RF Data

```bash
export SENDER_TOKEN="sender-token-alpha-00000000"
export SENDER_ID="<sender-id-from-seed>"
./scripts/generate_simulated_observations.sh | ./scripts/radio_sender.sh
```

### Edge Setup & RF Collection

```bash
# Install edge dependencies (RTL-SDR, HackRF tools, Python, numpy)
./scripts/setup-edge.sh                    # Full install
./scripts/setup-edge.sh --skip-hackrf      # Skip HackRF/Python deps
./scripts/setup-edge.sh --skip-optional    # Skip websocat

# RTL-SDR collection
SENDER_TOKEN=xxx ./scripts/rf-collector.sh --freq 315M --protocol tpms

# HackRF wideband sweep (1 MHz–6 GHz anomaly detection)
SENDER_TOKEN=xxx ./scripts/rf-collector.sh --adapter hackrf_sweep

# HackRF BLE capture (2.4 GHz advertising channels)
SENDER_TOKEN=xxx ./scripts/rf-collector.sh --adapter hackrf_ble --ble-dwell-ms 200
```

### Linting

```bash
npm run lint           # ESLint across all .ts/.tsx files
```

## Architecture

npm workspaces monorepo with 4 packages (namespace: `@rf-telemetry/`):

```
src/shared/                    → @rf-telemetry/shared (Prisma + Zod schemas + utilities)
src/api/                       → @rf-telemetry/api (Express REST + WebSocket + SSE, port 4000)
src/web/                       → @rf-telemetry/web (Next.js 15 + Tailwind + recharts, port 3000)
services/data-processor-worker → @rf-telemetry/worker (polling-based classifier + alerting)
scripts/                       → Bash adapters, Python processors, and RF data senders
```

**Dependency flow**: shared → api, web, worker (shared must be built first via `tsc`)

### Shared Package (`src/shared`)

Foundation package — all other packages depend on it. Exports:
- Prisma client + all model types and enums
- Zod validation schemas (observation, sender, whitelist, rule, alert, auth, protocol-rule)
- Utilities: signature generation (`utils/signature`), protocol matching (`utils/protocol-match`), constants

Main entry is `dist/index.js` — **must be compiled with `tsc` before other packages can use it**.

### API (`src/api`)

Express server with:
- REST routes in `src/routes/` (auth, senders, ingest, observations, whitelist, rules, alerts, events, protocol-rules)
- WebSocket ingestion via `src/ws.ts`
- SSE for real-time updates via `src/services/sse.ts`
- Sender auth middleware: SHA-256 token hash lookup (`src/middleware/`)
- Token encryption: AES-256-GCM for sender token storage (`src/services/crypto.ts`)
- Protocol rules seeded on startup (`src/services/seed-protocol-rules.ts`)
- Alert rules seeded on startup (`src/services/seed-alert-rules.ts`) — disabled by default

### Web (`src/web`)

Next.js 15 App Router with React 19:
- Dashboard: `src/app/(dashboard)/dashboard/page.tsx`
- Spectrum Monitor: `src/app/(dashboard)/spectrum/page.tsx`
- Bluetooth Monitor: `src/app/(dashboard)/bluetooth/page.tsx`
- Navigation: `src/components/nav.tsx`
- Charts: `src/components/charts.tsx` (main), `spectrum-charts.tsx`, `ble-charts.tsx`
- All charts use recharts (AreaChart, BarChart, PieChart)
- Auth: NextAuth v5 with JWT sessions
- Event bus (`src/lib/events.ts`): `emitDataChanged()` / `onDataChanged(cb)` for cross-component instant refresh after mutations
- API aggregation endpoints use raw SQL (`prisma.$queryRaw`) with `date_trunc` bucketing

### Worker (`services/data-processor-worker`)

Polling-based (no job queue). Runs classification loop + retention cleanup:
- `src/classifier.ts`: PENDING → KNOWN (whitelist match) or UNKNOWN
- `src/rules.ts`: Evaluates alert rules (UNKNOWN_BURST, NEW_DEVICE, BLE_TRACKER, BLE_FLOOD, SPECTRUM_ANOMALY)
- `src/retention.ts`: Cleans old unknown observations based on `RETENTION_DAYS`

### Edge Scripts

RF adapter pipeline: `rf-collector.sh → adapter | radio_sender.sh → API ingest`

Adapters (`scripts/adapters/`):
- `rtl_433.sh` — RTL-SDR via rtl_433 JSON output + normalization
- `hackrf.sh` — HackRF IQ capture → rtl_433 decode (sub-GHz ISM)
- `hackrf_sweep.sh` — HackRF wideband sweep → Python anomaly detector
- `hackrf_ble.sh` — HackRF BLE capture → Python GFSK decoder

Python processors (`scripts/processors/`):
- `sweep_processor.py` — Welford's online algorithm for per-bin baseline, EMA adaptive tracking, anomaly detection. Emits `spectrum-anomaly` and `spectrum-baseline` NDJSON.
- `ble_processor.py` — Phase 2a: energy detection (burst counting per channel). Phase 2b: GFSK demod → BLE advertising PDU parsing (access address correlation, CRC-24, AD structures). MAC addresses SHA-256 hashed for privacy. Emits `ble-energy` and `ble-adv` NDJSON.
- `requirements.txt` — `numpy>=1.24.0`

## Classification System

- **KNOWN** = user explicitly approved via whitelist or "Approve" button. Never auto-assigned.
- **PENDING** = freshly ingested, not yet classified by worker.
- **UNKNOWN** = worker classified it, no whitelist match found.
- Ingest (REST + WS): checks whitelist only → KNOWN or PENDING.
- Worker classifier: whitelist → KNOWN, else → UNKNOWN.
- `POST /api/observations/:id/approve` creates whitelist entry + marks all matching signatures KNOWN.
- Whitelist DELETE reverts KNOWN observations back to UNKNOWN.
- ProtocolRule model is for informational labeling only, NOT auto-classification.

## Protocols

| Protocol | Source | Description |
|---|---|---|
| `tpms` | RTL-SDR/HackRF | Tire pressure monitoring sensors |
| `acurite-*`, `oregon-*`, etc. | RTL-SDR/HackRF | Weather stations |
| `spectrum-anomaly` | HackRF sweep | Power deviation beyond sigma threshold |
| `spectrum-baseline` | HackRF sweep | Periodic per-band power summary |
| `ble-energy` | HackRF BLE | Per-channel energy detection (burst count, RSSI) |
| `ble-adv` | HackRF BLE | Decoded BLE advertising PDU (MAC hash, device name, manufacturer) |

## Alert Rule Types

| RuleType | Description | Config |
|---|---|---|
| `UNKNOWN_BURST` | Too many unknown observations from a sender | `threshold`, `windowSeconds` |
| `NEW_DEVICE` | First-ever observation of a signature | (none) |
| `BLE_TRACKER` | BLE device seen persistently (potential tracking) | `minObservations`, `windowMinutes`, `excludeKnown` |
| `BLE_FLOOD` | Abnormal BLE advertising volume (jamming/fuzzing) | `threshold`, `windowSeconds` |
| `SPECTRUM_ANOMALY` | Persistent wideband power anomaly | `minStreakMinutes`, `minDeviationSigma` |

## Key Technical Notes

- Prisma JSON fields need `as object` cast when passing Zod-parsed `Record<string, unknown>`
- `@rf-telemetry/shared` re-exports Prisma types but namespace types like `Prisma.DbNull` aren't accessible — use `as never` cast
- Signal feed uses CSS grid with fixed `gridTemplateColumns` for aligned columns (not flex)
- `tsconfig.base.json` at repo root is extended by all packages and must be included in Docker COPY lines
- BLE MAC addresses are SHA-256 hashed (truncated to 16 hex chars) for privacy — never store raw MACs
- Observation signatures use `rf-telemetry-v1:{protocol}:{key=value&...}` convention hashed with SHA-256

## Docker Notes

- **Dev**: `docker compose up` uses `Dockerfile.dev` + volume mounts for hot reload
- **Prod**: `docker compose -f docker-compose.prod.yml up` uses multi-stage Dockerfiles
- Prisma schema changes require `docker compose build --no-cache` (Prisma generate is cached)
- New npm dependencies also require container rebuild
- API dev container runs `prisma db push` on startup
- Shared source changes require container restart (built once at startup, not watched)
- Alpine `wget` resolves `localhost` to IPv6 — use `127.0.0.1` in healthchecks
- `AUTH_TRUST_HOST=true` needed for NextAuth v5 in Docker

## Auth Credentials (Dev/Seed)

- Admin: `admin@local` / `admin123`
- Sender tokens: `sender-token-alpha-00000000`, `sender-token-bravo-00000000`

## Deployment

### Infrastructure

Deployed to **Azure Container Apps** (Consumption plan) with:
- **Container registry**: GHCR (`ghcr.io/patrickrb/signalsentry-{api,web,worker}`)
- **Azure auth**: OIDC federated credentials (no long-lived secrets)
- **Database**: Azure PostgreSQL Flexible Server (`primary-burns-db` in RG `burnsforce`)
- **DNS**: Azure DNS zone `signalsentry.io` in RG `signal-sentry`
- **ACA resources**: RG `rg-signalsentry-apps` in Central US

### Environments

| | Production | Staging (per PR) |
|---|---|---|
| **Web** | `signalsentry.io` (0.5 vCPU, 1Gi, 1-2 replicas) | `{auto}.azurecontainerapps.io` (0.25 vCPU, 0.5Gi, 0-1) |
| **API** | `api.signalsentry.io` (0.5 vCPU, 1Gi, 1-3, HTTP autoscale) | `{auto}.azurecontainerapps.io` (0.25 vCPU, 0.5Gi, 0-1) |
| **Worker** | No ingress (0.25 vCPU, 0.5Gi, 1 replica) | No ingress (0.25 vCPU, 0.5Gi, 1 replica) |
| **Database** | `signalsentry_prod` | `signalsentry_staging_pr_{N}` (ephemeral) |
| **ACA env** | `signalsentry-prod` | `signalsentry-staging` |

### Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | PR to main | Lint, test, build verification, Docker image build check |
| `deploy-staging.yml` | PR opened/synced to main | Build images, create staging DB, deploy 3 ACA apps, comment URLs on PR |
| `teardown-staging.yml` | PR closed | Delete ACA apps, drop staging DB, clean GHCR images |
| `deploy-production.yml` | Push to main | Build images, push schema, deploy 3 ACA apps, health check |

### Image Tags

- **Staging**: `pr-{N}-{sha7}` (e.g., `pr-42-a1b2c3d`)
- **Production**: `main-{sha7}` + `latest`

### NEXT_PUBLIC_API_URL

Next.js inlines `NEXT_PUBLIC_*` env vars at build time. The `Dockerfile.web` accepts a build arg:

```dockerfile
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
```

- **Production**: `https://api.signalsentry.io`
- **Staging**: `https://{api-fqdn}` (determined at deploy time, API deploys before web image is built)
- **Local/Docker Compose**: `http://localhost:4000` (default)

### GitHub Secrets

| Secret | Purpose |
|--------|---------|
| `AZURE_CLIENT_ID` | OIDC — AD app registration client ID |
| `AZURE_TENANT_ID` | OIDC — Azure AD tenant ID |
| `AZURE_SUBSCRIPTION_ID` | OIDC — subscription ID |
| `DATABASE_HOST` | `primary-burns-db.postgres.database.azure.com` |
| `DATABASE_ADMIN_USER` | Admin user for creating/dropping staging DBs |
| `DATABASE_ADMIN_PASSWORD` | Admin password |
| `DATABASE_APP_PASSWORD` | `signalsentry_app` user password |
| `PROD_JWT_SECRET` | 64-char hex for JWT signing |
| `PROD_NEXTAUTH_SECRET` | 64-char hex for NextAuth |
| `PROD_TOKEN_ENCRYPTION_KEY` | 64-char hex (32 bytes) for AES-256-GCM |
| `GHCR_PAT` | GitHub PAT with `read:packages` — used by ACA to pull images |

### Manual Operations

```bash
# View logs
az containerapp logs show --name signalsentry-prod-api --resource-group rg-signalsentry-apps --follow

# Restart a container app
az containerapp revision restart --name signalsentry-prod-api --resource-group rg-signalsentry-apps

# Scale manually
az containerapp update --name signalsentry-prod-api --resource-group rg-signalsentry-apps --min-replicas 2 --max-replicas 5

# Connect to production DB
psql "host=primary-burns-db.postgres.database.azure.com dbname=signalsentry_prod user=signalsentry_app sslmode=require"

# One-time infra setup
./scripts/azure-setup.sh

# DNS setup (after first production deploy)
./scripts/azure-setup.sh setup-dns
```

### Cost Estimate

| Resource | Monthly |
|----------|---------|
| ACA production (~1.25 vCPU always-on) | ~$5-15 |
| ACA staging (scale-to-zero) | ~$0-2 |
| Azure DNS zone | ~$0.50 |
| GHCR | Free |
| **Total additional** | **~$6-18/month** |

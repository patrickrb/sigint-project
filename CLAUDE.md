# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RF Home Telemetry Dashboard — a privacy-minded, receive-only RF telemetry monitoring system. Ingests observation events from radio receivers, classifies them against a whitelist, and displays live telemetry in a web dashboard.

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
cd src/shared && npx vitest run           # Shared tests (21 tests)
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
scripts/                       → Bash simulators and RF data senders
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

### Web (`src/web`)

Next.js 15 App Router with React 19:
- Dashboard page: `src/app/(dashboard)/dashboard/page.tsx`
- Navigation: `src/components/nav.tsx`
- Charts use recharts (AreaChart, BarChart, PieChart)
- Auth: NextAuth v5 with JWT sessions
- Event bus (`src/lib/events.ts`): `emitDataChanged()` / `onDataChanged(cb)` for cross-component instant refresh after mutations
- API aggregation endpoints use raw SQL (`prisma.$queryRaw`) with `date_trunc` bucketing

### Worker (`services/data-processor-worker`)

Polling-based (no job queue). Runs classification loop + retention cleanup:
- `src/classifier.ts`: PENDING → KNOWN (whitelist match) or UNKNOWN
- `src/rules.ts`: Evaluates alert rules (UNKNOWN_BURST, NEW_DEVICE)
- `src/retention.ts`: Cleans old unknown observations based on `RETENTION_DAYS`

## Classification System

- **KNOWN** = user explicitly approved via whitelist or "Approve" button. Never auto-assigned.
- **PENDING** = freshly ingested, not yet classified by worker.
- **UNKNOWN** = worker classified it, no whitelist match found.
- Ingest (REST + WS): checks whitelist only → KNOWN or PENDING.
- Worker classifier: whitelist → KNOWN, else → UNKNOWN.
- `POST /api/observations/:id/approve` creates whitelist entry + marks all matching signatures KNOWN.
- Whitelist DELETE reverts KNOWN observations back to UNKNOWN.
- ProtocolRule model is for informational labeling only, NOT auto-classification.

## Key Technical Notes

- Prisma JSON fields need `as object` cast when passing Zod-parsed `Record<string, unknown>`
- `@rf-telemetry/shared` re-exports Prisma types but namespace types like `Prisma.DbNull` aren't accessible — use `as never` cast
- Signal feed uses CSS grid with fixed `gridTemplateColumns` for aligned columns (not flex)
- `tsconfig.base.json` at repo root is extended by all packages and must be included in Docker COPY lines

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

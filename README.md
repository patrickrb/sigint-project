# RF Home Telemetry Dashboard

A privacy-minded, receive-only RF telemetry monitoring system. Receives normalized observation events from radio receivers, classifies them against a whitelist, and displays live telemetry in a dashboard.

## Architecture

| Component | Tech | Port |
|-----------|------|------|
| API | Express + WebSocket + SSE | 4000 |
| Web | Next.js 15 + Tailwind | 3000 |
| Worker | Node.js (pg polling) | — |
| Database | PostgreSQL | 5432 |

## Quick Start (Docker)

```bash
cp .env.example .env
docker compose up --build
```

Then run migrations and seed:

```bash
# From host (with DATABASE_URL pointing to localhost:5432)
npm run db:push
npm run db:seed
```

Open http://localhost:3000 and login with `admin@local` / `admin123`.

## Quick Start (Local Dev)

```bash
# Prerequisites: Node 20+, PostgreSQL running locally
cp .env.example .env
# Edit .env with your DATABASE_URL

npm install
npm run db:generate
npm run db:push
npm run db:seed

# Start all services (separate terminals)
npm run dev:api
npm run dev:worker
npm run dev:web
```

## Simulate RF Data

```bash
# Set these from the seed output
export SENDER_TOKEN="sender-token-alpha-00000000"
export SENDER_ID="<sender-id-from-seed>"

./scripts/generate_simulated_observations.sh | ./scripts/radio_sender.sh
```

Dependencies: `bash 4+`, `jq`, `curl` (and optionally `websocat` for WebSocket transport).

## Tests

```bash
npm test
```

## Project Structure

```
src/shared/          Prisma schema, Zod validation, utilities
src/api/             Express REST API + WebSocket ingestion + SSE
src/web/             Next.js 15 dashboard
services/data-processor-worker/   Background classifier + alerting
scripts/             Bash simulators and senders
```

## Key Features

- **Live dashboard** with SSE-powered real-time observation feed
- **Device fingerprinting** via SHA-256 signatures (privacy-preserving)
- **Whitelist management** — label known devices, auto-classify
- **Alerting rules** — unknown burst detection, new device detection
- **Sender management** — token-based auth for radio receivers
- **Data retention** — automatic cleanup of old unknown observations

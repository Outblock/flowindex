# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## General Rules

- When I ask to fix or change something, do NOT remove it entirely. Fix/improve the existing feature unless I explicitly say 'remove' or 'delete'.
- When I report that something looks wrong or data is bad, trust my observation. Do not dismiss it as 'working fine' or 'real data' without evidence. Investigate thoroughly first.
- When a debugging chain exceeds 3-4 failed attempts without clear progress, stop and provide a summary of what was tried, what was learned, and what the likely root cause is — so I can decide whether to continue or get external help.

## Project Structure

Always verify which server/project/directory a change should go in before starting work. Ask if ambiguous.

**Top-level directories:**
- `backend/` — Go indexer + API server
- `frontend/` — TanStack Start SSR app (React 19, TypeScript)
- `runner/` — Runner service (Cadence playground + wallet)
- `simulate/` — Transaction simulator (frontend landing page + Flow Emulator)
  - `simulate/frontend/` — TanStack Start landing page (deployed to Cloud Run)
  - `simulate/emulator/` — Flow Emulator in mainnet-fork mode (deployed to GCE VM)
- `wallet/` — Passkey wallet app (Vite + React 19, supports Flow Cadence + EVM)
  - `wallet/bundler/` — Alto ERC-4337 bundler + paymaster signing service (deployed to `flowindex-bundler` VM)
- `packages/` — Shared workspace packages (event-decoder, auth-core, evm-wallet, webhooks-sdk, etc.)
- `supabase/` — Self-hosted Supabase auth stack (edge functions, migrations, gateway)
- `devportal/` — Developer portal (Fumadocs + Scalar)
- `ai/` — AI chat assistant
- `sim-workflow/` — Simulation workflow
- `studio/` — Supabase Studio proxy
- `scripts/` — Utility scripts
  - `scripts/deploy-smart-wallet/` — Foundry project for deploying Coinbase Smart Wallet + VerifyingPaymaster to Flow-EVM

## Pre-Commit Checklist

After making changes, always run the build/lint check before committing. Fix any ESLint errors, TypeScript errors, or build failures before pushing. Never push code that doesn't build.

## Git Workflow

When pushing to main, always pull/rebase first to avoid non-fast-forward errors. Use `git pull --rebase origin main` before pushing.

**Branch hygiene:** After a feature branch is merged to main, delete it (`git push origin --delete <branch>`). Never re-merge an already-merged branch — this overwrites fixes that landed after the original merge. Before merging any branch, run `git log origin/main --oneline -- <changed-files>` to check if main already has newer changes to those files.

## Project Overview

FlowIndex is a high-performance blockchain explorer and indexer for the Flow blockchain with Flow-EVM support. It features a Go backend with concurrent block ingestion and a TanStack Start SSR frontend.

**Key Technologies:**
- Backend: Go 1.24+, PostgreSQL (pgx driver), Flow SDK, Gorilla WebSocket/Mux
- Frontend: React 19, TanStack Start (SSR via Nitro), TanStack Router, TypeScript, TailwindCSS, Shadcn/UI, Recharts
- Auth: Self-hosted Supabase (GoTrue + PostgREST + edge functions)
- Deployment: Docker, Docker Compose, GCP

## Development Commands

### Local Development (Docker Compose)
```bash
# Start all services
docker compose up -d --build

# View logs
docker compose logs -f backend
docker compose logs -f frontend

# Stop services
docker compose down

# Access points:
# - Frontend: http://localhost:5173
# - Backend API: http://localhost:8080
# - PostgreSQL: localhost:5432
# - Supabase Gateway: localhost:54321
# - Supabase Studio: localhost:8000
# - DevPortal: localhost:3001
```

### Backend (Go)
```bash
cd backend

go mod download && go mod tidy

# Build
CGO_CFLAGS="-std=gnu99" CGO_ENABLED=1 go build -o indexer main.go

# Run locally (requires PostgreSQL)
DB_URL=postgres://flowscan:secretpassword@localhost:5432/flowscan \
FLOW_ACCESS_NODE=access-001.mainnet28.nodes.onflow.org:9000 \
PORT=8080 \
./indexer

# Run migrations only
./indexer migrate

# Run tests
go test ./...
```

### Frontend (React/TanStack Start)
```bash
cd frontend

# Install dependencies (prefer bun)
bun install

# Development server
bun run dev

# Build for production (outputs to .output/)
bun run build

# Run production server
bun .output/server/index.mjs

# Lint
bun run lint

# Regenerate API client from OpenAPI specs
bun run gen:api
```

### Database Management
```bash
# Connect to local PostgreSQL
psql postgres://flowscan:secretpassword@localhost:5432/flowscan

# Run schema manually
psql postgres://flowscan:secretpassword@localhost:5432/flowscan < backend/schema_v2.sql

# Check indexing progress
psql -c "SELECT * FROM app.indexing_checkpoints;" postgres://flowscan:secretpassword@localhost:5432/flowscan
```

## Architecture

### Backend Architecture

The backend follows a concurrent pipeline architecture:

1. **Main Entry Point** (`backend/main.go`):
   - Two independent ingesters: Forward (live blocks) and Backward (history backfill)
   - LiveDerivers and HistoryDerivers: process derived data from raw blocks
   - Workers/Processors: async workers for tokens, EVM, staking, etc.
   - `RAW_ONLY=true` disables all workers/derivers (raw ingestion only)

2. **Ingester Service** (`internal/ingester/service.go`):
   - Manages block ingestion lifecycle in "forward" or "backward" mode
   - Coordinates worker pool, batch processing, checkpoint persistence

3. **Worker Pool** (`internal/ingester/worker.go`):
   - Workers fetch complete blocks with all transactions, events, and derived data
   - Returns `FetchResult` containing: Block, Transactions, Events, AddressActivity, TokenTransfers, AccountKeys
   - EVM detection via `import EVM` in script content

4. **Repository Layer** (`internal/repository/postgres.go`):
   - `SaveBlockData()`: Atomic batch insert of all block-related data
   - Uses PostgreSQL transactions + pgx `CopyFrom` for bulk inserts

5. **API Server** (`internal/api/server.go`):
   - REST endpoints: `/health`, `/status`, `/blocks`, `/transactions`, `/accounts/{address}`
   - V1 routes: `/flow/v1/...` (also at `/api/v1/flow/v1/...`)
   - WebSocket endpoint `/ws` for live updates

6. **Additional subsystems:**
   - `internal/eventbus/` — Event bus for webhook notifications
   - `internal/webhooks/` — Webhook delivery (Svix + direct HTTP + Discord/Slack)
   - `internal/market/` — Price feed (CoinGecko integration)

### Database Schema

Two schema files: `backend/schema_v2.sql` (main) and `backend/schema_webhooks.sql` (webhooks). Migrations run automatically on backend startup.

**Key schemas:**
- `raw.*` — Raw blockchain data: `blocks`, `transactions`, `events` (all partitioned), `tx_lookup`, `block_lookup`, `scripts`
- `app.*` — Derived/indexed data: `ft_transfers`, `nft_transfers`, `smart_contracts`, `contract_versions`, `ft_tokens`, `ft_holdings`, `nft_collections`, `nft_ownership`, `nft_items`, `account_keys`, `accounts`, `address_transactions`, `staking_nodes`, `staking_delegators`, `defi_pairs`, `defi_events`, `daily_stats`, `market_prices`, etc.
- `analytics.*` — Analytics: `daily_metrics`, etc.

**Conventions:**
- Addresses stored as lowercase hex without `0x` prefix
- EVM hashes stored lowercase without `0x` in `raw.tx_lookup.evm_hash`
- All timestamps use `TIMESTAMPTZ`
- JSONB columns for complex nested data

### Frontend Architecture

The frontend is a **TanStack Start SSR app** (NOT a plain React SPA). Source code is in `frontend/app/`, NOT `frontend/src/`.

1. **Routing** — TanStack Router with file-based routes in `frontend/app/routes/`
   - Key routes: `/blocks`, `/transactions` (also `/tx`, `/txs`), `/account/:address`, `/tokens`, `/nfts`, `/contracts`, `/nodes`, `/analytics`, `/stats`, `/developer`, `/playground`, `/admin`, `/api-docs`

2. **API Client** — `frontend/app/api.ts` (TypeScript, Axios-based)
   - Generated API clients from OpenAPI specs via `bun run gen:api` in `app/api/gen/`

3. **Server** — `frontend/server/` for custom Nitro server routes (OG image generation, etc.)

4. **Auth** — Supabase auth via `@supabase/supabase-js`

5. **Flow integration** — `@onflow/fcl` for Flow Client Library, Cadence codegen in `frontend/cadence/`

6. **UI stack** — Shadcn/UI (Radix primitives), TailwindCSS, Framer Motion, Lucide icons, Recharts, ReactFlow, Three.js

### Docker Compose Services

14+ services: `db` (PostgreSQL), `backend`, `frontend`, `supabase-db`, `supabase-auth` (GoTrue), `supabase-rest` (PostgREST), `supabase-gateway` (nginx), `supabase-meta`, `supabase-studio`, `studio-auth`, `passkey-auth`, `flow-keys`, `runner-projects`, `docs` (devportal), `alto-bundler`

### ERC-4337 Infrastructure (Flow-EVM)

**VM:** `flowindex-bundler` (GCE e2-micro, COS, us-central1-a, `10.128.0.6`)
**DNS:** `bundler.flowindex.io` (static IP `136.112.57.126`)

| Service | Port | URL |
|---------|------|-----|
| Alto Bundler | 4337 | `https://bundler.flowindex.io` |
| Paymaster Signer | 4338 | `https://bundler.flowindex.io/paymaster` |
| Caddy (TLS) | 443 | Routes to above |

**Deployed Contracts (Flow-EVM Testnet, chain 545):**
- EntryPoint v0.7: `0x0000000071727De22E5E9d8BAf0edAc6f37da032` (canonical, pre-deployed)
- CoinbaseSmartWalletFactory: `0xAc396ed9a5E949C685C3799657E26fE1d6fFf7E7`
- CoinbaseSmartWallet (impl): `0x0d956a72774534DE5bFc0dA88Fca589ba2378De0`
- VerifyingPaymaster: `0x348C96e048A6A01B1bD75b6218b65986717CC15a`

**Key package:** `packages/evm-wallet/` — ERC-4337 client SDK (factory, signer, bundler-client, UserOp construction, EIP-1193 provider, WalletConnect v2)

**CI/CD:** `deploy-infra.yml` (separate from `deploy.yml`) — triggers on `wallet/bundler/**` or `packages/evm-wallet/**` changes

## Workers (17 types)

`token_worker`, `evm_worker`, `meta_worker`, `accounts_worker`, `ft_holdings_worker`, `nft_ownership_worker`, `token_metadata_worker`, `nft_item_metadata_worker`, `nft_ownership_reconciler`, `tx_contracts_worker`, `tx_metrics_worker`, `staking_worker`, `defi_worker`, `daily_stats_worker`, `daily_balance_worker`, `analytics_deriver_worker`, `proposer_key_backfill`

Plus `webhook_processor` (in `internal/webhooks/`).

## Configuration

### Key Backend Environment Variables
- `DB_URL`: PostgreSQL connection string (required)
- `FLOW_ACCESS_NODE`: Flow gRPC endpoint (default: mainnet28)
- `FLOW_ACCESS_NODES`: Node pool for live ingestion
- `FLOW_HISTORIC_ACCESS_NODES`: Node pool for history ingestion across sporks
- `FLOW_ARCHIVE_NODE`: Archive node endpoint
- `PORT`: API server port (default: 8080)
- `START_BLOCK`: Starting block height
- `RAW_ONLY`: Disable all workers/derivers (raw ingestion only)
- `ENABLE_HISTORY_INGESTER`: Enable history backfill (default: true)
- `ENABLE_LIVE_DERIVERS` / `LIVE_DERIVERS_CHUNK` / `HISTORY_DERIVERS_CHUNK`: Deriver pipeline config
- `LATEST_WORKER_COUNT` / `LATEST_BATCH_SIZE`: Forward ingester tuning
- `HISTORY_WORKER_COUNT` / `HISTORY_BATCH_SIZE`: Backward ingester tuning
- `HISTORY_STOP_HEIGHT`: Stop backward ingester at this height
- `SUPABASE_DB_URL` / `SUPABASE_JWT_SECRET`: Supabase integration
- `SVIX_AUTH_TOKEN` / `SVIX_SERVER_URL`: Webhook delivery via Svix
- `ENABLE_PRICE_FEED` / `PRICE_REFRESH_MIN`: Market price feed
- `ADMIN_TOKEN` / `ADMIN_JWT_SECRET` / `ADMIN_ALLOWED_ROLES`: Admin auth
- `API_RATE_LIMIT_*`: Rate limiting configuration

### Frontend Environment Variables
- `VITE_API_URL`: Backend API base URL (default: http://localhost:8080)
- `VITE_SUPABASE_URL`: Supabase gateway URL

## Key Implementation Details

### Dual Ingester + Deriver Pattern
- **Forward Ingester**: Real-time blocks in ascending order, broadcasts to frontend via WebSocket
- **Backward Ingester**: Historical backfill in descending order, no broadcasts
- **LiveDerivers / HistoryDerivers**: Process derived data (tokens, accounts, etc.) from raw blocks after ingestion

### EVM Transaction Detection
Detected by `import EVM` in transaction scripts. Sets `is_evm` flag, stores EVM data in `evm_transactions`, parses EVM hash/from/to/value/gas from events.

### Spork-Aware History Backfill
Flow access nodes only serve current spork blocks. Configure `FLOW_HISTORIC_ACCESS_NODES` with per-spork nodes. Supports batch API (spork 18+) and per-tx fallback (spork 1-17).

## Common Development Patterns

### Adding New API Endpoints
1. Define route in `backend/internal/api/server.go`
2. Implement handler on `Server` struct
3. Add repository method if needed
4. Update frontend `app/api.ts` or regenerate from OpenAPI spec

### Adding New Database Tables
1. Add to `backend/schema_v2.sql` (use `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`)
2. Define Go struct in `internal/models/models.go`
3. Add repository methods in `internal/repository/postgres.go`

### Frontend Component Development
1. Shadcn/UI components from `app/components/ui/`
2. TailwindCSS utilities for styling
3. Framer Motion for animations
4. Lucide React for icons
5. File-based routing in `app/routes/`

## Common Gotchas

- **NUMERIC columns + empty strings**: Cadence event fields often return `""`. Always use `numericOrZero()` helper for NUMERIC/DECIMAL inserts.
- **CREATE TABLE IF NOT EXISTS** does NOT modify existing tables. Must pair with `ALTER TABLE ADD COLUMN IF NOT EXISTS`.
- **ALTER TABLE must come BEFORE CREATE INDEX** in schema_v2.sql if the index references new columns.
- **Dead worker leases**: When a worker fails 21 times, lease gets stuck FAILED. Fix: `DELETE FROM app.worker_leases WHERE worker_type = 'xxx' AND status = 'FAILED'`
- **Frontend build**: May require `NODE_OPTIONS="--max-old-space-size=8192"` to avoid OOM.
- **Frontend source is in `app/` not `src/`** — the TanStack Start migration moved everything.

## Notes

- The codebase prioritizes data completeness over storage optimization
- Worker concurrency should be tuned for your infrastructure
- Database migrations run automatically on backend startup via `repo.Migrate("schema_v2.sql")`
- Exhaustive data capture aligned with Flow Access API spec

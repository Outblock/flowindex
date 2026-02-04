# FlowScan Clone

A Flow blockchain explorer (similar to Etherscan / Blockscout) focused on high-throughput indexing, extensible storage, and low-latency queries.

## Features
- **Schema V2:** `raw.*` / `app.*` separation with partitioned tables
- **Forward/Backward Ingesters:** Live head + historical backfill in parallel
- **Async Workers:** Token/Meta derived data
- **Spork-Aware History Backfill:** Separate historic node pool via `FLOW_HISTORIC_ACCESS_NODES`
- **Cursor Pagination:** Blocks / Transactions / Address / Token / NFT
- **REST + WebSocket:** Real-time block and transaction updates
- **Script De-dup:** `raw.transactions.script_hash` + `raw.scripts` to reduce long-term storage growth
- **Railway & Docker:** Fast validation and deployment

## Docs
- `docs/architecture/ARCHITECTURE.md` — architecture + diagrams
- `docs/architecture/schema-v2-plan.md` — Schema V2 refactor plan
- `docs/operations/deploy-env.md` — deployment environment variables
- `docs/operations/railway-runbook.md` — Railway validation steps
- `docs/status/project-status.md` — current status and next steps

## Project Structure
- `backend/`: Go indexer + API
- `frontend/`: React (Vite) UI
- `devportal/`: Developer portal (Fumadocs + Scalar API reference)
- `docker-compose.yml`: local one-command stack

## Local Development

### Prerequisites
- Docker & Docker Compose
- Go 1.24+
- Node.js 20+ (or Bun)

### Run via Docker (recommended)
```bash
docker compose up -d --build
```
- Backend: `http://localhost:8080`
- Frontend: `http://localhost:5173`
- Docs: `http://localhost:3000`

### Run Backend (dev)
```bash
cd backend
export DB_URL="postgres://flowscan:password@localhost:5432/flowscan?sslmode=disable"
export FLOW_ACCESS_NODE="access-001.mainnet28.nodes.onflow.org:9000"
export FLOW_HISTORIC_ACCESS_NODES="access-001.mainnet28.nodes.onflow.org:9000,access-001.mainnet27.nodes.onflow.org:9000"
go run main.go
```

### Run Frontend (dev)
```bash
cd frontend
npm install
npm run dev
```

## Deployment (Railway)
- Railway deploys from root build context
- Environment template: `docs/operations/railway.env.example`
- Runbook: `docs/operations/railway-runbook.md`

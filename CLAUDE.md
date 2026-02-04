# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FlowScan Clone is a high-performance blockchain explorer for the Flow Blockchain with Flow-EVM support. It features a Go backend with concurrent block ingestion and a React frontend with "Nothing Phone" inspired aesthetics.

**Key Technologies:**
- Backend: Go 1.24+, PostgreSQL (pgx driver), Flow SDK, Gorilla WebSocket/Mux
- Frontend: React 19, Vite, TailwindCSS, Shadcn/UI, React Router, Recharts
- Deployment: Docker, Docker Compose, Railway

## Development Commands

### Local Development (Docker Compose)
```bash
# Start all services (PostgreSQL, backend, frontend)
docker-compose up -d --build

# View logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Stop services
docker-compose down

# Access points:
# - Frontend: http://localhost:5173
# - Backend API: http://localhost:8080
# - PostgreSQL: localhost:5432
```

### Backend (Go)
```bash
cd backend

# Install dependencies
go mod download
go mod tidy

# Build
CGO_CFLAGS="-std=gnu99" CGO_ENABLED=1 go build -o indexer main.go

# Run locally (requires PostgreSQL)
DB_URL=postgres://flowscan:secretpassword@localhost:5432/flowscan \
FLOW_ACCESS_NODE=access-001.mainnet28.nodes.onflow.org:9000 \
PORT=8080 \
START_BLOCK=140900000 \
./indexer

# Run tests
go test ./...
```

### Frontend (React)
```bash
cd frontend

# Install dependencies
npm ci

# Development server
npm run dev

# Build for production
npm run build

# Lint
npm run lint

# Preview production build
npm run preview
```

### Database Management
```bash
# Connect to PostgreSQL
psql postgres://flowscan:secretpassword@localhost:5432/flowscan

# Run schema manually
psql postgres://flowscan:secretpassword@localhost:5432/flowscan < backend/schema_v2.sql

# Check indexing progress
psql -c "SELECT * FROM app.indexing_checkpoints;" postgres://flowscan:secretpassword@localhost:5432/flowscan
```

## Architecture

### Backend Architecture

The backend follows a concurrent pipeline architecture inspired by Blockscout:

1. **Main Entry Point** (`backend/main.go`):
   - Initializes two independent ingesters: Forward (live) and Backward (history)
   - Forward Ingester: Real-time block processing with WebSocket broadcasts
   - Backward Ingester: Historical data backfill (can be disabled via `ENABLE_HISTORY_INGESTER=false`)
   - Both run concurrently with separate worker pools

2. **Ingester Service** (`internal/ingester/service.go`):
   - Manages the block ingestion lifecycle
   - Supports two modes: "forward" (live) and "backward" (history)
   - Coordinates worker pool and batch processing
   - Handles checkpoint persistence and recovery
   - Broadcasts new blocks/transactions via callbacks (forward mode only)

3. **Worker Pool** (`internal/ingester/worker.go`):
   - Each worker fetches a complete block with all transactions, events, and derived data
   - Returns `FetchResult` containing: Block, Transactions, Events, AddressActivity, TokenTransfers, AccountKeys
   - EVM transaction detection via script content analysis (`import EVM`)
   - Stateless workers enable horizontal scaling

4. **Repository Layer** (`internal/repository/postgres.go`):
   - `SaveBlockData()`: Atomic batch insert of all block-related data
   - Uses PostgreSQL transactions for consistency
   - Handles duplicate key conflicts gracefully

5. **Flow Client** (`internal/flow/client.go`):
   - Wraps Flow SDK gRPC client
   - Methods: `GetLatestBlock()`, `GetBlockByHeight()`, `GetTransaction()`, `GetTransactionResult()`

6. **API Server** (`internal/api/server.go`):
   - REST endpoints for blocks, transactions, accounts, stats
   - WebSocket endpoint `/ws` for live updates
   - CORS enabled for frontend integration

### Database Schema (`backend/schema_v2.sql`)

**Core Tables:**
- `raw.blocks`: Block metadata (partitioned)
- `raw.transactions`: Transaction metadata (partitioned)
- `raw.events`: Event logs (partitioned)
- `raw.tx_lookup` / `raw.block_lookup`: global ID -> height lookup tables
- `raw.scripts`: de-duplicated scripts (`script_hash` -> `script_text`)
- `app.address_transactions`: Many-to-many relationship tracking roles (PROPOSER, PAYER, AUTHORIZER)
- `app.token_transfers`: FT/NFT transfer records (derived)
- `app.account_keys`: Account key state keyed by `(address, key_index)` with revocation support
- `app.indexing_checkpoints`: Progress tracking for ingesters/workers

**Design Principles:**
- Exhaustive data capture aligned with Flow Access API spec
- Denormalized fields (e.g., `block_height` in events) for query performance
- JSONB columns for complex nested data
- Indexes optimized for explorer query patterns

### Frontend Architecture

1. **Routing** (`frontend/src/App.jsx`):
   - React Router with routes: `/`, `/block/:id`, `/tx/:id`, `/account/:address`

2. **Pages** (`frontend/src/pages/`):
   - `Home.jsx`: Dashboard with live blocks, transactions, daily stats chart, indexing status
   - `BlockDetail.jsx`: Block information with transaction list
   - `TransactionDetail.jsx`: Transaction details with event logs and EVM data
   - `AccountDetail.jsx`: Account activity, transaction history, token transfers

3. **Components** (`frontend/src/components/`):
   - `DailyStatsChart.jsx`: Recharts-based visualization
   - `IndexingStatus.jsx`: Real-time ingester progress display
   - `ui/`: Shadcn/UI components (button, card, badge, etc.)

4. **API Client** (`frontend/src/api.js`):
   - Axios-based wrapper for backend API
   - Uses `VITE_API_URL` environment variable (Railway deployment)

5. **WebSocket Integration** (`frontend/src/hooks/useWebSocket.js`):
   - Live block and transaction updates from backend

## Configuration

### Backend Environment Variables
- `DB_URL`: PostgreSQL connection string (required)
- `FLOW_ACCESS_NODE`: Flow gRPC endpoint (default: mainnet28)
- `FLOW_ACCESS_NODES`: Optional node pool for live ingestion
- `FLOW_HISTORIC_ACCESS_NODES`: Optional node pool for history ingestion across sporks
- `PORT`: API server port (default: 8080)
- `START_BLOCK`: Starting block height for ingestion
- `LATEST_WORKER_COUNT`: Forward ingester workers (Railway: 50, local: 2)
- `LATEST_BATCH_SIZE`: Forward ingester batch size (Railway: 10, local: 1)
- `HISTORY_WORKER_COUNT`: Backward ingester workers (Railway: 100, local: 10)
- `HISTORY_BATCH_SIZE`: Backward ingester batch size (Railway: 500, local: 20)
- `ENABLE_HISTORY_INGESTER`: Enable history backfill (default: true)
- `DB_MAX_OPEN_CONNS`: Database connection pool size (Railway: 200)
- `DB_MAX_IDLE_CONNS`: Idle connection limit (Railway: 50)
- `TX_SCRIPT_INLINE_MAX_BYTES`: If >0, store small scripts inline; otherwise use `raw.scripts`

### Frontend Environment Variables
- `VITE_API_URL`: Backend API base URL (Railway: dynamic, local: http://localhost:8080)

### Railway Deployment (`railway.toml`)
- Two services: `backend` and `frontend`
- Root build context strategy (Dockerfiles in subdirectories)
- Backend uses `RAILWAY_DOCKERFILE_PATH=backend/Dockerfile`
- Frontend uses `RAILWAY_DOCKERFILE_PATH=frontend/Dockerfile`
- Database URL templated with Railway Postgres variables

## Key Implementation Details

### Dual Ingester Pattern
The system runs two independent ingesters simultaneously:
- **Forward Ingester**: Starts from last checkpoint, processes new blocks in ascending order, broadcasts to frontend
- **Backward Ingester**: Starts from checkpoint, processes historical blocks in descending order, no broadcasts
- Both use the same worker pool implementation but with different configurations
- This enables fast historical backfill while maintaining real-time updates

### EVM Transaction Detection
Flow-EVM transactions are detected by scanning transaction scripts for `import EVM`. When detected:
- `transactions.is_evm` flag is set
- Additional EVM-specific data is stored in `evm_transactions` table
- Event parsing extracts EVM hash, from/to addresses, value, gas used

### Exhaustive Data Redundancy
Per commit history, the schema captures maximum redundancy:
- Full signature arrays (proposal_key, payload_signatures, envelope_signatures)
- Complete block metadata (collection_guarantees, block_seals)
- Event transaction_index and position tracking
- ProposerKeyIndex stored as INT (aligned with Flow spec)

### Atomic Batch Processing
Workers fetch complete block data independently, then `SaveBlockData()` inserts all related records in a single transaction. This ensures:
- No partial block states in database
- Consistent checkpoint updates
- Efficient bulk inserts via pgx `CopyFrom`

## Common Development Patterns

### Adding New API Endpoints
1. Define route in `backend/internal/api/server.go`
2. Implement handler method on `Server` struct
3. Add repository method if database access needed
4. Update frontend `src/api.js` with new API call

### Adding New Database Tables
1. Add CREATE TABLE to `backend/schema.sql`
2. Define Go struct in `internal/models/models.go`
3. Add repository methods in `internal/repository/postgres.go`
4. Update `SaveBlockData()` if part of block ingestion pipeline

### Modifying Ingester Logic
1. Worker logic: `internal/ingester/worker.go` (`FetchBlockData` method)
2. Service orchestration: `internal/ingester/service.go`
3. Configuration: `backend/main.go` (ingester initialization)
4. Schema changes: `backend/schema.sql` + models

### Frontend Component Development
1. Use Shadcn/UI components from `src/components/ui/`
2. Follow "Nothing Phone" aesthetic (minimal, monochrome, geometric)
3. Tailwind utility classes for styling
4. Framer Motion for animations
5. Lucide React for icons

## Testing

### Manual Testing Scripts (Root Directory)
- `test-homepage.js`: Verify dashboard rendering
- `test-block-page.js`: Test block detail page
- `test-tx-page.js`: Test transaction detail page
- `test-account-page.js`: Test account detail page
- `test-page.js`: Generic page tester

Run with Node.js (these appear to be simple frontend smoke tests).

## Notes

- The codebase prioritizes data completeness over storage optimization (exhaustive redundancy principle)
- Worker concurrency is tuned differently for production (Railway) vs local development
- Database migrations run automatically on backend startup via `repo.Migrate("schema.sql")`
- Frontend expects backend API at `VITE_API_URL` or falls back to relative paths
- All timestamps use PostgreSQL `TIMESTAMPTZ` for timezone awareness

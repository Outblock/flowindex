# FlowScan Deploy Env (Railway + GCP)

This is the final publish list of environment variables used by the backend. Railway and GCP use the same keys.

## Required

- `DB_URL` = Postgres connection string.
- `FLOW_ACCESS_NODE` = Flow access node, e.g. `access-001.mainnet28.nodes.onflow.org:9000`.
- `FLOW_ACCESS_NODES` = optional comma-separated list of access nodes (overrides `FLOW_ACCESS_NODE`).
- `FLOW_HISTORIC_ACCESS_NODES` = optional comma-separated list of historic spork nodes for history backfill (recommended for full history).
- `FLOW_ARCHIVE_NODE` = optional archive node fallback (default: `archive.mainnet.nodes.onflow.org:9000`).
- `PORT` = API port (Railway sets this automatically; for GCP you can set explicitly).
- `START_BLOCK` = start height for indexing (optional but strongly recommended).

## Ingestion

- `LATEST_WORKER_COUNT` (default: 2)
- `LATEST_BATCH_SIZE` (default: 1)
- `HISTORY_WORKER_COUNT` (default: 5)
- `HISTORY_BATCH_SIZE` (default: 20)
- `ENABLE_HISTORY_INGESTER` (default: true)
- `MAX_REORG_DEPTH` (default: 1000)
- `STORE_BLOCK_PAYLOADS` (default: false; set true only if you need full guarantees/seals/signatures JSON in `raw.blocks`)
- `STORE_EXECUTION_RESULTS` (default: false; set true only if you need `raw.execution_results`)

## Derived + Async Workers

- `ENABLE_DERIVED_WRITES` (default: false)
- `ENABLE_TOKEN_WORKER` (default: true)
- `ENABLE_EVM_WORKER` (default: true)
- `ENABLE_META_WORKER` (default: true)
- `ENABLE_ACCOUNTS_WORKER` (default: true)
- `ENABLE_FT_HOLDINGS_WORKER` (default: true)
- `ENABLE_NFT_OWNERSHIP_WORKER` (default: true)
- `ENABLE_TX_CONTRACTS_WORKER` (default: true)
- `ENABLE_TX_METRICS_WORKER` (default: true)
- `TOKEN_WORKER_RANGE` (default: 50000)
- `EVM_WORKER_RANGE` (default: 50000)
- `META_WORKER_RANGE` (default: 50000)
- `ACCOUNTS_WORKER_RANGE` (default: 50000)
- `FT_HOLDINGS_WORKER_RANGE` (default: 50000)
- `NFT_OWNERSHIP_WORKER_RANGE` (default: 50000)
- `TX_CONTRACTS_WORKER_RANGE` (default: 50000)
- `TX_METRICS_WORKER_RANGE` (default: 50000)
- `TOKEN_WORKER_CONCURRENCY` (default: 1)
- `EVM_WORKER_CONCURRENCY` (default: 1)
- `META_WORKER_CONCURRENCY` (default: 1)
- `ACCOUNTS_WORKER_CONCURRENCY` (default: 1)
- `FT_HOLDINGS_WORKER_CONCURRENCY` (default: 1)
- `NFT_OWNERSHIP_WORKER_CONCURRENCY` (default: 1)
- `TX_CONTRACTS_WORKER_CONCURRENCY` (default: 1)
- `TX_METRICS_WORKER_CONCURRENCY` (default: 1)
- `ENABLE_DAILY_STATS` (default: true)
- `ENABLE_LOOKUP_REPAIR` (default: false)
- `LOOKUP_REPAIR_LIMIT` (default: 1000)
- `LOOKUP_REPAIR_INTERVAL_MIN` (default: 10)
- `TX_SCRIPT_INLINE_MAX_BYTES` (default: 0)
  - If `>0`, store `raw.transactions.script` inline only when the script size is <= this limit.
  - Otherwise, scripts are stored as `raw.transactions.script_hash` and de-duplicated in `raw.scripts`.

## API Query Tuning

- `API_RECENT_TX_WINDOW` (default: 20000)
  - First-page recent transaction queries are constrained to the latest N block heights to avoid wide partition scans.

## Live Address Backfill (optional)

These improve account pages during large range backfills by seeding recent activity.

- `ENABLE_LIVE_ADDRESS_BACKFILL` (default: true)
- `LIVE_ADDRESS_BACKFILL_BLOCKS` (default: `META_WORKER_RANGE`)
- `LIVE_ADDRESS_BACKFILL_CHUNK` (default: 5000)

## Flow RPC Throttling

- `FLOW_RPC_RPS` (default: 5)
- `FLOW_RPC_BURST` (default: `FLOW_RPC_RPS`)
- `FLOW_RPC_RPS_PER_NODE` (optional; multiplies by number of access nodes)
- `FLOW_RPC_BURST_PER_NODE` (optional; multiplies by number of access nodes)

## DB Pool Tuning (optional)

- `DB_MAX_OPEN_CONNS` (default: driver default)
- `DB_MAX_IDLE_CONNS` (default: driver default)

## Frontend Reverse Proxy (nginx)

These are used by the **frontend** container to proxy `/api` and `/ws` to backend.

- `BACKEND_API` (default: auto-detect)
  - Local Docker: `http://backend:8080`
  - Railway: `http://backend.railway.internal:8080`
  - GCP: set to your internal LB / service URL
- `BACKEND_WS` (default: same as `BACKEND_API`)

## Developer Portal (Docs Service)

These are used by the **docs** service (`devportal/`) to proxy `/flowscan-api/*` to backend (so Scalar can "Try it" without CORS).

- `BACKEND_API_URL` (required)
  - Railway: `http://backend.railway.internal:8080`
  - Local Docker: `http://backend:8080`
  - GCP: set to your internal LB / service URL
- `PORT` (default: `8080`)

## Frontend Docs Link (optional)

The frontend reads `DOCS_URL` at runtime from `/env.js` (rendered by `frontend/entrypoint.sh`). This avoids a rebuild when the docs domain changes.

- `DOCS_URL` (optional)
  - Example: `https://<docs-domain>.up.railway.app`

## OpenAPI Spec Overrides (optional)

- `OPENAPI_SPEC_PATH` (default: `openapi-v2.json`)
- `OPENAPI_V1_SPEC_PATH` (default: `openapi-v1.json`)
- `OPENAPI_V2_SPEC_PATH` (default: `openapi-v2.json`)

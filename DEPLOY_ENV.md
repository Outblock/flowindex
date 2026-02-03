# FlowScan Deploy Env (Railway + GCP)

This is the final publish list of environment variables used by the backend. Railway and GCP use the same keys.

## Required

- `DB_URL` = Postgres connection string.
- `FLOW_ACCESS_NODE` = Flow access node, e.g. `access-001.mainnet28.nodes.onflow.org:9000`.
- `FLOW_ACCESS_NODES` = optional comma-separated list of access nodes (overrides `FLOW_ACCESS_NODE`).
- `PORT` = API port (Railway sets this automatically; for GCP you can set explicitly).
- `START_BLOCK` = start height for indexing (optional but strongly recommended).

## Ingestion

- `LATEST_WORKER_COUNT` (default: 2)
- `LATEST_BATCH_SIZE` (default: 1)
- `HISTORY_WORKER_COUNT` (default: 5)
- `HISTORY_BATCH_SIZE` (default: 20)
- `ENABLE_HISTORY_INGESTER` (default: true)
- `MAX_REORG_DEPTH` (default: 1000)

## Derived + Async Workers

- `ENABLE_DERIVED_WRITES` (default: false)
- `ENABLE_TOKEN_WORKER` (default: true)
- `ENABLE_META_WORKER` (default: true)
- `TOKEN_WORKER_RANGE` (default: 50000)
- `META_WORKER_RANGE` (default: 50000)
- `ENABLE_DAILY_STATS` (default: true)
- `ENABLE_LOOKUP_REPAIR` (default: false)
- `LOOKUP_REPAIR_LIMIT` (default: 1000)
- `LOOKUP_REPAIR_INTERVAL_MIN` (default: 10)

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

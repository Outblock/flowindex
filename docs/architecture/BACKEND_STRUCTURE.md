# Backend Structure Map

**Last updated:** 2026-02-06

## 1. Layering
- `raw.*`: source-of-truth chain data from RPC, partitioned by height.
- `app.*`: worker-derived/query-optimized tables built from `raw.*`.
- API reads from both, but business/query shape should prefer `app.*` when available.

## 2. Directory Layout (Backend)
- `backend/main.go`
  - bootstraps DB, Flow clients, ingesters, async workers, API server.
- `backend/internal/flow/`
  - RPC client, retry/rate-limit, multi-node/spork-aware pinning.
- `backend/internal/ingester/`
  - block fetch + raw persistence pipeline.
  - worker implementations (`token_worker`, `evm_worker`, `meta_worker`, etc.).
- `backend/internal/repository/`
  - DB schema migration entry + all read/write queries.
  - split by concern:
  - `postgres_ingest.go`: raw ingestion writes.
  - `postgres_derived.go`: app-layer derived writes.
  - `query_legacy_chain.go`, `query_legacy_misc.go`: explorer endpoints.
  - `query_v2.go`, `api_v2*.go`: v1/v2 API query helpers.
- `backend/internal/api/`
  - `server.go`: legacy handlers + status payload.
  - `server_bootstrap.go`: router/middleware/server bootstrap.
  - `routes_registration.go`: route groups.
  - `websocket.go`: WS hub.
  - `v1_handlers.go`, `v1_helpers.go`: `/flow/v1` and response mappers.

## 3. Data Ownership Rules
- Put data in `raw.*` when:
  - it comes directly from Flow RPC and should be replayable/auditable.
  - examples: blocks, txs, events, collections, execution_results, scripts.
- Put data in `app.*` when:
  - it is parsed/aggregated/join-optimized for product queries.
  - examples: token transfers, holdings, ownership, account catalog, tx metrics, EVM mappings.

## 4. Event Parsing Rule
- `raw.events.payload` keeps full flattened payload.
- Event-specific extraction belongs in workers:
  - parse required fields from `raw.events`.
  - upsert to dedicated `app.*` table(s).
- This keeps raw immutable and app evolvable.

## 5. EVM Hash Placement
- `raw.tx_lookup` stores only `flow_tx_id -> block_height` lookup (no `evm_hash`).
- EVM hash mapping lives in `app.evm_tx_hashes` (supports many EVM hashes per cadence tx).
- EVM tx summary stays in `app.evm_transactions`.

## 6. System Transactions
- Flow has repeated system-level tx ids (same id across many blocks).
- Raw keeps them for fidelity.
- Recent transaction APIs filter those rows by default for explorer UX/perf.
- `raw.tx_lookup` skip-writes those repeated system rows to avoid ambiguous id lookup.

## 7. Hot Path Query Notes
- Always use cursor pagination for high-volume endpoints.
- For "recent tx", query only a latest-height window first (`API_RECENT_TX_WINDOW`, default `20000`).
- Keep lookup tables (`raw.block_lookup`, `raw.tx_lookup`) small and explicit to avoid cross-partition scans.

# FlowScan Clone Architecture

**Last updated:** 2026-02-04

## 1. Goals and Scope
- **Goal:** High-throughput indexing, low-latency queries, and extensible derived data for Flow.
- **Scale target:** 10TB+ with concurrent live + historical backfill.
- **Core principle:** Preserve raw data fully; aggregate in the app layer for fast queries.

## 2. System Overview
```mermaid
flowchart LR
  A["Flow Access Nodes"] --> B["Raw Ingester (Live/History)"]
  B --> C["Raw DB (partitioned)"]
  C --> D["Derived Workers (token/meta/evm/stats)"]
  D --> E["App DB (aggregates)"]
  C --> F["API Server (REST + WS)"]
  E --> F
  F --> G["Frontend UI"]
```

## 3. Runtime Modules and Responsibilities
- **Raw Ingester (Live):** Tracks the chain head and keeps the latest blocks fresh.
- **Raw Ingester (History):** Backfills from `start_height` to cover full history.
- **Derived Workers:** Read `raw.*` and write `app.*` (token/nft/meta/evm/stats, etc).
- **Committer:** Advances `app.indexing_checkpoints` for resumability and idempotency.
- **API Server:** REST + WebSocket, reading from raw/app with unified pagination.
- **Frontend:** Vite UI consuming API/WS.

## 4. Data Flow and Indexing Mode
```mermaid
sequenceDiagram
  participant L as Live Ingester
  participant H as History Ingester
  participant R as raw.*
  participant W as Workers
  participant A as app.*
  participant C as Checkpoints

  L->>R: Fetch latest block batches
  L->>C: Update live checkpoint
  H->>R: Backfill historical batches
  H->>C: Update history checkpoint
  W->>R: Read raw data
  W->>A: Write derived aggregates
  W->>C: Update worker checkpoint
```

## 5. Database Layout and Partitioning
Raw/App dual-layer design. Raw is append-only; App is query-optimized.

### Raw Schema (Primary Tables)
- `raw.blocks` (partition by height)
- `raw.transactions` (partition by block_height)
- `raw.events` (partition by block_height)
- `raw.collections` (partition by block_height)
- `raw.execution_results` (partition by block_height)
- `raw.block_lookup` (block_id -> height fast lookup)
- `raw.tx_lookup` (tx_id -> height fast lookup)
- `raw.scripts` (script_hash -> script_text de-dup)
- `raw.indexing_errors` (dedupe + audit)

### App Schema (Derived Tables)
- `app.address_transactions` (address-to-tx mapping)
- `app.token_transfers` (FT/NFT transfers)
- `app.nft_transfers` (NFT-only table)
- `app.address_stats` (address stats)
- `app.account_keys` (Flow account keys state, keyed by `(address, key_index)`; supports publicKey -> address lookup)
- `app.smart_contracts` (contract catalog)
- `app.indexing_checkpoints` (resumability)
- `app.worker_leases` (lease-based concurrency)
- `app.evm_transactions` (EVM-derived)

### Partitioning Strategy
```mermaid
flowchart TB
  P["Parent Table raw.transactions"] --> P1["Partition [0..5M)"]
  P --> P2["Partition [5M..10M)"]
  P --> P3["Partition [10M..15M)"]
```
- Partition key: `block_height` / `height`.
- Typical sizes: 5,000,000 (blocks/tx/collections/execution_results), 10,000,000 (events/transfers/evm).
- Key optimization: lookup tables avoid cross-partition scans.
- Recommended: `raw.create_partitions()` with 1–2 partitions lookahead.

## 6. Resumability and Idempotency
- `app.indexing_checkpoints` records latest heights per worker.
- `app.worker_leases` provides range leasing to avoid duplicate processing.
- Upsert/idempotent writes prevent corruption on retries.
- `raw.indexing_errors` for dedupe + audit.

## 7. Reorg Handling
- `MAX_REORG_DEPTH` guards rollback boundaries.
- Raw/app cleanup stays consistent within rollback range.

## 8. API and Pagination
- REST + WebSocket.
- Cursor pagination (avoid offset scans).
- Cursor examples:
  - Blocks: `height`
  - Transactions: `block_height:tx_index:tx_id`
  - Address Tx: `block_height:tx_id`
  - Token/NFT Transfers: `block_height:tx_id:event_index`

## 9. Environment Variables (Key Groups)
Full list in `docs/operations/deploy-env.md`.

### Core
- `PORT`
- `DB_URL`

### Flow Nodes and Rate Limits
- `FLOW_ACCESS_NODES`
- `FLOW_HISTORIC_ACCESS_NODES` (optional, recommended for full history across sporks)
- `FLOW_RPC_RPS_PER_NODE`
- `FLOW_RPC_BURST_PER_NODE`

### Live/History Ingestion
- `LATEST_WORKER_COUNT`
- `LATEST_BATCH_SIZE`
- `HISTORY_WORKER_COUNT`
- `HISTORY_BATCH_SIZE`

### Derived Workers
- `TOKEN_WORKER_CONCURRENCY`
- `TOKEN_WORKER_RANGE`
- `META_WORKER_CONCURRENCY`
- `META_WORKER_RANGE`

### DB Pool
- `DB_MAX_OPEN_CONNS`
- `DB_MAX_IDLE_CONNS`

### Storage Tuning
- `TX_SCRIPT_INLINE_MAX_BYTES` (optional)
  - If `>0`, store `raw.transactions.script` inline when small.
  - Otherwise store `script_hash` and resolve via `raw.scripts` on-demand.

## 10. Extensibility Guidance
- Add new derived modules in `app.*` to avoid raw overload.
- Use daily aggregates for long-range analytics.
- For very large scale, consider hot/cold tiering and archival.

## 11. Deployment Topology (Railway / GCP)
```mermaid
flowchart LR
  U["User Browser"] --> FE["Frontend (nginx)"]
  FE --> API["Backend API"]
  API --> DB["Postgres"]
```
- **Railway:** Single instance for rapid validation; scale out later.
- **GCP:** Split raw/app or read/write tiers when needed.

# FlowScan Clone - Project Status

**Last Updated:** 2026-02-04

## Executive Summary
FlowScan v2 is operational on Railway with multi-node Flow access, cursor-based APIs, and high-throughput backfill. The system can index latest blocks and backfill history concurrently. Token/NFT transfer indexing is now consistent and backfill is running with higher concurrency. Current focus is sustained throughput and preparing for GCP migration.

## Current Architecture (High Level)
- **Ingesters**
  - Forward (live) ingester for real-time head.
  - Backward (history) ingester for full history backfill.
- **Storage**
  - `raw.*` tables for immutable chain data, range-partitioned.
  - `app.*` tables for derived/query-friendly data.
- **Workers**
  - TokenWorker and MetaWorker read `raw.events` and `raw.transactions` and populate `app.*` tables.
  - Lease-based ranges with checkpoint committer.
- **API**
  - Cursor pagination for blocks, transactions, address txs, token/nft transfers.
  - Status endpoint cached to reduce load.

## Status: What Works
- **Schema V2** (raw/app separation, partitions) deployed.
- **Cursor API** deployed; frontend now uses cursor for blocks/txs/account txs.
- **TokenWorker parsing** supports FT + NFT (Deposited/Withdrawn) and writes `token_id` correctly.
- **Multi-node access** enabled via `FLOW_ACCESS_NODES`, `FLOW_RPC_RPS_PER_NODE`.
- **WebSocket proxy** stable in frontend nginx.
- **Stats page** shows worker checkpoints and history progress bar.

## Recent Changes (Last 24h)
- Cursor pagination used by frontend (no offset queries).
- Token transfer upserts now include `token_id`, `token_contract_address`, `is_nft` updates.
- TokenWorker concurrency is configurable.
- Backend image includes `backfill_token_transfers` binary.

## Current Environment Highlights (Example)
Use this section as a template for deployment-specific tracking.

- **Flow Access**: active access nodes and per-node RPS.
- **DB Size**: current size and growth rate.
- **Largest tables**: list top partitions by size.
- **Checkpoints (sample)**: main/history/derived checkpoints and lag.

## Known Risks / Bottlenecks
- **Raw events payload** (JSONB) is the dominant storage cost. At 10-50TB, this becomes the primary pressure.
- **Partition size** currently 10M for `raw.events` and `app.token_transfers`. Long-term, 1-2M partitions will reduce per-partition bloat and improve VACUUM.
- **Address/Token queries** will require additional composite indexes for large-scale read performance.
- **History+Derived contention**: backfill + heavy derived workers may contend on I/O.

## Next Steps (Technical Plan)
1. **History backfill acceleration**
   - Continue increasing `HISTORY_WORKER_COUNT` and `HISTORY_BATCH_SIZE` until rate limit or DB saturation.
   - Add nodes after whitelist confirmation.
2. **Token/NFT completeness**
   - Run `backfill_token_transfers` in backend container for older heights if needed.
3. **Indexing efficiency**
   - Add composite indexes once history is 80%+ complete.
4. **GCP migration prep**
   - Split `raw` and `app` into separate DBs in Phase 2.

## Open Items
- EVM worker (write into `app.evm_transactions`).
- Token/NFT global list pages.
- Long-term storage strategy for `raw.events.payload`.

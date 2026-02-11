# FlowScan Clone - Project Status

**Last Updated:** 2026-02-12

## Executive Summary
FlowScan v2 is operational on Railway with multi-node Flow access, cursor-based APIs, and parallel live + history backfill. The backend now has 9 async workers, live derivers for real-time materialization, modular API handlers, rate limiting, and market price integration. The frontend has been migrated to TanStack Start (SSR via Nitro + Bun) with HeyAPI OpenAPI codegen, file-based routing, and FCL integration. Current focus is feature completeness (token/NFT/contract pages) and sustained throughput before migrating to GCP.

## Current Architecture (High Level)
- **Ingesters**
  - Forward (live) ingester for real-time head.
  - Backward (history) ingester for full history backfill.
- **9 Async Workers** (lease-based, configurable concurrency)
  - TokenWorker, EVMWorker, MetaWorker, AccountsWorker, FTHoldingsWorker
  - NFTOwnershipWorker, TokenMetadataWorker, TxContractsWorker, TxMetricsWorker
- **Live Derivers**
  - Blockscout-style real-time materialization attached to forward ingester's `OnIndexedRange` callback.
  - Runs same Processor implementations idempotently for near-zero lag.
- **Storage**
  - `raw.*` tables for immutable chain data, range-partitioned (5M–10M ranges).
  - `app.*` tables for derived/query-friendly data (32+ tables).
- **API** (modular handler files)
  - `routes_registration.go` mounts domain-specific handlers (`v1_handlers_*.go`)
  - Cursor pagination for blocks, transactions, address txs, token/nft transfers.
  - IP-based rate limiting (`API_RATE_LIMIT_RPS`, burst, TTL).
  - Status endpoint cached to reduce load.
- **Frontend** (SSR)
  - TanStack Start + Nitro (Bun preset) for full-stack SSR.
  - File-based routing (`app/routes/`), 18 route files.
  - HeyAPI OpenAPI codegen for type-safe API calls.
  - FCL integration for Cadence script execution and COA lookup.
- **DevPortal**
  - Fumadocs + Scalar API reference, served as third Railway service.

## Status: What Works
- **Schema V2** (raw/app separation, partitions) deployed with 32+ tables.
- **9 Async Workers** operational with configurable enable/range/concurrency per worker.
- **Live Derivers** running on forward ingester for near-zero lag derived data.
- **Cursor API** deployed; frontend uses cursor for all list pages.
- **Modular API handlers** split by domain (blocks, transactions, accounts, FT, NFT, contracts, EVM, status).
- **Rate limiting** (IP-based token bucket) on all API endpoints.
- **Market price feed** (CoinGecko) with periodic refresh, stored in `app.market_prices`.
- **TokenWorker parsing** supports FT + NFT (Deposited/Withdrawn), writes to separate `app.ft_transfers` / `app.nft_transfers`.
- **Multi-node access** enabled via `FLOW_ACCESS_NODES`, `FLOW_RPC_RPS_PER_NODE`.
- **Spork-aware history**: `FLOW_HISTORIC_ACCESS_NODES` with pinned client per height.
- **Account keys**: `app.account_keys` keyed by `(address, key_index)` with revoked support.
- **COA (Cadence Object Account) lookup**: Header search supports 0x40-char EVM address → Flow address.
- **FCL integration** (WIP): Cadence script execution, address resolution from `cadence/addresses.json`.
- **SSR frontend**: TanStack Start + Nitro with Bun runtime, SSR-safe components (SafeNumberFlow, UTC timestamps).
- **HeyAPI codegen**: Type-safe API clients generated from backend OpenAPI specs.
- **Theme system**: Dark/light mode with View Transition API circular wipe animation.
- **Token/NFT/Contract pages**: List and detail pages for tokens, NFTs, and smart contracts.
- **Stats dashboard**: Worker checkpoints, history progress, daily stats chart.
- **FlowPriceChart**: FLOW price sparkline with 24h change and market cap.
- **WebSocket proxy** stable; real-time block/transaction updates on dashboard.
- **Backfill tools**: 5 CLI tools in `cmd/tools/` for retroactive data processing.
- **DevPortal**: Fumadocs docs site + Scalar API explorer deployed on Railway.

## Recent Changes (Last Week)
- **Indexer reliability overhaul** (`fix/indexer-reliability` branch):
  - Worker dependency enforcement — downstream workers wait for upstream checkpoints.
  - Surgical rollback — precise DELETE by height instead of TRUNCATE; checkpoints clamped not zeroed.
  - Lease reaper — recovers crashed worker leases (expired ACTIVE → FAILED).
  - Dead letter alerting — CRITICAL log for leases with attempt >= 20.
  - LiveDeriver retry queue — 3 retries with exponential backoff for failed processors.
  - Gap detection — LAG() window function finds missing ranges between COMPLETED leases.
  - NFT ownership height guard — prevents stale owner overwrites from out-of-order processing.
  - Full docs: `docs/architecture/indexer-reliability.md`
- **COA lookup** added to core OpenAPI spec and header search bar.
- **FCL integration** started: `fclConfig.ts`, `cadence/addresses.json`, Cadence codegen.
- **Theme transition** switched to left-to-right wipe using View Transition API.
- **SafeNumberFlow** SSR-safe wrapper for @number-flow/react to avoid hydration mismatch.
- **Account route** refreshes on route change, avoids NumberFlow SSR issues.
- **GridScan** layered behind 404 text for visual effect.

## Current Environment Highlights (Example)
Use this section as a template for deployment-specific tracking.

- **Flow Access**: active access nodes and per-node RPS.
- **DB Size**: current size and growth rate.
- **Largest tables**: list top partitions by size.
- **Checkpoints (sample)**: main/history/derived checkpoints and lag.

## Known Risks / Bottlenecks
- **Raw events payload** (JSONB) is the dominant storage cost. At 10-50TB, this becomes the primary pressure.
- **Script/arguments growth**: scripts are now de-duped; arguments may still become large depending on workload.
- **Address/Token queries** will require additional composite indexes for large-scale read performance.
- **History+Derived contention**: backfill + heavy derived workers may contend on I/O.

## Identified Code Bloat (Cleanup Candidates)
- `app.token_transfers` — dead table, zero Go code references (superseded by `app.ft_transfers` + `app.nft_transfers`).
- `app.ft_metadata` — redundant with `app.ft_tokens`; should consolidate.
- `app.status_snapshots` — write-orphaned (table exists but nothing populates it).
- `raw.collections`, `raw.execution_results` — write-only tables with no API exposure.
- 47/127 API routes are stubs returning empty/mock data (~37%).
- Frontend `gen/find/` has ~5000 lines generated from stub endpoints.
- Legacy query layer (`query_legacy_*.go`, 1107 lines) overlaps with V2.

## Next Steps (Technical Plan)
1. **History backfill acceleration**
   - Continue increasing `HISTORY_WORKER_COUNT` and `HISTORY_BATCH_SIZE` until rate limit or DB saturation.
   - Add nodes after whitelist confirmation.
2. **Token/NFT completeness**
   - Run `backfill_token_transfers` in backend container for older heights if needed.
   - Complete token metadata worker coverage.
3. **Account key completeness**
   - Run `backfill_account_keys` once after schema/parsing changes to populate `app.account_keys` from existing `raw.events`.
4. **Indexing efficiency**
   - Add composite indexes once history is 80%+ complete.
5. **FCL wallet integration**
   - Complete wallet connection flow for user-facing Cadence interactions.
6. **GCP migration prep**
   - Split `raw` and `app` into separate DBs in Phase 2.

## Open Items
- Token/NFT global list pages — data populated, UI in progress.
- Long-term storage strategy for `raw.events.payload`.
- FCL wallet connection flow (WIP).
- Playwright test coverage expansion.

# Ingestion Pipeline Architecture

This document explains how FlowScan's block ingestion, derivation, and worker pipeline works end-to-end.

## Overview

```
                         Flow Blockchain
                              |
              +---------------+---------------+
              |                               |
     Forward Ingester              Backward Ingester
     (main_ingester)               (history_ingester)
       mode=forward                  mode=backward
       live blocks                   history backfill
              |                               |
              v                               v
         raw.blocks                      raw.blocks
         raw.transactions                raw.transactions
         raw.events                      raw.events
              |                               |
              v                               v
      Live Deriver (forward)        Live Deriver (history)
        chunk=10 blocks               chunk=10 blocks
        real-time                     on each batch commit
              |                               |
              +--------> Processors <---------+
              |       (12 block-range)        |
              v                               v
       Update Checkpoints           History Deriver
       (per processor)              chunk=1000 blocks
                                    safety-net scanner
                                          |
                                          v
                                    Same Processors
                                    (upward + downward scan)

              +--- Queue-based Async Workers ---+
              |  nft_item_metadata_worker       |
              |  nft_ownership_reconciler        |
              +--- (lease-based, independent) ---+
```

## 1. Ingesters (Raw Data Layer)

Ingesters fetch blocks from the Flow Access API and store raw data in `raw.blocks`, `raw.transactions`, `raw.events`, `raw.tx_lookup`, `raw.block_lookup`. They do NOT produce any derived/app tables.

### Forward Ingester (`main_ingester`)

- **Mode**: `forward` -- processes blocks in ascending order from the chain head
- **Purpose**: Real-time indexing of new blocks as they are sealed on-chain
- **Behavior**:
  1. Reads its checkpoint from `app.indexing_checkpoints`
  2. Fetches the latest sealed block height from the Flow node
  3. Fills a batch of blocks using a concurrent worker pool
  4. Performs **reorg detection**: verifies parent hash continuity; if mismatched, rolls back
  5. Saves the batch atomically via `repo.SaveBlockData()` (single DB transaction)
  6. Updates its checkpoint
  7. Fires callbacks:
     - `OnNewBlock(block)` -- WebSocket broadcast to frontend
     - `OnNewTransaction(tx)` -- WebSocket broadcast
     - `OnIndexedRange(fromHeight, toHeight)` -- triggers the forward LiveDeriver
- **Config**: `LATEST_WORKER_COUNT` (default 2), `LATEST_BATCH_SIZE` (default 1)

### Backward Ingester (`history_ingester`)

- **Mode**: `backward` -- processes blocks in descending order for history backfill
- **Purpose**: Fill raw tables going back in time, eventually covering the full chain history
- **Behavior**:
  1. Starts from its checkpoint and walks backwards
  2. No reorg checks (historical blocks are immutable)
  3. No WebSocket broadcasts (silent backfill)
  4. Handles **spork boundaries**: when a node returns "not found", parses the spork root height from the error and adjusts the floor
  5. Fires `OnIndexedRange` -- triggers the history LiveDeriver
  6. Optionally stops at `HISTORY_STOP_HEIGHT` (for parallel spork indexing across instances)
- **Config**: `HISTORY_WORKER_COUNT` (default 5), `HISTORY_BATCH_SIZE` (default 20)
- **Node pool**: Uses `FLOW_HISTORIC_ACCESS_NODES` (can include archive nodes for pre-spork blocks)

## 2. Derivers (Derived Data Layer)

Derivers take raw data and produce derived/app tables (token transfers, account info, EVM mappings, etc.) by running a set of **Processors**.

### Strategy: Why Derivers Instead of Async Workers?

Previously, each processor ran as an independent **AsyncWorker** polling for work via a lease-based mechanism. This had a fundamental latency problem: workers processed blocks in 1000-block ranges, meaning a new block wouldn't be processed until its range filled up (up to ~16 minutes). Live_deriver processes blocks in 10-block chunks (~1 second), giving near-real-time derived data.

**Current strategy (Plan A)**:
- **LiveDeriver handles all block-range processors** for both forward and history paths
- **LiveDeriver updates checkpoints directly** after each chunk, replacing the AsyncWorker + CheckpointCommitter pattern
- **AsyncWorkers are only used for queue-based processors** that don't operate on block ranges (nft_item_metadata, nft_reconciler)
- **HistoryDeriver is a safety net** that scans for any missed ranges

### Live Deriver

**File**: `internal/ingester/live_deriver.go`

The LiveDeriver is triggered by `NotifyRange(from, to)` callbacks from ingesters. Two instances exist:

| Instance | Triggered by | Purpose |
|----------|-------------|---------|
| Forward LiveDeriver | `main_ingester.OnIndexedRange` | Process new blocks in real-time |
| History LiveDeriver | `history_ingester.OnIndexedRange` | Process newly backfilled history batches immediately |

**How it works**:

1. `NotifyRange(from, to)` is called by the ingester after committing a batch
2. Ranges are coalesced into a single `pending` range (cheap, non-blocking)
3. A background goroutine wakes up, takes the pending range, and processes it in chunks
4. Each chunk runs processors in **two phases**:
   - **Phase 1** (parallel): Independent processors -- token_worker, evm_worker, tx_contracts_worker, accounts_worker, meta_worker, tx_metrics_worker, staking_worker, defi_worker
   - **Phase 2** (parallel, after phase 1 completes): Token-dependent processors -- ft_holdings_worker, nft_ownership_worker, daily_balance_worker
5. After both phases complete, **updates checkpoints** for every processor via `repo.UpdateCheckpoint()`
6. Failed processors are enqueued for retry (up to 3 attempts with exponential backoff)

**Config**: `LIVE_DERIVERS_CHUNK` (default 10 blocks)

**Head backfill**: On startup, the forward LiveDeriver seeds the last N blocks (default 100, configurable via `LIVE_DERIVERS_HEAD_BACKFILL_BLOCKS`) so the UI has derived data immediately after deploy.

### History Deriver

**File**: `internal/ingester/history_deriver.go`

The HistoryDeriver is a **safety-net scanner** that ensures all raw blocks have been processed by the derivation processors. It handles two scenarios:

1. **Upward scan**: Blocks that were already in `raw.*` when the system started but hadn't been processed yet (backlog from before derivers existed)
2. **Downward scan**: Blocks that the backward ingester fills below the initial starting point

**Two cursors**:

```
                    Chain history
   minRaw ----[downCursor]---- upCursor ----[workerFloor]---- tip
     |              |              |              |              |
     v              v              v              v              v
   oldest     DOWN scan        initial        UP scan        newest
   raw block   direction       start          direction       block
               (←)             point            (→)
```

- **upCursor** (`history_deriver` checkpoint): Scans upward from minRaw toward `workerFloor` (minimum of all processor checkpoints). Processes the initial backlog.
- **downCursor** (`history_deriver_down` checkpoint): Tracks the bottom of processed data. As the history ingester fills new blocks below, this cursor chases minRaw downward.

**Guards**:
- Before processing a range, verifies raw blocks actually exist via `HasBlocksInRange()`. This prevents silently skipping ranges the backward ingester hasn't filled yet.

**`findWorkerFloor()`**: Returns `min(token_worker, evm_worker, accounts_worker, meta_worker)` checkpoint. This is the ceiling for the upward scan -- the HistoryDeriver won't process blocks that the LiveDeriver has already handled.

**Config**: `HISTORY_DERIVERS_CHUNK` (default 1000), `HISTORY_DERIVERS_SLEEP_MS` (throttle)

## 3. Processors

All processors implement the `Processor` interface:

```go
type Processor interface {
    ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error
    Name() string
}
```

### Phase 1: Independent Processors

These run in parallel and have no dependencies on each other.

| Processor | Name | What it does | Writes to |
|-----------|------|-------------|-----------|
| TokenWorker | `token_worker` | Parses FT/NFT events, pairs withdraw/deposit into transfers, handles cross-VM FLOW transfers (EVM bridge) | `app.ft_transfers`, `app.nft_transfers`, `app.ft_tokens`, `app.nft_collections`, `app.smart_contracts` |
| EVMWorker | `evm_worker` | Parses `EVM.TransactionExecuted` events, decodes RLP payload, maps EVM hash to Cadence tx | `app.evm_tx_hashes` |
| TxContractsWorker | `tx_contracts_worker` | Extracts contract imports from scripts, tags transactions (EVM, FEE, SWAP, etc.) | `app.tx_contracts`, `app.tx_tags` |
| AccountsWorker | `accounts_worker` | Catalogs accounts from `AccountCreated` events and tx participants, detects COA creation | `app.accounts`, `app.coa_accounts` |
| MetaWorker | `meta_worker` | Backfills `address_transactions`, extracts account keys and contract deployments, fetches contract code | `app.address_transactions`, `app.account_stats`, `app.account_keys`, `app.smart_contracts` |
| TxMetricsWorker | `tx_metrics_worker` | Computes per-transaction metrics (event count, gas, etc.) | `app.tx_metrics` |
| StakingWorker | `staking_worker` | Parses staking/epoch events, tracks node state | `app.staking_events`, `app.staking_nodes`, `app.epoch_stats` |
| DefiWorker | `defi_worker` | Parses DEX swap events (IncrementFi, BloctoSwap, Metapier) | `app.defi_events`, `app.defi_pairs` |

### Phase 2: Token-Dependent Processors

These run after Phase 1 because they read from tables that `token_worker` writes.

| Processor | Name | What it does | Writes to |
|-----------|------|-------------|-----------|
| FTHoldingsWorker | `ft_holdings_worker` | Updates account FT balances incrementally from transfers | `app.ft_holdings` |
| NFTOwnershipWorker | `nft_ownership_worker` | Updates NFT ownership from transfers | `app.nft_ownership` |
| DailyBalanceWorker | `daily_balance_worker` | Aggregates daily FT deltas per (address, token, date) | `app.daily_balances` |

### Not in LiveDeriver (too slow for real-time)

| Processor | Name | Why excluded | Where it runs |
|-----------|------|-------------|---------------|
| TokenMetadataWorker | `token_metadata_worker` | Calls on-chain Cadence scripts (~2s per range) | History Deriver only |

### Queue-Based Processors (AsyncWorker)

These don't process block ranges; they find their own work from derived tables.

| Processor | Name | What it does | Dependency |
|-----------|------|-------------|-----------|
| NFTItemMetadataWorker | `nft_item_metadata_worker` | Fetches per-NFT metadata (name, image, traits) via Cadence scripts | Reads from `nft_ownership` |
| NFTOwnershipReconciler | `nft_ownership_reconciler` | Verifies NFT ownership against chain state, deletes stale records | Reads from `nft_ownership` |

## 4. AsyncWorker & Lease Mechanism

**File**: `internal/ingester/async_worker.go`

Only used for queue-based processors now (nft_item_metadata, nft_reconciler).

**How it works**:
1. Polls every 1 second
2. Calculates candidate range from checkpoint, aligned to `RangeSize`
3. Checks dependency gates (upstream worker checkpoints)
4. Acquires a lease via `repo.AcquireLease()` (INSERT with ON CONFLICT IGNORE)
5. If acquired: runs `ProcessRange()`, marks lease COMPLETED or FAILED
6. If not acquired: tries the next aligned range (lookahead up to 5)
7. Failed leases are retried; after 20 failures, flagged as dead letters

**Leases stored in**: `app.worker_leases` table

## 5. CheckpointCommitter

**File**: `internal/ingester/committer.go`

Only manages checkpoints for queue-based workers now. Runs every 5s.

- `AdvanceCheckpointSafe()`: Finds contiguous COMPLETED leases and advances the checkpoint
- `ReapExpiredLeases()` (every 30s): Recovers crashed workers
- `DetectLeaseGaps()` (every 60s): Finds missing ranges
- `CountDeadLeases()` (every 60s): Alerts on permanently failed ranges

## 6. Data Flow Example

### New block arrives (real-time)

```
1. Forward Ingester fetches block 142,610,500
2. Saves to raw.blocks, raw.transactions, raw.events
3. Calls OnIndexedRange(142,610,500, 142,610,501)
4. Forward LiveDeriver wakes up
5. Coalesces with pending ranges → processes [142,610,500, 142,610,510)
6. Phase 1: token_worker, evm_worker, accounts_worker, etc. run in parallel
7. Phase 2: ft_holdings_worker, nft_ownership_worker run in parallel
8. Updates checkpoints: token_worker=142610510, evm_worker=142610510, ...
9. User can now search for EVM tx hash, see token transfers, etc.
```

### History backfill

```
1. Backward Ingester fetches blocks [100,000,000 - 100,000,500)
2. Saves to raw.blocks, raw.transactions, raw.events
3. Calls OnIndexedRange(100,000,000, 100,000,500)
4. History LiveDeriver processes the batch in 10-block chunks
5. Meanwhile, History Deriver's downCursor chases minRaw for any gaps
```

## 7. Checkpoint Map

| Checkpoint Name | Updated By | Read By |
|----------------|-----------|---------|
| `main_ingester` | Forward Ingester | LiveDeriver (head backfill), various queries |
| `history_ingester` | Backward Ingester | Stats page |
| `token_worker` | LiveDeriver, HistoryDeriver | `findWorkerFloor()`, dependency gates |
| `evm_worker` | LiveDeriver, HistoryDeriver | `findWorkerFloor()` |
| `accounts_worker` | LiveDeriver, HistoryDeriver | `findWorkerFloor()` |
| `meta_worker` | LiveDeriver, HistoryDeriver | `findWorkerFloor()` |
| `ft_holdings_worker` | LiveDeriver, HistoryDeriver | -- |
| `nft_ownership_worker` | LiveDeriver, HistoryDeriver | nft_reconciler dependency gate |
| `daily_balance_worker` | LiveDeriver, HistoryDeriver | -- |
| `tx_contracts_worker` | LiveDeriver, HistoryDeriver | -- |
| `tx_metrics_worker` | LiveDeriver, HistoryDeriver | -- |
| `staking_worker` | LiveDeriver, HistoryDeriver | -- |
| `defi_worker` | LiveDeriver, HistoryDeriver | -- |
| `token_metadata_worker` | LiveDeriver, HistoryDeriver | -- |
| `history_deriver` | HistoryDeriver (up cursor) | HistoryDeriver (down cursor init) |
| `history_deriver_down` | HistoryDeriver (down cursor) | -- |
| `nft_item_metadata_worker` | CheckpointCommitter | -- |
| `nft_ownership_reconciler` | CheckpointCommitter | -- |

## 8. Environment Variables

### Ingesters

| Variable | Default | Description |
|----------|---------|-------------|
| `LATEST_WORKER_COUNT` | 2 | Forward ingester concurrency |
| `LATEST_BATCH_SIZE` | 1 | Forward ingester batch size |
| `HISTORY_WORKER_COUNT` | 5 | Backward ingester concurrency |
| `HISTORY_BATCH_SIZE` | 20 | Backward ingester batch size |
| `HISTORY_STOP_HEIGHT` | 0 (disabled) | Stop backward ingester at this height |
| `ENABLE_FORWARD_INGESTER` | true | Enable/disable forward ingester |
| `ENABLE_HISTORY_INGESTER` | true | Enable/disable backward ingester |
| `FLOW_ACCESS_NODES` | -- | Comma-separated gRPC endpoints for live |
| `FLOW_HISTORIC_ACCESS_NODES` | -- | Comma-separated gRPC endpoints for history |

### Derivers

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_LIVE_DERIVERS` | true | Enable forward + history LiveDerivers |
| `LIVE_DERIVERS_CHUNK` | 10 | Blocks per LiveDeriver chunk |
| `LIVE_DERIVERS_HEAD_BACKFILL_BLOCKS` | 100 | Blocks to seed on startup |
| `ENABLE_HISTORY_DERIVERS` | true | Enable HistoryDeriver scanner |
| `HISTORY_DERIVERS_CHUNK` | 1000 | Blocks per HistoryDeriver chunk |
| `HISTORY_DERIVERS_SLEEP_MS` | 0 | Throttle between HistoryDeriver chunks |

### Worker Toggles

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_TOKEN_WORKER` | true | Token transfers (FT/NFT) |
| `ENABLE_EVM_WORKER` | true | EVM transaction mapping |
| `ENABLE_META_WORKER` | true | Address transactions, keys, contracts |
| `ENABLE_ACCOUNTS_WORKER` | true | Account catalog |
| `ENABLE_FT_HOLDINGS_WORKER` | true | FT balance tracking |
| `ENABLE_NFT_OWNERSHIP_WORKER` | true | NFT ownership tracking |
| `ENABLE_TOKEN_METADATA_WORKER` | true | On-chain FT/NFT metadata |
| `ENABLE_TX_CONTRACTS_WORKER` | true | Transaction contract tagging |
| `ENABLE_TX_METRICS_WORKER` | true | Transaction metrics |
| `ENABLE_STAKING_WORKER` | true | Staking events |
| `ENABLE_DEFI_WORKER` | true | DEX swap events |
| `ENABLE_DAILY_BALANCE_WORKER` | true | Daily balance aggregation |
| `ENABLE_NFT_ITEM_METADATA_WORKER` | true | Per-NFT metadata (queue-based) |
| `ENABLE_NFT_RECONCILER` | true | NFT ownership reconciliation (queue-based) |
| `RAW_ONLY` | false | Disable ALL workers/derivers, only run ingesters |

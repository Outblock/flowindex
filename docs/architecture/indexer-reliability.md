# Indexer Reliability and Error Recovery

**Last updated:** 2026-02-12
**Branch:** `fix/indexer-reliability`

## Overview

This document describes the error handling, retry, and recovery mechanisms in the FlowScan indexer pipeline. The design is inspired by Blockscout's approach to chain indexing reliability.

## 1. Worker Dependency Enforcement

### Problem
Downstream workers (e.g., FTHoldingsWorker) could run ahead of upstream workers (e.g., TokenWorker), reading empty `app.ft_transfers` tables and marking their lease COMPLETED with no data — permanently.

### Solution
Each `AsyncWorker` accepts a `Dependencies []string` field listing upstream checkpoint names. Before processing a range `[base, base+rangeSize)`, the worker checks that every dependency's checkpoint has advanced past `base+rangeSize`. If not, the worker sleeps and retries later.

### Dependency Graph
```
raw ingester (main_ingester)
  ├── token_worker        (no upstream dependency)
  ├── evm_worker          (no upstream dependency)
  ├── meta_worker          (no upstream dependency)
  ├── accounts_worker      (no upstream dependency)
  ├── tx_metrics_worker    (no upstream dependency)
  │
  └── token_worker checkpoint
        ├── ft_holdings_worker
        ├── nft_ownership_worker
        ├── tx_contracts_worker
        └── token_metadata_worker
```

### Files
- `backend/internal/ingester/async_worker.go` — dependency gate in `tryProcessNextRange()`
- `backend/main.go` — wiring `Dependencies: []string{"token_worker"}` for downstream workers

## 2. Lease Lifecycle and Error Recovery

### Lease States
```
  ┌─────────┐   worker crash    ┌─────────┐
  │ ACTIVE  │ ──(lease expires)──▶│ FAILED  │
  │ (5 min) │                    │         │
  └────┬────┘                    └────┬────┘
       │ success                      │ reclaim (attempt < 20)
       ▼                              ▼
  ┌──────────┐                   ┌─────────┐
  │COMPLETED │                   │ ACTIVE  │ (retry)
  └──────────┘                   └─────────┘
                                      │ attempt >= 20
                                      ▼
                                 ┌──────────┐
                                 │DEAD LETTER│ (manual intervention)
                                 └──────────┘
```

### Components

**AcquireLease** (`postgres_leasing.go`):
- `INSERT ... ON CONFLICT DO NOTHING RETURNING id`
- Returns 0 if another worker already claimed the range.

**ReclaimLease** (`postgres_leasing.go`):
- Picks up FAILED leases OR expired ACTIVE leases (crashed workers).
- Increments `attempt` counter. Capped at 20 to prevent infinite retries.

**ReapExpiredLeases** (`postgres_leasing.go`):
- Marks expired ACTIVE leases as FAILED so they enter the reclaim pool.
- Runs every 30 seconds via CheckpointCommitter.

**CountDeadLeases** (`postgres_leasing.go`):
- Finds leases with `status = 'FAILED' AND attempt >= 20`.
- Logged as CRITICAL by the committer — these block checkpoint advancement.

**DetectLeaseGaps** (`postgres_leasing.go`):
- Uses `LAG()` window function to find missing ranges between COMPLETED leases.
- Runs every 60 seconds via CheckpointCommitter.

## 3. CheckpointCommitter

The committer runs in the background and performs four operations:

| Operation | Interval | Purpose |
|-----------|----------|---------|
| `advanceAllCheckpoints` | 5s | Move checkpoint to highest contiguous COMPLETED height |
| `reapExpiredLeases` | 30s | Recover from worker crashes (OOM, panic) |
| `detectGaps` | 60s | Find missing ranges in lease coverage |
| `detectDeadLeases` | 60s | Alert on permanently failed leases |

### Contiguous Checkpoint Rule
The checkpoint only advances through a fully-connected chain of COMPLETED leases. A single FAILED or ACTIVE lease blocks advancement beyond that point. This ensures the API never serves data from a range that has gaps.

### File
- `backend/internal/ingester/committer.go`

## 4. LiveDeriver Retry Queue

### Problem
The LiveDeriver runs processors on freshly ingested blocks for near-zero-lag derived data. Previously, if a processor failed, the error was logged but the range was silently dropped.

### Solution
Failed processor+range pairs are enqueued for retry with exponential backoff:

| Attempt | Backoff |
|---------|---------|
| 1st retry | 5 seconds |
| 2nd retry | 10 seconds |
| 3rd retry | 20 seconds |
| Give up | Log warning; async worker will backfill |

The retry queue is capped at 100 entries to prevent unbounded growth. Old entries are dropped FIFO when full.

### File
- `backend/internal/ingester/live_deriver.go`

## 5. Error Logging

All indexing errors are persisted to `raw.indexing_errors`:

| Column | Purpose |
|--------|---------|
| `worker_name` | Which worker/processor failed |
| `block_height` | Height that failed |
| `transaction_id` | Specific tx if applicable |
| `error_hash` | Dedupe key (same error not logged twice) |
| `error_message` | Human-readable error |
| `raw_data` | Optional payload for debugging |

Uses `ON CONFLICT (worker_name, block_height, transaction_id, error_hash) DO NOTHING` for deduplication.

## 6. Surgical Rollback

### Problem
The previous rollback implementation used `TRUNCATE` on state tables (`address_stats`, `smart_contracts`, `account_keys`, `daily_stats`) and zeroed all worker checkpoints. A single-block reorg would destroy hours of derived data.

### Solution
`RollbackFromHeight()` now performs precise operations:

1. **Event-sourced tables** (ft_transfers, nft_transfers, etc.): `DELETE WHERE block_height >= rollbackHeight`
2. **State tables with height tracking**: `DELETE WHERE last_updated_height >= rollbackHeight`
3. **Address stats**: Delete only for addresses that had transactions in the rolled-back range
4. **Daily stats**: Delete only affected dates
5. **Worker leases**: Delete only leases overlapping the rollback range
6. **Worker checkpoints**: `LEAST(last_height, rollbackHeight - 1)` — clamp, don't zero

### File
- `backend/internal/repository/rollback.go`

## 7. NFT Ownership Height Guard

### Problem
Out-of-order processing could overwrite the NFT `owner` field with stale data. The `last_height` used `GREATEST()` but the `owner` was unconditionally overwritten.

### Solution
Added a WHERE guard on the upsert:
```sql
ON CONFLICT (contract_address, contract_name, nft_id) DO UPDATE SET
    owner = EXCLUDED.owner,
    last_height = EXCLUDED.last_height,
    updated_at = NOW()
WHERE EXCLUDED.last_height >= app.nft_ownership.last_height
```

### File
- `backend/internal/repository/api_v2.go` (UpsertNFTOwnership)

## 8. Testing

### Local Integration Test
```bash
docker compose -f docker-compose.test.yml up -d --build
```

This starts the full pipeline indexing ~1000 mainnet blocks (from height 141000000) with all 9 workers enabled. Expected results:
- All worker leases reach COMPLETED status
- Zero entries in `raw.indexing_errors`
- Dependency chain verified: downstream workers wait for upstream

### Verification Queries
```sql
-- Check all leases completed
SELECT worker_type, status, COUNT(*) FROM app.worker_leases GROUP BY 1, 2 ORDER BY 1;

-- Check for errors
SELECT COUNT(*) FROM raw.indexing_errors;

-- Check checkpoint advancement
SELECT * FROM app.indexing_checkpoints ORDER BY service_name;

-- Check for dead leases
SELECT * FROM app.worker_leases WHERE status = 'FAILED' AND attempt >= 20;

-- Check for gaps
SELECT worker_type, from_height, to_height
FROM app.worker_leases
WHERE status != 'COMPLETED'
ORDER BY worker_type, from_height;
```

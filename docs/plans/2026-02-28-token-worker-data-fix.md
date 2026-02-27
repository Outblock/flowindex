# Token Worker Data Fix Plan

## Problems

### 1. Staking events misclassified as "mint"
Events like `FlowIDTableStaking.TokensWithdrawn` match `.TokensWithdrawn` in `classifyTokenEvent()` and create spurious FT transfer legs. These unpaired legs appear as "mint" transfers in the DB.

**Affected contracts**: `FlowIDTableStaking`, `FlowStakingCollection`, `LockedTokens`, `FlowEpoch`, `FlowDKG`, `FlowClusterQC`

**Code fix**: Already deployed (commit `b191c51`). New blocks are processed correctly.

**DB impact**: All existing `app.ft_transfers` rows derived from staking events are bogus and need deletion + re-processing.

### 2. EVM direct call `from`/`to` null in `app.evm_tx_hashes`
Flow's `0xff`-prefixed "direct call" transactions use a custom RLP format that go-ethereum can't decode. The `evm_worker` now handles this (commit `b191c51`), but existing rows have null `from_address`/`to_address`.

**Code fix**: Already deployed. New blocks decoded correctly.

**DB impact**: Existing `app.evm_tx_hashes` rows for direct calls have empty from/to.

## Fix Strategy: Forward Re-processing

Instead of resetting worker checkpoints (which process from checkpoint upward and would miss already-processed history), use a dedicated re-processing approach:

### Option A: Reset `history_deriver` checkpoints (Recommended)

The `history_deriver` drives `token_worker` and `evm_worker` through already-indexed raw blocks. Resetting its checkpoints makes it re-run all processors from the bottom.

**Steps:**
1. Delete bogus staking FT transfers first (SQL cleanup)
2. Reset `history_deriver` UP checkpoint to the earliest indexed height
3. The history_deriver will re-scan all raw blocks and re-run token_worker + evm_worker
4. Since both workers use upsert, correct data overwrites bad data

**SQL to delete bogus staking transfers:**
```sql
-- Count affected rows first
SELECT contract_name, COUNT(*)
FROM app.ft_transfers
WHERE contract_name IN ('FlowIDTableStaking', 'FlowStakingCollection', 'LockedTokens', 'FlowEpoch', 'FlowDKG', 'FlowClusterQC')
GROUP BY contract_name;

-- Delete them
DELETE FROM app.ft_transfers
WHERE contract_name IN ('FlowIDTableStaking', 'FlowStakingCollection', 'LockedTokens', 'FlowEpoch', 'FlowDKG', 'FlowClusterQC');
```

**Reset history_deriver:**
```sql
-- Check current checkpoints
SELECT * FROM app.indexing_checkpoints WHERE service_name LIKE 'history_deriver%';

-- Reset UP cursor to re-scan from the beginning
UPDATE app.indexing_checkpoints
SET last_height = (SELECT MIN(block_height) FROM raw.blocks)
WHERE service_name = 'history_deriver';

-- Delete completed leases so ranges are re-processed
DELETE FROM app.worker_leases WHERE worker_type = 'history_deriver';
```

**Pros:**
- Uses existing infrastructure, no new code needed
- Forward direction (lowest to highest), as requested
- Both token_worker and evm_worker get re-run automatically
- Upsert semantics prevent duplicates

**Cons:**
- Re-processes ALL workers for ALL blocks (not just affected ones)
- Takes time proportional to total indexed block count
- Adds DB load during re-processing

### Option B: Targeted admin endpoint for specific workers

Add a new admin endpoint that re-processes only specific workers for a height range, without resetting the main history_deriver.

**New endpoint**: `POST /admin/reprocess-worker`
```json
{
  "worker": "token_worker",   // or "evm_worker"
  "from_height": 85000000,
  "to_height": 143000000,
  "chunk_size": 1000,
  "concurrency": 4
}
```

This would:
1. Iterate from `from_height` to `to_height` in chunks
2. Call `worker.ProcessRange()` for each chunk
3. Report progress via response streaming or polling

**Pros:**
- Targeted — only re-runs the specific worker
- Can control concurrency and range
- Doesn't interfere with normal history_deriver operation
- Can be run for token_worker and evm_worker separately

**Cons:**
- Requires new code
- Need to be careful about DB connection pool usage

### Option C: One-shot SQL fix for EVM hashes + reset token_worker

For the EVM issue, directly update `app.evm_tx_hashes` using a SQL query that re-decodes the `raw_tx_payload` from `raw.events`. For staking, just delete + reset.

**Pros:** Fast, targeted
**Cons:** Can't decode RLP in SQL; would need a Go script

## Recommendation

**Option B** (targeted admin endpoint) is the cleanest long-term solution:
- Reusable for future data fixes
- Doesn't disrupt normal indexing
- Forward direction as requested
- Can run token_worker and evm_worker independently

**Quick win**: Start with Option A (reset history_deriver) if we want an immediate fix. Add Option B later for finer-grained control.

## Affected Height Range

- EVM on Flow mainnet started around block **85,981,134** (spork 18, Nov 2024)
- Staking events exist from genesis but are most numerous in recent sporks
- Current tip: ~143M+

## Verification

After re-processing, verify with:
```sql
-- No staking transfers should exist
SELECT COUNT(*) FROM app.ft_transfers
WHERE contract_name IN ('FlowIDTableStaking', 'FlowStakingCollection', 'LockedTokens');

-- EVM tx hashes should have from/to populated
SELECT COUNT(*) as total,
       COUNT(NULLIF(from_address, '')) as has_from,
       COUNT(NULLIF(to_address, '')) as has_to
FROM app.evm_tx_hashes;

-- Spot-check the test transaction
SELECT * FROM app.evm_tx_hashes
WHERE transaction_id = '17b6bfde16f2524a90cc3e2c30f4f6f864c31f8eca297a6c72f31f5d11c37c4d';
```

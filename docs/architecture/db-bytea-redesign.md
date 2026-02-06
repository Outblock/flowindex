# Bytea Schema Redesign (Full Rebuild)

## Summary
We are switching all **high‑cardinality hex identifiers** (block IDs, tx IDs, collection IDs, addresses, EVM/COA addresses) from `TEXT/VARCHAR` to `BYTEA`.  
This cuts storage and index size roughly in half for these columns and improves cache hit rate and scan speed at 10–20TB scale.

This change **requires a full DB rebuild** (DROP + recreate schema + re‑index + re‑derive app tables).

## Why `BYTEA`?
Hex strings are 2x the size of their binary representation:

| Data | Hex length | Bytes | Savings |
|------|------------|-------|---------|
| Flow address | 16 | 8 | ~50% |
| EVM/COA address | 40 | 20 | ~50% |
| Block/Tx ID | 64 | 32 | ~50% |

At 10–20TB, the **overall savings** depend on the share of these columns:
- Conservative: **10–15%** (1–3TB)
- Likely: **20–30%** (2–6TB)

Indexes also shrink by a similar factor.

## High‑Level Approach
1. **Schema update**: `BYTEA` for IDs/addresses across raw + app schemas.  
2. **App layer**:
   - Always **store raw bytes** in DB.
   - Always **return hex strings** in API (via `encode()` or Go conversion).
3. **Derived tables** remain the primary query surface for APIs.

## Columns Converted to `BYTEA`
**Raw schema**
- `raw.blocks`: `id`, `parent_id`, `state_root_hash`, `execution_result_id`
- `raw.block_lookup`: `id`
- `raw.transactions`: `id`, `proposer_address`, `payer_address`, `authorizers[]`
- `raw.tx_lookup`: `id`, `evm_hash`
- `raw.events`: `transaction_id`, `contract_address`
- `raw.collections`: `id`, `transaction_ids[]`
- `raw.execution_results`: `id`

**App schema**
- `app.token_transfers`: `transaction_id`, `token_contract_address`, `from_address`, `to_address`
- `app.evm_transactions`: `transaction_id`, `evm_hash`, `from_address`, `to_address`
- `app.accounts`: `address`
- `app.address_transactions`: `address`, `transaction_id`
- `app.address_stats`: `address`
- `app.account_keys`: `address`, `public_key`  
  - `signing_algorithm`, `hashing_algorithm` → `SMALLINT`
- `app.smart_contracts`: `address`
- `app.ft_tokens`, `app.ft_metadata`, `app.ft_holdings`: `contract_address`, `address`
- `app.nft_collections`, `app.nft_ownership`: `contract_address`, `owner`
- `app.tx_contracts`, `app.tx_tags`, `app.tx_metrics`: `transaction_id`
- `app.coa_accounts`: `coa_address`, `flow_address`, `transaction_id`
- `app.account_storage_snapshots`: `address`

## API Behavior (No Change)
All API responses remain **hex strings** (lowercase, no `0x`).  
Conversion happens in repository layer using:
- `encode(column, 'hex')` in SQL for reads  
- `hex.DecodeString()` → `[]byte` on writes

## Rebuild Procedure
1. **DROP & Recreate**
   - Drop old DB.
   - Apply updated `backend/schema_v2.sql`.
2. **Re‑ingest raw**
   - Run raw ingester.
3. **Re‑derive app**
   - Run workers for:
     - `accounts_worker`
     - `token_worker`
     - `ft_holdings_worker`
     - `nft_ownership_worker`
     - `tx_metrics_worker`
     - `tx_contracts_worker`
4. **Verify**
   - Run API unit tests (v1/v2).
   - Run smoke tests with 2–3 sample addresses.

## Notes
### `account_keys` algorithms
Store `signing_algorithm` and `hashing_algorithm` as **`SMALLINT`** (values < 10).

### `account_storage_snapshots` capacity
`BIGINT` is safe:
- 1 FLOW = 100MB.
- 10^9 FLOW → 10^17 bytes < 9.22e18 (`BIGINT` limit).

## Next Step
Review updated `backend/schema_v2.sql` and repository changes before the rebuild.

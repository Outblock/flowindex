# PostgreSQL Performance Analysis: 20-80TB Scale

> Generated: 2025-02-11 | Branch: `refactor/schema-cleanup`

## Overview

This document analyzes the FlowScan database and backend performance characteristics at 20-80TB scale (~200M blocks, billions of events), identifying bottlenecks and providing concrete recommendations.

---

## A. Partition Strategy

### Current Setup

| Table | Partition Step | Partitions at 200M blocks | Est. partition size |
|-------|---------------|--------------------------|---------------------|
| `raw.blocks` | 5M | 40 | 2-4 GB |
| `raw.transactions` | 5M | 40 | 5-20 GB |
| `raw.events` | 10M | 20 | **20-100 GB** |
| `app.ft_transfers` | 10M | 20 | 10-50 GB |
| `app.nft_transfers` | 10M | 20 | 5-25 GB |
| `app.evm_transactions` | 10M | 20 | 5-30 GB |

### Assessment
- Partition counts (20-40) are fine — PostgreSQL handles up to ~1000 partitions
- **`raw.events` is the concern** — partitions could reach 100 GB each, problematic for vacuum, index rebuilds, and backups

### Recommendations
- `raw.events` should use **2M-5M ranges** (not 10M) — events are 10-50x per transaction
- `app.ft_transfers` / `app.nft_transfers` should use **5M ranges** for vacuum performance
- `raw.blocks` at 5M is fine (~500 bytes/row)
- **Target**: keep each partition under 20-30 GB (data + indexes)

### Partition Pruning
- Queries with `block_height` in WHERE: pruning works well
- Queries on `app.ft_transfers` by `from_address`/`to_address` WITHOUT `block_height`: **scans ALL partitions**
- `app.evm_transactions` queries by `evm_hash`: scans all partitions

---

## B. Index Analysis

### Indexes Likely to Bottleneck

1. **`idx_ft_transfers_from/to`** — Plain B-tree on BYTEA across all partitions. `WHERE from_address = X` scans every partition's index. **Single biggest index bottleneck.**
2. **`idx_nft_transfers_from/to`** — Same problem
3. **`idx_evm_hash`** — Scanning all partitions for one EVM hash
4. **`idx_nft_ownership_owner`** — Unpartitioned, will hit cache misses at 100M+ rows

### Missing Indexes (Add Before 20TB)

```sql
-- Composite indexes eliminate sort for "transfers by address, ordered by recency"
CREATE INDEX idx_ft_transfers_from_height
  ON app.ft_transfers(from_address, block_height DESC, event_index DESC);
CREATE INDEX idx_ft_transfers_to_height
  ON app.ft_transfers(to_address, block_height DESC, event_index DESC);
CREATE INDEX idx_nft_transfers_from_height
  ON app.nft_transfers(from_address, block_height DESC, event_index DESC);
CREATE INDEX idx_nft_transfers_to_height
  ON app.nft_transfers(to_address, block_height DESC, event_index DESC);

-- Drop superseded single-column indexes
DROP INDEX idx_ft_transfers_from, idx_ft_transfers_to;
DROP INDEX idx_nft_transfers_from, idx_nft_transfers_to;

-- Cursor pagination tiebreaker
CREATE INDEX idx_address_txs_cursor
  ON app.address_transactions(address, block_height DESC, transaction_id DESC);

-- FT holdings by token
CREATE INDEX idx_ft_holdings_token
  ON app.ft_holdings(contract_address, contract_name) WHERE balance > 0;
```

### BRIN vs B-tree
- **Use BRIN for `timestamp`** on raw.blocks/transactions/events and ft/nft_transfers (100-1000x smaller, timestamps correlate with row order)
- **Keep B-tree for `block_height`** (partition key, pruning handles it)
- **Keep B-tree for address columns** (no correlation with physical order)

### Index Bloat on High-Update Tables
- `app.ft_holdings`, `app.nft_ownership`, `app.account_keys` — constant UPSERTs
- Set `fillfactor = 70` to allow HOT updates
- Aggressive autovacuum tuning needed

---

## C. Query Performance Risks

### CRITICAL: Queries That Will Degrade

#### 1. `COUNT(*)` on Partitioned Tables
Found in `token_transfer_contracts.go` and `api_v2_extra.go`. Requires scanning every matching partition.

**Fix**: Replace with `pg_class.reltuples` estimates or pre-computed counters. Switch paginated APIs from `total_count` to `has_more` semantics.

#### 2. `LEFT JOIN raw.events` (RESOLVED in Phase 2)
Cross-partition joins between `app.ft_transfers` and `raw.events` were the single highest-impact performance issue.

**Status**: Eliminated in Phase 2 schema cleanup. All token transfer queries now read `contract_name` directly from the transfer row.

#### 3. `ListFTVaultSummariesByAddress` Expensive Aggregate (RESOLVED in Phase 2)
Was scanning ALL ft_transfers for an address with SUM aggregate and multi-table JOIN.

**Status**: Replaced with direct read from `app.ft_holdings` (pre-computed balances).

#### 4. `GetTransactionsByAddressCursor` UNION Over 5 Tables
CTE queries `app.address_transactions` + `app.ft_transfers` (from/to) + `app.nft_transfers` (from/to). For active addresses, touches every partition.

**Fix**: Expand `app.address_transactions` to include transfer participation roles (`FT_SENDER`, `FT_RECEIVER`, `NFT_SENDER`, `NFT_RECEIVER`) during TokenWorker ingestion.

#### 5. `ListNFTCollectionSummaries` FULL OUTER JOIN
Scans entire `app.nft_ownership` for per-collection counts.

**Fix**: Pre-compute collection counts in a counter table refreshed by NFTOwnershipWorker.

---

## D. Write Path Performance

### COPY vs UPSERT
- Current approach: `CopyFrom` first (fast path) with savepoint, falls back to per-row UPSERT on conflict
- This is well-designed. COPY is 5-10x faster. Conflicts should be rare with checkpoint tracking.
- At 80TB: consider staging table + `INSERT ... ON CONFLICT` merge to avoid savepoint WAL overhead

### Sequence Contention
- High-volume tables use composite natural keys (no sequences) — **correct, no contention**
- `internal_id BIGSERIAL` removed in Phase 1 — good

### WAL Pressure
- Set `wal_compression = on` (PG15+)
- Increase `checkpoint_timeout` to 15-30 min, `max_wal_size` to 16-32 GB
- `SET LOCAL synchronous_commit = off` is appropriate for reconstructible indexing data

### Connection Pooling
- Current: `DB_MAX_OPEN_CONNS=200` (Railway) — aggressive
- **Deploy PgBouncer** in transaction pooling mode
- PostgreSQL `max_connections = 100-150`, PgBouncer `default_pool_size = 50`
- Separate pools for ingestion (few long txns) and API (many short queries)

---

## E. Storage Optimization

### JSONB Compression
- `raw.events.payload` is the largest storage consumer
- Switch to **lz4 compression** (PG14+): `ALTER TABLE raw.events ALTER COLUMN payload SET COMPRESSION lz4;` — 2x faster decompression
- Consider `toast_tuple_target = 128` to aggressively TOAST payloads

### Vacuum/Analyze Tuning

**Per-partition autovacuum (high-write partitions):**
```sql
ALTER TABLE raw.events_pN SET (
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_cost_delay = 2
);
```

**High-update tables:**
```sql
ALTER TABLE app.ft_holdings SET (fillfactor = 70);
ALTER TABLE app.nft_ownership SET (fillfactor = 70);
```

**System-level:**
- `autovacuum_max_workers = 6` (up from default 3)

### Hot/Cold Tiering
| Tier | Data | Strategy |
|------|------|----------|
| Hot | Last 24-48h | Default tablespace (fast NVMe) |
| Warm | Last 30 days | Default tablespace |
| Cold | Historical | Cheaper storage via tablespace, or Citus columnar |

---

## F. Concrete Recommendations

### Top 5 Before 20TB

| # | Change | Impact | Status |
|---|--------|--------|--------|
| 1 | **Eliminate `LEFT JOIN raw.events`** from query paths | 10x improvement on token transfer queries | **DONE** (Phase 2) |
| 2 | **Replace `COUNT(*)` with estimates** or pre-computed counters | Eliminates full-table scans on paginated endpoints | TODO |
| 3 | **Add composite indexes** for address-based transfer queries | Eliminates sort step, enables index-only scans | TODO |
| 4 | **Expand `app.address_transactions`** to include transfer roles | Eliminates 5-table UNION in address tx queries | TODO |
| 5 | **Deploy PgBouncer** | Frees shared memory for buffers/work_mem | TODO |

### Top 5 Before 80TB

| # | Change | Impact |
|---|--------|--------|
| 1 | **Reduce `raw.events` partition size to 2-5M** | Manageable vacuum, backup granularity |
| 2 | **Hot/cold storage tiering** with tablespaces | Storage cost reduction |
| 3 | **Add read replicas** for API query traffic | Isolate ingestion from query load |
| 4 | **Materialize expensive aggregations** (collection counts, holder counts) | Eliminate real-time GROUP BY on large tables |
| 5 | **Split `raw.events.payload`** into separate columnar store or object storage | 60-70% of storage is payloads; 10-12x compression possible |

### Bottleneck Progression

| Scale | Primary Bottleneck | Key Mitigation |
|-------|-------------------|----------------|
| 5-10TB | Cross-partition JOINs, COUNT(*) | Eliminate LEFT JOIN raw.events (done), pre-compute counts |
| 10-20TB | Index size, vacuum duration | Composite indexes, aggressive autovacuum, PgBouncer |
| 20-40TB | Buffer pool contention, WAL pressure | Read replicas, WAL compression, hot/cold tiering |
| 40-80TB | Storage cost, vacuum on massive partitions | Smaller partitions, columnar storage, object storage offload |

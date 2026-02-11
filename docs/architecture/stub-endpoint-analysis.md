# Stub Endpoint Analysis: Required Tables, Workers, and Data Sources

> Generated: 2025-02-11 | Branch: `refactor/schema-cleanup`

## Overview

The backend has ~30 stub endpoints returning `501 Not Implemented`. This document analyzes what new tables, workers, and data sources are needed to implement them.

---

## 1. Staking / Nodes Group (HIGHEST priority, 15+ endpoints)

**Endpoints:**
- `/flow/v1/node`, `/flow/v1/node/{node_id}`, `/flow/v1/node/{node_id}/reward/delegation`
- `/staking/v1/delegator`, `/staking/v1/epoch/stats`
- `/staking/v1/epoch/{epoch}/nodes`, `/staking/v1/epoch/{epoch}/role/{role}/nodes/aggregate`
- `/staking/v1/epoch/{epoch}/role/{role}/nodes/count`, `/staking/v1/epoch/{epoch}/role/{role}/nodes/grouped`
- `/staking/v1/node/{node_id}/event`, `/staking/v1/rewards/paid`, `/staking/v1/rewards/staking`
- `/staking/v1/tokenomics`
- `/staking/v1/account/{address}/ft/transfer`, `/staking/v1/account/{address}/transaction`

### Data Sources

**A. On-chain events (already in `raw.events`):**
- `FlowIDTableStaking.DelegatorRewardsPaid`, `RewardsPaid`, `TokensCommitted`, `TokensStaked`, `TokensUnstaked`
- `FlowIDTableStaking.NewNodeCreated`, `NodeRemovedAndRefunded`, `NewDelegatorCreated`
- `flow.EpochSetup` / `flow.EpochCommit` system service events

**B. Cadence script execution (new RPC calls):**
- Node table snapshot: `FlowIDTableStaking.getStakedNodeIDs()`, `FlowIDTableStaking.getNodeInfo(nodeID)`
- Epoch counter: `FlowEpoch.currentEpochCounter`
- Total/circulating supply: `FlowToken.totalSupply`

### Required New Tables

```sql
-- Staking nodes (per-epoch snapshot)
CREATE TABLE IF NOT EXISTS app.staking_nodes (
    node_id         TEXT NOT NULL,
    epoch           BIGINT NOT NULL,
    address         BYTEA NOT NULL,
    role            SMALLINT NOT NULL,      -- 1=Collection, 2=Consensus, 3=Execution, 4=Verification, 5=Access
    role_name       TEXT,
    networking_address TEXT,
    tokens_staked   NUMERIC(78,8),
    tokens_committed NUMERIC(78,8),
    tokens_unstaking NUMERIC(78,8),
    tokens_unstaked NUMERIC(78,8),
    tokens_rewarded NUMERIC(78,8),
    delegator_count INT DEFAULT 0,
    delegators_staked NUMERIC(78,8) DEFAULT 0,
    node_name       TEXT,
    organization    TEXT,
    first_seen_height BIGINT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (node_id, epoch)
);

-- Delegators
CREATE TABLE IF NOT EXISTS app.staking_delegators (
    delegator_id    TEXT NOT NULL,
    node_id         TEXT NOT NULL,
    address         BYTEA NOT NULL,
    tokens_committed NUMERIC(78,8),
    tokens_staked   NUMERIC(78,8),
    tokens_unstaking NUMERIC(78,8),
    tokens_rewarded NUMERIC(78,8),
    block_height    BIGINT,
    transaction_id  BYTEA,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (delegator_id, node_id)
);

-- Staking events (materialized from raw.events)
CREATE TABLE IF NOT EXISTS app.staking_events (
    block_height      BIGINT NOT NULL,
    transaction_id    BYTEA NOT NULL,
    event_index       INT NOT NULL,
    event_type        TEXT NOT NULL,
    node_id           TEXT,
    delegator_id      TEXT,
    address           BYTEA,
    amount            NUMERIC(78,8),
    timestamp         TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (block_height, transaction_id, event_index)
) PARTITION BY RANGE (block_height);

-- Epoch stats (per-epoch aggregates)
CREATE TABLE IF NOT EXISTS app.epoch_stats (
    epoch              BIGINT PRIMARY KEY,
    start_height       BIGINT,
    end_height         BIGINT,
    start_time         TIMESTAMPTZ,
    end_time           TIMESTAMPTZ,
    total_nodes        INT,
    total_validators   INT,
    total_delegators   INT,
    total_staked       NUMERIC(78,8),
    total_payout       NUMERIC(78,8),
    apy                NUMERIC(10,6),
    stake_apy          NUMERIC(10,6),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tokenomics snapshot (periodic)
CREATE TABLE IF NOT EXISTS app.tokenomics_snapshots (
    id                  BIGSERIAL PRIMARY KEY,
    total_supply        NUMERIC(78,8),
    circulating_supply  NUMERIC(78,8),
    validator_count     INT,
    validator_staked    NUMERIC(78,8),
    validator_apy       NUMERIC(10,6),
    delegator_count     INT,
    delegator_staked    NUMERIC(78,8),
    delegator_apy       NUMERIC(10,6),
    inflation_rate      NUMERIC(10,6),
    rewards_cumulative  NUMERIC(78,8),
    rewards_last_epoch  NUMERIC(78,8),
    as_of               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Required New Workers

| Worker | Type | Description |
|--------|------|-------------|
| **StakingWorker** | Async worker (`Processor`) | Parses `FlowIDTableStaking.*` events from `raw.events` into `app.staking_events` and `app.epoch_stats` |
| **StakingSnapshotJob** | Periodic background job | Executes Cadence scripts to snapshot node table, populates `app.staking_nodes`, `app.staking_delegators`, `app.tokenomics_snapshots` |

### Notes
- Raw staking events ARE already in `raw.events` — StakingWorker just materializes them
- Node metadata (names, organizations, IPs) requires live Cadence script execution
- This is the **highest-leverage single worker addition** — unlocks 20+ endpoints including wallet/participation

---

## 2. DeFi Group (MEDIUM priority, 5 endpoints)

**Endpoints:**
- `/defi/v1/asset`, `/defi/v1/events`, `/defi/v1/latest-block`, `/defi/v1/latest-swap`, `/defi/v1/pair`

### Data Sources
- Swap/liquidity events from DEX contracts (IncrementFi, .find, BloctoSwap) — already in `raw.events`
- Reserve data: Cadence script queries against DEX contracts (live RPC)
- Follows DEXScreener/CoinGecko adapter format

### Required New Tables

```sql
CREATE TABLE IF NOT EXISTS app.defi_assets (
    id                TEXT PRIMARY KEY,
    name              TEXT,
    symbol            TEXT,
    total_supply      NUMERIC(78,18),
    metadata          JSONB,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app.defi_pairs (
    id                TEXT PRIMARY KEY,
    dex_key           TEXT NOT NULL,
    asset0_id         TEXT NOT NULL,
    asset1_id         TEXT NOT NULL,
    fee_bps           INT,
    reserves_asset0   NUMERIC(78,18),
    reserves_asset1   NUMERIC(78,18),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app.defi_events (
    block_height      BIGINT NOT NULL,
    transaction_id    BYTEA NOT NULL,
    event_index       INT NOT NULL,
    pair_id           TEXT NOT NULL,
    event_type        TEXT NOT NULL,
    maker             BYTEA,
    asset0_in         NUMERIC(78,18),
    asset0_out        NUMERIC(78,18),
    asset1_in         NUMERIC(78,18),
    asset1_out        NUMERIC(78,18),
    price_native      NUMERIC,
    timestamp         TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (block_height, transaction_id, event_index)
) PARTITION BY RANGE (block_height);
```

### Required New Workers

| Worker | Type | Description |
|--------|------|-------------|
| **DeFiWorker** | Async worker | Parses known DEX contract events into `app.defi_events` and `app.defi_pairs` |
| **DeFiReservesJob** | Periodic job | Queries DEX contracts for current reserves via Cadence scripts |

---

## 3. Accounting / Tax Report Group (LOW priority, 2 endpoints)

**Endpoints:** `/flow/v1/account/{address}/tax-report`, `/accounting/v1/account/{address}/tax-report`

### Data Sources
All data already exists: `app.ft_transfers`, `app.nft_transfers`, `app.market_prices`, `app.tx_metrics`

### Required New Tables
Optional cache table (`app.tax_reports`) — not strictly required.

### Required New Workers
**None.** Query-time computation over existing tables.

---

## 4. Triggers / Webhooks Group (LOW priority, 5 endpoints)

**Endpoints:** `/triggers/v1/logs`, `/triggers/v1/triggers` (CRUD), `/triggers/v1/triggers/{id}/status`, `/triggers/v1/requeue/{id}`

### Required New Tables

```sql
CREATE TABLE IF NOT EXISTS app.triggers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT,
    name            TEXT,
    event_filter    TEXT NOT NULL,
    address_filter  BYTEA,
    callback_url    TEXT NOT NULL,
    status          TEXT DEFAULT 'ACTIVE',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app.trigger_logs (
    id              BIGSERIAL PRIMARY KEY,
    trigger_id      UUID NOT NULL REFERENCES app.triggers(id),
    block_height    BIGINT,
    transaction_id  BYTEA,
    status          TEXT NOT NULL,
    response_code   INT,
    error_message   TEXT,
    attempt         INT DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Required New Workers

| Worker | Type | Description |
|--------|------|-------------|
| **TriggerDispatcher** | Live callback | Attaches to forward ingester, matches events against trigger definitions, fires HTTP callbacks |

### Notes
Requires auth infrastructure (`/auth/v1/generate`) that doesn't exist yet.

---

## 5. Wallet / Participation Group (MEDIUM priority, 4 endpoints)

**Endpoints:** `/wallet/v1/participation/{address}` (list, aggregate, count, per-token)

### Required New Tables
**None.** Uses staking tables from Group 1.

### Required New Workers
**None.** Query-only over `app.staking_events` and `app.staking_delegators`.

### Notes
Blocked by Staking group implementation.

---

## 6. Simple / Legacy / Compatibility Group (LOW priority, 10+ endpoints)

**Endpoints:**
- `/simple/v1/blocks`, `/simple/v1/events`, `/simple/v1/transaction`, `/simple/v1/transaction/events`
- `/simple/v1/node_rewards`, `/simple/v1/rewards`
- `/nft/v0/{nft_type}/holding`, `/nft/v0/{nft_type}/item`, `/nft/v0/{nft_type}/item/{nft_id}`
- `/public/v1/epoch/payout`, `/public/v1/resolver`

### Required New Tables
Only `app.address_names` (for `.find` / FlowNS name resolution):

```sql
CREATE TABLE IF NOT EXISTS app.address_names (
    address     BYTEA NOT NULL,
    name        TEXT NOT NULL,
    provider    TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (address, provider)
);
```

### Required New Workers
- Simple/NFT-v0 endpoints: **None** — just handler code over existing data
- Rewards endpoints: Blocked by StakingWorker
- Resolver: Needs a **NameResolverJob** (periodic) querying `.find`/FlowNS contracts

---

## 7. Auth / Scheduled Transactions (LOW priority, 2 endpoints)

**Endpoints:** `/flow/v1/scheduled-transaction`, `/auth/v1/generate`

Optional `app.api_keys` table for API key management.

---

## Implementation Priority Summary

| Group | New Tables | New Workers | Blocked By | Priority |
|-------|-----------|-------------|------------|----------|
| **Staking/Nodes** | 5 | StakingWorker + StakingSnapshotJob | Nothing | **HIGH** |
| **Wallet/Participation** | 0 | None | Staking | **MEDIUM** |
| **DeFi** | 3 | DeFiWorker + DeFiReservesJob | Nothing | **MEDIUM** |
| **Simple/Legacy** | 0-1 | None (handlers only) | Partially by Staking | **LOW** |
| **Tax Report** | 0-1 | None (query-time) | Nothing | **LOW** |
| **Triggers/Webhooks** | 2 | TriggerDispatcher | Auth | **LOW** |
| **Auth/Scheduled** | 1 | None | Nothing | **LOW** |

## Recommended Implementation Order

1. **StakingWorker + StakingSnapshotJob** — Unlocks 20+ endpoints. Highest-leverage single addition.
2. **Simple/NFT-v0 handlers** — Zero infrastructure cost, just handler implementations.
3. **DeFiWorker** — Independent of staking, needed for aggregator integrations.
4. **Tax report handler** — No new workers, query over existing data.
5. **Triggers/Auth** — Full new subsystem, defer unless specific demand.

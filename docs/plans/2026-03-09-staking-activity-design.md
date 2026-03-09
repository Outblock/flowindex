# Staking Activity Design

## Goal

Add a "Staking Activity" section to the existing Staking tab on the account detail page. Shows historical staking events (stake, unstake, reward, etc.) grouped by epoch, below the current live state cards.

## Data Model

### Source Tables

- **`app.staking_events`** — partitioned by block_height, has event_type, node_id, delegator_id, amount, timestamp, transaction_id
- **`app.staking_delegators`** — maps (delegator_id, node_id) → address (BYTEA)
- **`app.staking_nodes`** — maps node_id → address (BYTEA), per epoch
- **`app.epoch_stats`** — maps epoch → (start_height, end_height, start_time, end_time)

### Query Strategy

No existing index on staking_events by address. Need to:

1. Look up node_ids from `staking_nodes WHERE address = $1` (node operator)
2. Look up (delegator_id, node_id) pairs from `staking_delegators WHERE address = $1` (delegator)
3. Query `staking_events` where `(node_id, delegator_id)` matches either set
4. Join `epoch_stats` to get epoch number per event (via block_height between start_height and end_height)

New index needed:
```sql
CREATE INDEX IF NOT EXISTS idx_staking_events_delegator ON app.staking_events(node_id, delegator_id);
```

## API

### `GET /flow/v1/account/{address}/staking/activity`

Query params: `limit` (default 50), `offset` (default 0)

Response:
```json
{
  "data": [
    {
      "event_type": "DelegatorTokensCommitted",
      "node_id": "3c6519ba...",
      "delegator_id": 499,
      "amount": "44000.00000000",
      "timestamp": "2026-02-23T14:51:51Z",
      "block_height": 144329420,
      "transaction_id": "0xf7cc5be2...",
      "epoch": 483,
      "epoch_start": "2026-02-23T00:00:00Z",
      "epoch_end": "2026-02-24T00:00:00Z"
    }
  ],
  "_meta": { "limit": 50, "offset": 0 }
}
```

## Frontend

### Location

Bottom of `AccountStakingTab.tsx`, below existing node/delegator cards.

### Layout

- Section header: "Staking Activity"
- Events grouped by epoch dividers: "Epoch 483 — Feb 23–24, 2026"
- Each row: type badge (color-coded) | amount FLOW | node ID (short) | delegator ID | timestamp | tx link
- Badge colors:
  - Green: Staked, Committed, Restaked
  - Orange: Unstaking
  - Red: Unstaked
  - Blue: RewardsPaid, DelegatorRewardsPaid
  - Gray: NewNodeCreated, NewDelegatorCreated
- Display labels map event_type to user-friendly names (e.g. `DelegatorTokensCommitted` → "Staked")
- Paginated with "Load more" button (offset-based, 50 per page)

## Transfer Diagram Fix

Recognize staking contract address (`8624b52f9ddcd04a` on mainnet = FlowIDTableStaking) in `TransferFlowDiagram.tsx`. When tokens flow to the staking contract with no counterpart deposit, label as "Stake" instead of "Burn".

## Event Type Display Mapping

| DB event_type | Display Label | Badge Color |
|---|---|---|
| TokensCommitted / DelegatorTokensCommitted | Staked | green |
| TokensStaked / DelegatorTokensStaked | Restaked | green |
| TokensUnstaking / DelegatorTokensUnstaking | Unstaking | orange |
| TokensUnstaked / DelegatorTokensUnstaked | Unstaked | red |
| RewardsPaid / DelegatorRewardsPaid | Reward | blue |
| NewNodeCreated | Node Created | gray |
| NewDelegatorCreated | Delegator Created | gray |

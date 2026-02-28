# Analytics Dashboard Design

## Overview
Full-featured analytics metric board for the FlowScan blockchain explorer. KPI summary cards on top, time-series charts below organized by category. Uses existing "Nothing Phone" aesthetic with 7D/30D/90D/All time range toggles.

## KPI Summary Cards (6 cards, top row)
| Card | Value | Delta | Source |
|------|-------|-------|--------|
| Total Transactions | cumulative | +X today | `/status/count` |
| Active Accounts (24h) | daily count | vs yesterday | `daily_stats` |
| Gas Burned (24h) | total_gas_used | vs yesterday | `daily_stats` |
| Tx Error Rate (24h) | failed/total % | vs yesterday | `tx_metrics` |
| FLOW Price | $X.XX | 24h change % | `/status/price` |
| Contracts Deployed | cumulative | +X today | `daily_stats` |

## Chart Sections (2-column grid)

### 1. Network Activity
- Daily Transaction Count (Cadence vs EVM stacked area)
- Daily Active Accounts (area)
- New Accounts Created per Day (area)

### 2. Gas & Fees
- Daily Gas Burned (area)
- Average Gas per Transaction (area)
- Epoch Fee Breakdown: minted/fees/burned (stacked bar from `epoch_stats`)

### 3. Transaction Health
- Transaction Error Rate % over time (area)
- Error Count by status (bar)

### 4. Token Economy
- Daily FT Transfer Count (area)
- Daily NFT Transfer Count (area)
- Top 5 FT Tokens by Transfer Volume (horizontal bar)
- FLOW Price History (line + market cap secondary axis)

### 5. EVM Adoption
- EVM vs Cadence Tx Count (stacked area)
- EVM Gas Usage Trend (area)

### 6. Staking & Epochs
- Total Staked per Epoch (line)
- Rewards Distributed per Epoch (bar)
- Node Count over Time (line)

## Backend Changes
1. `GET /analytics/daily` - daily_stats + error rate + new accounts
2. `GET /analytics/transfers/daily` - aggregated FT/NFT transfer counts per day
3. `GET /analytics/errors/daily` - tx error counts from tx_metrics
4. New `daily_stats` columns: `new_accounts`, `failed_tx_count`
5. Reuse existing: `/status/price`, `/staking/epoch/stats`, `/status/count`, `/status/nodes`

## Frontend Changes
- New sidebar entry: "Analytics" with chart icon at `/analytics`
- New route: `frontend/app/routes/analytics.tsx`
- Reusable `<MetricCard>` component
- Reusable `<TimeSeriesChart>` component (Recharts + time range toggles)
- Global time range selector syncing all charts

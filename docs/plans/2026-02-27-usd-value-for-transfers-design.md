# USD Value for Token Transfers

## Goal

Show historical USD value for FLOW and other FT transfers based on the token price at the time of the transaction. Currently `approx_usd_price` is hardcoded to 0 in all transfer responses.

## Data Sources

- **CryptoCompare** (free, no API key): FLOW daily prices from 2021-01-28 to present (~2000 records). Also supports USDC, USDT, BLT, REVV, DUST.
- **CoinGecko** (existing): Continues real-time 10-min polling for FLOW.
- **Stablecoins**: USDC, USDT, FUSD hardcoded to $1.00 USD.

## Design

### 1. Price Data Backfill

On startup, fetch full daily history from CryptoCompare for tokens that have a `market_symbol` set in `app.ft_tokens`. Store in existing `app.market_prices` table. Skip if data already covers 90%+ of the range.

**CryptoCompare endpoint**: `GET /data/v2/histoday?fsym={symbol}&tsym=USD&limit=2000`

### 2. Schema Changes

Add `market_symbol` column to `app.ft_tokens`:
```sql
ALTER TABLE app.ft_tokens ADD COLUMN IF NOT EXISTS market_symbol TEXT;
-- Seed known values
UPDATE app.ft_tokens SET market_symbol = 'FLOW' WHERE contract_name = 'FlowToken';
UPDATE app.ft_tokens SET market_symbol = 'USDC' WHERE symbol = 'USDC.e';
UPDATE app.ft_tokens SET market_symbol = 'USDT' WHERE symbol = 'tUSDT';
UPDATE app.ft_tokens SET market_symbol = 'BLT' WHERE contract_name = 'BloctoToken';
```

### 3. New Repository Method

```go
// GetPriceNearTime returns the price closest to the given timestamp.
// Returns (price, true) if found within 48h, or (0, false) otherwise.
func (r *Repository) GetPriceNearTime(ctx context.Context, asset, currency string, ts time.Time) (float64, bool, error)
```

SQL: union of the closest record before and after `ts`, pick the one with smallest time delta. Reject if delta > 48h (gap in data).

**Batch variant** for efficiency:
```go
// GetPricesForDates returns a map of date -> price for batch lookups.
// Callers group transfers by date, then look up once per date.
func (r *Repository) GetPricesForDates(ctx context.Context, asset, currency string, dates []time.Time) (map[string]float64, error)
```

### 4. API Changes

**`toFTTransferOutput()`** in `v1_helpers.go`:
- Accept a `priceMap map[string]map[string]float64` (date -> asset -> price)
- Replace hardcoded `approx_usd_price: 0` with actual historical price
- Add new field `usd_value` = amount * price

**Transfer list handlers** (`handleFlowAccountFTTransfers`, etc.):
1. After fetching transfers, collect unique (asset, date) pairs
2. Batch-fetch prices via `GetPricesForDates`
3. Pass price map to `toFTTransferOutput()`

**Transaction detail** (`toFlowTransactionOutput()`):
- Add `fee_usd` field = fee * FLOW price at block time

### 5. In-Memory Price Cache

Since price data is small (~2000 records per token) and rarely changes for historical dates:
- Load all daily prices into memory on startup
- Cache structure: `map[asset][]DailyPrice` sorted by date
- Binary search for nearest price by timestamp
- Refresh when new prices are inserted

### 6. Frontend Changes

All places displaying FLOW/FT amounts add `~ $X.XX` suffix:

- **Token transfer list** (`AccountFTTransfersTab.tsx`): Show USD value column
- **Transaction detail** (`TransactionDetailPage.tsx`): Fee in USD
- **Account balance** (`AccountOverview`): Current FLOW balance in USD (use latest price)
- **Home page** transaction list: USD value if FLOW transfer

Format: gray text, 2 decimal places for > $1, 4 for < $1. Omit if no price data.

## Scope

- Support all FT tokens that have `market_symbol` set in `app.ft_tokens`
- Stablecoins (USDC, USDT, FUSD) always use $1.00
- Tokens without price data: no USD shown (graceful degradation)
- Historical accuracy: daily granularity (sufficient for explorer use case)

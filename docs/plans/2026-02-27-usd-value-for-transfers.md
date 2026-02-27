# USD Value for Token Transfers — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show historical USD value for FLOW and other FT token transfers, using the token price at the time of each transaction.

**Architecture:** In-memory price cache loaded from `app.market_prices` DB table, populated at startup via CryptoCompare backfill (full history) + existing CoinGecko polling (live). API handlers look up prices by (asset, date) and inject `usd_price` / `usd_value` into transfer responses. Frontend displays `≈ $X.XX` next to all FLOW/FT amounts.

**Tech Stack:** Go (backend), PostgreSQL, CryptoCompare REST API, React/TypeScript (frontend)

---

## Task 1: Add `market_symbol` column to `app.ft_tokens`

**Files:**
- Modify: `backend/schema_v2.sql` (append after line 798)

**Step 1: Add the ALTER TABLE statement**

Add at the end of `schema_v2.sql` (migrations section):

```sql
-- USD price support: link FT tokens to market data symbols
ALTER TABLE app.ft_tokens ADD COLUMN IF NOT EXISTS market_symbol TEXT;
```

**Step 2: Add seed data for known tokens**

Immediately after the ALTER:

```sql
-- Seed known market symbols (idempotent)
UPDATE app.ft_tokens SET market_symbol = 'FLOW' WHERE contract_name = 'FlowToken' AND (market_symbol IS NULL OR market_symbol = '');
UPDATE app.ft_tokens SET market_symbol = 'USDC' WHERE symbol IN ('USDC.e', 'USDC') AND (market_symbol IS NULL OR market_symbol = '');
UPDATE app.ft_tokens SET market_symbol = 'USDT' WHERE symbol IN ('tUSDT', 'USDT') AND (market_symbol IS NULL OR market_symbol = '');
UPDATE app.ft_tokens SET market_symbol = 'BLT'  WHERE contract_name = 'BloctoToken' AND (market_symbol IS NULL OR market_symbol = '');
UPDATE app.ft_tokens SET market_symbol = 'REVV' WHERE contract_name = 'REVV' AND (market_symbol IS NULL OR market_symbol = '');
UPDATE app.ft_tokens SET market_symbol = 'FUSD' WHERE contract_name = 'FUSD' AND (market_symbol IS NULL OR market_symbol = '');
UPDATE app.ft_tokens SET market_symbol = 'stFLOW' WHERE contract_name = 'stFlowToken' AND (market_symbol IS NULL OR market_symbol = '');
```

**Step 3: Commit**

```
feat: add market_symbol column to ft_tokens for USD pricing
```

---

## Task 2: CryptoCompare price fetcher

**Files:**
- Create: `backend/internal/market/cryptocompare.go`

**Step 1: Implement the CryptoCompare daily history fetcher**

```go
package market

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// FetchDailyPriceHistory fetches up to 2000 days of daily close prices
// for a given symbol from CryptoCompare (free, no API key required).
// Returns oldest-first.
func FetchDailyPriceHistory(ctx context.Context, symbol string, days int) ([]PriceQuote, error) {
	if days <= 0 || days > 2000 {
		days = 2000
	}
	url := fmt.Sprintf(
		"https://min-api.cryptocompare.com/data/v2/histoday?fsym=%s&tsym=USD&limit=%d",
		symbol, days,
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "flowscan-clone/1.0")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("cryptocompare status: %s", resp.Status)
	}

	var result struct {
		Response string `json:"Response"`
		Message  string `json:"Message"`
		Data     struct {
			Data []struct {
				Time  int64   `json:"time"`
				Close float64 `json:"close"`
			} `json:"Data"`
		} `json:"Data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode cryptocompare: %w", err)
	}
	if result.Response == "Error" {
		return nil, fmt.Errorf("cryptocompare error: %s", result.Message)
	}

	var quotes []PriceQuote
	for _, d := range result.Data.Data {
		if d.Close <= 0 {
			continue // skip zero-price entries before listing
		}
		quotes = append(quotes, PriceQuote{
			Asset:    symbol,
			Currency: "usd",
			Price:    d.Close,
			Source:   "cryptocompare",
			AsOf:     time.Unix(d.Time, 0).UTC(),
		})
	}
	return quotes, nil
}
```

**Step 2: Commit**

```
feat: add CryptoCompare daily price history fetcher
```

---

## Task 3: In-memory price cache

**Files:**
- Create: `backend/internal/market/price_cache.go`

**Step 1: Implement the price cache with binary search**

```go
package market

import (
	"sort"
	"sync"
	"time"
)

// DailyPrice is a single date→price entry.
type DailyPrice struct {
	Date  time.Time // truncated to day (UTC)
	Price float64
}

// PriceCache holds sorted daily prices per asset for fast lookup.
type PriceCache struct {
	mu     sync.RWMutex
	prices map[string][]DailyPrice // key: uppercase asset symbol
}

func NewPriceCache() *PriceCache {
	return &PriceCache{prices: make(map[string][]DailyPrice)}
}

// Load replaces all prices for an asset. Expects sorted input (oldest first).
func (c *PriceCache) Load(asset string, prices []DailyPrice) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.prices[asset] = prices
}

// Append adds new prices and re-sorts.
func (c *PriceCache) Append(asset string, prices []DailyPrice) {
	c.mu.Lock()
	defer c.mu.Unlock()
	existing := c.prices[asset]
	// De-dup by date string
	seen := make(map[string]bool, len(existing))
	for _, p := range existing {
		seen[p.Date.Format("2006-01-02")] = true
	}
	for _, p := range prices {
		key := p.Date.Format("2006-01-02")
		if !seen[key] {
			existing = append(existing, p)
			seen[key] = true
		}
	}
	sort.Slice(existing, func(i, j int) bool { return existing[i].Date.Before(existing[j].Date) })
	c.prices[asset] = existing
}

// GetPriceAt returns the daily close price closest to the given time.
// Returns (price, true) if found within 48h, or (0, false) otherwise.
func (c *PriceCache) GetPriceAt(asset string, ts time.Time) (float64, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	ps := c.prices[asset]
	if len(ps) == 0 {
		return 0, false
	}

	// Binary search for the date closest to ts
	target := ts.UTC().Truncate(24 * time.Hour)
	idx := sort.Search(len(ps), func(i int) bool {
		return !ps[i].Date.Before(target)
	})

	// Check candidates: idx-1 (before) and idx (at or after)
	best := -1
	bestDelta := time.Duration(1<<63 - 1)
	for _, i := range []int{idx - 1, idx} {
		if i < 0 || i >= len(ps) {
			continue
		}
		delta := absDuration(ps[i].Date.Sub(target))
		if delta < bestDelta {
			bestDelta = delta
			best = i
		}
	}
	if best < 0 || bestDelta > 48*time.Hour {
		return 0, false
	}
	return ps[best].Price, true
}

// GetLatestPrice returns the most recent price for an asset.
func (c *PriceCache) GetLatestPrice(asset string) (float64, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	ps := c.prices[asset]
	if len(ps) == 0 {
		return 0, false
	}
	return ps[len(ps)-1].Price, true
}

func absDuration(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}
```

**Step 2: Commit**

```
feat: add in-memory price cache with binary search
```

---

## Task 4: Price cache initialization in main.go

**Files:**
- Modify: `backend/main.go` (price backfill section, lines ~884-921)
- Modify: `backend/internal/api/server_bootstrap.go` (Server struct, line 99)

**Step 1: Add PriceCache to Server struct**

In `server_bootstrap.go`, add field to `Server`:

```go
type Server struct {
	repo             *repository.Repository
	client           FlowClient
	httpServer       *http.Server
	startBlock       uint64
	blockscoutURL    string
	backfillProgress *BackfillProgress
	priceCache       *market.PriceCache   // <-- ADD THIS
	// ... rest unchanged
}
```

In `NewServer()`, initialize it:

```go
s := &Server{
	repo:        repo,
	client:      client,
	startBlock:  startBlock,
	priceCache:  market.NewPriceCache(),
	// ...
}
```

**Step 2: Add market_symbol to TokenMetadataInfo**

In `backend/internal/repository/query_v2.go`, add `MarketSymbol` field to `TokenMetadataInfo` struct (line 582):

```go
type TokenMetadataInfo struct {
	Name         string `json:"name"`
	Symbol       string `json:"symbol"`
	Decimals     int    `json:"decimals"`
	Logo         string `json:"logo,omitempty"`
	Description  string `json:"description,omitempty"`
	MarketSymbol string `json:"market_symbol,omitempty"` // <-- ADD
}
```

Update the SQL query in `GetFTTokenMetadataByIdentifiers()` (line 591+) to also SELECT `market_symbol` and scan it into the struct.

**Step 3: Expand price backfill in main.go**

Replace the existing CoinGecko-only backfill block (lines ~884-921) with:

```go
if enablePriceFeed {
	go func() {
		// 1. Load all existing prices from DB into cache
		loadPriceCacheFromDB(ctx, repo, apiServer.priceCache)

		// 2. Backfill from CryptoCompare for tokens with market_symbol
		symbols := getMarketSymbols(ctx, repo) // query ft_tokens for non-null market_symbol
		for _, sym := range symbols {
			earliest, _ := repo.GetEarliestMarketPrice(ctx, sym, "USD")
			// Skip if we already have >365 days of data
			if earliest != nil && earliest.AsOf.Before(time.Now().AddDate(0, 0, -365)) {
				log.Printf("[price_backfill] %s: already have data from %s, skipping CryptoCompare", sym, earliest.AsOf.Format("2006-01-02"))
				continue
			}
			log.Printf("[price_backfill] Fetching %s history from CryptoCompare...", sym)
			ctxFetch, cancel := context.WithTimeout(ctx, 30*time.Second)
			history, err := market.FetchDailyPriceHistory(ctxFetch, sym, 2000)
			cancel()
			if err != nil {
				log.Printf("[price_backfill] %s failed: %v", sym, err)
				continue
			}
			prices := make([]repository.MarketPrice, len(history))
			for i, q := range history {
				prices[i] = repository.MarketPrice{
					Asset: q.Asset, Currency: q.Currency, Price: q.Price, Source: q.Source, AsOf: q.AsOf,
				}
			}
			inserted, err := repo.BulkInsertMarketPrices(ctx, prices)
			if err != nil {
				log.Printf("[price_backfill] %s insert error: %v", sym, err)
			} else {
				log.Printf("[price_backfill] %s: %d new prices inserted (of %d fetched)", sym, inserted, len(history))
			}
		}

		// 3. Also run existing CoinGecko 365-day backfill for FLOW
		// (keeps the denser hourly data from CoinGecko)
		earliest, err := repo.GetEarliestMarketPrice(ctx, "FLOW", "USD")
		needsCoingecko := err != nil || earliest.AsOf.After(time.Now().AddDate(0, 0, -30))
		if needsCoingecko {
			// ... existing CoinGecko backfill code unchanged ...
		}

		// 4. Reload cache after backfill
		loadPriceCacheFromDB(ctx, repo, apiServer.priceCache)
	}()
}
```

Helper functions to add in `main.go`:

```go
func loadPriceCacheFromDB(ctx context.Context, repo *repository.Repository, cache *market.PriceCache) {
	// Get all distinct assets from market_prices
	assets, err := repo.GetDistinctPriceAssets(ctx)
	if err != nil {
		log.Printf("[price_cache] Failed to get assets: %v", err)
		return
	}
	for _, asset := range assets {
		prices, err := repo.GetMarketPriceHistory(ctx, asset, "USD", 8760) // up to 1 year hourly
		if err != nil {
			log.Printf("[price_cache] Failed to load %s: %v", asset, err)
			continue
		}
		daily := make([]market.DailyPrice, len(prices))
		for i, p := range prices {
			daily[i] = market.DailyPrice{Date: p.AsOf.UTC().Truncate(24 * time.Hour), Price: p.Price}
		}
		cache.Load(asset, daily)
		log.Printf("[price_cache] Loaded %d prices for %s", len(daily), asset)
	}
	// Add stablecoin entries (constant $1)
	for _, stable := range []string{"USDC", "USDT", "FUSD"} {
		if _, ok := cache.GetLatestPrice(stable); !ok {
			today := time.Now().UTC().Truncate(24 * time.Hour)
			cache.Load(stable, []market.DailyPrice{{Date: today, Price: 1.0}})
		}
	}
}

func getMarketSymbols(ctx context.Context, repo *repository.Repository) []string {
	// New repo method needed - see Task 5
	symbols, err := repo.GetDistinctMarketSymbols(ctx)
	if err != nil {
		log.Printf("[price_backfill] Failed to get market symbols: %v", err)
		return []string{"FLOW"} // fallback
	}
	return symbols
}
```

**Step 4: Update price poller to also refresh cache**

In the existing price poller goroutine (lines ~924-971), after `InsertMarketPrice`, add:

```go
// Update cache with latest price
apiServer.priceCache.Append(strings.ToUpper(quote.Asset), []market.DailyPrice{
	{Date: quote.AsOf.UTC().Truncate(24 * time.Hour), Price: quote.Price},
})
```

**Step 5: Commit**

```
feat: initialize price cache from DB + CryptoCompare backfill on startup
```

---

## Task 5: New repository methods

**Files:**
- Modify: `backend/internal/repository/market_prices.go`

**Step 1: Add `GetDistinctPriceAssets`**

```go
func (r *Repository) GetDistinctPriceAssets(ctx context.Context) ([]string, error) {
	rows, err := r.db.Query(ctx, `SELECT DISTINCT UPPER(asset) FROM app.market_prices ORDER BY 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var assets []string
	for rows.Next() {
		var a string
		if err := rows.Scan(&a); err != nil {
			return nil, err
		}
		assets = append(assets, a)
	}
	return assets, nil
}
```

**Step 2: Add `GetDistinctMarketSymbols`**

```go
func (r *Repository) GetDistinctMarketSymbols(ctx context.Context) ([]string, error) {
	rows, err := r.db.Query(ctx, `
		SELECT DISTINCT market_symbol FROM app.ft_tokens
		WHERE market_symbol IS NOT NULL AND market_symbol != ''
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var symbols []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		symbols = append(symbols, s)
	}
	return symbols, nil
}
```

**Step 3: Commit**

```
feat: add repo methods for distinct price assets and market symbols
```

---

## Task 6: Wire USD prices into FT transfer API responses

**Files:**
- Modify: `backend/internal/api/v1_helpers.go` (line 630, `toFTTransferOutput`)
- Modify: `backend/internal/api/v1_handlers_accounts.go` (lines 352-378, 590-616)

**Step 1: Update `toFTTransferOutput` signature to accept price info**

Change the function signature from:

```go
func toFTTransferOutput(t models.TokenTransfer, contractName, addrFilter string, meta *repository.TokenMetadataInfo) map[string]interface{}
```

to:

```go
func toFTTransferOutput(t models.TokenTransfer, contractName, addrFilter string, meta *repository.TokenMetadataInfo, usdPrice float64) map[string]interface{}
```

Replace the hardcoded fields:

```go
// OLD:
"approx_usd_price": 0,

// NEW:
"approx_usd_price": usdPrice,
"usd_value":        parseFloatOrZero(t.Amount) * usdPrice,
```

If `usdPrice == 0`, both fields will be 0 (frontend can check and hide).

**Step 2: Update all callers of `toFTTransferOutput`**

In `handleFlowAccountFTTransfers` (line 352+) and `handleFlowAccountFTTokenTransfers` (line 590+), after batch-loading token metadata, add price lookup:

```go
// After: ftMeta, _ := s.repo.GetFTTokenMetadataByIdentifiers(r.Context(), ftIDs)

// Look up USD prices for each transfer
for _, t := range transfers {
	id := formatTokenVaultIdentifier(t.TokenContractAddress, t.ContractName)
	var m *repository.TokenMetadataInfo
	if meta, ok := ftMeta[id]; ok {
		m = &meta
	}
	// Determine market symbol for this token
	var usdPrice float64
	if m != nil && m.MarketSymbol != "" {
		usdPrice, _ = s.priceCache.GetPriceAt(m.MarketSymbol, t.Timestamp)
	} else if t.ContractName == "FlowToken" {
		usdPrice, _ = s.priceCache.GetPriceAt("FLOW", t.Timestamp)
	}
	out = append(out, toFTTransferOutput(t.TokenTransfer, t.ContractName, address, m, usdPrice))
}
```

**Step 3: Also update the tax report handler**

In `v1_handlers_tax.go` (line 66-70), replace the "latest price" logic with per-transfer historical lookup:

```go
// OLD: flowPrice from GetLatestMarketPrice for all entries
// NEW: per-transfer lookup
usdPrice, _ := s.priceCache.GetPriceAt("FLOW", ts)
entry["approx_usd_price"] = usdPrice
// Also update usd_value calculation per transfer
```

**Step 4: Update all other callers**

Search for all `toFTTransferOutput(` calls and add the `usdPrice` argument. Expected callers:
- `v1_handlers_accounts.go` (2 places, done above)
- `v1_handlers_tax.go` (1 place)
- Any other file that calls it (grep to verify)

**Step 5: Commit**

```
feat: inject historical USD price into FT transfer API responses
```

---

## Task 7: Add `fee_usd` to transaction detail response

**Files:**
- Modify: `backend/internal/api/v1_helpers.go` (`toFlowTransactionOutput` or similar)

**Step 1: Find and modify the transaction output builder**

In `toFlowTransactionOutput()` (or `toFlowTransactionOutputWithTransfers()`), after setting the `"fee"` field:

```go
// After setting fee:
var feeUSD float64
if fee > 0 {
	if p, ok := s.priceCache.GetPriceAt("FLOW", tx.Timestamp); ok {
		feeUSD = fee * p
	}
}
out["fee_usd"] = feeUSD
```

Note: If `toFlowTransactionOutput` is a standalone function (not a method on Server), you'll need to pass the priceCache or the usdPrice as a parameter.

**Step 2: Commit**

```
feat: add fee_usd to transaction detail response
```

---

## Task 8: Add status/price/at endpoint (optional but useful)

**Files:**
- Modify: `backend/internal/api/routes_registration.go`
- Modify: `backend/internal/api/v1_handlers_status.go`

**Step 1: Add a new endpoint for historical price lookup**

Route: `GET /status/price/at?asset=FLOW&ts=2025-06-01T00:00:00Z`

```go
func (s *Server) handleStatusPriceAt(w http.ResponseWriter, r *http.Request) {
	asset := strings.ToUpper(r.URL.Query().Get("asset"))
	if asset == "" {
		asset = "FLOW"
	}
	tsStr := r.URL.Query().Get("ts")
	if tsStr == "" {
		writeAPIError(w, http.StatusBadRequest, "ts parameter required")
		return
	}
	ts, err := time.Parse(time.RFC3339, tsStr)
	if err != nil {
		ts, err = time.Parse("2006-01-02", tsStr)
		if err != nil {
			writeAPIError(w, http.StatusBadRequest, "invalid ts format")
			return
		}
	}
	price, found := s.priceCache.GetPriceAt(asset, ts)
	writeAPIResponse(w, []map[string]interface{}{
		{"asset": asset, "currency": "USD", "price": price, "found": found, "as_of": ts},
	}, nil, nil)
}
```

Register in routes:

```go
r.HandleFunc("/status/price/at", cachedHandler(60*time.Second, s.handleStatusPriceAt)).Methods("GET", "OPTIONS")
```

**Step 2: Commit**

```
feat: add /status/price/at endpoint for historical price lookup
```

---

## Task 9: Frontend — USD value display utility

**Files:**
- Create: `frontend/app/components/UsdValue.tsx`

**Step 1: Create a reusable USD value display component**

```tsx
interface Props {
    value?: number;    // USD value (amount * price)
    price?: number;    // USD price per token
    amount?: number;   // token amount (calculates value = amount * price)
    className?: string;
}

export function UsdValue({ value, price, amount, className }: Props) {
    const usd = value ?? (price && amount ? price * amount : 0);
    if (!usd || usd === 0) return null;

    const formatted = usd >= 1
        ? `$${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : usd >= 0.01
            ? `$${usd.toFixed(4)}`
            : `$${usd.toFixed(6)}`;

    return (
        <span className={`text-zinc-400 dark:text-zinc-500 ${className ?? ''}`}>
            ≈ {formatted}
        </span>
    );
}
```

**Step 2: Commit**

```
feat: add UsdValue component for displaying USD equivalent
```

---

## Task 10: Frontend — Show USD in FT transfer tables

**Files:**
- Modify: `frontend/app/components/account/AccountFTTransfersTab.tsx`

**Step 1: Add USD column to the transfer table**

The API now returns `approx_usd_price` and `usd_value` for each transfer. Update the table:

1. Add column header: `<th>USD Value</th>`
2. In each row, after the amount cell:

```tsx
<td className="p-4 font-mono">
    {tx.amount != null ? Number(tx.amount).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—'}
    {tx.usd_value > 0 && (
        <span className="ml-2 text-zinc-400 dark:text-zinc-500 text-[10px]">
            ≈ ${tx.usd_value >= 1
                ? tx.usd_value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                : tx.usd_value.toFixed(4)}
        </span>
    )}
</td>
```

Or use the `<UsdValue>` component from Task 9.

**Step 2: Commit**

```
feat: display USD values in FT transfer table
```

---

## Task 11: Frontend — Show USD in transaction detail page

**Files:**
- Modify: `frontend/app/routes/txs/$txId.tsx`

**Step 1: Show USD alongside fees**

Where the fee is displayed, add the USD equivalent using `fee_usd` from the API response.

**Step 2: Show USD alongside FT transfer amounts**

In the FT transfer section of the transaction detail page (around line 977 where `ft.amount` is displayed), add the USD value if `ft.usd_value` or `ft.approx_usd_price` is available.

**Step 3: Show USD alongside aggregated amounts in FlowRow**

The `FlowRow` component (line 203) receives `amount`. Also pass `usdPrice` and display the USD equivalent.

**Step 4: Commit**

```
feat: display USD values in transaction detail page
```

---

## Task 12: Frontend — Show USD for account FLOW balance

**Files:**
- Modify: `frontend/app/routes/accounts/$address.tsx` (around line 270)

**Step 1: Fetch current FLOW price and display balance in USD**

The account page already fetches account data. Use the existing `/status/price` endpoint (already fetched by the network stats) to get the current FLOW price.

Where balance is displayed (line ~270):

```tsx
{balanceValue != null && balanceValue > 0 && flowPrice > 0 && (
    <span className="text-zinc-400 text-sm ml-2">
        ≈ ${(balanceValue * flowPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
)}
```

**Step 2: Commit**

```
feat: display USD equivalent for FLOW balance on account page
```

---

## Task 13: Build & verify

**Step 1: Build backend**

```bash
cd backend && CGO_CFLAGS="-std=gnu99" CGO_ENABLED=1 go build -o indexer main.go
```

Expected: Compiles without errors.

**Step 2: Build frontend**

```bash
cd frontend && npm run build
```

Expected: Builds without errors (warnings about `use client` are expected).

**Step 3: Commit if any fixes were needed**

```
fix: resolve build issues for USD pricing feature
```

---

## Task 14: Final commit & summary

**Step 1: Verify all changes**

```bash
git diff --stat main
```

**Step 2: Create summary commit if needed**

Ensure all files are committed. The feature should include:

- Backend: CryptoCompare fetcher, price cache, schema migration, API response changes
- Frontend: UsdValue component, USD display in transfers/tx detail/account balance

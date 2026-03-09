# Token Price Worker — Multi-Source Periodic Price Updates

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the FLOW-only price poller with a multi-source periodic updater that refreshes all tokens with `coingecko_id` every 30 minutes.

**Architecture:** Extend the existing poller goroutine in `main.go`. Add batch current-price fetch functions for CoinGecko and DeFi Llama. Add new GeckoTerminal source for Flow EVM DEX tokens. Priority: CoinGecko → DeFi Llama → GeckoTerminal — first successful source wins per token.

**Tech Stack:** Go, CoinGecko API, DeFi Llama API, GeckoTerminal API

---

### Task 1: Add CoinGecko batch current-price fetch

**Files:**
- Modify: `backend/internal/market/price.go`

Add `FetchMultiTokenPrices(ctx, coingeckoIDs []string) (map[string]PriceQuote, error)` that calls CoinGecko `/simple/price?ids=flow,usd-coin,...&vs_currencies=usd&include_24hr_change=true&include_market_cap=true` and returns a map keyed by coingecko_id.

### Task 2: Add DeFi Llama current-price fetch

**Files:**
- Modify: `backend/internal/market/defillama.go`

Add `FetchDefiLlamaCurrentPrices(ctx, coingeckoIDs []string) (map[string]PriceQuote, error)` that calls `https://coins.llama.fi/prices/current/coingecko:flow,coingecko:usd-coin,...` and returns a map keyed by coingecko_id.

### Task 3: Add GeckoTerminal Flow EVM price fetch

**Files:**
- Create: `backend/internal/market/geckoterminal.go`

Add `FetchGeckoTerminalPrices(ctx) (map[string]PriceQuote, error)` that calls GeckoTerminal's Flow EVM network top pools endpoint and returns prices keyed by coingecko_id (or market_symbol if no coingecko_id).

### Task 4: Replace FLOW-only poller with multi-token updater

**Files:**
- Modify: `backend/main.go`

Replace the `fetchAndStore` closure in the poller goroutine. New logic:
1. Load `coingecko_id → market_symbol` map from DB
2. Collect all coingecko_ids
3. Try CoinGecko batch → for any missing, try DeFi Llama → for any still missing, try GeckoTerminal
4. Store all results in DB + update in-memory price cache
5. Change default interval to 30 min

### Task 5: Commit and push

Commit all changes, push to main.

package market

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type PriceQuote struct {
	Asset          string
	Currency       string
	Price          float64
	PriceChange24h float64
	MarketCap      float64
	Source         string
	AsOf           time.Time
}

func FetchFlowPrice(ctx context.Context) (PriceQuote, error) {
	url := "https://api.coingecko.com/api/v3/simple/price?ids=flow&vs_currencies=usd&include_24hr_change=true&include_market_cap=true"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return PriceQuote{}, err
	}
	req.Header.Set("User-Agent", "flowscan-clone/1.0")

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return PriceQuote{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return PriceQuote{}, fmt.Errorf("coingecko status: %s", resp.Status)
	}

	var result map[string]struct {
		USD          float64 `json:"usd"`
		USDChange24h float64 `json:"usd_24h_change"`
		USDMarketCap float64 `json:"usd_market_cap"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return PriceQuote{}, err
	}

	if data, ok := result["flow"]; ok {
		return PriceQuote{
			Asset:          "flow",
			Currency:       "usd",
			Price:          data.USD,
			PriceChange24h: data.USDChange24h,
			MarketCap:      data.USDMarketCap,
			Source:         "coingecko",
			AsOf:           time.Now(),
		}, nil
	}

	return PriceQuote{}, fmt.Errorf("coingecko payload missing flow")
}

// FetchFlowPriceHistory fetches daily FLOW/USD prices for the last N days
// from CoinGecko's /coins/{id}/market_chart endpoint. Returns one PriceQuote
// per day, oldest first.
func FetchFlowPriceHistory(ctx context.Context, days int) ([]PriceQuote, error) {
	if days <= 0 {
		days = 365
	}
	url := fmt.Sprintf(
		"https://api.coingecko.com/api/v3/coins/flow/market_chart?vs_currency=usd&days=%d&interval=daily",
		days,
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
		return nil, fmt.Errorf("coingecko market_chart status: %s", resp.Status)
	}

	var result struct {
		Prices     [][]json.Number `json:"prices"`
		MarketCaps [][]json.Number `json:"market_caps"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode market_chart: %w", err)
	}

	// Build a map of timestamp_ms -> market_cap for quick lookup.
	mcapByTS := make(map[string]float64, len(result.MarketCaps))
	for _, pair := range result.MarketCaps {
		if len(pair) < 2 {
			continue
		}
		tsStr := pair[0].String()
		mcap, _ := pair[1].Float64()
		mcapByTS[tsStr] = mcap
	}

	quotes := make([]PriceQuote, 0, len(result.Prices))
	for _, pair := range result.Prices {
		if len(pair) < 2 {
			continue
		}
		tsMs, err := pair[0].Int64()
		if err != nil {
			continue
		}
		price, err := pair[1].Float64()
		if err != nil {
			continue
		}
		t := time.Unix(tsMs/1000, (tsMs%1000)*int64(time.Millisecond))
		quotes = append(quotes, PriceQuote{
			Asset:     "flow",
			Currency:  "usd",
			Price:     price,
			MarketCap: mcapByTS[pair[0].String()],
			Source:    "coingecko",
			AsOf:      t,
		})
	}

	return quotes, nil
}


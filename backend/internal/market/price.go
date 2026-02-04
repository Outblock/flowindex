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


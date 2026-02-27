package market

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// FetchDefiLlamaPriceHistory fetches daily prices from DeFi Llama for a CoinGecko ID.
// Paginates in 500-day chunks. Returns oldest-first, skipping zero prices.
func FetchDefiLlamaPriceHistory(ctx context.Context, coingeckoID string) ([]PriceQuote, error) {
	var allQuotes []PriceQuote
	// Start from 2020-01-01 and paginate forward
	start := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	now := time.Now().UTC()

	for start.Before(now) {
		url := fmt.Sprintf(
			"https://coins.llama.fi/chart/coingecko:%s?start=%d&span=500&period=1d&searchWidth=600",
			coingeckoID, start.Unix(),
		)

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return allQuotes, err
		}
		req.Header.Set("User-Agent", "flowscan-clone/1.0")

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return allQuotes, err
		}

		var result struct {
			Coins map[string]struct {
				Prices []struct {
					Timestamp float64 `json:"timestamp"`
					Price     float64 `json:"price"`
				} `json:"prices"`
			} `json:"coins"`
		}
		err = json.NewDecoder(resp.Body).Decode(&result)
		resp.Body.Close()
		if err != nil {
			return allQuotes, fmt.Errorf("decode defillama: %w", err)
		}

		fetched := 0
		for _, coinData := range result.Coins {
			for _, p := range coinData.Prices {
				if p.Price <= 0 {
					continue
				}
				ts := time.Unix(int64(p.Timestamp), 0).UTC()
				allQuotes = append(allQuotes, PriceQuote{
					Asset:    coingeckoID,
					Currency: "usd",
					Price:    p.Price,
					Source:   "defillama",
					AsOf:     ts,
				})
				fetched++
			}
		}

		if fetched == 0 {
			// No data in this range, move forward
			start = start.AddDate(0, 0, 500)
		} else {
			// Move start past the last fetched point
			start = start.AddDate(0, 0, 500)
		}
	}

	return allQuotes, nil
}

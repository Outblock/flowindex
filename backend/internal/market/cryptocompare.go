package market

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// FetchDailyPriceHistory fetches up to 2000 days of daily close prices
// from CryptoCompare (free, no API key). Returns oldest-first, skipping zero prices.
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
			continue
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

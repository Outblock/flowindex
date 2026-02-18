package api

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type textCache struct {
	mu        sync.Mutex
	value     string
	expiresAt time.Time
}

var (
	totalSupplyCache            textCache
	totalSupplyWithDecimalCache textCache
)

func (s *Server) handleCompatFlowscanStats(w http.ResponseWriter, r *http.Request) {
	metric := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("metric")))
	if metric == "" {
		metric = "fees"
	}
	if metric != "fees" {
		writeAPIError(w, http.StatusBadRequest, "unsupported metric; only 'fees' is supported")
		return
	}

	timescale := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("timescale")))
	if timescale == "" {
		timescale = "daily"
	}
	if timescale != "daily" && timescale != "hourly" {
		writeAPIError(w, http.StatusBadRequest, "unsupported timescale; use daily|hourly")
		return
	}

	from, err := parseCompatTime(r.URL.Query().Get("from"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid from")
		return
	}
	to, err := parseCompatTime(r.URL.Query().Get("to"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid to")
		return
	}
	if from.IsZero() || to.IsZero() {
		now := time.Now().UTC()
		to = now
		from = now.Add(-24 * time.Hour)
	}
	if !to.After(from) {
		writeAPIError(w, http.StatusBadRequest, "invalid time range; to must be after from")
		return
	}
	if timescale == "hourly" && to.Sub(from) > 45*24*time.Hour {
		writeAPIError(w, http.StatusBadRequest, "hourly range too large; max 45 days")
		return
	}
	if timescale == "daily" && to.Sub(from) > 5*365*24*time.Hour {
		writeAPIError(w, http.StatusBadRequest, "daily range too large; max 5 years")
		return
	}

	points, err := s.repo.GetFeeMetricPoints(r.Context(), from, to, timescale)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	out := make([]interface{}, 0, len(points))
	for _, p := range points {
		out = append(out, map[string]interface{}{
			"metric":    metric,
			"number":    p.Number,
			"time":      p.Time.UTC().Format(time.RFC3339),
			"timescale": timescale,
		})
	}
	writeAPIResponse(w, out, map[string]interface{}{"count": len(out)}, nil)
}

func (s *Server) handleCompatTotalSupply(w http.ResponseWriter, r *http.Request) {
	val, err := getCachedText(r.Context(), &totalSupplyCache, 5*time.Minute, func(ctx context.Context) (string, error) {
		primary := strings.TrimSpace(os.Getenv("FIND_TOTAL_SUPPLY_URL"))
		if primary == "" {
			primary = "https://api.find.xyz/public/v1/totalSupply"
		}
		if v, err := fetchPlainText(ctx, primary); err == nil && v != "" {
			return v, nil
		}

		fallback := strings.TrimSpace(os.Getenv("TOKEN_PRICE_TOTAL_SUPPLY_URL"))
		if fallback == "" {
			fallback = "https://token-price-functions.vercel.app/api/totalSupply"
		}
		return fetchPlainText(ctx, fallback)
	})
	if err != nil {
		writeAPIError(w, http.StatusBadGateway, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte(val))
}

func (s *Server) handleCompatTotalSupplyWithDecimal(w http.ResponseWriter, r *http.Request) {
	val, err := getCachedText(r.Context(), &totalSupplyWithDecimalCache, 5*time.Minute, func(ctx context.Context) (string, error) {
		primary := strings.TrimSpace(os.Getenv("FIND_TOTAL_SUPPLY_WITH_DECIMAL_URL"))
		if primary == "" {
			primary = "https://api.find.xyz/public/v1/totalSupplyWithDecimal"
		}
		if v, err := fetchPlainText(ctx, primary); err == nil && v != "" {
			return v, nil
		}

		raw, err := getCachedText(ctx, &totalSupplyCache, 5*time.Minute, func(ctx context.Context) (string, error) {
			fallback := strings.TrimSpace(os.Getenv("TOKEN_PRICE_TOTAL_SUPPLY_URL"))
			if fallback == "" {
				fallback = "https://token-price-functions.vercel.app/api/totalSupply"
			}
			return fetchPlainText(ctx, fallback)
		})
		if err != nil {
			return "", err
		}
		return formatFixedDecimals(raw, 8)
	})
	if err != nil {
		writeAPIError(w, http.StatusBadGateway, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte(val))
}

func parseCompatTime(v string) (time.Time, error) {
	v = strings.TrimSpace(v)
	if v == "" {
		return time.Time{}, nil
	}
	if ts, err := time.Parse(time.RFC3339, v); err == nil {
		return ts.UTC(), nil
	}
	if ts, err := time.Parse(time.RFC3339Nano, v); err == nil {
		return ts.UTC(), nil
	}
	if ts, err := time.Parse("2006-01-02", v); err == nil {
		return ts.UTC(), nil
	}
	if n, err := strconv.ParseInt(v, 10, 64); err == nil {
		// Treat as unix seconds.
		return time.Unix(n, 0).UTC(), nil
	}
	return time.Time{}, fmt.Errorf("unsupported time format")
}

func fetchPlainText(ctx context.Context, url string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("upstream status %d", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 256))
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(b)), nil
}

func getCachedText(ctx context.Context, cache *textCache, ttl time.Duration, loader func(context.Context) (string, error)) (string, error) {
	now := time.Now()
	cache.mu.Lock()
	if now.Before(cache.expiresAt) && cache.value != "" {
		v := cache.value
		cache.mu.Unlock()
		return v, nil
	}
	cache.mu.Unlock()

	v, err := loader(ctx)
	if err != nil {
		return "", err
	}
	cache.mu.Lock()
	cache.value = v
	cache.expiresAt = time.Now().Add(ttl)
	cache.mu.Unlock()
	return v, nil
}

func formatFixedDecimals(raw string, decimals int) (string, error) {
	raw = strings.TrimSpace(raw)
	raw = strings.TrimPrefix(raw, "+")
	if raw == "" {
		return "", fmt.Errorf("empty numeric value")
	}
	for _, ch := range raw {
		if ch < '0' || ch > '9' {
			return "", fmt.Errorf("invalid integer value")
		}
	}
	if decimals <= 0 {
		return raw, nil
	}
	if len(raw) <= decimals {
		return "0." + strings.Repeat("0", decimals-len(raw)) + raw, nil
	}
	i := len(raw) - decimals
	return raw[:i] + "." + raw[i:], nil
}

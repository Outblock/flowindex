package api

import (
	"encoding/json"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"
)

// Status endpoints
func (s *Server) handleStatusCount(w http.ResponseWriter, r *http.Request) {
	_, maxH, totalBlocks, _ := s.repo.GetBlockRange(r.Context())
	totalTxs, _ := s.repo.GetTotalTransactions(r.Context())
	writeAPIResponse(w, []interface{}{map[string]interface{}{
		"block_count":       totalBlocks,
		"transaction_count": totalTxs,
		"max_height":        maxH,
	}}, nil, nil)
}

func (s *Server) handleStatusStat(w http.ResponseWriter, r *http.Request) {
	stats, err := s.repo.GetDailyStats(r.Context())
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeAPIResponse(w, stats, map[string]interface{}{"count": len(stats)}, nil)
}

func (s *Server) handleStatusStatTrend(w http.ResponseWriter, r *http.Request) {
	// reuse daily stats for trend
	s.handleStatusStat(w, r)
}

func (s *Server) handleStatusFlowStat(w http.ResponseWriter, r *http.Request) {
	minH, maxH, totalBlocks, _ := s.repo.GetBlockRange(r.Context())
	totalTxs, _ := s.repo.GetTotalTransactions(r.Context())
	writeAPIResponse(w, []interface{}{map[string]interface{}{
		"min_height":  minH,
		"max_height":  maxH,
		"block_count": totalBlocks,
		"tx_count":    totalTxs,
	}}, nil, nil)
}

func (s *Server) handleStatusEpochStatus(w http.ResponseWriter, r *http.Request) {
	snap, err := s.repo.GetStatusSnapshot(r.Context(), "epoch_status")
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if snap == nil {
		writeAPIResponse(w, []interface{}{}, nil, nil)
		return
	}
	var payload interface{}
	_ = json.Unmarshal(snap.Payload, &payload)
	writeAPIResponse(w, []interface{}{payload}, nil, nil)
}

func (s *Server) handleStatusEpochStat(w http.ResponseWriter, r *http.Request) {
	snap, err := s.repo.GetStatusSnapshot(r.Context(), "epoch_stat")
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if snap == nil {
		writeAPIResponse(w, []interface{}{}, nil, nil)
		return
	}
	var payload interface{}
	_ = json.Unmarshal(snap.Payload, &payload)
	writeAPIResponse(w, []interface{}{payload}, nil, nil)
}

func (s *Server) handleStatusTokenomics(w http.ResponseWriter, r *http.Request) {
	snap, err := s.repo.GetStatusSnapshot(r.Context(), "tokenomics")
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if snap == nil {
		writeAPIResponse(w, []interface{}{}, nil, nil)
		return
	}
	var payload map[string]interface{}
	_ = json.Unmarshal(snap.Payload, &payload)

	// Enrich with staking APY from epoch payout data
	if payouts, err := s.repo.ListEpochPayouts(r.Context(), 1, 0); err == nil && len(payouts) > 0 {
		payout := payouts[0]
		payoutTotal := parseFloatOrZero(payout.PayoutTotal)
		totalStaked := 0.0
		if ts, ok := payload["total_staked"].(float64); ok && ts > 0 {
			totalStaked = ts
		}
		if payoutTotal > 0 && totalStaked > 0 {
			// APY = (payout_per_epoch / total_staked) × 52 weeks × 100
			apy := (payoutTotal / totalStaked) * 52.0 * 100.0
			payload["staking_apy"] = math.Round(apy*100) / 100 // 2 decimal places
		}
	}

	writeAPIResponse(w, []interface{}{payload}, nil, nil)
}

func (s *Server) handleStatusPrice(w http.ResponseWriter, r *http.Request) {
	mp, err := s.repo.GetLatestMarketPrice(r.Context(), "FLOW", "USD")
	if err != nil {
		// No price data yet — return empty.
		writeAPIResponse(w, []interface{}{}, nil, nil)
		return
	}
	writeAPIResponse(w, []interface{}{map[string]interface{}{
		"asset":            mp.Asset,
		"currency":         mp.Currency,
		"price":            mp.Price,
		"price_change_24h": mp.PriceChange24h,
		"market_cap":       mp.MarketCap,
		"source":           mp.Source,
		"as_of":            mp.AsOf,
	}}, nil, nil)
}

func (s *Server) handleStatusPriceHistory(w http.ResponseWriter, r *http.Request) {
	limit := 168 // default: 7 days of hourly data
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 720 {
			limit = n
		}
	}
	prices, err := s.repo.GetMarketPriceHistory(r.Context(), "FLOW", "USD", limit)
	if err != nil {
		writeAPIResponse(w, []interface{}{}, nil, nil)
		return
	}
	out := make([]interface{}, 0, len(prices))
	for _, p := range prices {
		out = append(out, map[string]interface{}{
			"price": p.Price,
			"as_of": p.AsOf,
		})
	}
	writeAPIResponse(w, out, map[string]interface{}{"count": len(out)}, nil)
}

func (s *Server) handleStatusNodes(w http.ResponseWriter, r *http.Request) {
	// Return nodes from the latest epoch via the staking_nodes table
	limit, offset := parseLimitOffset(r)
	// Nodes are a bounded set (~500); allow higher limit for this endpoint
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 2000 {
			limit = n
		}
	}
	nodes, err := s.repo.ListStakingNodesLatestEpoch(r.Context(), limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Fetch GeoIP metadata and merge into response
	metaMap, _ := s.repo.ListNodeMetadata(r.Context())

	out := make([]interface{}, 0, len(nodes))
	for _, n := range nodes {
		entry := map[string]interface{}{
			"node_id":            n.NodeID,
			"role":               n.Role,
			"address":            formatAddressV1(n.Address),
			"networking_address": n.NetworkingAddress,
			"tokens_staked":      parseFloatOrZero(n.TokensStaked),
			"tokens_committed":   parseFloatOrZero(n.TokensCommitted),
			"tokens_unstaking":   parseFloatOrZero(n.TokensUnstaking),
			"tokens_unstaked":    parseFloatOrZero(n.TokensUnstaked),
			"tokens_rewarded":    parseFloatOrZero(n.TokensRewarded),
			"delegator_count":    n.DelegatorCount,
			"epoch":              n.Epoch,
		}
		if m, ok := metaMap[n.NodeID]; ok {
			entry["country"] = m.Country
			entry["country_code"] = m.CountryCode
			entry["city"] = m.City
			entry["latitude"] = m.Latitude
			entry["longitude"] = m.Longitude
			entry["isp"] = m.ISP
			entry["org"] = m.Org
		}
		out = append(out, entry)
	}

	writeAPIResponse(w, out, map[string]interface{}{
		"limit":  limit,
		"offset": offset,
	}, nil)
}

// handleStatusGCPVMs proxies the /status endpoint from the GCP VM API-only container.
// This avoids HTTPS→HTTP mixed content issues since the frontend calls same-origin.
// Configure with GCP_STATUS_URL env var (default: http://34.30.229.27:8081/status).
var gcpVMsCache struct {
	mu        sync.Mutex
	payload   []byte
	expiresAt time.Time
	fetchedAt time.Time
}

func (s *Server) handleStatusGCPVMs(w http.ResponseWriter, r *http.Request) {
	gcpURL := os.Getenv("GCP_STATUS_URL")
	if gcpURL == "" {
		gcpURL = "http://34.30.229.27:8081/status"
	}

	now := time.Now()
	gcpVMsCache.mu.Lock()
	if now.Before(gcpVMsCache.expiresAt) && len(gcpVMsCache.payload) > 0 {
		cached := append([]byte(nil), gcpVMsCache.payload...)
		gcpVMsCache.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.Write(cached)
		return
	}
	gcpVMsCache.mu.Unlock()

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(gcpURL)
	if err != nil {
		log.Printf("[api] GCP status proxy error: %v", err)
		// Graceful degradation: if we have any previous successful payload, serve it
		// instead of failing hard and breaking VM progress UI.
		gcpVMsCache.mu.Lock()
		hasStale := len(gcpVMsCache.payload) > 0
		stale := append([]byte(nil), gcpVMsCache.payload...)
		staleAt := gcpVMsCache.fetchedAt
		gcpVMsCache.mu.Unlock()
		if hasStale {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-Data-Stale", "true")
			w.Header().Set("X-Data-Stale-At", staleAt.UTC().Format(time.RFC3339))
			w.Write(stale)
			return
		}
		http.Error(w, "GCP status unavailable", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, "Failed to read GCP status", http.StatusBadGateway)
		return
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		log.Printf("[api] GCP status proxy upstream status=%d body=%s", resp.StatusCode, string(body))
		gcpVMsCache.mu.Lock()
		hasStale := len(gcpVMsCache.payload) > 0
		stale := append([]byte(nil), gcpVMsCache.payload...)
		staleAt := gcpVMsCache.fetchedAt
		gcpVMsCache.mu.Unlock()
		if hasStale {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-Data-Stale", "true")
			w.Header().Set("X-Data-Stale-At", staleAt.UTC().Format(time.RFC3339))
			w.Write(stale)
			return
		}
		http.Error(w, "GCP status unavailable", http.StatusBadGateway)
		return
	}

	gcpVMsCache.mu.Lock()
	gcpVMsCache.payload = body
	gcpVMsCache.expiresAt = time.Now().Add(5 * time.Second)
	gcpVMsCache.fetchedAt = time.Now()
	gcpVMsCache.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	w.Write(body)
}

func (s *Server) handleNotImplemented(w http.ResponseWriter, r *http.Request) {
	writeAPIError(w, http.StatusNotImplemented, "endpoint not implemented yet; see /docs/api for status")
}

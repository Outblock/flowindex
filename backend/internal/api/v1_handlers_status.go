package api

import (
	"encoding/json"
	"net/http"
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
	var payload interface{}
	_ = json.Unmarshal(snap.Payload, &payload)
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
		"asset":             mp.Asset,
		"currency":          mp.Currency,
		"price":             mp.Price,
		"price_change_24h":  mp.PriceChange24h,
		"market_cap":        mp.MarketCap,
		"source":            mp.Source,
		"as_of":             mp.AsOf,
	}}, nil, nil)
}

func (s *Server) handleStatusNodes(w http.ResponseWriter, r *http.Request) {
	// Return nodes from the latest epoch via the staking_nodes table
	limit, offset := parseLimitOffset(r)
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

func (s *Server) handleNotImplemented(w http.ResponseWriter, r *http.Request) {
	writeAPIError(w, http.StatusNotImplemented, "endpoint not implemented yet; see /docs/api for status")
}

package api

import (
	"net/http"
	"strings"

	"flowscan-clone/internal/models"
)

// handleDefiListPairs handles GET /defi/v1/pair
func (s *Server) handleDefiListPairs(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	dexKey := strings.TrimSpace(r.URL.Query().Get("dex"))

	pairs, err := s.repo.ListDefiPairs(r.Context(), dexKey, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	out := make([]map[string]interface{}, 0, len(pairs))
	for _, p := range pairs {
		out = append(out, map[string]interface{}{
			"id":              p.ID,
			"dex_key":         p.DexKey,
			"asset0_id":       p.Asset0ID,
			"asset1_id":       p.Asset1ID,
			"asset0_symbol":   p.Asset0Symbol,
			"asset1_symbol":   p.Asset1Symbol,
			"fee_bps":         p.FeeBps,
			"reserves_asset0": p.ReservesAsset0,
			"reserves_asset1": p.ReservesAsset1,
			"updated_at":      formatTime(p.UpdatedAt),
		})
	}

	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

// handleDefiListEvents handles GET /defi/v1/events
func (s *Server) handleDefiListEvents(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	pairID := strings.TrimSpace(r.URL.Query().Get("pair_id"))
	eventType := strings.TrimSpace(r.URL.Query().Get("event_type"))

	events, err := s.repo.ListDefiEvents(r.Context(), pairID, eventType, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	out := make([]map[string]interface{}, 0, len(events))
	for _, e := range events {
		out = append(out, defiEventToMap(e))
	}

	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

// handleDefiLatestSwap handles GET /defi/v1/latest-swap
func (s *Server) handleDefiLatestSwap(w http.ResponseWriter, r *http.Request) {
	pairID := strings.TrimSpace(r.URL.Query().Get("pair_id"))

	event, err := s.repo.GetLatestSwap(r.Context(), pairID)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if event == nil {
		writeAPIResponse(w, []interface{}{}, nil, nil)
		return
	}
	writeAPIResponse(w, []interface{}{defiEventToMap(*event)}, nil, nil)
}

// handleDefiLatestBlock handles GET /defi/v1/latest-block
func (s *Server) handleDefiLatestBlock(w http.ResponseWriter, r *http.Request) {
	height, err := s.repo.GetDefiLatestBlock(r.Context())
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeAPIResponse(w, []interface{}{map[string]interface{}{
		"latest_block": height,
	}}, nil, nil)
}

// handleDefiListAssets handles GET /defi/v1/asset
func (s *Server) handleDefiListAssets(w http.ResponseWriter, r *http.Request) {
	assets, err := s.repo.ListDefiAssets(r.Context())
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	out := make([]map[string]interface{}, 0, len(assets))
	for _, a := range assets {
		out = append(out, map[string]interface{}{
			"id":     a.ID,
			"symbol": a.Symbol,
		})
	}

	writeAPIResponse(w, out, map[string]interface{}{"count": len(out)}, nil)
}

func defiEventToMap(e models.DefiEvent) map[string]interface{} {
	return map[string]interface{}{
		"block_height":   e.BlockHeight,
		"transaction_id": e.TransactionID,
		"event_index":    e.EventIndex,
		"pair_id":        e.PairID,
		"event_type":     e.EventType,
		"maker":          e.Maker,
		"asset0_in":      e.Asset0In,
		"asset0_out":     e.Asset0Out,
		"asset1_in":      e.Asset1In,
		"asset1_out":     e.Asset1Out,
		"price_native":   e.PriceNative,
		"timestamp":      formatTime(e.Timestamp),
	}
}

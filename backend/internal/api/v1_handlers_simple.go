package api

import (
	"net/http"
	"strings"

	"github.com/gorilla/mux"
)

// ── Simple/v1 endpoints ──────────────────────────────────────────────────────

// handleSimpleBlocks handles GET /simple/v1/blocks — simplified block list
func (s *Server) handleSimpleBlocks(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	blocks, err := s.repo.ListBlocks(r.Context(), limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(blocks))
	for _, b := range blocks {
		out = append(out, map[string]interface{}{
			"height":    b.Height,
			"id":        b.ID,
			"timestamp": formatTime(b.Timestamp),
			"tx_count":  b.TxCount,
		})
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

// handleSimpleEvents handles GET /simple/v1/events — event list with optional filters
func (s *Server) handleSimpleEvents(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	heightParam, err := parseHeightParam(r.URL.Query().Get("height"))
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid height")
		return
	}
	txHash := strings.TrimSpace(r.URL.Query().Get("transaction_hash"))

	if txHash != "" {
		events, err := s.repo.GetEventsByTransactionID(r.Context(), txHash)
		if err != nil {
			writeAPIError(w, http.StatusInternalServerError, err.Error())
			return
		}
		out := make([]map[string]interface{}, 0, len(events))
		for _, e := range events {
			out = append(out, toFlowEventOutput(e))
		}
		writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
		return
	}

	if heightParam != nil {
		events, err := s.repo.GetEventsByBlockHeight(r.Context(), *heightParam)
		if err != nil {
			writeAPIError(w, http.StatusInternalServerError, err.Error())
			return
		}
		out := make([]map[string]interface{}, 0, len(events))
		for _, e := range events {
			out = append(out, toFlowEventOutput(e))
		}
		writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
		return
	}

	// No filter: return empty with guidance
	writeAPIResponse(w, []interface{}{}, map[string]interface{}{
		"limit":  limit,
		"offset": offset,
		"hint":   "provide ?height= or ?transaction_hash= to filter events",
	}, nil)
}

// handleSimpleTransactions handles GET /simple/v1/transaction — transaction list
func (s *Server) handleSimpleTransactions(w http.ResponseWriter, r *http.Request) {
	// Delegate to the existing flow/v1/transaction handler
	s.handleFlowListTransactions(w, r)
}

// handleSimpleTransactionEvents handles GET /simple/v1/transaction/events — events for a transaction
func (s *Server) handleSimpleTransactionEvents(w http.ResponseWriter, r *http.Request) {
	txHash := strings.TrimSpace(r.URL.Query().Get("transaction_hash"))
	if txHash == "" {
		writeAPIError(w, http.StatusBadRequest, "transaction_hash query parameter is required")
		return
	}

	events, err := s.repo.GetEventsByTransactionID(r.Context(), txHash)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(events))
	for _, e := range events {
		out = append(out, toFlowEventOutput(e))
	}
	writeAPIResponse(w, out, map[string]interface{}{"count": len(out)}, nil)
}

// ── NFT/v0 endpoints ────────────────────────────────────────────────────────

// handleNFTV0Holding handles GET /nft/v0/{nft_type}/holding — NFT owner counts
func (s *Server) handleNFTV0Holding(w http.ResponseWriter, r *http.Request) {
	// Delegate to existing handler
	s.handleFlowNFTHoldingsByCollection(w, r)
}

// handleNFTV0Item handles GET /nft/v0/{nft_type}/item — list NFT items
func (s *Server) handleNFTV0Item(w http.ResponseWriter, r *http.Request) {
	collectionAddr, collectionName := parseTokenParam(mux.Vars(r)["nft_type"])
	limit, offset := parseLimitOffset(r)

	items, err := s.repo.ListNFTOwnershipByCollection(r.Context(),
		formatTokenIdentifier(collectionAddr, collectionName), limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]map[string]interface{}, 0, len(items))
	for _, item := range items {
		out = append(out, toCombinedNFTDetails(item))
	}
	writeAPIResponse(w, out, map[string]interface{}{"limit": limit, "offset": offset, "count": len(out)}, nil)
}

// handleNFTV0ItemByID handles GET /nft/v0/{nft_type}/item/{nft_id} — single NFT item
func (s *Server) handleNFTV0ItemByID(w http.ResponseWriter, r *http.Request) {
	collectionAddr, collectionName := parseTokenParam(mux.Vars(r)["nft_type"])
	nftID := mux.Vars(r)["nft_id"]
	item, err := s.repo.GetNFTOwnership(r.Context(), collectionAddr, collectionName, nftID)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if item == nil {
		writeAPIResponse(w, []interface{}{}, nil, nil)
		return
	}
	writeAPIResponse(w, []interface{}{toCombinedNFTDetails(*item)}, nil, nil)
}

// ── Staking compatibility endpoints ──────────────────────────────────────────

// handleStakingDelegators handles GET /staking/v1/delegator
func (s *Server) handleStakingDelegators(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	nodeID := strings.TrimSpace(r.URL.Query().Get("node_id"))

	delegators, err := s.repo.ListStakingDelegators(r.Context(), nodeID, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	out := make([]interface{}, 0, len(delegators))
	for _, d := range delegators {
		out = append(out, map[string]interface{}{
			"delegator_id":     d.DelegatorID,
			"node_id":          d.NodeID,
			"address":          formatAddressV1(d.Address),
			"tokens_committed": parseFloatOrZero(d.TokensCommitted),
			"tokens_staked":    parseFloatOrZero(d.TokensStaked),
			"tokens_unstaking": parseFloatOrZero(d.TokensUnstaking),
			"tokens_rewarded":  parseFloatOrZero(d.TokensRewarded),
			"tokens_unstaked":  parseFloatOrZero(d.TokensUnstaked),
			"updated_at":       formatTime(d.UpdatedAt),
		})
	}

	writeAPIResponse(w, out, map[string]interface{}{
		"limit":  limit,
		"offset": offset,
	}, nil)
}

// handleStakingAccountFTTransfers handles GET /staking/v1/account/{address}/ft/transfer
func (s *Server) handleStakingAccountFTTransfers(w http.ResponseWriter, r *http.Request) {
	// Delegate to existing FT transfer handler
	s.handleFlowAccountFTTransfers(w, r)
}

// handleStakingAccountTransactions handles GET /staking/v1/account/{address}/transaction
func (s *Server) handleStakingAccountTransactions(w http.ResponseWriter, r *http.Request) {
	// Delegate to existing account transactions handler
	s.handleFlowAccountTransactions(w, r)
}

// handleStakingRewardsPaid handles GET /staking/v1/rewards/paid
func (s *Server) handleStakingRewardsPaid(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)

	events, err := s.repo.ListStakingEventsByType(r.Context(), "RewardsPaid", limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	out := make([]interface{}, 0, len(events))
	for _, e := range events {
		out = append(out, map[string]interface{}{
			"block_height":   e.BlockHeight,
			"transaction_id": e.TransactionID,
			"event_index":    e.EventIndex,
			"event_type":     e.EventType,
			"node_id":        e.NodeID,
			"delegator_id":   e.DelegatorID,
			"amount":         e.Amount,
			"timestamp":      formatTime(e.Timestamp),
		})
	}

	writeAPIResponse(w, out, map[string]interface{}{
		"limit":  limit,
		"offset": offset,
	}, nil)
}

// handleStakingRewardsStaking handles GET /staking/v1/rewards/staking
func (s *Server) handleStakingRewardsStaking(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)

	events, err := s.repo.ListStakingEventsByTypeLike(r.Context(), "%Staked", limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	out := make([]interface{}, 0, len(events))
	for _, e := range events {
		out = append(out, map[string]interface{}{
			"block_height":   e.BlockHeight,
			"transaction_id": e.TransactionID,
			"event_index":    e.EventIndex,
			"event_type":     e.EventType,
			"node_id":        e.NodeID,
			"delegator_id":   e.DelegatorID,
			"amount":         e.Amount,
			"timestamp":      formatTime(e.Timestamp),
		})
	}

	writeAPIResponse(w, out, map[string]interface{}{
		"limit":  limit,
		"offset": offset,
	}, nil)
}

// handleStakingTokenomics handles GET /staking/v1/tokenomics
func (s *Server) handleStakingTokenomics(w http.ResponseWriter, r *http.Request) {
	snapshot, err := s.repo.GetLatestTokenomicsSnapshot(r.Context())
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if snapshot == nil {
		writeAPIResponse(w, []interface{}{}, nil, nil)
		return
	}
	writeAPIResponse(w, []interface{}{snapshot}, nil, nil)
}

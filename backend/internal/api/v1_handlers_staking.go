package api

import (
	"net/http"
	"strconv"
	"strings"

	"flowscan-clone/internal/models"

	"github.com/gorilla/mux"
)

// handleListNodes handles GET /flow/v1/node — list all staking nodes (latest epoch)
func (s *Server) handleListNodes(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)

	epochStr := r.URL.Query().Get("epoch")
	var nodes []models.StakingNode
	var err error

	if epochStr != "" {
		epoch, parseErr := strconv.ParseInt(epochStr, 10, 64)
		if parseErr != nil {
			writeAPIError(w, http.StatusBadRequest, "invalid epoch parameter")
			return
		}
		nodes, err = s.repo.ListStakingNodes(r.Context(), epoch, limit, offset)
	} else {
		nodes, err = s.repo.ListStakingNodesLatestEpoch(r.Context(), limit, offset)
	}

	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	out := make([]interface{}, 0, len(nodes))
	for _, n := range nodes {
		out = append(out, stakingNodeToMap(n))
	}

	writeAPIResponse(w, out, map[string]interface{}{
		"limit":  limit,
		"offset": offset,
	}, nil)
}

// handleGetNode handles GET /flow/v1/node/{node_id} — get single node
func (s *Server) handleGetNode(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	nodeID := vars["node_id"]
	if nodeID == "" {
		writeAPIError(w, http.StatusBadRequest, "node_id is required")
		return
	}

	node, err := s.repo.GetStakingNode(r.Context(), nodeID)
	if err != nil {
		writeAPIError(w, http.StatusNotFound, "node not found")
		return
	}

	writeAPIResponse(w, []interface{}{stakingNodeToMap(*node)}, nil, nil)
}

// handleGetNodeEvents handles GET /staking/v1/node/{node_id}/event — events for a node
func (s *Server) handleGetNodeEvents(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	nodeID := vars["node_id"]
	if nodeID == "" {
		writeAPIError(w, http.StatusBadRequest, "node_id is required")
		return
	}

	limit, offset := parseLimitOffset(r)

	events, err := s.repo.ListStakingEventsByNode(r.Context(), nodeID, limit, offset)
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

// handleGetEpochStats handles GET /staking/v1/epoch/stats — epoch stats list
func (s *Server) handleGetEpochStats(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)

	stats, err := s.repo.ListEpochStats(r.Context(), limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	out := make([]interface{}, 0, len(stats))
	for _, st := range stats {
		out = append(out, epochStatsToMap(st))
	}

	writeAPIResponse(w, out, map[string]interface{}{
		"limit":  limit,
		"offset": offset,
	}, nil)
}

// handleListEpochNodes handles GET /staking/v1/epoch/{epoch}/nodes — nodes for specific epoch
func (s *Server) handleListEpochNodes(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	epochStr := vars["epoch"]
	epoch, err := strconv.ParseInt(epochStr, 10, 64)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid epoch parameter")
		return
	}

	limit, offset := parseLimitOffset(r)

	nodes, err := s.repo.ListStakingNodes(r.Context(), epoch, limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	out := make([]interface{}, 0, len(nodes))
	for _, n := range nodes {
		out = append(out, stakingNodeToMap(n))
	}

	writeAPIResponse(w, out, map[string]interface{}{
		"limit":  limit,
		"offset": offset,
		"epoch":  epoch,
	}, nil)
}

func stakingNodeToMap(n models.StakingNode) map[string]interface{} {
	return map[string]interface{}{
		"node_id":            n.NodeID,
		"epoch":              n.Epoch,
		"address":            formatAddressV1(n.Address),
		"role":               n.Role,
		"networking_address": n.NetworkingAddress,
		"tokens_staked":      parseFloatOrZero(n.TokensStaked),
		"tokens_committed":   parseFloatOrZero(n.TokensCommitted),
		"tokens_unstaking":   parseFloatOrZero(n.TokensUnstaking),
		"tokens_unstaked":    parseFloatOrZero(n.TokensUnstaked),
		"tokens_rewarded":    parseFloatOrZero(n.TokensRewarded),
		"delegator_count":    n.DelegatorCount,
		"first_seen_height":  n.FirstSeenHeight,
		"updated_at":         formatTime(n.UpdatedAt),
	}
}

func epochStatsToMap(s models.EpochStats) map[string]interface{} {
	return map[string]interface{}{
		"epoch":          s.Epoch,
		"start_height":   s.StartHeight,
		"end_height":     s.EndHeight,
		"start_time":     formatTime(s.StartTime),
		"end_time":       formatTime(s.EndTime),
		"total_nodes":    s.TotalNodes,
		"total_staked":   parseFloatOrZero(s.TotalStaked),
		"total_rewarded": parseFloatOrZero(s.TotalRewarded),
		"updated_at":     formatTime(s.UpdatedAt),
	}
}

// handleStakingDelegators handles GET /staking/delegator
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

// handleStakingAccountFTTransfers handles GET /staking/account/{address}/ft/transfer
func (s *Server) handleStakingAccountFTTransfers(w http.ResponseWriter, r *http.Request) {
	s.handleFlowAccountFTTransfers(w, r)
}

// handleStakingAccountTransactions handles GET /staking/account/{address}/transaction
func (s *Server) handleStakingAccountTransactions(w http.ResponseWriter, r *http.Request) {
	s.handleFlowAccountTransactions(w, r)
}

// handleStakingRewardsPaid handles GET /staking/rewards/paid
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

// handleStakingRewardsStaking handles GET /staking/rewards/staking
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

// handlePublicEpochPayout handles GET /public/v1/epoch/payout
func (s *Server) handlePublicEpochPayout(w http.ResponseWriter, r *http.Request) {
	limit, offset := parseLimitOffset(r)
	if limit > 100 {
		limit = 100
	}

	payouts, err := s.repo.ListEpochPayouts(r.Context(), limit, offset)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, err.Error())
		return
	}

	out := make([]interface{}, 0, len(payouts))
	for _, p := range payouts {
		out = append(out, map[string]interface{}{
			"block_height": p.PayoutHeight,
			"timestamp":    formatTime(p.PayoutTime),
			"epoch":        strconv.FormatInt(p.Epoch, 10),
			"fields": map[string]interface{}{
				"total":      parseFloatOrZero(p.PayoutTotal),
				"fromFees":   parseFloatOrZero(p.PayoutFromFees),
				"minted":     parseFloatOrZero(p.PayoutMinted),
				"feesBurned": parseFloatOrZero(p.PayoutFeesBurned),
			},
		})
	}

	selfLink := "/public/v1/epoch/payout?limit=" + strconv.Itoa(limit)
	if offset > 0 {
		selfLink += "&offset=" + strconv.Itoa(offset)
	}
	nextLink := "/public/v1/epoch/payout?limit=" + strconv.Itoa(limit) + "&offset=" + strconv.Itoa(offset+limit)

	writeAPIResponse(w, out, nil, map[string]string{
		"self": selfLink,
		"next": nextLink,
	})
}

// handleStakingTokenomics handles GET /staking/tokenomics
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

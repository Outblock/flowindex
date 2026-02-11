package api

import (
	"net/http"
	"strconv"

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

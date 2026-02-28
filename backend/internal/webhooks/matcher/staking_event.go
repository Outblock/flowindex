package matcher

import (
	"encoding/json"
	"strconv"
	"strings"

	"flowscan-clone/internal/models"
)

type stakingEventConditions struct {
	EventTypes []string `json:"event_types"`
	NodeID     string   `json:"node_id"`
	MinAmount  *float64 `json:"min_amount"`
}

// StakingEventMatcher matches staking events by type, node, and amount.
type StakingEventMatcher struct{}

func (m *StakingEventMatcher) EventType() string { return "staking.event" }

func (m *StakingEventMatcher) Match(data interface{}, conditions json.RawMessage) MatchResult {
	se, ok := data.(*models.StakingEvent)
	if !ok {
		return MatchResult{}
	}

	var cond stakingEventConditions
	if len(conditions) > 0 {
		if err := json.Unmarshal(conditions, &cond); err != nil {
			return MatchResult{}
		}
	}

	// Check event types
	if len(cond.EventTypes) > 0 {
		found := false
		for _, et := range cond.EventTypes {
			if strings.EqualFold(se.EventType, et) {
				found = true
				break
			}
		}
		if !found {
			return MatchResult{}
		}
	}

	// Check node_id
	if cond.NodeID != "" {
		if se.NodeID != cond.NodeID {
			return MatchResult{}
		}
	}

	// Check min_amount
	if cond.MinAmount != nil {
		amount, err := strconv.ParseFloat(se.Amount, 64)
		if err != nil {
			return MatchResult{}
		}
		if amount < *cond.MinAmount {
			return MatchResult{}
		}
	}

	return MatchResult{
		Matched: true,
		EventData: map[string]interface{}{
			"event_type":   se.EventType,
			"node_id":      se.NodeID,
			"delegator_id": se.DelegatorID,
			"amount":       se.Amount,
			"tx_id":        se.TransactionID,
			"block_height": se.BlockHeight,
		},
	}
}

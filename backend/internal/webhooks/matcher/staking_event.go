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

func (m *StakingEventMatcher) Match(data interface{}, conditions json.RawMessage) bool {
	se, ok := data.(*models.StakingEvent)
	if !ok {
		return false
	}

	var cond stakingEventConditions
	if len(conditions) > 0 {
		if err := json.Unmarshal(conditions, &cond); err != nil {
			return false
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
			return false
		}
	}

	// Check node_id
	if cond.NodeID != "" {
		if se.NodeID != cond.NodeID {
			return false
		}
	}

	// Check min_amount
	if cond.MinAmount != nil {
		amount, err := strconv.ParseFloat(se.Amount, 64)
		if err != nil {
			return false
		}
		if amount < *cond.MinAmount {
			return false
		}
	}

	return true
}

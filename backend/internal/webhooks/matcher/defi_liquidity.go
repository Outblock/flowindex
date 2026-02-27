package matcher

import (
	"encoding/json"
	"strings"

	"flowscan-clone/internal/models"
)

type defiLiquidityConditions struct {
	PairID    string `json:"pair_id"`
	EventType string `json:"event_type"` // "Add" or "Remove"
}

// DefiLiquidityMatcher matches DeFi liquidity add/remove events.
type DefiLiquidityMatcher struct{}

func (m *DefiLiquidityMatcher) EventType() string { return "defi.liquidity" }

func (m *DefiLiquidityMatcher) Match(data interface{}, conditions json.RawMessage) bool {
	de, ok := data.(*models.DefiEvent)
	if !ok {
		return false
	}
	// Must NOT be a Swap event
	if strings.EqualFold(de.EventType, "Swap") {
		return false
	}

	var cond defiLiquidityConditions
	if len(conditions) > 0 {
		if err := json.Unmarshal(conditions, &cond); err != nil {
			return false
		}
	}

	// Check pair_id
	if cond.PairID != "" {
		if de.PairID != cond.PairID {
			return false
		}
	}

	// Check event_type filter
	if cond.EventType != "" {
		if !strings.EqualFold(de.EventType, cond.EventType) {
			return false
		}
	}

	return true
}

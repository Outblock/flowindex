package matcher

import (
	"encoding/json"
)

// BalanceCheckMatcher matches periodic balance check events.
// It always matches (the monitor already pre-filtered by address).
type BalanceCheckMatcher struct{}

func (m *BalanceCheckMatcher) EventType() string { return "balance.check" }

func (m *BalanceCheckMatcher) Match(data interface{}, conditions json.RawMessage) MatchResult {
	// data is a map[string]interface{} with address, balance, token fields.
	dataMap, ok := data.(map[string]interface{})
	if !ok {
		return MatchResult{}
	}

	// If conditions specify addresses, filter.
	if len(conditions) > 0 {
		var cond struct {
			Addresses flexStringSlice `json:"addresses"`
		}
		if err := json.Unmarshal(conditions, &cond); err == nil && len(cond.Addresses) > 0 {
			addr, _ := dataMap["address"].(string)
			matched := false
			for _, a := range cond.Addresses {
				if normalizeAddress(a) == normalizeAddress(addr) {
					matched = true
					break
				}
			}
			if !matched {
				return MatchResult{}
			}
		}
	}

	return MatchResult{Matched: true, EventData: dataMap}
}

package matcher

import (
	"encoding/json"

	"flowscan-clone/internal/models"
)

type accountCreatedConditions struct {
	Addresses []string `json:"addresses"`
}

// AccountCreatedMatcher matches flow.AccountCreated events.
type AccountCreatedMatcher struct{}

func (m *AccountCreatedMatcher) EventType() string { return "account.created" }

func (m *AccountCreatedMatcher) Match(data interface{}, conditions json.RawMessage) MatchResult {
	evt, ok := data.(*models.Event)
	if !ok {
		return MatchResult{}
	}

	if evt.Type != "flow.AccountCreated" {
		return MatchResult{}
	}

	var payload struct {
		Address string `json:"address"`
	}
	if err := json.Unmarshal(evt.Payload, &payload); err != nil {
		return MatchResult{}
	}

	var cond accountCreatedConditions
	if len(conditions) > 0 {
		if err := json.Unmarshal(conditions, &cond); err != nil {
			return MatchResult{}
		}
	}

	address := normalizeAddress(payload.Address)
	if len(cond.Addresses) > 0 {
		found := false
		for _, addr := range cond.Addresses {
			if normalizeAddress(addr) == address {
				found = true
				break
			}
		}
		if !found {
			return MatchResult{}
		}
	}

	return MatchResult{
		Matched: true,
		EventData: map[string]interface{}{
			"address":      address,
			"event_name":   "AccountCreated",
			"tx_id":        evt.TransactionID,
			"block_height": evt.BlockHeight,
		},
	}
}

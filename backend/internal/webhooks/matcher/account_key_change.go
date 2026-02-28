package matcher

import (
	"encoding/json"
	"strings"

	"flowscan-clone/internal/models"
)

type accountKeyChangeConditions struct {
	Addresses []string `json:"addresses"`
}

// AccountKeyChangeMatcher matches account key change events (KeyAdded / KeyRevoked).
type AccountKeyChangeMatcher struct{}

func (m *AccountKeyChangeMatcher) EventType() string { return "account.key_change" }

func (m *AccountKeyChangeMatcher) Match(data interface{}, conditions json.RawMessage) MatchResult {
	evt, ok := data.(*models.Event)
	if !ok {
		return MatchResult{}
	}

	// Must be a key-related event
	if !strings.Contains(evt.EventName, "KeyAdded") && !strings.Contains(evt.EventName, "KeyRevoked") {
		return MatchResult{}
	}

	var cond accountKeyChangeConditions
	if len(conditions) > 0 {
		if err := json.Unmarshal(conditions, &cond); err != nil {
			return MatchResult{}
		}
	}

	// Check addresses (ContractAddress is the account address for key events)
	if len(cond.Addresses) > 0 {
		found := false
		for _, addr := range cond.Addresses {
			if strings.EqualFold(evt.ContractAddress, addr) {
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
			"address":      evt.ContractAddress,
			"event_name":   evt.EventName,
			"tx_id":        evt.TransactionID,
			"block_height": evt.BlockHeight,
		},
	}
}

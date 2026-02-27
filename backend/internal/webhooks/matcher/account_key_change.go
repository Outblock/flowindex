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

func (m *AccountKeyChangeMatcher) Match(data interface{}, conditions json.RawMessage) bool {
	evt, ok := data.(*models.Event)
	if !ok {
		return false
	}

	// Must be a key-related event
	if !strings.Contains(evt.EventName, "KeyAdded") && !strings.Contains(evt.EventName, "KeyRevoked") {
		return false
	}

	var cond accountKeyChangeConditions
	if len(conditions) > 0 {
		if err := json.Unmarshal(conditions, &cond); err != nil {
			return false
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
			return false
		}
	}

	return true
}

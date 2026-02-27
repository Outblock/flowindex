package matcher

import (
	"encoding/json"
	"strings"

	"flowscan-clone/internal/models"
)

type contractEventConditions struct {
	ContractAddress string   `json:"contract_address"`
	EventNames      []string `json:"event_names"`
}

// ContractEventMatcher matches contract events by address and optional event name filter.
type ContractEventMatcher struct{}

func (m *ContractEventMatcher) EventType() string { return "contract.event" }

func (m *ContractEventMatcher) Match(data interface{}, conditions json.RawMessage) bool {
	evt, ok := data.(*models.Event)
	if !ok {
		return false
	}

	var cond contractEventConditions
	if len(conditions) > 0 {
		if err := json.Unmarshal(conditions, &cond); err != nil {
			return false
		}
	}

	// Check contract address
	if cond.ContractAddress != "" {
		if !strings.EqualFold(evt.ContractAddress, cond.ContractAddress) {
			return false
		}
	}

	// Check event names filter
	if len(cond.EventNames) > 0 {
		found := false
		for _, name := range cond.EventNames {
			if strings.EqualFold(evt.EventName, name) {
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

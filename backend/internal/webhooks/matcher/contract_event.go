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

func (m *ContractEventMatcher) Match(data interface{}, conditions json.RawMessage) MatchResult {
	evt, ok := data.(*models.Event)
	if !ok {
		return MatchResult{}
	}

	var cond contractEventConditions
	if len(conditions) > 0 {
		if err := json.Unmarshal(conditions, &cond); err != nil {
			return MatchResult{}
		}
	}

	// Check contract address
	if cond.ContractAddress != "" {
		if !strings.EqualFold(evt.ContractAddress, cond.ContractAddress) {
			return MatchResult{}
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
			return MatchResult{}
		}
	}

	return MatchResult{
		Matched: true,
		EventData: map[string]interface{}{
			"event_type":       evt.Type,
			"contract_address": evt.ContractAddress,
			"contract_name":    evt.ContractName,
			"event_name":       evt.EventName,
			"fields":           string(evt.Values),
			"tx_id":            evt.TransactionID,
			"block_height":     evt.BlockHeight,
		},
	}
}

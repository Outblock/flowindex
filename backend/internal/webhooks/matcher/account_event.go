package matcher

import (
	"encoding/json"
	"strings"

	"flowscan-clone/internal/models"
)

type accountEventConditions struct {
	Addresses  []string `json:"addresses"`
	EventTypes []string `json:"event_types"`
}

// AccountEventMatcher matches account lifecycle, key, and contract events.
type AccountEventMatcher struct{}

func (m *AccountEventMatcher) EventType() string { return "account.event" }

func (m *AccountEventMatcher) Match(data interface{}, conditions json.RawMessage) MatchResult {
	evt, ok := data.(*models.Event)
	if !ok {
		return MatchResult{}
	}

	eventType, address := normalizeAccountEvent(evt)
	if eventType == "" {
		return MatchResult{}
	}

	var cond accountEventConditions
	if len(conditions) > 0 {
		if err := json.Unmarshal(conditions, &cond); err != nil {
			return MatchResult{}
		}
	}

	if len(cond.EventTypes) > 0 {
		found := false
		for _, candidate := range cond.EventTypes {
			if strings.EqualFold(candidate, eventType) {
				found = true
				break
			}
		}
		if !found {
			return MatchResult{}
		}
	}

	if len(cond.Addresses) > 0 {
		normAddress := normalizeAddress(address)
		found := false
		for _, addr := range cond.Addresses {
			if normalizeAddress(addr) == normAddress {
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
			"address":        address,
			"event_type":     eventType,
			"raw_event_type": evt.Type,
			"event_name":     evt.EventName,
			"tx_id":          evt.TransactionID,
			"block_height":   evt.BlockHeight,
		},
	}
}

func normalizeAccountEvent(evt *models.Event) (eventType string, address string) {
	if evt == nil {
		return "", ""
	}

	switch {
	case evt.Type == "flow.AccountCreated":
		var payload struct {
			Address string `json:"address"`
		}
		_ = json.Unmarshal(evt.Payload, &payload)
		return "account.created", normalizeAddress(payload.Address)
	case strings.Contains(evt.EventName, "KeyAdded"):
		return "account.key.added", normalizeAddress(evt.ContractAddress)
	case strings.Contains(evt.EventName, "KeyRevoked"), strings.Contains(evt.EventName, "KeyRemoved"):
		return "account.key.removed", normalizeAddress(evt.ContractAddress)
	case strings.EqualFold(evt.EventName, "AccountContractAdded"):
		return "account.contract.added", normalizeAddress(evt.ContractAddress)
	case strings.EqualFold(evt.EventName, "AccountContractUpdated"):
		return "account.contract.updated", normalizeAddress(evt.ContractAddress)
	case strings.EqualFold(evt.EventName, "AccountContractRemoved"):
		return "account.contract.removed", normalizeAddress(evt.ContractAddress)
	default:
		return "", ""
	}
}

package matcher

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"

	"flowscan-clone/internal/models"
)

type defiEventConditions struct {
	PairID    string   `json:"pair_id"`
	EventType string   `json:"event_type"`
	Addresses []string `json:"addresses"`
	MinAmount *float64 `json:"min_amount"`
}

// DefiEventMatcher matches unified DeFi events across swaps and liquidity changes.
type DefiEventMatcher struct{}

func (m *DefiEventMatcher) EventType() string { return "defi.event" }

func (m *DefiEventMatcher) Match(data interface{}, conditions json.RawMessage) MatchResult {
	de, ok := data.(*models.DefiEvent)
	if !ok {
		return MatchResult{}
	}

	eventType := normalizeDefiEventType(de.EventType)
	if eventType == "" {
		return MatchResult{}
	}

	var cond defiEventConditions
	if len(conditions) > 0 {
		if err := json.Unmarshal(conditions, &cond); err != nil {
			return MatchResult{}
		}
	}

	if cond.PairID != "" && de.PairID != cond.PairID {
		return MatchResult{}
	}

	if cond.EventType != "" && !strings.EqualFold(cond.EventType, eventType) {
		return MatchResult{}
	}

	if cond.MinAmount != nil {
		maxAmt := 0.0
		for _, v := range []string{de.Asset0In, de.Asset0Out, de.Asset1In, de.Asset1Out} {
			if f, err := strconv.ParseFloat(v, 64); err == nil {
				maxAmt = math.Max(maxAmt, f)
			}
		}
		if maxAmt < *cond.MinAmount {
			return MatchResult{}
		}
	}

	if len(cond.Addresses) > 0 {
		found := false
		for _, addr := range cond.Addresses {
			if strings.EqualFold(de.Maker, addr) {
				found = true
				break
			}
		}
		if !found {
			return MatchResult{}
		}
	}

	eventData := defiEventData(de)
	eventData["event_type"] = eventType
	eventData["raw_event_type"] = de.EventType

	return MatchResult{
		Matched:   true,
		EventData: eventData,
	}
}

func normalizeDefiEventType(eventType string) string {
	switch strings.ToLower(strings.TrimSpace(eventType)) {
	case "swap":
		return "swap"
	case "add", "addliquidity", "add_liquidity":
		return "add_liquidity"
	case "remove", "removeliquidity", "remove_liquidity":
		return "remove_liquidity"
	default:
		return ""
	}
}

package matcher

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"

	"flowscan-clone/internal/models"
)

type defiSwapConditions struct {
	PairID    string   `json:"pair_id"`
	MinAmount *float64 `json:"min_amount"`
	Addresses []string `json:"addresses"` // check Maker field
}

// DefiSwapMatcher matches DeFi swap events.
type DefiSwapMatcher struct{}

func (m *DefiSwapMatcher) EventType() string { return "defi.swap" }

func (m *DefiSwapMatcher) Match(data interface{}, conditions json.RawMessage) MatchResult {
	de, ok := data.(*models.DefiEvent)
	if !ok {
		return MatchResult{}
	}
	if !strings.EqualFold(de.EventType, "Swap") {
		return MatchResult{}
	}

	var cond defiSwapConditions
	if len(conditions) > 0 {
		if err := json.Unmarshal(conditions, &cond); err != nil {
			return MatchResult{}
		}
	}

	// Check pair_id
	if cond.PairID != "" {
		if de.PairID != cond.PairID {
			return MatchResult{}
		}
	}

	// Check min_amount (max of all asset in/out values)
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

	// Check addresses (Maker)
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

	return MatchResult{
		Matched: true,
		EventData: defiEventData(de),
	}
}

// defiEventData builds a flat event data map from a DefiEvent.
func defiEventData(de *models.DefiEvent) map[string]interface{} {
	return map[string]interface{}{
		"pair_id":      de.PairID,
		"event_type":   de.EventType,
		"maker":        de.Maker,
		"asset0_in":    de.Asset0In,
		"asset0_out":   de.Asset0Out,
		"asset1_in":    de.Asset1In,
		"asset1_out":   de.Asset1Out,
		"price_native": de.PriceNative,
		"tx_id":        de.TransactionID,
		"block_height": de.BlockHeight,
	}
}

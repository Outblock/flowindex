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

func (m *DefiSwapMatcher) Match(data interface{}, conditions json.RawMessage) bool {
	de, ok := data.(*models.DefiEvent)
	if !ok {
		return false
	}
	if !strings.EqualFold(de.EventType, "Swap") {
		return false
	}

	var cond defiSwapConditions
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

	// Check min_amount (max of all asset in/out values)
	if cond.MinAmount != nil {
		maxAmt := 0.0
		for _, v := range []string{de.Asset0In, de.Asset0Out, de.Asset1In, de.Asset1Out} {
			if f, err := strconv.ParseFloat(v, 64); err == nil {
				maxAmt = math.Max(maxAmt, f)
			}
		}
		if maxAmt < *cond.MinAmount {
			return false
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
			return false
		}
	}

	return true
}

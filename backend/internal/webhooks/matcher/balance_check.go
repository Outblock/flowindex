package matcher

import (
	"encoding/json"
	"strconv"
	"strings"
)

type balanceCheckConditions struct {
	Addresses     flexStringSlice `json:"addresses"`
	TokenContract string          `json:"token_contract"`
	Direction     string          `json:"direction"`
	MinAmount     *flexFloat64    `json:"min_amount"`
}

// BalanceCheckMatcher matches periodic balance check events.
type BalanceCheckMatcher struct{}

func (m *BalanceCheckMatcher) EventType() string { return "balance.check" }

func (m *BalanceCheckMatcher) Match(data interface{}, conditions json.RawMessage) MatchResult {
	// data is a map[string]interface{} with address, balance, token fields.
	dataMap, ok := data.(map[string]interface{})
	if !ok {
		return MatchResult{}
	}

	var cond balanceCheckConditions
	if len(conditions) > 0 {
		if err := json.Unmarshal(conditions, &cond); err != nil {
			return MatchResult{}
		}
	}

	if len(cond.Addresses) > 0 {
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

	if cond.TokenContract != "" {
		tokenContract, _ := dataMap["token_contract"].(string)
		if normalizeTokenIdentifier(cond.TokenContract) != normalizeTokenIdentifier(tokenContract) {
			return MatchResult{}
		}
	}

	current, currOK := parseBalanceNumber(dataMap["balance"])
	previous, prevOK := parseBalanceNumber(dataMap["previous_balance"])
	if !currOK {
		return MatchResult{}
	}

	direction := strings.ToLower(strings.TrimSpace(cond.Direction))
	if direction == "" {
		direction = "any"
	}

	if cond.MinAmount != nil {
		threshold := cond.MinAmount.Float64()
		switch direction {
		case "above":
			if !prevOK || !(previous <= threshold && current > threshold) {
				return MatchResult{}
			}
		case "below":
			if !prevOK || !(previous >= threshold && current < threshold) {
				return MatchResult{}
			}
		default:
			if !prevOK || current == previous {
				return MatchResult{}
			}
		}
	} else {
		if !prevOK {
			return MatchResult{}
		}
		switch direction {
		case "above":
			if current <= previous {
				return MatchResult{}
			}
		case "below":
			if current >= previous {
				return MatchResult{}
			}
		default:
			if current == previous {
				return MatchResult{}
			}
		}
	}

	return MatchResult{Matched: true, EventData: dataMap}
}

func parseBalanceNumber(value interface{}) (float64, bool) {
	switch v := value.(type) {
	case string:
		n, err := strconv.ParseFloat(v, 64)
		return n, err == nil
	case float64:
		return v, true
	case int:
		return float64(v), true
	default:
		return 0, false
	}
}

func normalizeTokenIdentifier(value string) string {
	value = strings.TrimSpace(strings.Replace(value, "A.0x", "A.", 1))
	parts := strings.Split(value, ".")
	if len(parts) >= 3 && strings.EqualFold(parts[0], "A") {
		return "A." + normalizeAddress(parts[1]) + "." + parts[2]
	}
	return strings.ToLower(value)
}

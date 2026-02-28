package matcher

import (
	"encoding/json"
	"strconv"
	"strings"

	"flowscan-clone/internal/models"
)

// ftTransferConditions defines the JSON filter schema for FT transfers.
// Fields use flexible types to handle both frontend string values and proper typed values.
type ftTransferConditions struct {
	Addresses     flexStringSlice `json:"addresses"`
	Direction     string          `json:"direction"`      // "in", "out", "both" (default "both")
	TokenContract string          `json:"token_contract"` // match TokenContractAddress
	MinAmount     *flexFloat64    `json:"min_amount"`
}

// flexFloat64 unmarshals from either a JSON number or a numeric string.
type flexFloat64 float64

func (f *flexFloat64) UnmarshalJSON(data []byte) error {
	// Try number first
	var n float64
	if err := json.Unmarshal(data, &n); err == nil {
		*f = flexFloat64(n)
		return nil
	}
	// Try string
	var s string
	if err := json.Unmarshal(data, &s); err == nil {
		n, err := strconv.ParseFloat(s, 64)
		if err == nil {
			*f = flexFloat64(n)
			return nil
		}
	}
	return nil
}

func (f *flexFloat64) Float64() float64 {
	if f == nil {
		return 0
	}
	return float64(*f)
}

// flexStringSlice unmarshals from either a JSON array of strings or a comma-separated string.
type flexStringSlice []string

func (f *flexStringSlice) UnmarshalJSON(data []byte) error {
	// Try array first
	var arr []string
	if err := json.Unmarshal(data, &arr); err == nil {
		*f = arr
		return nil
	}
	// Try single string (comma-separated)
	var s string
	if err := json.Unmarshal(data, &s); err == nil {
		if s == "" {
			*f = nil
			return nil
		}
		parts := strings.Split(s, ",")
		result := make([]string, 0, len(parts))
		for _, p := range parts {
			p = strings.TrimSpace(p)
			if p != "" {
				result = append(result, p)
			}
		}
		*f = result
		return nil
	}
	return nil
}

// FTTransferMatcher matches fungible token transfers.
type FTTransferMatcher struct{}

func (m *FTTransferMatcher) EventType() string { return "ft.transfer" }

func (m *FTTransferMatcher) Match(data interface{}, conditions json.RawMessage) MatchResult {
	tt, ok := data.(*models.TokenTransfer)
	if !ok {
		return MatchResult{}
	}
	// Must be a fungible token transfer
	if tt.IsNFT {
		return MatchResult{}
	}
	return matchFTTransfer(tt, conditions)
}

// ftTransferEventData builds a flat event data map from a TokenTransfer.
func ftTransferEventData(tt *models.TokenTransfer) map[string]interface{} {
	return map[string]interface{}{
		"from_address":           tt.FromAddress,
		"to_address":             tt.ToAddress,
		"amount":                 tt.Amount,
		"token_contract_address": tt.TokenContractAddress,
		"contract_name":          tt.ContractName,
		"tx_id":                  tt.TransactionID,
		"block_height":           tt.BlockHeight,
	}
}

// matchFTTransfer is shared logic used by both FTTransferMatcher and LargeTransferMatcher.
func matchFTTransfer(tt *models.TokenTransfer, conditions json.RawMessage) MatchResult {
	var cond ftTransferConditions
	if len(conditions) > 0 {
		if err := json.Unmarshal(conditions, &cond); err != nil {
			return MatchResult{}
		}
	}

	// Check token contract filter.
	// Supports both raw address ("1654653399040a61") and Cadence format ("A.1654653399040a61.FlowToken").
	if cond.TokenContract != "" {
		condAddr := cond.TokenContract
		// Extract address from Cadence identifier (A.<address>.<Name>)
		if strings.HasPrefix(condAddr, "A.") {
			parts := strings.SplitN(condAddr, ".", 3)
			if len(parts) >= 2 {
				condAddr = parts[1]
			}
		}
		dbAddr := tt.TokenContractAddress
		if strings.HasPrefix(dbAddr, "A.") {
			parts := strings.SplitN(dbAddr, ".", 3)
			if len(parts) >= 2 {
				dbAddr = parts[1]
			}
		}
		if !strings.EqualFold(normalizeAddress(dbAddr), normalizeAddress(condAddr)) {
			return MatchResult{}
		}
	}

	// Check min_amount
	if cond.MinAmount != nil {
		amount, err := strconv.ParseFloat(tt.Amount, 64)
		if err != nil {
			return MatchResult{}
		}
		if amount < cond.MinAmount.Float64() {
			return MatchResult{}
		}
	}

	// Check address filter (normalize 0x prefix on both sides)
	if len(cond.Addresses) > 0 {
		direction := strings.ToLower(cond.Direction)
		if direction == "" {
			direction = "both"
		}
		normFrom := normalizeAddress(tt.FromAddress)
		normTo := normalizeAddress(tt.ToAddress)
		matched := false
		for _, addr := range cond.Addresses {
			normAddr := normalizeAddress(addr)
			switch direction {
			case "in":
				if strings.EqualFold(normTo, normAddr) {
					matched = true
				}
			case "out":
				if strings.EqualFold(normFrom, normAddr) {
					matched = true
				}
			default: // "both"
				if strings.EqualFold(normFrom, normAddr) || strings.EqualFold(normTo, normAddr) {
					matched = true
				}
			}
			if matched {
				break
			}
		}
		if !matched {
			return MatchResult{}
		}
	}

	return MatchResult{Matched: true, EventData: ftTransferEventData(tt)}
}

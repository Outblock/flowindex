package matcher

import (
	"encoding/json"
	"strconv"
	"strings"

	"flowscan-clone/internal/models"
)

// ftTransferConditions defines the JSON filter schema for FT transfers.
type ftTransferConditions struct {
	Addresses     []string `json:"addresses"`
	Direction     string   `json:"direction"`      // "in", "out", "both" (default "both")
	TokenContract string   `json:"token_contract"` // match TokenContractAddress
	MinAmount     *float64 `json:"min_amount"`
}

// FTTransferMatcher matches fungible token transfers.
type FTTransferMatcher struct{}

func (m *FTTransferMatcher) EventType() string { return "ft.transfer" }

func (m *FTTransferMatcher) Match(data interface{}, conditions json.RawMessage) bool {
	tt, ok := data.(*models.TokenTransfer)
	if !ok {
		return false
	}
	// Must be a fungible token transfer
	if tt.IsNFT {
		return false
	}
	return matchFTTransfer(tt, conditions)
}

// matchFTTransfer is shared logic used by both FTTransferMatcher and LargeTransferMatcher.
func matchFTTransfer(tt *models.TokenTransfer, conditions json.RawMessage) bool {
	var cond ftTransferConditions
	if len(conditions) > 0 {
		if err := json.Unmarshal(conditions, &cond); err != nil {
			return false
		}
	}

	// Check token contract filter
	if cond.TokenContract != "" {
		if !strings.EqualFold(tt.TokenContractAddress, cond.TokenContract) {
			return false
		}
	}

	// Check min_amount
	if cond.MinAmount != nil {
		amount, err := strconv.ParseFloat(tt.Amount, 64)
		if err != nil {
			return false
		}
		if amount < *cond.MinAmount {
			return false
		}
	}

	// Check address filter
	if len(cond.Addresses) > 0 {
		direction := strings.ToLower(cond.Direction)
		if direction == "" {
			direction = "both"
		}
		matched := false
		for _, addr := range cond.Addresses {
			switch direction {
			case "in":
				if strings.EqualFold(tt.ToAddress, addr) {
					matched = true
				}
			case "out":
				if strings.EqualFold(tt.FromAddress, addr) {
					matched = true
				}
			default: // "both"
				if strings.EqualFold(tt.FromAddress, addr) || strings.EqualFold(tt.ToAddress, addr) {
					matched = true
				}
			}
			if matched {
				break
			}
		}
		if !matched {
			return false
		}
	}

	return true
}

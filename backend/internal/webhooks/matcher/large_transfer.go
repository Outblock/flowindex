package matcher

import (
	"encoding/json"

	"flowscan-clone/internal/models"
)

// LargeTransferMatcher matches fungible token transfers above a minimum amount.
// It delegates to the same logic as FTTransferMatcher but requires min_amount.
type LargeTransferMatcher struct{}

func (m *LargeTransferMatcher) EventType() string { return "ft.large_transfer" }

func (m *LargeTransferMatcher) Match(data interface{}, conditions json.RawMessage) bool {
	tt, ok := data.(*models.TokenTransfer)
	if !ok {
		return false
	}
	if tt.IsNFT {
		return false
	}

	// Verify min_amount is present in conditions (accept both number and string)
	var check map[string]interface{}
	if len(conditions) > 0 {
		if err := json.Unmarshal(conditions, &check); err != nil {
			return false
		}
	}
	if check["min_amount"] == nil {
		return false
	}

	return matchFTTransfer(tt, conditions)
}

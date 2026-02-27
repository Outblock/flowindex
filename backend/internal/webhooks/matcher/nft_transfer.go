package matcher

import (
	"encoding/json"
	"strings"

	"flowscan-clone/internal/models"
)

type nftTransferConditions struct {
	Addresses  []string `json:"addresses"`
	Collection string   `json:"collection"` // TokenContractAddress
	TokenIDs   []string `json:"token_ids"`
	Direction  string   `json:"direction"` // "in", "out", "both"
}

// NFTTransferMatcher matches NFT transfer events.
type NFTTransferMatcher struct{}

func (m *NFTTransferMatcher) EventType() string { return "nft.transfer" }

func (m *NFTTransferMatcher) Match(data interface{}, conditions json.RawMessage) bool {
	tt, ok := data.(*models.TokenTransfer)
	if !ok {
		return false
	}
	if !tt.IsNFT {
		return false
	}

	var cond nftTransferConditions
	if len(conditions) > 0 {
		if err := json.Unmarshal(conditions, &cond); err != nil {
			return false
		}
	}

	// Check collection filter
	if cond.Collection != "" {
		if !strings.EqualFold(tt.TokenContractAddress, cond.Collection) {
			return false
		}
	}

	// Check token_ids filter
	if len(cond.TokenIDs) > 0 {
		found := false
		for _, tid := range cond.TokenIDs {
			if tt.TokenID == tid {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}

	// Check address + direction filter
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
			default:
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

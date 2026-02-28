package matcher

import (
	"encoding/json"
	"strings"

	"flowscan-clone/internal/models"
)

type nftTransferConditions struct {
	Addresses  []string `json:"addresses"`
	Collection string   `json:"collection"` // TokenContractAddress or Cadence identifier
	TokenIDs   []string `json:"token_ids"`
	Direction  string   `json:"direction"` // "in", "out", "both"
}

// NFTTransferMatcher matches NFT transfer events.
type NFTTransferMatcher struct{}

func (m *NFTTransferMatcher) EventType() string { return "nft.transfer" }

func (m *NFTTransferMatcher) Match(data interface{}, conditions json.RawMessage) MatchResult {
	tt, ok := data.(*models.TokenTransfer)
	if !ok {
		return MatchResult{}
	}
	if !tt.IsNFT {
		return MatchResult{}
	}

	var cond nftTransferConditions
	if len(conditions) > 0 {
		if err := json.Unmarshal(conditions, &cond); err != nil {
			return MatchResult{}
		}
	}

	// Check collection filter.
	// Supports both raw hex ("0b2a3299cc857e29") and Cadence identifier ("A.0b2a3299cc857e29.TopShot").
	if cond.Collection != "" {
		if !matchCollection(tt.TokenContractAddress, tt.ContractName, cond.Collection) {
			return MatchResult{}
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
			return MatchResult{}
		}
	}

	// Check address + direction filter (normalize 0x prefix on both sides)
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
			default:
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

	return MatchResult{
		Matched: true,
		EventData: map[string]interface{}{
			"from_address":      tt.FromAddress,
			"to_address":        tt.ToAddress,
			"nft_id":            tt.TokenID,
			"collection_address": tt.TokenContractAddress,
			"collection_name":   tt.ContractName,
			"tx_id":             tt.TransactionID,
			"block_height":      tt.BlockHeight,
		},
	}
}

// matchCollection checks if a transfer matches a collection condition.
// The condition can be:
//   - Raw hex address: "0b2a3299cc857e29"
//   - Cadence identifier: "A.0b2a3299cc857e29.TopShot"
//   - With 0x prefix: "0x0b2a3299cc857e29"
//
// The DB stores token_contract_address as hex (no prefix) and contract_name separately.
func matchCollection(dbAddr, dbContractName, condCollection string) bool {
	normDBAddr := normalizeAddress(dbAddr)

	// Try direct match first
	if strings.EqualFold(normDBAddr, normalizeAddress(condCollection)) {
		return true
	}

	// Parse Cadence identifier: "A.<hex>.<name>"
	parts := strings.SplitN(condCollection, ".", 3)
	if len(parts) == 3 && strings.EqualFold(parts[0], "A") {
		condAddr := normalizeAddress(parts[1])
		condName := parts[2]
		// Match by address AND contract name
		if strings.EqualFold(normDBAddr, condAddr) && strings.EqualFold(dbContractName, condName) {
			return true
		}
	}

	return false
}

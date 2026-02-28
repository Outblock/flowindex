package matcher

import (
	"encoding/json"
	"strings"

	"flowscan-clone/internal/models"
)

type addressActivityConditions struct {
	Addresses []string `json:"addresses"`
	Roles     []string `json:"roles"` // "PROPOSER", "PAYER", "AUTHORIZER"
}

// AddressActivityMatcher matches transactions involving specific addresses in specific roles.
type AddressActivityMatcher struct{}

func (m *AddressActivityMatcher) EventType() string { return "address.activity" }

func (m *AddressActivityMatcher) Match(data interface{}, conditions json.RawMessage) MatchResult {
	tx, ok := data.(*models.Transaction)
	if !ok {
		return MatchResult{}
	}

	var cond addressActivityConditions
	if len(conditions) > 0 {
		if err := json.Unmarshal(conditions, &cond); err != nil {
			return MatchResult{}
		}
	}

	eventData := map[string]interface{}{
		"tx_id":       tx.ID,
		"block_height": tx.BlockHeight,
		"proposer":    tx.ProposerAddress,
		"payer":       tx.PayerAddress,
		"authorizers": tx.Authorizers,
	}

	if len(cond.Addresses) == 0 {
		return MatchResult{Matched: true, EventData: eventData}
	}

	// Build role set (empty = all roles)
	roleSet := make(map[string]bool, len(cond.Roles))
	for _, r := range cond.Roles {
		roleSet[strings.ToUpper(r)] = true
	}
	allRoles := len(roleSet) == 0

	for _, addr := range cond.Addresses {
		if (allRoles || roleSet["PROPOSER"]) && strings.EqualFold(tx.ProposerAddress, addr) {
			return MatchResult{Matched: true, EventData: eventData}
		}
		if (allRoles || roleSet["PAYER"]) && strings.EqualFold(tx.PayerAddress, addr) {
			return MatchResult{Matched: true, EventData: eventData}
		}
		if allRoles || roleSet["AUTHORIZER"] {
			for _, auth := range tx.Authorizers {
				if strings.EqualFold(auth, addr) {
					return MatchResult{Matched: true, EventData: eventData}
				}
			}
		}
	}

	return MatchResult{}
}

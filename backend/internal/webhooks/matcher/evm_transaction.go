package matcher

import (
	"encoding/json"
	"strconv"
	"strings"

	"flowscan-clone/internal/models"
)

type evmTransactionConditions struct {
	From     string   `json:"from"`
	To       string   `json:"to"`
	MinValue *float64 `json:"min_value"`
}

// EVMTransactionMatcher matches EVM transactions by from/to addresses and min value.
type EVMTransactionMatcher struct{}

func (m *EVMTransactionMatcher) EventType() string { return "evm.transaction" }

func (m *EVMTransactionMatcher) Match(data interface{}, conditions json.RawMessage) MatchResult {
	etx, ok := data.(*models.EVMTransaction)
	if !ok {
		return MatchResult{}
	}

	var cond evmTransactionConditions
	if len(conditions) > 0 {
		if err := json.Unmarshal(conditions, &cond); err != nil {
			return MatchResult{}
		}
	}

	// Check from address
	if cond.From != "" {
		if !strings.EqualFold(etx.FromAddress, cond.From) {
			return MatchResult{}
		}
	}

	// Check to address
	if cond.To != "" {
		if !strings.EqualFold(etx.ToAddress, cond.To) {
			return MatchResult{}
		}
	}

	// Check min_value
	if cond.MinValue != nil {
		val, err := strconv.ParseFloat(etx.Value, 64)
		if err != nil {
			return MatchResult{}
		}
		if val < *cond.MinValue {
			return MatchResult{}
		}
	}

	return MatchResult{
		Matched: true,
		EventData: map[string]interface{}{
			"evm_hash":     etx.EVMHash,
			"from_address": etx.FromAddress,
			"to_address":   etx.ToAddress,
			"value":        etx.Value,
			"gas_used":     etx.GasUsed,
			"tx_id":        etx.TransactionID,
		},
	}
}

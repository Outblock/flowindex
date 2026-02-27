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

func (m *EVMTransactionMatcher) Match(data interface{}, conditions json.RawMessage) bool {
	etx, ok := data.(*models.EVMTransaction)
	if !ok {
		return false
	}

	var cond evmTransactionConditions
	if len(conditions) > 0 {
		if err := json.Unmarshal(conditions, &cond); err != nil {
			return false
		}
	}

	// Check from address
	if cond.From != "" {
		if !strings.EqualFold(etx.FromAddress, cond.From) {
			return false
		}
	}

	// Check to address
	if cond.To != "" {
		if !strings.EqualFold(etx.ToAddress, cond.To) {
			return false
		}
	}

	// Check min_value
	if cond.MinValue != nil {
		val, err := strconv.ParseFloat(etx.Value, 64)
		if err != nil {
			return false
		}
		if val < *cond.MinValue {
			return false
		}
	}

	return true
}

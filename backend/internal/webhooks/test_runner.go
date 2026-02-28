package webhooks

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"flowscan-clone/internal/models"
	"flowscan-clone/internal/webhooks/matcher"
)

// PathTestResult holds the outcome of testing a single subscription path.
type PathTestResult struct {
	TriggerStatus string                `json:"trigger_status"` // "pass" or "fail"
	TriggerError  string                `json:"trigger_error,omitempty"`
	EventData     map[string]interface{} `json:"event_data,omitempty"`
	Conditions    []ConditionTestResult `json:"conditions,omitempty"`
}

// ConditionTestResult holds the detailed outcome of a single condition evaluation.
type ConditionTestResult struct {
	Field    string `json:"field"`
	Operator string `json:"operator"`
	Expected string `json:"expected"`
	Actual   string `json:"actual"`
	Status   string `json:"status"` // "pass" or "fail"
}

// mockTxID is a realistic 64-char hex transaction ID used in mock data.
const mockTxID = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"

// BuildMockEventData returns default mock data for the given event type with
// any provided overrides applied on top.
func BuildMockEventData(eventType string, overrides map[string]interface{}) map[string]interface{} {
	var defaults map[string]interface{}

	switch eventType {
	case "ft.transfer", "ft.large_transfer":
		defaults = map[string]interface{}{
			"from_address":           "1654653399040a61",
			"to_address":             "18eb4ee6b3c026d2",
			"amount":                 "100.0",
			"token_contract_address": "1654653399040a61",
			"contract_name":          "FlowToken",
			"tx_id":                  mockTxID,
			"block_height":           uint64(100000000),
		}

	case "nft.transfer":
		defaults = map[string]interface{}{
			"from_address":      "1654653399040a61",
			"to_address":        "18eb4ee6b3c026d2",
			"nft_id":            "1",
			"collection_address": "0b2a3299cc857e29",
			"collection_name":   "TopShot",
			"tx_id":             mockTxID,
			"block_height":      uint64(100000000),
		}

	case "contract.event":
		defaults = map[string]interface{}{
			"event_type":       "A.1654653399040a61.FlowToken.TokensDeposited",
			"contract_address": "1654653399040a61",
			"contract_name":    "FlowToken",
			"event_name":       "TokensDeposited",
			"fields":           `{"amount":"100.0"}`,
			"tx_id":            mockTxID,
			"block_height":     uint64(100000000),
		}

	case "address.activity":
		defaults = map[string]interface{}{
			"tx_id":        mockTxID,
			"block_height": uint64(100000000),
			"proposer":     "1654653399040a61",
			"payer":        "1654653399040a61",
			"authorizers":  []string{"1654653399040a61"},
		}

	case "staking.event":
		defaults = map[string]interface{}{
			"event_type":   "DelegatorRewardsPaid",
			"node_id":      "node-001",
			"delegator_id": 1,
			"amount":       "500.0",
			"tx_id":        mockTxID,
			"block_height": uint64(100000000),
		}

	case "evm.transaction":
		defaults = map[string]interface{}{
			"evm_hash":     "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
			"from_address": "0x1234567890abcdef1234567890abcdef12345678",
			"to_address":   "0xabcdef1234567890abcdef1234567890abcdef12",
			"value":        "1000000000000000000",
			"gas_used":     uint64(21000),
			"tx_id":        mockTxID,
		}

	case "account.key_change":
		defaults = map[string]interface{}{
			"address":      "1654653399040a61",
			"event_name":   "KeyAdded",
			"tx_id":        mockTxID,
			"block_height": uint64(100000000),
		}

	case "defi.swap":
		defaults = map[string]interface{}{
			"pair_id":      "pair-001",
			"event_type":   "Swap",
			"maker":        "1654653399040a61",
			"asset0_in":    "100.0",
			"asset0_out":   "0.0",
			"asset1_in":    "0.0",
			"asset1_out":   "50.0",
			"price_native": "0.5",
			"tx_id":        mockTxID,
			"block_height": uint64(100000000),
		}

	case "defi.liquidity":
		defaults = map[string]interface{}{
			"pair_id":      "pair-001",
			"event_type":   "Add",
			"maker":        "1654653399040a61",
			"asset0_in":    "100.0",
			"asset0_out":   "0.0",
			"asset1_in":    "100.0",
			"asset1_out":   "0.0",
			"price_native": "1.0",
			"tx_id":        mockTxID,
			"block_height": uint64(100000000),
		}

	default:
		defaults = map[string]interface{}{
			"tx_id":        mockTxID,
			"block_height": uint64(100000000),
		}
	}

	// Apply overrides
	for k, v := range overrides {
		defaults[k] = v
	}

	return defaults
}

// buildMockModelData constructs the Go model struct that matchers expect from
// the flat mock data map.
func buildMockModelData(eventType string, data map[string]interface{}) interface{} {
	switch eventType {
	case "ft.transfer", "ft.large_transfer":
		return &models.TokenTransfer{
			FromAddress:          getString(data, "from_address"),
			ToAddress:            getString(data, "to_address"),
			Amount:               getString(data, "amount"),
			TokenContractAddress: getString(data, "token_contract_address"),
			ContractName:         getString(data, "contract_name"),
			TransactionID:        getString(data, "tx_id"),
			BlockHeight:          getUint64(data, "block_height"),
			IsNFT:                false,
		}

	case "nft.transfer":
		return &models.TokenTransfer{
			FromAddress:          getString(data, "from_address"),
			ToAddress:            getString(data, "to_address"),
			TokenID:              getString(data, "nft_id"),
			TokenContractAddress: getString(data, "collection_address"),
			ContractName:         getString(data, "collection_name"),
			TransactionID:        getString(data, "tx_id"),
			BlockHeight:          getUint64(data, "block_height"),
			IsNFT:                true,
		}

	case "contract.event":
		return &models.Event{
			Type:            getString(data, "event_type"),
			ContractAddress: getString(data, "contract_address"),
			ContractName:    getString(data, "contract_name"),
			EventName:       getString(data, "event_name"),
			Values:          json.RawMessage(getString(data, "fields")),
			TransactionID:   getString(data, "tx_id"),
			BlockHeight:     getUint64(data, "block_height"),
		}

	case "address.activity":
		tx := &models.Transaction{
			ID:              getString(data, "tx_id"),
			BlockHeight:     getUint64(data, "block_height"),
			ProposerAddress: getString(data, "proposer"),
			PayerAddress:    getString(data, "payer"),
		}
		if auths, ok := data["authorizers"].([]string); ok {
			tx.Authorizers = auths
		}
		return tx

	case "staking.event":
		return &models.StakingEvent{
			EventType:     getString(data, "event_type"),
			NodeID:        getString(data, "node_id"),
			DelegatorID:   getInt(data, "delegator_id"),
			Amount:        getString(data, "amount"),
			TransactionID: getString(data, "tx_id"),
			BlockHeight:   getUint64(data, "block_height"),
		}

	case "evm.transaction":
		return &models.EVMTransaction{
			EVMHash:       getString(data, "evm_hash"),
			FromAddress:   getString(data, "from_address"),
			ToAddress:     getString(data, "to_address"),
			Value:         getString(data, "value"),
			GasUsed:       getUint64(data, "gas_used"),
			TransactionID: getString(data, "tx_id"),
		}

	case "account.key_change":
		return &models.Event{
			ContractAddress: getString(data, "address"),
			EventName:       getString(data, "event_name"),
			TransactionID:   getString(data, "tx_id"),
			BlockHeight:     getUint64(data, "block_height"),
		}

	case "defi.swap", "defi.liquidity":
		return &models.DefiEvent{
			PairID:        getString(data, "pair_id"),
			EventType:     getString(data, "event_type"),
			Maker:         getString(data, "maker"),
			Asset0In:      getString(data, "asset0_in"),
			Asset0Out:     getString(data, "asset0_out"),
			Asset1In:      getString(data, "asset1_in"),
			Asset1Out:     getString(data, "asset1_out"),
			PriceNative:   getString(data, "price_native"),
			TransactionID: getString(data, "tx_id"),
			BlockHeight:   getUint64(data, "block_height"),
		}

	default:
		return nil
	}
}

// RunPathTest builds mock data, runs it through the matcher and condition
// engine, and returns a detailed PathTestResult.
func RunPathTest(reg *matcher.Registry, eventType string, conditions json.RawMessage, overrides map[string]interface{}) PathTestResult {
	m := reg.Get(eventType)
	if m == nil {
		return PathTestResult{
			TriggerStatus: "fail",
			TriggerError:  fmt.Sprintf("no matcher registered for event type %q", eventType),
		}
	}

	mockData := BuildMockEventData(eventType, overrides)
	modelData := buildMockModelData(eventType, mockData)
	if modelData == nil {
		return PathTestResult{
			TriggerStatus: "fail",
			TriggerError:  fmt.Sprintf("unsupported event type for model construction: %q", eventType),
		}
	}

	result := m.Match(modelData, conditions)
	if !result.Matched {
		return PathTestResult{
			TriggerStatus: "fail",
			TriggerError:  "trigger conditions did not match mock data",
			EventData:     mockData,
		}
	}

	// Evaluate generic conditions with detailed per-condition results
	var condMap map[string]interface{}
	if len(conditions) > 0 {
		if err := json.Unmarshal(conditions, &condMap); err != nil {
			return PathTestResult{
				TriggerStatus: "pass",
				EventData:     result.EventData,
			}
		}
	}

	condResults := evaluateConditionsDetailed(condMap, result.EventData)

	// Check overall status
	triggerStatus := "pass"
	for _, cr := range condResults {
		if cr.Status == "fail" {
			triggerStatus = "fail"
			break
		}
	}

	return PathTestResult{
		TriggerStatus: triggerStatus,
		EventData:     result.EventData,
		Conditions:    condResults,
	}
}

// evaluateConditionsDetailed evaluates all generic conditions against the event
// data and returns per-condition results. Trigger-specific keys and keys
// without a recognised operator suffix are skipped.
func evaluateConditionsDetailed(conditions map[string]interface{}, eventData map[string]interface{}) []ConditionTestResult {
	var results []ConditionTestResult

	for key, expected := range conditions {
		if matcher.IsTriggerConditionKey(key) {
			continue
		}

		field, op := matcher.ParseConditionKey(key)
		if op == "" {
			continue
		}

		expectedStr := toStr(expected)
		actual, ok := eventData[field]
		actualStr := ""
		if ok {
			actualStr = toStr(actual)
		}

		status := "fail"
		if ok && matcher.EvaluateOp(op, actualStr, expectedStr) {
			status = "pass"
		}

		results = append(results, ConditionTestResult{
			Field:    field,
			Operator: op,
			Expected: expectedStr,
			Actual:   actualStr,
			Status:   status,
		})
	}

	return results
}

// --- helpers ---

func getString(data map[string]interface{}, key string) string {
	v, ok := data[key]
	if !ok {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprintf("%v", v)
}

func getUint64(data map[string]interface{}, key string) uint64 {
	v, ok := data[key]
	if !ok {
		return 0
	}
	switch n := v.(type) {
	case uint64:
		return n
	case int:
		return uint64(n)
	case int64:
		return uint64(n)
	case float64:
		return uint64(n)
	case string:
		u, _ := strconv.ParseUint(n, 10, 64)
		return u
	default:
		return 0
	}
}

func getInt(data map[string]interface{}, key string) int {
	v, ok := data[key]
	if !ok {
		return 0
	}
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case uint64:
		return int(n)
	case float64:
		return int(n)
	case string:
		i, _ := strconv.Atoi(n)
		return i
	default:
		return 0
	}
}

func toStr(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	if v == nil {
		return ""
	}
	// Handle string slices
	if ss, ok := v.([]string); ok {
		return strings.Join(ss, ",")
	}
	return fmt.Sprintf("%v", v)
}

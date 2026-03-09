//go:build integration

package api_test

import (
	"context"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/onflow/flow-go-sdk"
)

func TestAudit_AccountCrossRef(t *testing.T) {
	if flowClient == nil {
		t.Skip("flowClient not available")
	}

	const addrHex = "1654653399040a61" // FlowToken
	const addrWith0x = "0x" + addrHex

	// Fetch from our API
	apiAccount := fetchEnvelopeObject(t, "/flow/account/"+addrWith0x)

	// Fetch from Flow Access Node
	c, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	addr := flow.HexToAddress(addrHex)
	flowAccount, err := flowClient.GetAccount(c, addr)
	if err != nil {
		t.Fatalf("Flow Access Node GetAccount(%s) error: %v", addrHex, err)
	}

	// Cross-reference: address matches
	apiAddr := strings.ToLower(toString(apiAccount["address"]))
	flowAddr := strings.ToLower(flowAccount.Address.Hex())
	// Normalize: strip 0x prefix for comparison
	apiAddrNorm := strings.TrimPrefix(apiAddr, "0x")
	flowAddrNorm := strings.TrimPrefix(flowAddr, "0x")
	if apiAddrNorm != flowAddrNorm {
		t.Errorf("address mismatch: api=%q flow=%q", apiAddr, flowAddr)
	}

	// Cross-reference: FLOW balance — both should be > 0 and within 2x ratio
	apiBalance := toFloat64(apiAccount["flowBalance"])
	// Flow SDK returns balance in UFix64 (uint64, value / 1e8 = FLOW)
	flowBalanceFLOW := float64(flowAccount.Balance) / 1e8

	if apiBalance <= 0 {
		t.Errorf("API balance should be > 0 for FlowToken account, got %v", apiBalance)
	}
	if flowBalanceFLOW <= 0 {
		t.Errorf("Flow SDK balance should be > 0 for FlowToken account, got %v", flowBalanceFLOW)
	}
	// Wide tolerance: within 2x ratio (balance changes between API snapshot and live query)
	if apiBalance > 0 && flowBalanceFLOW > 0 {
		ratio := apiBalance / flowBalanceFLOW
		if ratio < 0.5 || ratio > 2.0 {
			t.Errorf("balance ratio out of range: api=%.2f flow=%.2f ratio=%.2f (want 0.5-2.0)", apiBalance, flowBalanceFLOW, ratio)
		} else {
			t.Logf("balance: api=%.2f flow=%.2f ratio=%.2f", apiBalance, flowBalanceFLOW, ratio)
		}
	}

	// Cross-reference: contract count
	apiContracts := apiAccount["contracts"]
	flowContractCount := len(flowAccount.Contracts)
	if apiContracts != nil {
		// API may return contracts as a list or a count
		switch c := apiContracts.(type) {
		case []interface{}:
			if len(c) != flowContractCount {
				t.Errorf("contract count mismatch: api=%d flow=%d", len(c), flowContractCount)
			}
		case float64:
			if int(c) != flowContractCount {
				t.Errorf("contract count mismatch: api=%.0f flow=%d", c, flowContractCount)
			}
		default:
			t.Logf("contracts field type: %T (value: %v)", apiContracts, apiContracts)
		}
	}

	// Log key count differences (API may filter revoked keys)
	apiKeys := apiAccount["keys"]
	flowKeyCount := len(flowAccount.Keys)
	if apiKeys != nil {
		switch k := apiKeys.(type) {
		case []interface{}:
			t.Logf("key count: api=%d flow=%d (api may filter revoked keys)", len(k), flowKeyCount)
		case float64:
			t.Logf("key count: api=%.0f flow=%d (api may filter revoked keys)", k, flowKeyCount)
		}
	} else {
		t.Logf("key count: api=<nil> flow=%d", flowKeyCount)
	}
}

func TestAudit_AccountTransactions(t *testing.T) {
	txList := fetchEnvelopeList(t, "/flow/account/"+ctx.address+"/transaction?limit=10")

	if len(txList) == 0 {
		t.Skip("no transactions found for account " + ctx.address)
	}

	for i, tx := range txList {
		label := "tx[" + strconv.Itoa(i) + "]"

		// Verify required fields
		assertFieldsExist(t, tx, "id", "block_height", "timestamp")

		// Verify timestamp is valid
		assertTimestamp(t, label+".timestamp", toString(tx["timestamp"]))

		// Verify block_height is positive
		height := toFloat64(tx["block_height"])
		if height <= 0 {
			t.Errorf("%s.block_height should be positive, got %.0f", label, height)
		}
	}
}

func TestAudit_AccountContractCode(t *testing.T) {
	obj := fetchBareObject(t, "/flow/account/0x1654653399040a61/contract/FlowToken")

	// Extract the code field
	code := toString(obj["code"])
	if code == "" {
		// Try "source" as an alternative field name
		code = toString(obj["source"])
	}

	if len(code) < 100 {
		t.Errorf("contract code too short: got %d chars, want > 100", len(code))
	}

	if !strings.Contains(code, "FlowToken") {
		t.Errorf("contract code should contain 'FlowToken', got %.200s...", code)
	}
}

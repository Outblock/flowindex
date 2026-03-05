package ingester

import (
	"encoding/json"
	"testing"
	"time"

	"flowscan-clone/internal/models"
)

// makePayload builds a flat JSON payload from key-value pairs.
func makePayload(t *testing.T, fields map[string]string) []byte {
	t.Helper()
	m := make(map[string]interface{}, len(fields))
	for k, v := range fields {
		m[k] = v
	}
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("failed to marshal payload: %v", err)
	}
	return b
}

// TestWrapperOnlyEVMBridgedTokenTransfer verifies that a transaction with ONLY
// FungibleToken wrapper events (no token-specific events) for an EVMVMBridgedToken
// produces exactly 1 FT transfer with the correct from/to/amount/contract.
func TestWrapperOnlyEVMBridgedTokenTransfer(t *testing.T) {
	ts := time.Date(2026, 1, 15, 12, 0, 0, 0, time.UTC)
	txID := "7d455b0df3e2037c2daadf98b07e1e4d78534fbd5f378754a056afe0b76012d8"
	blockHeight := uint64(100000)

	events := []models.Event{
		{
			TransactionID:   txID,
			BlockHeight:     blockHeight,
			EventIndex:      0,
			Type:            "A.f233dcee88fe0abe.FungibleToken.Withdrawn",
			ContractAddress: "f233dcee88fe0abe",
			Payload: makePayload(t, map[string]string{
				"from":          "0x6a1142285bbb7526",
				"amount":        "32959.59000000",
				"type":          "A.1e4aa0b87d10b141.EVMVMBridgedToken_99af3eea856556646c98c8b9b2548fe815240750.Vault",
				"withdrawnUUID": "74766793238093",
			}),
			Timestamp: ts,
		},
		{
			TransactionID:   txID,
			BlockHeight:     blockHeight,
			EventIndex:      1,
			Type:            "A.f233dcee88fe0abe.FungibleToken.Deposited",
			ContractAddress: "f233dcee88fe0abe",
			Payload: makePayload(t, map[string]string{
				"to":            "0x84221fe0294044d7",
				"amount":        "32959.59000000",
				"type":          "A.1e4aa0b87d10b141.EVMVMBridgedToken_99af3eea856556646c98c8b9b2548fe815240750.Vault",
				"depositedUUID": "74766793238093",
			}),
			Timestamp: ts,
		},
		// FlowToken fee events (should be filtered out by fee filter)
		{
			TransactionID:   txID,
			BlockHeight:     blockHeight,
			EventIndex:      2,
			Type:            "A.1654653399040a61.FlowToken.TokensWithdrawn",
			ContractAddress: "1654653399040a61",
			Payload: makePayload(t, map[string]string{
				"from":   "0x6a1142285bbb7526",
				"amount": "0.00230000",
			}),
			Timestamp: ts,
		},
		{
			TransactionID:   txID,
			BlockHeight:     blockHeight,
			EventIndex:      3,
			Type:            "A.1654653399040a61.FlowToken.TokensDeposited",
			ContractAddress: "1654653399040a61",
			Payload: makePayload(t, map[string]string{
				"to":     "0xf919ee77447b7497",
				"amount": "0.00230000",
			}),
			Timestamp: ts,
		},
	}

	result := processTokenEvents(events)

	// Should have exactly 1 FT transfer (the bridged token; fee transfer filtered)
	if len(result.ftTransfers) != 1 {
		t.Fatalf("expected 1 FT transfer, got %d", len(result.ftTransfers))
	}

	transfer := result.ftTransfers[0]
	if transfer.FromAddress != "6a1142285bbb7526" {
		t.Errorf("expected from=6a1142285bbb7526, got %s", transfer.FromAddress)
	}
	if transfer.ToAddress != "84221fe0294044d7" {
		t.Errorf("expected to=84221fe0294044d7, got %s", transfer.ToAddress)
	}
	if transfer.Amount != "32959.59000000" {
		t.Errorf("expected amount=32959.59000000, got %s", transfer.Amount)
	}
	if transfer.ContractName != "EVMVMBridgedToken_99af3eea856556646c98c8b9b2548fe815240750" {
		t.Errorf("expected contract=EVMVMBridgedToken_99af3eea856556646c98c8b9b2548fe815240750, got %s", transfer.ContractName)
	}
	if transfer.TokenContractAddress != "1e4aa0b87d10b141" {
		t.Errorf("expected contractAddr=1e4aa0b87d10b141, got %s", transfer.TokenContractAddress)
	}
	if transfer.TransactionID != txID {
		t.Errorf("expected txID=%s, got %s", txID, transfer.TransactionID)
	}
	if transfer.BlockHeight != blockHeight {
		t.Errorf("expected blockHeight=%d, got %d", blockHeight, transfer.BlockHeight)
	}

	// Should discover the FT token
	expectedKey := "1e4aa0b87d10b141:EVMVMBridgedToken_99af3eea856556646c98c8b9b2548fe815240750"
	if _, ok := result.ftTokens[expectedKey]; !ok {
		t.Errorf("expected ftTokens to contain key %s, got keys: %v", expectedKey, keysOf(result.ftTokens))
	}
	if _, ok := result.contracts[expectedKey]; !ok {
		t.Errorf("expected contracts to contain key %s", expectedKey)
	}
}

// TestWrapperEventsStillEnrichTokenSpecificLegs verifies that when BOTH
// token-specific AND wrapper events exist, the result is exactly 1 transfer
// (the enriched token-specific one), NOT 2.
func TestWrapperEventsStillEnrichTokenSpecificLegs(t *testing.T) {
	ts := time.Date(2026, 1, 15, 12, 0, 0, 0, time.UTC)
	txID := "abc123"
	blockHeight := uint64(200000)

	// This simulates a token like JOSHIN that emits BOTH its own TokensWithdrawn/TokensDeposited
	// AND the FungibleToken.Withdrawn/Deposited wrapper events.
	events := []models.Event{
		// Wrapper: FungibleToken.Withdrawn (has from address)
		{
			TransactionID:   txID,
			BlockHeight:     blockHeight,
			EventIndex:      0,
			Type:            "A.f233dcee88fe0abe.FungibleToken.Withdrawn",
			ContractAddress: "f233dcee88fe0abe",
			Payload: makePayload(t, map[string]string{
				"from":          "0xaaaa1111aaaa1111",
				"amount":        "100.00000000",
				"type":          "A.82ed1b9cba5bb1b3.JOSHIN.Vault",
				"withdrawnUUID": "999111",
			}),
			Timestamp: ts,
		},
		// Token-specific: JOSHIN.TokensWithdrawn (mint event - no from address)
		{
			TransactionID:   txID,
			BlockHeight:     blockHeight,
			EventIndex:      1,
			Type:            "A.82ed1b9cba5bb1b3.JOSHIN.TokensWithdrawn",
			ContractAddress: "82ed1b9cba5bb1b3",
			Payload: makePayload(t, map[string]string{
				"amount":        "100.00000000",
				"withdrawnUUID": "999111",
			}),
			Timestamp: ts,
		},
		// Token-specific: JOSHIN.TokensDeposited (mint event - no to address)
		{
			TransactionID:   txID,
			BlockHeight:     blockHeight,
			EventIndex:      2,
			Type:            "A.82ed1b9cba5bb1b3.JOSHIN.TokensDeposited",
			ContractAddress: "82ed1b9cba5bb1b3",
			Payload: makePayload(t, map[string]string{
				"amount":       "100.00000000",
				"depositedUUID": "999111",
			}),
			Timestamp: ts,
		},
		// Wrapper: FungibleToken.Deposited (has to address)
		{
			TransactionID:   txID,
			BlockHeight:     blockHeight,
			EventIndex:      3,
			Type:            "A.f233dcee88fe0abe.FungibleToken.Deposited",
			ContractAddress: "f233dcee88fe0abe",
			Payload: makePayload(t, map[string]string{
				"to":            "0xbbbb2222bbbb2222",
				"amount":        "100.00000000",
				"type":          "A.82ed1b9cba5bb1b3.JOSHIN.Vault",
				"depositedUUID": "999111",
			}),
			Timestamp: ts,
		},
	}

	result := processTokenEvents(events)

	// Should produce exactly 1 FT transfer (enriched), not 2
	if len(result.ftTransfers) != 1 {
		t.Fatalf("expected 1 FT transfer, got %d", len(result.ftTransfers))
	}

	transfer := result.ftTransfers[0]
	if transfer.ContractName != "JOSHIN" {
		t.Errorf("expected contract=JOSHIN, got %s", transfer.ContractName)
	}
	if transfer.TokenContractAddress != "82ed1b9cba5bb1b3" {
		t.Errorf("expected contractAddr=82ed1b9cba5bb1b3, got %s", transfer.TokenContractAddress)
	}
	if transfer.Amount != "100.00000000" {
		t.Errorf("expected amount=100.00000000, got %s", transfer.Amount)
	}
	// The wrapper events should have enriched the token-specific legs with addresses
	if transfer.FromAddress != "aaaa1111aaaa1111" {
		t.Errorf("expected from=aaaa1111aaaa1111, got %s", transfer.FromAddress)
	}
	if transfer.ToAddress != "bbbb2222bbbb2222" {
		t.Errorf("expected to=bbbb2222bbbb2222, got %s", transfer.ToAddress)
	}
}

// TestWrapperOnlyWithdrawal verifies that a wrapper-only withdrawal (burn)
// creates a transfer leg even without a matching deposit.
func TestWrapperOnlyWithdrawal(t *testing.T) {
	ts := time.Date(2026, 1, 15, 12, 0, 0, 0, time.UTC)
	txID := "burn123"
	blockHeight := uint64(300000)

	events := []models.Event{
		{
			TransactionID:   txID,
			BlockHeight:     blockHeight,
			EventIndex:      0,
			Type:            "A.f233dcee88fe0abe.FungibleToken.Withdrawn",
			ContractAddress: "f233dcee88fe0abe",
			Payload: makePayload(t, map[string]string{
				"from":          "0xaaaa1111aaaa1111",
				"amount":        "50.00000000",
				"type":          "A.1e4aa0b87d10b141.EVMVMBridgedToken_abc123.Vault",
				"withdrawnUUID": "12345",
			}),
			Timestamp: ts,
		},
	}

	result := processTokenEvents(events)

	if len(result.ftTransfers) != 1 {
		t.Fatalf("expected 1 FT transfer (burn), got %d", len(result.ftTransfers))
	}

	transfer := result.ftTransfers[0]
	if transfer.FromAddress != "aaaa1111aaaa1111" {
		t.Errorf("expected from=aaaa1111aaaa1111, got %s", transfer.FromAddress)
	}
	if transfer.ToAddress != "" {
		t.Errorf("expected empty to address for burn, got %s", transfer.ToAddress)
	}
	if transfer.ContractName != "EVMVMBridgedToken_abc123" {
		t.Errorf("expected contract=EVMVMBridgedToken_abc123, got %s", transfer.ContractName)
	}
}

func keysOf[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

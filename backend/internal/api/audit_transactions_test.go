//go:build integration

package api_test

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/onflow/flow-go-sdk"
)

func TestAudit_TransactionCrossRef(t *testing.T) {
	if flowClient == nil {
		t.Skip("flowClient not available")
	}
	if ctx.txID == "unknown" {
		t.Skip("no known transaction ID")
	}

	// Fetch transaction from our API
	apiTx := fetchEnvelopeObject(t, "/flow/v1/transaction/"+ctx.txID)

	// Fetch same transaction from Flow Access Node
	c, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	txID := flow.HexToID(ctx.txID)
	flowTx, err := flowClient.GetTransaction(c, txID)
	if err != nil {
		t.Fatalf("Flow Access Node GetTransaction(%s) error: %v", ctx.txID, err)
	}
	flowResult, err := flowClient.GetTransactionResult(c, txID)
	if err != nil {
		t.Fatalf("Flow Access Node GetTransactionResult(%s) error: %v", ctx.txID, err)
	}

	// Cross-reference: payer
	apiPayer := toString(apiTx["payer"])
	flowPayer := "0x" + flowTx.Payer.Hex()
	if apiPayer != flowPayer {
		t.Errorf("payer mismatch: api=%q flow=%q", apiPayer, flowPayer)
	}

	// Cross-reference: proposer
	apiProposer := toString(apiTx["proposer"])
	flowProposer := "0x" + flowTx.ProposalKey.Address.Hex()
	if apiProposer != flowProposer {
		t.Errorf("proposer mismatch: api=%q flow=%q", apiProposer, flowProposer)
	}

	// Cross-reference: status (if sealed on chain, API should say "Sealed")
	if flowResult.Status == flow.TransactionStatusSealed {
		apiStatus := toString(apiTx["status"])
		if apiStatus != "Sealed" {
			t.Errorf("status mismatch: api=%q expected=Sealed (flow status=%v)", apiStatus, flowResult.Status)
		}
	}

	// Cross-reference: event count
	apiEventCount := int(toFloat64(apiTx["event_count"]))
	flowEventCount := len(flowResult.Events)
	if apiEventCount != flowEventCount {
		t.Errorf("event_count mismatch: api=%d flow=%d", apiEventCount, flowEventCount)
	}

	// Cross-reference: authorizer count
	if auths, ok := apiTx["authorizers"]; ok {
		if authList, ok := auths.([]interface{}); ok {
			if len(authList) != len(flowTx.Authorizers) {
				t.Errorf("authorizer count mismatch: api=%d flow=%d", len(authList), len(flowTx.Authorizers))
			}
		}
	}

	// Verify required fields are present
	assertFieldsExist(t, apiTx, "id", "block_height", "payer", "proposer", "status", "gas_used", "timestamp")

	// Verify field formats
	assertFlowAddress(t, apiPayer)
	assertFlowAddress(t, apiProposer)
	assertTimestamp(t, "transaction.timestamp", toString(apiTx["timestamp"]))
	assertNonEmpty(t, "transaction.id", toString(apiTx["id"]))

	blockHeight := toFloat64(apiTx["block_height"])
	if blockHeight <= 0 {
		t.Errorf("block_height should be positive, got %.0f", blockHeight)
	}
}

func TestAudit_TransactionListConsistency(t *testing.T) {
	txList := fetchEnvelopeList(t, "/flow/v1/transaction?limit=10")

	if len(txList) == 0 {
		t.Fatal("transaction list is empty")
	}

	for i, tx := range txList {
		label := "tx[" + strconv.Itoa(i) + "]"

		// Verify required fields
		assertFieldsExist(t, tx, "id", "block_height", "payer", "proposer", "status", "timestamp")

		// Verify id is non-empty
		assertNonEmpty(t, label+".id", toString(tx["id"]))

		// Verify payer is a valid Flow address
		payer := toString(tx["payer"])
		assertFlowAddress(t, payer)

		// Verify timestamp is valid
		assertTimestamp(t, label+".timestamp", toString(tx["timestamp"]))

		// Verify block_height is positive
		blockHeight := toFloat64(tx["block_height"])
		if blockHeight <= 0 {
			t.Errorf("%s.block_height should be positive, got %.0f", label, blockHeight)
		}
	}
}

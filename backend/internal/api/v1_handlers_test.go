package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/mux"
	"github.com/onflow/cadence"
	flowsdk "github.com/onflow/flow-go-sdk"
)

type mockFlowClient struct {
	account *flowsdk.Account
}

func (m *mockFlowClient) GetLatestBlockHeight(ctx context.Context) (uint64, error) {
	return 0, nil
}

func (m *mockFlowClient) GetTransaction(ctx context.Context, txID flowsdk.Identifier) (*flowsdk.Transaction, error) {
	return nil, nil
}

func (m *mockFlowClient) GetTransactionResult(ctx context.Context, txID flowsdk.Identifier) (*flowsdk.TransactionResult, error) {
	return nil, nil
}

func (m *mockFlowClient) GetAccount(ctx context.Context, address flowsdk.Address) (*flowsdk.Account, error) {
	return m.account, nil
}

func (m *mockFlowClient) ExecuteScriptAtLatestBlock(ctx context.Context, script []byte, args []cadence.Value) (cadence.Value, error) {
	return cadence.NewVoid(), nil
}

func TestHandleFlowGetAccount(t *testing.T) {
	acc := &flowsdk.Account{
		Address: flowsdk.HexToAddress("0x01"),
		Balance: 123000000,
		Contracts: map[string][]byte{
			"TestContract": []byte("pub contract TestContract {}"),
		},
	}
	s := &Server{client: &mockFlowClient{account: acc}}

	req := httptest.NewRequest("GET", "/flow/v1/account/0x01", nil)
	req = mux.SetURLVars(req, map[string]string{"address": "0x01"})
	rec := httptest.NewRecorder()

	s.handleFlowGetAccount(rec, req)

	var resp map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}

	data, ok := resp["data"].([]interface{})
	if !ok || len(data) != 1 {
		t.Fatalf("expected data array with 1 element, got: %v", resp["data"])
	}

	row := data[0].(map[string]interface{})
	if row["address"] != "0000000000000001" {
		t.Fatalf("expected normalized address '0000000000000001', got %v", row["address"])
	}
	if row["flowBalance"] != 1.23 {
		t.Fatalf("expected flowBalance 1.23, got %v", row["flowBalance"])
	}
	if contracts, ok := row["contracts"].([]interface{}); !ok || len(contracts) != 1 {
		t.Fatalf("expected contracts length 1, got %v", row["contracts"])
	}
}

func TestTransferDirection(t *testing.T) {
	if got := transferDirection("aa", "aa", "bb"); got != "withdraw" {
		t.Fatalf("expected withdraw, got %s", got)
	}
	if got := transferDirection("aa", "bb", "aa"); got != "deposit" {
		t.Fatalf("expected deposit, got %s", got)
	}
	if got := transferDirection("", "", "aa"); got != "deposit" {
		t.Fatalf("expected deposit when from empty, got %s", got)
	}
	if got := transferDirection("", "aa", ""); got != "withdraw" {
		t.Fatalf("expected withdraw when to empty, got %s", got)
	}
}

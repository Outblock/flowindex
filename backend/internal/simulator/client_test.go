package simulator

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClientHealthCheck(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/blocks" || r.URL.Query().Get("height") != "sealed" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.String())
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode([]map[string]interface{}{
			{"header": map[string]interface{}{"height": "1"}},
		})
	}))
	defer srv.Close()

	client := NewClient(srv.URL)
	ok, err := client.HealthCheck(context.Background())
	if err != nil {
		t.Fatalf("HealthCheck returned error: %v", err)
	}
	if !ok {
		t.Fatal("HealthCheck returned false, want true")
	}
}

func TestClientHealthCheck_Failure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	client := NewClient(srv.URL)
	ok, err := client.HealthCheck(context.Background())
	if err == nil {
		t.Fatal("expected error for 500 response")
	}
	if ok {
		t.Fatal("expected false for failed health check")
	}
}

func TestClientSendTransaction(t *testing.T) {
	txID := "abc123def456"
	callCount := 0

	// Build a sample Cadence JSON event payload
	eventPayload := map[string]interface{}{
		"type": "Event",
		"value": map[string]interface{}{
			"id": "A.1654653399040a61.FlowToken.TokensDeposited",
			"fields": []map[string]interface{}{
				{
					"name":  "amount",
					"value": map[string]interface{}{"type": "UFix64", "value": "10.00000000"},
				},
				{
					"name":  "to",
					"value": map[string]interface{}{"type": "Optional", "value": map[string]interface{}{"type": "Address", "value": "0x1234567890abcdef"}},
				},
			},
		},
	}
	payloadBytes, _ := json.Marshal(eventPayload)
	payloadB64 := base64.StdEncoding.EncodeToString(payloadBytes)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "POST" && r.URL.Path == "/v1/transactions":
			// Verify the request body has expected fields
			var body map[string]interface{}
			json.NewDecoder(r.Body).Decode(&body)
			if body["gas_limit"] != "9999" {
				t.Errorf("expected gas_limit=9999, got %v", body["gas_limit"])
			}
			if body["reference_block_id"] != strings.Repeat("0", 64) {
				t.Errorf("unexpected reference_block_id: %v", body["reference_block_id"])
			}
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]string{"id": txID})

		case r.Method == "GET" && r.URL.Path == "/v1/transaction_results/"+txID:
			callCount++
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":           "SEALED",
				"error_message":    "",
				"computation_used": "42",
				"events": []map[string]interface{}{
					{
						"type":              "A.1654653399040a61.FlowToken.TokensDeposited",
						"transaction_id":    txID,
						"transaction_index": "0",
						"event_index":       "0",
						"payload":           payloadB64,
					},
				},
			})

		default:
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	client := NewClient(srv.URL)
	result, err := client.SendTransaction(context.Background(), &TxRequest{
		Cadence: `transaction { execute { log("hello") } }`,
	})
	if err != nil {
		t.Fatalf("SendTransaction error: %v", err)
	}
	if !result.Success {
		t.Fatalf("expected success, got error: %s", result.Error)
	}
	if result.TxID != txID {
		t.Errorf("expected txID=%s, got %s", txID, result.TxID)
	}
	if result.ComputationUsed != 42 {
		t.Errorf("expected computation_used=42, got %d", result.ComputationUsed)
	}
	if len(result.Events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(result.Events))
	}
	if result.Events[0].Type != "A.1654653399040a61.FlowToken.TokensDeposited" {
		t.Errorf("unexpected event type: %s", result.Events[0].Type)
	}
}

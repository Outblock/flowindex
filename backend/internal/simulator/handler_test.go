package simulator

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandleSimulate_Success(t *testing.T) {
	txID := "sim-test-tx-id"

	// Build a Cadence JSON event payload for a deposit
	eventPayload := map[string]interface{}{
		"type": "Event",
		"value": map[string]interface{}{
			"id": "A.1654653399040a61.FlowToken.TokensDeposited",
			"fields": []map[string]interface{}{
				{
					"name":  "amount",
					"value": map[string]interface{}{"type": "UFix64", "value": "5.00000000"},
				},
				{
					"name":  "to",
					"value": map[string]interface{}{"type": "Address", "value": "0xabcdef1234567890"},
				},
			},
		},
	}
	payloadBytes, _ := json.Marshal(eventPayload)
	payloadB64 := base64.StdEncoding.EncodeToString(payloadBytes)

	emulator := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "POST" && r.URL.Path == "/emulator/snapshots":
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]string{"block_height": "1"})
		case r.Method == "PUT" && strings.HasPrefix(r.URL.Path, "/emulator/snapshots/"):
			w.WriteHeader(http.StatusOK)
		case r.Method == "POST" && r.URL.Path == "/v1/transactions":
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]string{"id": txID})
		case r.Method == "GET" && r.URL.Path == "/v1/transaction_results/"+txID:
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":           "SEALED",
				"error_message":    "",
				"computation_used": "100",
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
			t.Logf("unexpected request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer emulator.Close()

	client := NewClient(emulator.URL)
	handler := NewHandler(client)

	body, _ := json.Marshal(SimulateRequest{
		Cadence: `transaction { execute { log("test") } }`,
	})

	req := httptest.NewRequest("POST", "/flow/v1/simulate", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handler.HandleSimulate(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp SimulateResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !resp.Success {
		t.Fatalf("expected success=true, got error: %s", resp.Error)
	}
	if resp.ComputationUsed != 100 {
		t.Errorf("expected computation_used=100, got %d", resp.ComputationUsed)
	}
	if len(resp.Events) != 1 {
		t.Errorf("expected 1 event, got %d", len(resp.Events))
	}
}

func TestHandleSimulate_BadRequest(t *testing.T) {
	client := NewClient("http://localhost:0") // won't be called
	handler := NewHandler(client)

	req := httptest.NewRequest("POST", "/flow/v1/simulate", bytes.NewReader([]byte("not-json")))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handler.HandleSimulate(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp SimulateResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Success {
		t.Fatal("expected success=false for bad request")
	}
	if resp.Error == "" {
		t.Fatal("expected non-empty error message")
	}
}

func TestHandleSimulate_EmptyScript(t *testing.T) {
	client := NewClient("http://localhost:0")
	handler := NewHandler(client)

	body, _ := json.Marshal(SimulateRequest{Cadence: ""})
	req := httptest.NewRequest("POST", "/flow/v1/simulate", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handler.HandleSimulate(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

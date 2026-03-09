# Flow Transaction Simulation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add EVM-style transaction pre-execution simulation — users see balance changes, events, and errors before signing.

**Architecture:** A Flow Emulator in fork mode (`--fork mainnet`) runs on a dedicated GCE e2-small VM. The Go backend proxies requests to it via a new `POST /flow/v1/simulate` endpoint. Runner auto-simulates before sending transactions, with a settings toggle to skip.

**Tech Stack:** Flow Emulator (Docker), Go (net/http + flow-go-sdk gRPC client), React (Runner UI)

---

### Task 1: Provision GCE Simulator VM

**Files:**
- Create: `simulator/Dockerfile`
- Create: `simulator/start.sh`
- Modify: `.github/workflows/deploy.yml` (add simulator build+deploy jobs)

**Step 1: Create Dockerfile for the simulator**

```dockerfile
# simulator/Dockerfile
FROM ghcr.io/onflow/flow-emulator:latest

# Expose REST + gRPC
EXPOSE 8888 3569

# Persist cached registers across restarts
VOLUME /data

ENTRYPOINT ["emulator"]
CMD [ \
  "--fork-host", "access.mainnet.nodes.onflow.org:9000", \
  "--skip-tx-validation", \
  "--persist", \
  "--dbpath", "/data", \
  "--chain-id", "flow-mainnet", \
  "--rest-port", "8888", \
  "--grpc-port", "3569", \
  "--log-level", "info" \
]
```

**Step 2: Create startup helper script**

```bash
#!/bin/bash
# simulator/start.sh — run on the GCE VM
set -e

IMAGE="us-central1-docker.pkg.dev/flowindex-mainnet/flowindex/simulator:latest"
docker pull "$IMAGE"
docker stop simulator 2>/dev/null || true
docker rm simulator 2>/dev/null || true

docker run -d \
  --restart=always \
  --name simulator \
  --network=host \
  -v simulator-data:/data \
  "$IMAGE"
```

**Step 3: Provision the GCE VM manually (one-time)**

```bash
# Create a small VM in the same zone/VPC as backend
gcloud compute instances create flowindex-simulator \
  --zone=us-central1-a \
  --machine-type=e2-small \
  --image-family=cos-stable \
  --image-project=cos-cloud \
  --boot-disk-size=20GB \
  --tags=flowindex-internal \
  --metadata=google-logging-enabled=true

# Allow internal traffic from backend VM (same VPC, already open)
# Emulator listens on 8888 (REST) and 3569 (gRPC) — internal only

# Get internal IP for backend config
gcloud compute instances describe flowindex-simulator \
  --zone=us-central1-a \
  --format='get(networkInterfaces[0].networkIP)'
```

**Step 4: Add simulator to deploy workflow**

Add to `.github/workflows/deploy.yml`:

1. Change detection filter:
```yaml
simulator:
  - 'simulator/**'
```

2. Build job:
```yaml
build-simulator:
  needs: changes
  if: needs.changes.outputs.simulator == 'true'
  runs-on: ubuntu-latest
  permissions:
    contents: read
    id-token: write
  steps:
    - uses: actions/checkout@v4
    - uses: google-github-actions/auth@v2
      with:
        workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
        service_account: ${{ secrets.WIF_SA }}
    - uses: google-github-actions/setup-gcloud@v2
    - run: gcloud auth configure-docker us-central1-docker.pkg.dev --quiet
    - uses: docker/build-push-action@v6
      with:
        context: simulator
        file: simulator/Dockerfile
        push: true
        tags: |
          us-central1-docker.pkg.dev/flowindex-mainnet/flowindex/simulator:latest
          us-central1-docker.pkg.dev/flowindex-mainnet/flowindex/simulator:${{ github.sha }}
```

3. Deploy job:
```yaml
deploy-simulator:
  needs: [build-simulator]
  if: needs.build-simulator.result == 'success'
  runs-on: ubuntu-latest
  steps:
    - uses: google-github-actions/auth@v2
      with:
        workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
        service_account: ${{ secrets.WIF_SA }}
    - uses: google-github-actions/setup-gcloud@v2
    - name: Deploy simulator
      run: |
        gcloud compute ssh flowindex-simulator --zone=us-central1-a --command='
          IMAGE=us-central1-docker.pkg.dev/flowindex-mainnet/flowindex/simulator:${{ github.sha }}
          docker-credential-gcr configure-docker --registries=us-central1-docker.pkg.dev
          docker pull $IMAGE
          docker stop simulator 2>/dev/null; docker rm simulator 2>/dev/null
          docker run -d --restart=always --name simulator \
            --network=host \
            -v simulator-data:/data \
            $IMAGE
        '
```

**Step 5: Commit**

```bash
git add simulator/ .github/workflows/deploy.yml
git commit -m "feat: add simulator VM infrastructure and deploy pipeline"
```

---

### Task 2: Backend Simulator Client

**Files:**
- Create: `backend/internal/simulator/client.go`
- Create: `backend/internal/simulator/client_test.go`

**Step 1: Write the test**

```go
// backend/internal/simulator/client_test.go
package simulator

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientHealthCheck(t *testing.T) {
	// Mock emulator REST API
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/blocks" && r.URL.Query().Get("height") == "sealed" {
			json.NewEncoder(w).Encode([]map[string]interface{}{
				{"header": map[string]interface{}{"height": "100"}},
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer srv.Close()

	c := NewClient(srv.URL)
	ok, err := c.HealthCheck(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Fatal("expected healthy")
	}
}

func TestClientSendTransaction(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v1/transactions" && r.Method == "POST":
			json.NewEncoder(w).Encode(map[string]interface{}{
				"id": "abc123",
			})
		case r.URL.Path == "/v1/transaction_results/abc123":
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":           "SEALED",
				"status_code":      0,
				"error_message":    "",
				"computation_used": "42",
				"events": []map[string]interface{}{
					{
						"type":             "A.1654653399040a61.FlowToken.TokensWithdrawn",
						"transaction_id":   "abc123",
						"transaction_index": "0",
						"event_index":       "0",
						"payload":           "eyJ0eXBlIjoiRXZlbnQiLCJ2YWx1ZSI6e319",
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := NewClient(srv.URL)
	result, err := c.SendTransaction(context.Background(), &TxRequest{
		Cadence:     "transaction { prepare(signer: &Account) {} }",
		Arguments:   []json.RawMessage{},
		Authorizers: []string{"1654653399040a61"},
		Payer:       "1654653399040a61",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.TxID != "abc123" {
		t.Fatalf("expected txID abc123, got %s", result.TxID)
	}
	if result.ComputationUsed != 42 {
		t.Fatalf("expected computation 42, got %d", result.ComputationUsed)
	}
	if len(result.Events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(result.Events))
	}
}
```

**Step 2: Run test to verify it fails**

```bash
cd backend && go test ./internal/simulator/ -v
```
Expected: FAIL (package doesn't exist yet)

**Step 3: Implement the client**

```go
// backend/internal/simulator/client.go
package simulator

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
)

// TxRequest represents a simulation request.
type TxRequest struct {
	Cadence     string             `json:"cadence"`
	Arguments   []json.RawMessage  `json:"arguments"`
	Authorizers []string           `json:"authorizers"`
	Payer       string             `json:"payer"`
}

// TxEvent is a simplified event from the emulator.
type TxEvent struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// TxResult holds the simulation outcome.
type TxResult struct {
	TxID            string    `json:"txId"`
	Success         bool      `json:"success"`
	Error           string    `json:"error,omitempty"`
	Events          []TxEvent `json:"events"`
	ComputationUsed int64     `json:"computationUsed"`
}

// Client talks to a Flow Emulator REST API.
type Client struct {
	baseURL    string
	httpClient *http.Client
}

// NewClient creates a simulator client pointing at the emulator REST API.
func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// HealthCheck pings the emulator to verify it's running and forked.
func (c *Client) HealthCheck(ctx context.Context) (bool, error) {
	req, _ := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/v1/blocks?height=sealed", nil)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK, nil
}

// SendTransaction submits a transaction to the emulator and waits for the result.
// The emulator runs with --skip-tx-validation, so we send a minimal envelope
// with dummy signatures — the emulator ignores them.
func (c *Client) SendTransaction(ctx context.Context, txReq *TxRequest) (*TxResult, error) {
	// Build the emulator REST API transaction body.
	// Reference key with weight 1000 on the payer account.
	// Emulator with --skip-tx-validation accepts any signature.
	args := make([]string, len(txReq.Arguments))
	for i, a := range txReq.Arguments {
		args[i] = base64.StdEncoding.EncodeToString(a)
	}

	body := map[string]interface{}{
		"script":            base64.StdEncoding.EncodeToString([]byte(txReq.Cadence)),
		"arguments":         args,
		"reference_block_id": "0000000000000000000000000000000000000000000000000000000000000000",
		"gas_limit":          "9999",
		"payer":              txReq.Payer,
		"proposal_key": map[string]interface{}{
			"address":          txReq.Payer,
			"key_index":        "0",
			"sequence_number":  "0",
		},
		"authorizers": txReq.Authorizers,
		"payload_signatures": []map[string]interface{}{},
		"envelope_signatures": []map[string]interface{}{
			{
				"address":   txReq.Payer,
				"key_index": "0",
				"signature": base64.StdEncoding.EncodeToString([]byte("dummy")),
			},
		},
	}

	bodyBytes, _ := json.Marshal(body)
	req, _ := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/v1/transactions", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("submit tx: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("submit tx: status %d: %s", resp.StatusCode, string(b))
	}

	var txResp struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&txResp); err != nil {
		return nil, fmt.Errorf("decode tx response: %w", err)
	}

	// Poll for result (emulator is local, should be fast)
	return c.waitForResult(ctx, txResp.ID)
}

func (c *Client) waitForResult(ctx context.Context, txID string) (*TxResult, error) {
	for i := 0; i < 30; i++ {
		req, _ := http.NewRequestWithContext(ctx, "GET", c.baseURL+"/v1/transaction_results/"+txID, nil)
		resp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, err
		}

		var result struct {
			Status          string `json:"status"`
			StatusCode      int    `json:"status_code"`
			ErrorMessage    string `json:"error_message"`
			ComputationUsed string `json:"computation_used"`
			Events          []struct {
				Type    string `json:"type"`
				Payload string `json:"payload"`
			} `json:"events"`
		}
		json.NewDecoder(resp.Body).Decode(&result)
		resp.Body.Close()

		if result.Status == "SEALED" || result.Status == "FINALIZED" {
			events := make([]TxEvent, len(result.Events))
			for i, e := range result.Events {
				payload, _ := base64.StdEncoding.DecodeString(e.Payload)
				events[i] = TxEvent{Type: e.Type, Payload: payload}
			}
			comp, _ := strconv.ParseInt(result.ComputationUsed, 10, 64)
			return &TxResult{
				TxID:            txID,
				Success:         result.StatusCode == 0 && result.ErrorMessage == "",
				Error:           result.ErrorMessage,
				Events:          events,
				ComputationUsed: comp,
			}, nil
		}

		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
	return nil, fmt.Errorf("timeout waiting for tx %s", txID)
}
```

**Step 4: Run tests**

```bash
cd backend && go test ./internal/simulator/ -v
```
Expected: PASS

**Step 5: Commit**

```bash
git add backend/internal/simulator/
git commit -m "feat: add simulator client for Flow Emulator REST API"
```

---

### Task 3: Backend Simulate Handler

**Files:**
- Create: `backend/internal/simulator/handler.go`
- Create: `backend/internal/simulator/handler_test.go`
- Modify: `backend/internal/api/routes_registration.go` (add route)
- Modify: `backend/internal/api/server_bootstrap.go` (add simulator client to Server)

**Step 1: Write the test**

```go
// backend/internal/simulator/handler_test.go
package simulator

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleSimulate_Success(t *testing.T) {
	// Mock emulator
	emu := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v1/transactions" && r.Method == "POST":
			json.NewEncoder(w).Encode(map[string]interface{}{"id": "tx1"})
		case r.URL.Path == "/v1/transaction_results/tx1":
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":           "SEALED",
				"status_code":      0,
				"error_message":    "",
				"computation_used": "100",
				"events":           []interface{}{},
			})
		case r.URL.Path == "/v1/accounts/1654653399040a61":
			// Pre/post balance query — simplified
			json.NewEncoder(w).Encode(map[string]interface{}{
				"address": "1654653399040a61",
				"balance": "100000000",
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer emu.Close()

	client := NewClient(emu.URL)
	h := NewHandler(client)

	body, _ := json.Marshal(SimulateRequest{
		Cadence:     "transaction { prepare(signer: &Account) {} }",
		Arguments:   []json.RawMessage{},
		Authorizers: []string{"0x1654653399040a61"},
		Payer:       "0x1654653399040a61",
	})

	req := httptest.NewRequest("POST", "/flow/v1/simulate", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.HandleSimulate(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp SimulateResponse
	json.NewDecoder(w.Body).Decode(&resp)
	if !resp.Success {
		t.Fatalf("expected success, got error: %s", resp.Error)
	}
}

func TestHandleSimulate_BadRequest(t *testing.T) {
	client := NewClient("http://localhost:0") // won't be called
	h := NewHandler(client)

	req := httptest.NewRequest("POST", "/flow/v1/simulate", bytes.NewReader([]byte("invalid")))
	w := httptest.NewRecorder()

	h.HandleSimulate(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}
```

**Step 2: Run test to verify it fails**

```bash
cd backend && go test ./internal/simulator/ -v -run TestHandleSimulate
```
Expected: FAIL

**Step 3: Implement the handler**

```go
// backend/internal/simulator/handler.go
package simulator

import (
	"encoding/json"
	"net/http"
	"strings"
)

// SimulateRequest is the JSON body for POST /flow/v1/simulate.
type SimulateRequest struct {
	Cadence     string            `json:"cadence"`
	Arguments   []json.RawMessage `json:"arguments"`
	Authorizers []string          `json:"authorizers"`
	Payer       string            `json:"payer"`
	Verbose     bool              `json:"verbose"`
}

// BalanceChange represents a token balance change from the simulation.
type BalanceChange struct {
	Address string `json:"address"`
	Token   string `json:"token"`
	Delta   string `json:"delta"`
}

// SimulateResponse is returned to the caller.
type SimulateResponse struct {
	Success         bool            `json:"success"`
	Error           string          `json:"error,omitempty"`
	Events          []TxEvent       `json:"events"`
	BalanceChanges  []BalanceChange `json:"balanceChanges,omitempty"`
	ComputationUsed int64           `json:"computationUsed"`
}

// Handler exposes HTTP handlers for simulation.
type Handler struct {
	client *Client
}

// NewHandler creates a Handler backed by the given simulator client.
func NewHandler(client *Client) *Handler {
	return &Handler{client: client}
}

// HandleSimulate handles POST /flow/v1/simulate.
func (h *Handler) HandleSimulate(w http.ResponseWriter, r *http.Request) {
	var req SimulateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(SimulateResponse{
			Success: false,
			Error:   "invalid request body: " + err.Error(),
		})
		return
	}

	if req.Cadence == "" {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(SimulateResponse{
			Success: false,
			Error:   "cadence code is required",
		})
		return
	}

	// Normalize addresses (strip 0x prefix)
	for i, a := range req.Authorizers {
		req.Authorizers[i] = strings.TrimPrefix(a, "0x")
	}
	req.Payer = strings.TrimPrefix(req.Payer, "0x")
	if req.Payer == "" && len(req.Authorizers) > 0 {
		req.Payer = req.Authorizers[0]
	}

	// Submit to emulator
	result, err := h.client.SendTransaction(r.Context(), &TxRequest{
		Cadence:     req.Cadence,
		Arguments:   req.Arguments,
		Authorizers: req.Authorizers,
		Payer:       req.Payer,
	})
	if err != nil {
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(SimulateResponse{
			Success: false,
			Error:   "simulation failed: " + err.Error(),
		})
		return
	}

	resp := SimulateResponse{
		Success:         result.Success,
		Error:           result.Error,
		Events:          result.Events,
		ComputationUsed: result.ComputationUsed,
		BalanceChanges:  parseBalanceChanges(result.Events),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// parseBalanceChanges extracts balance deltas from FlowToken/FungibleToken events.
func parseBalanceChanges(events []TxEvent) []BalanceChange {
	changes := map[string]float64{}
	for _, e := range events {
		var payload struct {
			Value struct {
				Fields []struct {
					Name  string `json:"name"`
					Value struct {
						Value string `json:"value"`
					} `json:"value"`
				} `json:"fields"`
			} `json:"value"`
		}
		if err := json.Unmarshal(e.Payload, &payload); err != nil {
			continue
		}

		var amount, addr string
		for _, f := range payload.Value.Fields {
			switch f.Name {
			case "amount":
				amount = f.Value.Value
			case "from", "to":
				addr = f.Value.Value
			}
		}
		if addr == "" || amount == "" {
			continue
		}

		// Determine direction from event type
		var delta float64
		switch {
		case strings.Contains(e.Type, "TokensWithdrawn") || strings.Contains(e.Type, "Withdrawn"):
			// Parse as negative
			if v, err := parseFloat(amount); err == nil {
				delta = -v
			}
		case strings.Contains(e.Type, "TokensDeposited") || strings.Contains(e.Type, "Deposited"):
			if v, err := parseFloat(amount); err == nil {
				delta = v
			}
		default:
			continue
		}

		// Determine token name from event type
		token := "FLOW"
		if !strings.Contains(e.Type, "FlowToken") {
			parts := strings.Split(e.Type, ".")
			if len(parts) >= 3 {
				token = parts[2] // contract name
			}
		}

		key := addr + ":" + token
		changes[key] += delta
	}

	var result []BalanceChange
	for key, delta := range changes {
		parts := strings.SplitN(key, ":", 2)
		result = append(result, BalanceChange{
			Address: "0x" + strings.TrimPrefix(parts[0], "0x"),
			Token:   parts[1],
			Delta:   formatDelta(delta),
		})
	}
	return result
}

func parseFloat(s string) (float64, error) {
	var f float64
	_, err := json.Unmarshal([]byte(s), &f)
	return f, err
}

func formatDelta(d float64) string {
	if d >= 0 {
		return "+" + json.Number(json.Number(formatFloat(d)).String()).String()
	}
	return json.Number(formatFloat(d)).String()
}

func formatFloat(f float64) string {
	return strings.TrimRight(strings.TrimRight(
		json.Number(json.Number(
			strings.Replace(
				json.Number("0").String(), "0",
				strings.TrimRight(strings.TrimRight(
					fmt.Sprintf("%.8f", f), "0"), "."), 1,
			),
		).String()).String(), "0"), ".")
}
```

Note: `formatFloat`/`formatDelta` are rough — refine as needed. The core logic is event parsing.

**Step 4: Wire into the API server**

Add to `backend/internal/api/server_bootstrap.go`:
```go
// In Server struct, add:
simulatorHandler *simulator.Handler

// In NewServer(), after other setup:
if simURL := os.Getenv("SIMULATOR_URL"); simURL != "" {
    simClient := simulator.NewClient(simURL)
    s.simulatorHandler = simulator.NewHandler(simClient)
}
```

Add to `backend/internal/api/routes_registration.go`:
```go
func registerSimulateRoutes(r *mux.Router, s *Server) {
    if s.simulatorHandler != nil {
        r.HandleFunc("/flow/v1/simulate", s.simulatorHandler.HandleSimulate).Methods("POST", "OPTIONS")
    }
}
```

Call `registerSimulateRoutes(r, s)` from `registerAPIRoutes()`.

**Step 5: Run tests**

```bash
cd backend && go test ./internal/simulator/ -v
```
Expected: PASS

**Step 6: Commit**

```bash
git add backend/internal/simulator/ backend/internal/api/routes_registration.go backend/internal/api/server_bootstrap.go
git commit -m "feat: add POST /flow/v1/simulate endpoint with emulator client"
```

---

### Task 4: Snapshot Management (State Isolation)

**Files:**
- Modify: `backend/internal/simulator/client.go` (add snapshot methods)
- Modify: `backend/internal/simulator/handler.go` (wrap simulate in snapshot/revert)
- Create: `backend/internal/simulator/snapshot_test.go`

**Step 1: Write the test**

```go
// backend/internal/simulator/snapshot_test.go
package simulator

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSnapshotCreateAndRevert(t *testing.T) {
	var snapshotCreated, snapshotReverted bool

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/emulator/snapshots" && r.Method == "POST":
			snapshotCreated = true
			json.NewEncoder(w).Encode(map[string]interface{}{
				"name":        "test-snap",
				"blockHeight": 100,
			})
		case r.URL.Path == "/emulator/snapshots/test-snap" && r.Method == "PUT":
			snapshotReverted = true
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer srv.Close()

	c := NewClient(srv.URL)
	name, err := c.CreateSnapshot(context.Background(), "test-snap")
	if err != nil {
		t.Fatal(err)
	}
	if name != "test-snap" {
		t.Fatalf("expected test-snap, got %s", name)
	}
	if !snapshotCreated {
		t.Fatal("snapshot not created")
	}

	err = c.RevertSnapshot(context.Background(), "test-snap")
	if err != nil {
		t.Fatal(err)
	}
	if !snapshotReverted {
		t.Fatal("snapshot not reverted")
	}
}
```

**Step 2: Run test (should fail)**

```bash
cd backend && go test ./internal/simulator/ -v -run TestSnapshot
```

**Step 3: Add snapshot methods to client**

Add to `client.go`:

```go
// CreateSnapshot creates a named state snapshot on the emulator.
func (c *Client) CreateSnapshot(ctx context.Context, name string) (string, error) {
	body, _ := json.Marshal(map[string]string{"name": name})
	req, _ := http.NewRequestWithContext(ctx, "POST", c.baseURL+"/emulator/snapshots", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var result struct {
		Name string `json:"name"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	return result.Name, nil
}

// RevertSnapshot restores emulator state to a named snapshot.
func (c *Client) RevertSnapshot(ctx context.Context, name string) error {
	req, _ := http.NewRequestWithContext(ctx, "PUT", c.baseURL+"/emulator/snapshots/"+name, nil)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("revert snapshot: status %d", resp.StatusCode)
	}
	return nil
}
```

Update `handler.go` `HandleSimulate` to wrap in snapshot:

```go
// In HandleSimulate, before SendTransaction:
snapName := "sim-" + fmt.Sprintf("%d", time.Now().UnixNano())
if _, err := h.client.CreateSnapshot(r.Context(), snapName); err != nil {
    // Non-fatal — simulation still works, just no state isolation
    log.Printf("warn: failed to create snapshot: %v", err)
}
defer func() {
    if err := h.client.RevertSnapshot(r.Context(), snapName); err != nil {
        log.Printf("warn: failed to revert snapshot: %v", err)
    }
}()
```

**Step 4: Run tests**

```bash
cd backend && go test ./internal/simulator/ -v
```
Expected: PASS

**Step 5: Commit**

```bash
git add backend/internal/simulator/
git commit -m "feat: add snapshot create/revert for simulation state isolation"
```

---

### Task 5: Runner — Simulation Hook in Execute Flow

**Files:**
- Create: `runner/src/flow/simulate.ts`
- Create: `runner/src/flow/simulate.test.ts`
- Modify: `runner/src/App.tsx` (integrate simulate into handleRun)

**Step 1: Create the simulate API client**

```typescript
// runner/src/flow/simulate.ts

export interface SimulateRequest {
  cadence: string;
  arguments: Array<{ type: string; value: string }>;
  authorizers: string[];
  payer: string;
  verbose?: boolean;
}

export interface BalanceChange {
  address: string;
  token: string;
  delta: string;
}

export interface SimulateResponse {
  success: boolean;
  error?: string;
  events: Array<{ type: string; payload: any }>;
  balanceChanges: BalanceChange[];
  computationUsed: number;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080';

export async function simulateTransaction(req: SimulateRequest): Promise<SimulateResponse> {
  const resp = await fetch(`${API_BASE}/flow/v1/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!resp.ok) {
    const text = await resp.text();
    return {
      success: false,
      error: `Simulation service error: ${resp.status} ${text}`,
      events: [],
      balanceChanges: [],
      computationUsed: 0,
    };
  }

  return resp.json();
}
```

**Step 2: Write test**

```typescript
// runner/src/flow/simulate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { simulateTransaction } from './simulate';

describe('simulateTransaction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns simulation result on success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        success: true,
        events: [{ type: 'FlowToken.TokensWithdrawn', payload: {} }],
        balanceChanges: [{ address: '0x1234', token: 'FLOW', delta: '-10.0' }],
        computationUsed: 42,
      }),
    });

    const result = await simulateTransaction({
      cadence: 'transaction {}',
      arguments: [],
      authorizers: ['0x1234'],
      payer: '0x1234',
    });

    expect(result.success).toBe(true);
    expect(result.balanceChanges).toHaveLength(1);
    expect(result.computationUsed).toBe(42);
  });

  it('returns error on network failure', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.resolve('emulator down'),
    });

    const result = await simulateTransaction({
      cadence: 'transaction {}',
      arguments: [],
      authorizers: ['0x1234'],
      payer: '0x1234',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('502');
  });
});
```

**Step 3: Run tests**

```bash
cd runner && bun test src/flow/simulate.test.ts
```
Expected: PASS

**Step 4: Commit**

```bash
git add runner/src/flow/simulate.ts runner/src/flow/simulate.test.ts
git commit -m "feat(runner): add simulate API client"
```

---

### Task 6: Runner — Transaction Preview UI Component

**Files:**
- Create: `runner/src/components/TransactionPreview.tsx`

**Step 1: Create the preview component**

```tsx
// runner/src/components/TransactionPreview.tsx
import { useState } from 'react';
import type { SimulateResponse, BalanceChange } from '../flow/simulate';

interface TransactionPreviewProps {
  result: SimulateResponse;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function TransactionPreview({ result, onConfirm, onCancel, loading }: TransactionPreviewProps) {
  const [showDetails, setShowDetails] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 bg-zinc-900 border border-zinc-700 rounded-lg">
        <div className="animate-spin h-4 w-4 border-2 border-blue-400 border-t-transparent rounded-full" />
        <span className="text-sm text-zinc-300">Simulating transaction...</span>
      </div>
    );
  }

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {result.success ? (
            <span className="text-green-400 text-sm font-medium">✓ Simulation successful</span>
          ) : (
            <span className="text-red-400 text-sm font-medium">✗ Simulation failed</span>
          )}
        </div>
        <span className="text-xs text-zinc-500">{result.computationUsed} compute units</span>
      </div>

      {/* Balance Changes */}
      {result.balanceChanges.length > 0 && (
        <div className="px-4 py-3 border-b border-zinc-800">
          <div className="text-xs text-zinc-400 mb-2 font-medium">Balance Changes</div>
          {result.balanceChanges.map((change, i) => (
            <BalanceChangeRow key={i} change={change} />
          ))}
        </div>
      )}

      {/* Error */}
      {result.error && (
        <div className="px-4 py-3 border-b border-zinc-800">
          <div className="text-xs text-red-400 font-mono whitespace-pre-wrap">{result.error}</div>
        </div>
      )}

      {/* Events summary */}
      {result.events.length > 0 && (
        <div className="px-4 py-2 border-b border-zinc-800">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-xs text-zinc-400 hover:text-zinc-300"
          >
            {result.events.length} event{result.events.length !== 1 ? 's' : ''}
            {showDetails ? ' ▲' : ' ▼'}
          </button>
          {showDetails && (
            <div className="mt-2 space-y-1">
              {result.events.map((e, i) => (
                <div key={i} className="text-xs font-mono text-zinc-500 truncate">
                  {e.type}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="px-4 py-3 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 rounded"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded font-medium"
        >
          {result.success ? 'Confirm & Send' : 'Send Anyway'}
        </button>
      </div>
    </div>
  );
}

function BalanceChangeRow({ change }: { change: BalanceChange }) {
  const isNegative = change.delta.startsWith('-');
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-zinc-300 font-mono truncate max-w-[200px]">
        {change.address}
      </span>
      <span className={`text-xs font-mono ${isNegative ? 'text-red-400' : 'text-green-400'}`}>
        {change.delta} {change.token}
      </span>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add runner/src/components/TransactionPreview.tsx
git commit -m "feat(runner): add TransactionPreview component"
```

---

### Task 7: Runner — Integrate Preview into Execute Flow

**Files:**
- Modify: `runner/src/App.tsx` (add simulation state + settings toggle + preview flow)

**Step 1: Add settings state**

In `App.tsx`, add alongside existing state:

```typescript
// Simulation settings
const [simulateBeforeSend, setSimulateBeforeSend] = useState<boolean>(() => {
  const stored = localStorage.getItem('runner:simulate-before-send');
  return stored !== 'false'; // default true
});
const [simResult, setSimResult] = useState<SimulateResponse | null>(null);
const [simLoading, setSimLoading] = useState(false);
const [pendingExecution, setPendingExecution] = useState<(() => void) | null>(null);
```

Persist toggle:
```typescript
useEffect(() => {
  localStorage.setItem('runner:simulate-before-send', String(simulateBeforeSend));
}, [simulateBeforeSend]);
```

**Step 2: Modify handleRun**

In the existing `handleRun` function, wrap the transaction execution path:

```typescript
// Before the existing execute logic for transactions:
if (codeType === 'transaction' && simulateBeforeSend && network === 'mainnet') {
  setSimLoading(true);
  setSimResult(null);

  const signerAddr = /* extract from selectedSigner — existing logic */;

  try {
    const simResp = await simulateTransaction({
      cadence: code,
      arguments: paramValues.map((v, i) => ({ type: params[i].type, value: v })),
      authorizers: [signerAddr],
      payer: signerAddr,
    });
    setSimResult(simResp);
    setSimLoading(false);

    // Store the actual execute function for later confirmation
    setPendingExecution(() => () => {
      actuallyExecuteTransaction(); // the existing execution logic
    });
    return; // Don't execute yet — wait for user confirmation
  } catch (err) {
    setSimLoading(false);
    // Simulation service down — fall through to execute directly
    console.warn('Simulation failed, executing directly:', err);
  }
}
```

**Step 3: Add preview panel to the UI**

In the JSX, render the preview panel (e.g., above or replacing the ResultPanel when active):

```tsx
{(simLoading || simResult) && (
  <TransactionPreview
    result={simResult ?? { success: false, events: [], balanceChanges: [], computationUsed: 0 }}
    loading={simLoading}
    onConfirm={() => {
      setSimResult(null);
      pendingExecution?.();
      setPendingExecution(null);
    }}
    onCancel={() => {
      setSimResult(null);
      setPendingExecution(null);
    }}
  />
)}
```

**Step 4: Add settings toggle**

In the existing settings dropdown/menu (look for where `autoSign`, `lspMode` toggles are), add:

```tsx
<label className="flex items-center gap-2 text-sm cursor-pointer">
  <input
    type="checkbox"
    checked={simulateBeforeSend}
    onChange={(e) => setSimulateBeforeSend(e.target.checked)}
    className="rounded"
  />
  <span>Simulate before sending</span>
</label>
```

**Step 5: Test manually**

```bash
cd runner && bun run dev
# Open browser, write a transaction, click Execute
# Should see simulation preview before sending
```

**Step 6: Commit**

```bash
git add runner/src/App.tsx
git commit -m "feat(runner): integrate transaction simulation preview into execute flow"
```

---

### Task 8: Backend Environment + Docker Compose (Local Dev)

**Files:**
- Modify: `docker-compose.yml` (add simulator service for local dev)
- Modify: `backend/.env.example` or relevant env docs

**Step 1: Add simulator to docker-compose.yml**

```yaml
  simulator:
    image: ghcr.io/onflow/flow-emulator:latest
    command: >
      emulator
      --fork-host access.mainnet.nodes.onflow.org:9000
      --skip-tx-validation
      --persist
      --dbpath /data
      --chain-id flow-mainnet
      --rest-port 8888
      --grpc-port 3569
      --log-level info
    volumes:
      - simulator-data:/data
    ports:
      - "8888:8888"
      - "3569:3569"
    restart: unless-stopped

volumes:
  simulator-data:
```

Add env var to backend service:
```yaml
  backend:
    environment:
      - SIMULATOR_URL=http://simulator:8888
```

**Step 2: Test locally**

```bash
docker compose up -d simulator
curl http://localhost:8888/v1/blocks?height=sealed
# Should return a block from forked mainnet
```

**Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add flow emulator simulator to docker-compose for local dev"
```

---

### Task 9: GCP VM Deployment

**Files:**
- Already done in Task 1 (deploy workflow)
- Create env file on VM

**Step 1: Create the VM**

```bash
gcloud compute instances create flowindex-simulator \
  --zone=us-central1-a \
  --machine-type=e2-small \
  --image-family=cos-stable \
  --image-project=cos-cloud \
  --boot-disk-size=30GB \
  --tags=flowindex-internal

# Get internal IP
gcloud compute instances describe flowindex-simulator \
  --zone=us-central1-a \
  --format='get(networkInterfaces[0].networkIP)'
```

**Step 2: Deploy the emulator container**

```bash
gcloud compute ssh flowindex-simulator --zone=us-central1-a --command='
  docker-credential-gcr configure-docker --registries=us-central1-docker.pkg.dev
  docker run -d --restart=always --name simulator \
    --network=host \
    -v simulator-data:/data \
    ghcr.io/onflow/flow-emulator:latest \
    emulator \
    --fork-host access.mainnet.nodes.onflow.org:9000 \
    --skip-tx-validation \
    --persist \
    --dbpath /data \
    --chain-id flow-mainnet \
    --rest-port 8888 \
    --grpc-port 3569 \
    --log-level info
'
```

**Step 3: Add SIMULATOR_URL to backend env**

```bash
# Get simulator internal IP first, then:
gcloud compute ssh flowindex-backend --zone=us-central1-a --command='
  echo "SIMULATOR_URL=http://<SIMULATOR_INTERNAL_IP>:8888" >> /mnt/stateful_partition/pgdata/backend.env
'
# Restart backend to pick up new env
```

**Step 4: Verify**

```bash
gcloud compute ssh flowindex-simulator --zone=us-central1-a --command='
  curl -s http://localhost:8888/v1/blocks?height=sealed | head -c 200
'
```

**Step 5: Commit (deploy workflow changes)**

```bash
git add .github/workflows/deploy.yml
git commit -m "feat: add simulator VM to GCP deploy pipeline"
```

---

## Summary

| Task | What | Estimated Time |
|------|------|----------------|
| 1 | Simulator Dockerfile + Deploy Pipeline | 15 min |
| 2 | Backend Simulator Client | 20 min |
| 3 | Backend Simulate Handler + Route | 20 min |
| 4 | Snapshot Management | 10 min |
| 5 | Runner Simulate API Client | 10 min |
| 6 | Runner TransactionPreview Component | 15 min |
| 7 | Runner Execute Flow Integration | 20 min |
| 8 | Docker Compose (Local Dev) | 5 min |
| 9 | GCP VM Deployment | 15 min |

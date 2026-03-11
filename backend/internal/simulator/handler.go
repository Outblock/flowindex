package simulator

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// SimulateRequest is the incoming JSON body for the simulate endpoint.
type SimulateRequest struct {
	Cadence     string            `json:"cadence"`
	Arguments   []json.RawMessage `json:"arguments,omitempty"`
	Authorizers []string          `json:"authorizers,omitempty"`
	Payer       string            `json:"payer,omitempty"`
	Verbose     bool              `json:"verbose,omitempty"`
}

// BalanceChange describes a token balance delta for a single address.
type BalanceChange struct {
	Address string `json:"address"`
	Token   string `json:"token"`
	Delta   string `json:"delta"`
}

// SimulateResponse is the JSON response from the simulate endpoint.
type SimulateResponse struct {
	Success         bool            `json:"success"`
	Error           string          `json:"error,omitempty"`
	Events          []TxEvent       `json:"events,omitempty"`
	BalanceChanges  []BalanceChange `json:"balance_changes,omitempty"`
	ComputationUsed int64           `json:"computation_used"`
}

// Handler serves the /flow/v1/simulate endpoint.
// Requests are serialized via a mutex because the Flow Emulator
// can only execute one block at a time.
type Handler struct {
	client *Client
	mu     sync.Mutex
}

// NewHandler creates a new simulation handler and starts background warmup.
func NewHandler(client *Client) *Handler {
	h := &Handler{client: client}
	go h.warmup()
	return h
}

// warmup pre-caches common mainnet contract state by running a simple transaction.
// This makes the first real user request much faster.
func (h *Handler) warmup() {
	// Wait for emulator to be ready
	time.Sleep(3 * time.Second)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	// Check emulator health first
	if ok, err := h.client.HealthCheck(ctx); !ok || err != nil {
		log.Printf("[simulator] warmup: emulator not ready, skipping: %v", err)
		return
	}

	log.Println("[simulator] warmup: pre-caching common mainnet contract state...")

	h.mu.Lock()
	defer h.mu.Unlock()

	// Simple FlowToken transfer that touches FungibleToken + FlowToken contracts
	warmupCadence := `import FungibleToken from 0xf233dcee88fe0abe
import FlowToken from 0x1654653399040a61

transaction(amount: UFix64, to: Address) {
    let sentVault: @{FungibleToken.Vault}
    prepare(signer: auth(BorrowValue) &Account) {
        let vaultRef = signer.storage.borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(
            from: /storage/flowTokenVault
        ) ?? panic("Could not borrow reference to the owner's Vault!")
        self.sentVault <- vaultRef.withdraw(amount: amount)
    }
    execute {
        let receiverRef = getAccount(to)
            .capabilities.borrow<&{FungibleToken.Receiver}>(/public/flowTokenReceiver)
            ?? panic("Could not borrow receiver reference")
        receiverRef.deposit(from: <- self.sentVault)
    }
}`

	txReq := &TxRequest{
		Cadence: warmupCadence,
		Arguments: []json.RawMessage{
			json.RawMessage(`{"type":"UFix64","value":"0.001"}`),
			json.RawMessage(`{"type":"Address","value":"0x1654653399040a61"}`),
		},
		Authorizers: []string{"1654653399040a61"},
		Payer:       "1654653399040a61",
	}

	start := time.Now()
	result, err := h.client.SendTransaction(ctx, txReq)
	elapsed := time.Since(start)

	if err != nil {
		log.Printf("[simulator] warmup: transaction failed after %s: %v", elapsed, err)
		return
	}

	if result.Success {
		log.Printf("[simulator] warmup: completed successfully in %s (computation: %d)", elapsed, result.ComputationUsed)
	} else {
		log.Printf("[simulator] warmup: transaction error after %s: %s", elapsed, result.Error)
	}
}

// HandleSimulate processes a simulate request.
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
			Error:   "cadence script is required",
		})
		return
	}

	// Normalize addresses: strip 0x prefix, lowercase
	req.Payer = normalizeAddress(req.Payer)
	for i, a := range req.Authorizers {
		req.Authorizers[i] = normalizeAddress(a)
	}

	// Serialize: emulator can only execute one block at a time
	h.mu.Lock()
	defer h.mu.Unlock()

	// Try snapshot/revert for state isolation (may not work in fork mode)
	snapName := fmt.Sprintf("sim-%d", time.Now().UnixNano())
	snapOK := false
	if _, err := h.client.CreateSnapshot(r.Context(), snapName); err == nil {
		snapOK = true
		defer func() {
			h.client.RevertSnapshot(r.Context(), snapName)
		}()
	}
	_ = snapOK

	// Build and send the transaction
	txReq := &TxRequest{
		Cadence:     req.Cadence,
		Arguments:   req.Arguments,
		Authorizers: req.Authorizers,
		Payer:       req.Payer,
	}

	result, err := h.client.SendTransaction(r.Context(), txReq)
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
	}

	// Parse balance changes from events
	resp.BalanceChanges = parseBalanceChanges(result.Events)

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}

// balanceKey is used to aggregate balance changes by address+token.
type balanceKey struct {
	Address string
	Token   string
}

// parseBalanceChanges extracts token balance changes from transaction events.
func parseBalanceChanges(events []TxEvent) []BalanceChange {
	deltas := make(map[balanceKey]float64)

	for _, ev := range events {
		evType := ev.Type
		var amount float64
		var address string
		var token string

		isWithdraw := strings.Contains(evType, "TokensWithdrawn") || strings.Contains(evType, "Withdrawn")
		isDeposit := strings.Contains(evType, "TokensDeposited") || strings.Contains(evType, "Deposited")

		if !isWithdraw && !isDeposit {
			continue
		}

		// Extract token name from event type (e.g., "A.1654653399040a61.FlowToken.TokensWithdrawn")
		parts := strings.Split(evType, ".")
		if len(parts) >= 3 {
			token = parts[len(parts)-2] // contract name
		}

		// Skip generic FungibleToken/NonFungibleToken base events — they duplicate
		// the specific token events (e.g., FlowToken.TokensWithdrawn)
		if token == "FungibleToken" || token == "NonFungibleToken" {
			continue
		}

		// Parse Cadence JSON event payload to extract amount and address
		amount, address = parseCadenceEventPayload(ev.Payload)

		if address == "" || amount == 0 {
			continue
		}

		key := balanceKey{Address: address, Token: token}
		if isWithdraw {
			deltas[key] -= amount
		} else {
			deltas[key] += amount
		}
	}

	changes := make([]BalanceChange, 0, len(deltas))
	for key, delta := range deltas {
		changes = append(changes, BalanceChange{
			Address: key.Address,
			Token:   key.Token,
			Delta:   formatFloat(delta),
		})
	}

	return changes
}

// parseCadenceEventPayload tries to extract amount and address from a Cadence JSON event payload.
func parseCadenceEventPayload(payload json.RawMessage) (amount float64, address string) {
	if len(payload) == 0 {
		return 0, ""
	}

	// Cadence JSON payload format: {"type":"Event","value":{"id":"...","fields":[{"name":"amount","value":{"type":"UFix64","value":"1.00000000"}}, ...]}}
	var cadenceEvent struct {
		Type  string `json:"type"`
		Value struct {
			Fields []struct {
				Name  string          `json:"name"`
				Value json.RawMessage `json:"value"`
			} `json:"fields"`
		} `json:"value"`
	}

	if err := json.Unmarshal(payload, &cadenceEvent); err != nil {
		return 0, ""
	}

	for _, field := range cadenceEvent.Value.Fields {
		switch field.Name {
		case "amount":
			var val struct {
				Type  string `json:"type"`
				Value string `json:"value"`
			}
			if err := json.Unmarshal(field.Value, &val); err == nil {
				amount, _ = strconv.ParseFloat(val.Value, 64)
			}
		case "from", "to":
			address = extractAddress(field.Value)
		}
	}

	return amount, address
}

// extractAddress handles both Address and Optional<Address> Cadence JSON values.
// Address:          {"type":"Address","value":"0x1654653399040a61"}
// Optional<Address>: {"type":"Optional","value":{"type":"Address","value":"0x1654653399040a61"}}
func extractAddress(raw json.RawMessage) string {
	var outer struct {
		Type  string          `json:"type"`
		Value json.RawMessage `json:"value"`
	}
	if err := json.Unmarshal(raw, &outer); err != nil {
		return ""
	}

	if outer.Type == "Address" {
		var addr string
		if err := json.Unmarshal(outer.Value, &addr); err != nil {
			return ""
		}
		return normalizeAddress(addr)
	}

	if outer.Type == "Optional" {
		// Unwrap: value is {"type":"Address","value":"0x..."}
		var inner struct {
			Type  string `json:"type"`
			Value string `json:"value"`
		}
		if err := json.Unmarshal(outer.Value, &inner); err != nil {
			return ""
		}
		return normalizeAddress(inner.Value)
	}

	return ""
}

// normalizeAddress strips 0x prefix and lowercases.
func normalizeAddress(addr string) string {
	addr = strings.TrimSpace(addr)
	addr = strings.TrimPrefix(strings.ToLower(addr), "0x")
	return addr
}

// formatFloat formats a float with up to 8 decimal places, trimming trailing zeros.
func formatFloat(f float64) string {
	s := fmt.Sprintf("%.8f", f)
	s = strings.TrimRight(s, "0")
	s = strings.TrimRight(s, ".")
	return s
}

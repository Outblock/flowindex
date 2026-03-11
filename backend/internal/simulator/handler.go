package simulator

import (
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

// NewHandler creates a new simulation handler.
func NewHandler(client *Client) *Handler {
	return &Handler{client: client}
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

	// Create a snapshot before simulation
	snapName := fmt.Sprintf("sim-%d", time.Now().UnixNano())
	if _, err := h.client.CreateSnapshot(r.Context(), snapName); err != nil {
		log.Printf("[simulator] warning: could not create snapshot: %v", err)
	}

	// Always revert after simulation
	defer func() {
		if err := h.client.RevertSnapshot(r.Context(), snapName); err != nil {
			log.Printf("[simulator] warning: could not revert snapshot: %v", err)
		}
	}()

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
			var val struct {
				Type  string `json:"type"`
				Value string `json:"value"`
			}
			if err := json.Unmarshal(field.Value, &val); err == nil {
				address = normalizeAddress(val.Value)
			}
		}
	}

	return amount, address
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

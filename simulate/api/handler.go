package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
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
	Before  string `json:"before,omitempty"`
	After   string `json:"after,omitempty"`
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

// Handler serves the /api/simulate endpoint.
// Requests are serialized via a mutex because the Flow Emulator
// can only execute one block at a time.
type Handler struct {
	client            *Client
	mu                sync.Mutex
	emulatorContainer string
	stuckTimeout      time.Duration
	lastBlockChange   atomic.Int64 // unix timestamp of last observed block height change
	lastBlockHeight   atomic.Int64
	recovering        atomic.Bool
}

// HealthSnapshot captures watchdog-related health signals for external monitoring.
type HealthSnapshot struct {
	Recovering           bool  `json:"recovering"`
	Stalled              bool  `json:"stalled"`
	LastSealedHeight     int64 `json:"last_sealed_height"`
	SecondsSinceProgress int64 `json:"seconds_since_progress"`
	StuckTimeoutSeconds  int64 `json:"stuck_timeout_seconds"`
}

const tokenBalanceQueryScript = `
import FungibleToken from 0xf233dcee88fe0abe

access(all) fun main(address: Address): {String: UFix64} {
    let account = getAuthAccount<auth(BorrowValue) &Account>(address)
    let balances: {String: UFix64} = {}
    let vaultType: Type = Type<@{FungibleToken.Vault}>()

    account.storage.forEachStored(fun (path: StoragePath, type: Type): Bool {
        if !type.isRecovered && (type.isInstance(vaultType) || type.isSubtype(of: vaultType)) {
            if let vaultRef = account.storage.borrow<&{FungibleToken.Balance}>(from: path) {
                let key = type.identifier
                let current = balances[key] ?? 0.0
                balances[key] = current + vaultRef.balance
            }
        }
        return true
    })

    return balances
}
`

// NewHandler creates a new simulation handler and starts background warmup.
// Warmup runs immediately on start, then repeats every hour to keep the
// emulator's fork-mode cache fresh.
func NewHandler(client *Client, emulatorContainer string, stuckTimeoutSec int) *Handler {
	h := &Handler{
		client:            client,
		emulatorContainer: emulatorContainer,
		stuckTimeout:      time.Duration(stuckTimeoutSec) * time.Second,
	}
	h.lastBlockChange.Store(time.Now().Unix())
	go h.warmupLoop()
	go h.watchdog()
	return h
}

// HealthSnapshot returns watchdog progress metrics used by /health.
func (h *Handler) HealthStatus() HealthSnapshot {
	last := time.Unix(h.lastBlockChange.Load(), 0)
	since := time.Since(last)
	if since < 0 {
		since = 0
	}

	return HealthSnapshot{
		Recovering:           h.recovering.Load(),
		Stalled:              since > h.stuckTimeout,
		LastSealedHeight:     h.lastBlockHeight.Load(),
		SecondsSinceProgress: int64(since.Seconds()),
		StuckTimeoutSeconds:  int64(h.stuckTimeout.Seconds()),
	}
}

// watchdog monitors the emulator for stuck blocks and auto-recovers by
// restarting the emulator container when no progress is detected.
func (h *Handler) watchdog() {
	// Give emulator time to start up before monitoring
	time.Sleep(30 * time.Second)

	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		if h.recovering.Load() {
			continue
		}

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		height, err := h.client.getLatestBlockHeight(ctx)
		cancel()

		if err != nil {
			// Can't reach emulator or got "pending block" error — check how long it's been stuck
			stuckSince := time.Unix(h.lastBlockChange.Load(), 0)
			if time.Since(stuckSince) > h.stuckTimeout {
				log.Printf("[watchdog] emulator stuck for %s (timeout=%s), recovering...",
					time.Since(stuckSince).Round(time.Second), h.stuckTimeout)
				h.recoverEmulator()
			}
			continue
		}

		// Track block height changes
		prev := h.lastBlockHeight.Load()
		if height != prev {
			h.lastBlockHeight.Store(height)
			h.lastBlockChange.Store(time.Now().Unix())
		}
	}
}

// recoverEmulator restarts the emulator container and re-runs warmup.
func (h *Handler) recoverEmulator() {
	if !h.recovering.CompareAndSwap(false, true) {
		return // already recovering
	}
	defer h.recovering.Store(false)

	log.Printf("[recovery] restarting emulator container %q...", h.emulatorContainer)

	// Restart via Docker CLI (requires Docker socket mounted)
	cmd := exec.Command("docker", "restart", "-t", "5", h.emulatorContainer)
	out, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("[recovery] docker restart failed: %v, output: %s", err, string(out))
		return
	}
	log.Printf("[recovery] emulator container restarted, waiting for ready...")

	// Wait for emulator to be ready (up to 30s)
	for i := 0; i < 30; i++ {
		time.Sleep(1 * time.Second)
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		ok, err := h.client.HealthCheck(ctx)
		cancel()
		if ok && err == nil {
			log.Println("[recovery] emulator ready, re-running warmup...")
			h.lastBlockChange.Store(time.Now().Unix())
			h.warmup()
			return
		}
	}

	log.Println("[recovery] emulator did not become ready after 30s")
	h.lastBlockChange.Store(time.Now().Unix()) // reset timer to avoid immediate re-trigger
}

// warmupLoop runs warmup on start and then every hour.
func (h *Handler) warmupLoop() {
	h.warmup()
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()
	for range ticker.C {
		log.Println("[simulator] periodic warmup starting...")
		h.warmup()
	}
}

// warmup pre-caches common mainnet contract state by running transactions that
// import frequently-used contracts. This forces the fork-mode emulator to fetch
// and cache account state, making the first real user request much faster.
//
// NOTE: Warmup acquires the mutex per-tx (not for the entire duration) so that
// user requests are not blocked for minutes while warmup runs. Each warmup tx
// has a 45-second timeout — if the emulator is stuck on a heavy contract import,
// we skip it and move on.
func (h *Handler) warmup() {
	// Wait for emulator to be ready
	time.Sleep(3 * time.Second)

	ctx := context.Background()

	// Check emulator health first
	healthCtx, healthCancel := context.WithTimeout(ctx, 10*time.Second)
	defer healthCancel()
	if ok, err := h.client.HealthCheck(healthCtx); !ok || err != nil {
		log.Printf("[simulator] warmup: emulator not ready, skipping: %v", err)
		return
	}

	log.Println("[simulator] warmup: pre-caching common mainnet contract state...")

	start := time.Now()

	// Phase 1: Core token contracts (FlowToken transfer touches FungibleToken, FlowToken, FlowFees)
	h.runWarmupTx(ctx, "core-tokens", `
import FungibleToken from 0xf233dcee88fe0abe
import FlowToken from 0x1654653399040a61
import FungibleTokenSwitchboard from 0xf233dcee88fe0abe

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
}`,
		[]json.RawMessage{
			json.RawMessage(`{"type":"UFix64","value":"0.001"}`),
			json.RawMessage(`{"type":"Address","value":"0x1654653399040a61"}`),
		},
	)

	// Phase 2: NFT + metadata contracts
	h.runWarmupTx(ctx, "nft-metadata", `
import NonFungibleToken from 0x1d7e57aa55817448
import MetadataViews from 0x1d7e57aa55817448
import ViewResolver from 0x1d7e57aa55817448
import NFTCatalog from 0x49a7cda3a1eecc29
import NFTRetrieval from 0x49a7cda3a1eecc29
import NFTStorefrontV2 from 0x4eb8a10cb9f87357

transaction {
    prepare(signer: &Account) { log("nft-metadata warmup") }
}`, nil)

	// Phase 3: Staking contracts
	h.runWarmupTx(ctx, "staking", `
import FlowIDTableStaking from 0x8624b52f9ddcd04a
import FlowStakingCollection from 0x8d0e87b65159ae63
import FlowEpoch from 0x8624b52f9ddcd04a
import FlowClusterQC from 0x8624b52f9ddcd04a
import LockedTokens from 0x8d0e87b65159ae63

transaction {
    prepare(signer: &Account) { log("staking warmup") }
}`, nil)

	// Phase 4: EVM + bridge contracts
	h.runWarmupTx(ctx, "evm-bridge", `
import EVM from 0xe467b9dd11fa00df
import FlowEVMBridge from 0x1e4aa0b87d10b141

transaction {
    prepare(signer: &Account) { log("evm-bridge warmup") }
}`, nil)

	// Phase 5: Hybrid custody + capability contracts
	h.runWarmupTx(ctx, "hybrid-custody", `
import HybridCustody from 0xd8a7e05a7ac670c0
import CapabilityFactory from 0xd8a7e05a7ac670c0
import CapabilityFilter from 0xd8a7e05a7ac670c0

transaction {
    prepare(signer: &Account) { log("hybrid-custody warmup") }
}`, nil)

	// Phase 6: Naming + utility contracts
	h.runWarmupTx(ctx, "naming-utils", `
import Find from 0x097bafa4e0b48eef
import Flowns from 0x233eb012d34b0070
import Domains from 0x233eb012d34b0070
import StringUtils from 0xa340dc0a4ec828ab
import FlowDomainUtils from 0x1b3930856571a52b

transaction {
    prepare(signer: &Account) { log("naming-utils warmup") }
}`, nil)

	// Phase 7: Misc contracts
	h.runWarmupTx(ctx, "misc", `
import TransactionGeneration from 0xe52522745adf5c34
import FlowviewAccountBookmark from 0x39b144ab4d348e2b

transaction {
    prepare(signer: &Account) { log("misc warmup") }
}`, nil)

	// Phase 8: Pre-cache FlowToken vault storage for common signer addresses.
	// The warmup above caches contract code, but when a user simulates a FLOW transfer
	// using an address as signer, the emulator also fetches that account's storage registers
	// (e.g., /storage/flowTokenVault). This forces the emulator to do slow gRPC round-trips.
	// Pre-cache by running a FLOW transfer FROM each key address to warm the storage.
	popularSigners := []struct {
		name string
		addr string
	}{
		{"FlowToken", "1654653399040a61"},
		{"FungibleToken", "f233dcee88fe0abe"},
		{"FlowFees", "f919ee77447b7497"},
	}

	for _, acc := range popularSigners {
		h.runWarmupTx(ctx, "storage-"+acc.name, `
import FungibleToken from 0xf233dcee88fe0abe
import FlowToken from 0x1654653399040a61

transaction(amount: UFix64, to: Address) {
    let sentVault: @{FungibleToken.Vault}
    prepare(signer: auth(BorrowValue) &Account) {
        let vaultRef = signer.storage.borrow<auth(FungibleToken.Withdraw) &FlowToken.Vault>(
            from: /storage/flowTokenVault
        ) ?? panic("No vault")
        self.sentVault <- vaultRef.withdraw(amount: amount)
    }
    execute {
        let receiverRef = getAccount(to)
            .capabilities.borrow<&{FungibleToken.Receiver}>(/public/flowTokenReceiver)
            ?? panic("No receiver")
        receiverRef.deposit(from: <- self.sentVault)
    }
}`,
			[]json.RawMessage{
				json.RawMessage(`{"type":"UFix64","value":"0.001"}`),
				json.RawMessage(`{"type":"Address","value":"0xe467b9dd11fa00df"}`),
			}, acc.addr)
	}

	elapsed := time.Since(start)
	log.Printf("[simulator] warmup: all phases completed in %s", elapsed)
}

// runWarmupTx sends a single warmup transaction with a per-tx timeout.
// It acquires the mutex only for the duration of this single tx, so user
// requests can interleave between warmup phases.
// Optional signerOverride uses a specific address as the authorizer (to pre-cache its storage).
func (h *Handler) runWarmupTx(_ context.Context, name string, cadence string, args []json.RawMessage, signerOverride ...string) {
	signer := "e467b9dd11fa00df"
	if len(signerOverride) > 0 && signerOverride[0] != "" {
		signer = signerOverride[0]
	}
	txReq := &TxRequest{
		Cadence:     cadence,
		Arguments:   args,
		Authorizers: []string{signer},
		Payer:       "e467b9dd11fa00df",
	}

	// Per-tx timeout: if a single warmup tx takes >45s it's stuck on
	// a heavy mainnet state fetch — skip it rather than blocking everything.
	txCtx, txCancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer txCancel()

	h.mu.Lock()

	// Ensure emulator is ready before sending
	h.client.WaitForBlockReady(txCtx)

	start := time.Now()
	result, err := h.client.SendTransaction(txCtx, txReq)
	elapsed := time.Since(start)

	// Wait for block to commit before releasing mutex
	h.client.WaitForBlockReady(txCtx)
	h.mu.Unlock()

	if err != nil {
		log.Printf("[simulator] warmup [%s]: failed after %s: %v", name, elapsed, err)
		return
	}

	if result.Success {
		log.Printf("[simulator] warmup [%s]: OK in %s (computation: %d)", name, elapsed, result.ComputationUsed)
	} else {
		log.Printf("[simulator] warmup [%s]: error after %s: %s", name, elapsed, result.Error)
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
	for i, a := range req.Authorizers {
		req.Authorizers[i] = normalizeAddress(a)
	}

	// Always use the emulator service account as payer.
	// In simulation, the payer only pays gas fees which don't matter.
	// Using the service account avoids slow state fetches for arbitrary payer addresses.
	const serviceAccount = "e467b9dd11fa00df"

	// Serialize: emulator can only execute one block at a time
	h.mu.Lock()
	defer h.mu.Unlock()

	// Ensure emulator has no pending block before starting
	h.client.WaitForBlockReady(r.Context())

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
		Payer:       serviceAccount,
	}

	result, err := h.client.SendTransaction(r.Context(), txReq)
	if err != nil {
		// Still wait for block to settle before releasing mutex
		h.client.WaitForBlockReady(r.Context())
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(SimulateResponse{
			Success: false,
			Error:   "simulation failed: " + err.Error(),
		})
		return
	}

	// Wait for emulator to finish committing the block before releasing mutex.
	// Without this, the next queued request may hit "pending block" errors.
	h.client.WaitForBlockReady(r.Context())

	resp := SimulateResponse{
		Success:         result.Success,
		Error:           result.Error,
		Events:          result.Events,
		ComputationUsed: result.ComputationUsed,
	}

	parsedBalanceChanges := parseBalanceChanges(result.Events)
	if len(parsedBalanceChanges) > 0 {
		postBalances, err := h.fetchPostBalances(r.Context(), parsedBalanceChanges)
		if err != nil {
			log.Printf("[simulator] warning: failed to enrich balances with before/after: %v", err)
		}
		resp.BalanceChanges = buildBalanceChanges(parsedBalanceChanges, postBalances)
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
}

// balanceKey is used to aggregate balance changes by address+token.
type balanceKey struct {
	Address         string
	Token           string
	ContractAddress string
}

type parsedBalanceChange struct {
	Address         string
	Token           string
	ContractAddress string
	DeltaScaled     *big.Int
}

// parseBalanceChanges extracts token balance deltas from transaction events.
func parseBalanceChanges(events []TxEvent) []parsedBalanceChange {
	deltas := make(map[balanceKey]*big.Int)

	for _, ev := range events {
		evType := ev.Type
		var amount string
		var address string
		var token string
		var contractAddress string

		isWithdraw := strings.Contains(evType, "TokensWithdrawn") || strings.Contains(evType, "Withdrawn")
		isDeposit := strings.Contains(evType, "TokensDeposited") || strings.Contains(evType, "Deposited")

		if !isWithdraw && !isDeposit {
			continue
		}

		// Extract contract address + token name from event type
		// (e.g., "A.1654653399040a61.FlowToken.TokensWithdrawn").
		parts := strings.Split(evType, ".")
		if len(parts) >= 4 {
			contractAddress = parts[len(parts)-3]
			token = parts[len(parts)-2] // contract name
		}

		// Skip generic FungibleToken/NonFungibleToken base events — they duplicate
		// the specific token events (e.g., FlowToken.TokensWithdrawn)
		if token == "FungibleToken" || token == "NonFungibleToken" {
			continue
		}

		// Parse Cadence JSON event payload to extract amount and address
		amount, address = parseCadenceEventPayload(ev.Payload)

		if address == "" || amount == "" {
			continue
		}

		scaledAmount, err := parseUFix64Amount(amount)
		if err != nil {
			continue
		}

		key := balanceKey{Address: address, Token: token, ContractAddress: contractAddress}
		if _, ok := deltas[key]; !ok {
			deltas[key] = new(big.Int)
		}
		if isWithdraw {
			deltas[key].Sub(deltas[key], scaledAmount)
		} else {
			deltas[key].Add(deltas[key], scaledAmount)
		}
	}

	changes := make([]parsedBalanceChange, 0, len(deltas))
	for key, delta := range deltas {
		changes = append(changes, parsedBalanceChange{
			Address:         key.Address,
			Token:           key.Token,
			ContractAddress: key.ContractAddress,
			DeltaScaled:     new(big.Int).Set(delta),
		})
	}

	return changes
}

func buildBalanceChanges(parsed []parsedBalanceChange, postBalances map[balanceKey]string) []BalanceChange {
	changes := make([]BalanceChange, 0, len(parsed))
	for _, change := range parsed {
		apiChange := BalanceChange{
			Address: change.Address,
			Token:   change.Token,
			Delta:   formatScaledAmount(change.DeltaScaled),
		}

		if postBalances != nil {
			key := balanceKey{
				Address:         change.Address,
				Token:           change.Token,
				ContractAddress: change.ContractAddress,
			}
			if after, ok := postBalances[key]; ok {
				afterScaled, err := parseUFix64Amount(after)
				if err == nil {
					beforeScaled := new(big.Int).Sub(new(big.Int).Set(afterScaled), change.DeltaScaled)
					apiChange.After = formatScaledAmount(afterScaled)
					apiChange.Before = formatScaledAmount(beforeScaled)
				}
			}
		}

		changes = append(changes, apiChange)
	}
	return changes
}

func (h *Handler) fetchPostBalances(ctx context.Context, changes []parsedBalanceChange) (map[balanceKey]string, error) {
	if len(changes) == 0 {
		return nil, nil
	}

	byAddress := make(map[string][]parsedBalanceChange)
	for _, change := range changes {
		byAddress[change.Address] = append(byAddress[change.Address], change)
	}

	results := make(map[balanceKey]string, len(changes))
	for address, addressChanges := range byAddress {
		balances, err := h.client.GetTokenBalances(ctx, address)
		if err != nil {
			return nil, fmt.Errorf("querying balances for %s: %w", address, err)
		}
		for _, change := range addressChanges {
			key := balanceKey{
				Address:         change.Address,
				Token:           change.Token,
				ContractAddress: change.ContractAddress,
			}
			results[key] = lookupTokenBalance(balances, change.ContractAddress, change.Token)
		}
	}

	return results, nil
}

// parseCadenceEventPayload tries to extract amount and address from a Cadence JSON event payload.
func parseCadenceEventPayload(payload json.RawMessage) (amount string, address string) {
	if len(payload) == 0 {
		return "", ""
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
		return "", ""
	}

	for _, field := range cadenceEvent.Value.Fields {
		switch field.Name {
		case "amount":
			var val struct {
				Type  string `json:"type"`
				Value string `json:"value"`
			}
			if err := json.Unmarshal(field.Value, &val); err == nil {
				amount = val.Value
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

func lookupTokenBalance(balances map[string]string, contractAddress, token string) string {
	exact := buildTokenTypeID(contractAddress, token)
	if exact != "" {
		if balance, ok := balances[exact]; ok {
			return balance
		}
	}

	suffix := "." + token + ".Vault"
	var matched string
	for key, balance := range balances {
		if strings.HasSuffix(key, suffix) {
			if matched != "" {
				return "0.0"
			}
			matched = balance
		}
	}
	if matched != "" {
		return matched
	}
	return "0.0"
}

func buildTokenTypeID(contractAddress, token string) string {
	if contractAddress == "" || token == "" {
		return ""
	}
	return "A." + normalizeAddress(contractAddress) + "." + token + ".Vault"
}

func parseUFix64Amount(value string) (*big.Int, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return big.NewInt(0), nil
	}

	sign := int64(1)
	if strings.HasPrefix(value, "-") {
		sign = -1
		value = strings.TrimPrefix(value, "-")
	} else if strings.HasPrefix(value, "+") {
		value = strings.TrimPrefix(value, "+")
	}

	parts := strings.SplitN(value, ".", 2)
	wholePart := parts[0]
	if wholePart == "" {
		wholePart = "0"
	}
	whole := new(big.Int)
	if _, ok := whole.SetString(wholePart, 10); !ok {
		return nil, fmt.Errorf("invalid UFix64 integer part %q", value)
	}

	fractionPart := ""
	if len(parts) == 2 {
		fractionPart = parts[1]
	}
	if len(fractionPart) > 8 {
		fractionPart = fractionPart[:8]
	}
	fractionPart = fractionPart + strings.Repeat("0", 8-len(fractionPart))

	fraction := new(big.Int)
	if fractionPart != "" {
		if _, ok := fraction.SetString(fractionPart, 10); !ok {
			return nil, fmt.Errorf("invalid UFix64 fractional part %q", value)
		}
	}

	scale := big.NewInt(100000000)
	scaled := new(big.Int).Mul(whole, scale)
	scaled.Add(scaled, fraction)
	if sign < 0 {
		scaled.Neg(scaled)
	}
	return scaled, nil
}

func formatScaledAmount(value *big.Int) string {
	if value == nil {
		return "0.0"
	}

	scale := big.NewInt(100000000)
	sign := ""
	scaled := new(big.Int).Set(value)
	if scaled.Sign() < 0 {
		sign = "-"
		scaled.Neg(scaled)
	}

	whole := new(big.Int).Quo(scaled, scale)
	fraction := new(big.Int).Mod(scaled, scale)
	if fraction.Sign() == 0 {
		return sign + whole.String() + ".0"
	}

	fractionStr := fraction.String()
	if len(fractionStr) < 8 {
		fractionStr = strings.Repeat("0", 8-len(fractionStr)) + fractionStr
	}
	fractionStr = strings.TrimRight(fractionStr, "0")
	if fractionStr == "" {
		fractionStr = "0"
	}

	return sign + whole.String() + "." + fractionStr
}

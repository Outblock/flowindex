package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	jsoncdc "github.com/onflow/cadence/encoding/json"
)

// SimulateRequest is the incoming JSON body for the simulate endpoint.
type SimulateRequest struct {
	Cadence     string            `json:"cadence"`
	Arguments   []json.RawMessage `json:"arguments,omitempty"`
	Authorizers []string          `json:"authorizers,omitempty"`
	Payer       string            `json:"payer,omitempty"`
	Verbose     bool              `json:"verbose,omitempty"`
	Scheduled   *ScheduledOptions `json:"scheduled,omitempty"`
}

// ScheduledOptions controls optional post-transaction block advancement so
// scheduled transactions can execute inside the same simulation snapshot.
type ScheduledOptions struct {
	AdvanceSeconds float64 `json:"advance_seconds,omitempty"`
	AdvanceBlocks  int     `json:"advance_blocks,omitempty"`
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
	Success          bool            `json:"success"`
	Error            string          `json:"error,omitempty"`
	Events           []TxEvent       `json:"events,omitempty"`
	ScheduledResults []TxResult      `json:"scheduled_results,omitempty"`
	BalanceChanges   []BalanceChange `json:"balance_changes,omitempty"`
	ComputationUsed  int64           `json:"computation_used"`
}

const (
	maxScheduledAdvanceSeconds = 5.0
	maxScheduledAdvanceBlocks  = 20
)

var (
	cadenceAddressRe  = regexp.MustCompile(`^(?:0x)?[0-9a-fA-F]{16}$`)
	simulateRequestID atomic.Uint64
)

func nextSimRequestID() string {
	return fmt.Sprintf("sim-%06d", simulateRequestID.Add(1))
}

func logSimStage(requestID, stage string, started time.Time, format string, args ...any) {
	extra := ""
	if format != "" {
		extra = " " + fmt.Sprintf(format, args...)
	}
	log.Printf("[simulate %s] stage=%s elapsed=%s%s", requestID, stage, time.Since(started), extra)
}

// Handler serves the /api/simulate endpoint.
// Requests are serialized via a mutex because the Flow Emulator
// can only execute one block at a time.
type Handler struct {
	client            *Client
	mu                sync.Mutex
	emulatorContainer string
	stuckTimeout      time.Duration
	lastHealthyCheck  atomic.Int64 // unix timestamp of last successful emulator poll
	lastBlockChange   atomic.Int64 // unix timestamp of last observed block height change
	lastBlockHeight   atomic.Int64
	recovering        atomic.Bool
	baseSnapshot      atomic.Value // string: name of the post-warmup base snapshot
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
	h.lastHealthyCheck.Store(time.Now().Unix())
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
	lastHealthy := time.Unix(h.lastHealthyCheck.Load(), 0)
	sinceHealthy := time.Since(lastHealthy)
	if sinceHealthy < 0 {
		sinceHealthy = 0
	}

	return HealthSnapshot{
		Recovering:           h.recovering.Load(),
		Stalled:              sinceHealthy > h.stuckTimeout,
		LastSealedHeight:     h.lastBlockHeight.Load(),
		SecondsSinceProgress: int64(since.Seconds()),
		StuckTimeoutSeconds:  int64(h.stuckTimeout.Seconds()),
	}
}

func (h *Handler) triggerRecovery(reason string, err error) {
	if err != nil {
		log.Printf("[recovery] %s: %v", reason, err)
	} else {
		log.Printf("[recovery] %s", reason)
	}
	if !h.recovering.CompareAndSwap(false, true) {
		return
	}
	go h.recoverEmulator()
}

func (h *Handler) createStateSnapshot(ctx context.Context, prefix string) (string, error) {
	snapName := fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano())
	if _, err := h.client.CreateSnapshot(ctx, snapName); err != nil {
		h.triggerRecovery("snapshot creation failed", err)
		return "", fmt.Errorf("creating state snapshot: %w", err)
	}
	return snapName, nil
}

func (h *Handler) revertStateSnapshot(ctx context.Context, snapName string) error {
	if err := h.client.RevertSnapshot(ctx, snapName); err != nil {
		h.triggerRecovery("snapshot revert failed", err)
		return fmt.Errorf("reverting state snapshot: %w", err)
	}
	if err := h.client.WaitForBlockReady(ctx); err != nil {
		h.triggerRecovery("post-revert readiness check failed", err)
		return fmt.Errorf("waiting for emulator after revert: %w", err)
	}
	return nil
}

func normalizeScheduledOptions(opts *ScheduledOptions) (blocks int, wait time.Duration, err error) {
	if opts == nil {
		return 0, 0, nil
	}
	if opts.AdvanceBlocks < 0 {
		return 0, 0, fmt.Errorf("scheduled.advance_blocks must be >= 0")
	}
	if opts.AdvanceBlocks > maxScheduledAdvanceBlocks {
		return 0, 0, fmt.Errorf("scheduled.advance_blocks must be <= %d", maxScheduledAdvanceBlocks)
	}
	if opts.AdvanceSeconds < 0 {
		return 0, 0, fmt.Errorf("scheduled.advance_seconds must be >= 0")
	}
	if opts.AdvanceSeconds > maxScheduledAdvanceSeconds {
		return 0, 0, fmt.Errorf("scheduled.advance_seconds must be <= %.0f", maxScheduledAdvanceSeconds)
	}

	blocks = opts.AdvanceBlocks
	if blocks == 0 && opts.AdvanceSeconds > 0 {
		blocks = 1
	}

	wait = time.Duration(opts.AdvanceSeconds * float64(time.Second))
	return blocks, wait, nil
}

func (h *Handler) executeScheduledBlocks(ctx context.Context, opts *ScheduledOptions) ([]TxResult, error) {
	blocks, wait, err := normalizeScheduledOptions(opts)
	if err != nil {
		return nil, err
	}
	if blocks == 0 {
		return nil, nil
	}

	if wait > 0 {
		timer := time.NewTimer(wait)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-timer.C:
		}
	}

	scheduledResults := make([]TxResult, 0)
	for i := 0; i < blocks; i++ {
		block, err := h.client.CommitBlock(ctx)
		if err != nil {
			return nil, err
		}

		blockResults, err := h.client.GetTransactionResultsByBlockID(ctx, block.ID, true)
		if err != nil {
			return nil, err
		}
		scheduledResults = append(scheduledResults, blockResults...)
	}

	return scheduledResults, nil
}

func mergeSimulationResults(primary *TxResult, scheduled []TxResult) (success bool, errMsg string, events []TxEvent, computationUsed int64) {
	success = primary.Success
	errMsg = primary.Error
	events = append(events, primary.Events...)
	computationUsed = primary.ComputationUsed

	for _, result := range scheduled {
		events = append(events, result.Events...)
		computationUsed += result.ComputationUsed
		if !result.Success {
			success = false
			if errMsg == "" {
				errMsg = fmt.Sprintf("scheduled tx %s failed: %s", result.TxID, result.Error)
			} else {
				errMsg += "; " + fmt.Sprintf("scheduled tx %s failed: %s", result.TxID, result.Error)
			}
		}
	}

	return success, errMsg, events, computationUsed
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
			stuckSince := time.Unix(h.lastHealthyCheck.Load(), 0)
			if time.Since(stuckSince) > h.stuckTimeout {
				log.Printf("[watchdog] emulator stuck for %s (timeout=%s), recovering...",
					time.Since(stuckSince).Round(time.Second), h.stuckTimeout)
				h.triggerRecovery("watchdog detected stalled emulator", nil)
			}
			continue
		}
		h.lastHealthyCheck.Store(time.Now().Unix())

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

	// Phase 1: Core token contracts + FLOW transfer (warms FungibleToken, FlowToken, FlowFees)
	h.runWarmupTx(ctx, "core-tokens", `
import FungibleToken from 0xf233dcee88fe0abe
import FlowToken from 0x1654653399040a61
import FungibleTokenSwitchboard from 0xf233dcee88fe0abe
import FungibleTokenMetadataViews from 0xf233dcee88fe0abe
import Burner from 0xf233dcee88fe0abe

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
import CrossVMMetadataViews from 0x1d7e57aa55817448
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
import FlowDKG from 0x8624b52f9ddcd04a
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

	// Phase 7: Misc contracts + TransactionGeneration
	h.runWarmupTx(ctx, "misc", `
import TransactionGeneration from 0xe52522745adf5c34
import FlowviewAccountBookmark from 0x39b144ab4d348e2b

transaction {
    prepare(signer: &Account) { log("misc warmup") }
}`, nil)

	// Phase 8: System/runtime accounts accessed on every transaction
	// (FlowExecutionParameters, fee computation, authorization).
	// Also touch service account contracts (FlowServiceAccount, FlowStorageFees, etc.)
	h.runWarmupTx(ctx, "runtime-system", `
import FlowExecutionParameters from 0xf426ff57ee8f6110
import FlowServiceAccount from 0xe467b9dd11fa00df
import FlowStorageFees from 0xe467b9dd11fa00df
import FlowTransactionScheduler from 0xe467b9dd11fa00df
import NodeVersionBeacon from 0xe467b9dd11fa00df
import RandomBeaconHistory from 0xe467b9dd11fa00df
import FlowFees from 0xf919ee77447b7497

transaction {
    prepare(signer: &Account) {
        // Touch system accounts so their metadata registers get cached
        let a1 = getAccount(0xf426ff57ee8f6110)
        let a2 = getAccount(0xd421a63faae318f9)
        let a3 = getAccount(0x45df3724e7c13957)
        log(a1.balance)
        log(a2.balance)
        log(a3.balance)
    }
}`, nil)

	// Phase 9: Pre-cache FlowToken vault storage for common signer addresses.
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

	// Create a base snapshot AFTER warmup so all cached registers are included.
	// Simulations revert to this snapshot instead of creating fresh ones,
	// preserving the warm register cache across requests.
	baseCtx, baseCancel := context.WithTimeout(ctx, 10*time.Second)
	defer baseCancel()
	h.mu.Lock()
	baseName := fmt.Sprintf("base-%d", time.Now().UnixNano())
	if _, err := h.client.CreateSnapshot(baseCtx, baseName); err != nil {
		log.Printf("[simulator] warmup: failed to create base snapshot: %v", err)
	} else {
		h.baseSnapshot.Store(baseName)
		log.Printf("[simulator] warmup: base snapshot created: %s", baseName)
	}
	h.mu.Unlock()

	elapsed := time.Since(start)
	log.Printf("[simulator] warmup: all phases completed in %s", elapsed)
}

// runWarmupTx sends a single warmup transaction WITHOUT snapshot/revert.
// This lets the emulator's remote register cache accumulate across all warmup
// phases. The base snapshot is created after all warmup phases complete, so
// simulations that revert to base retain the warm cache.
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
	defer h.mu.Unlock()

	// Ensure emulator is ready before sending
	if err := h.client.WaitForBlockReady(txCtx); err != nil {
		log.Printf("[simulator] warmup [%s]: emulator not ready: %v", name, err)
		return
	}

	start := time.Now()
	result, err := h.client.SendTransaction(txCtx, txReq)
	elapsed := time.Since(start)

	// Wait for block to commit
	waitErr := h.client.WaitForBlockReady(txCtx)

	if err != nil {
		log.Printf("[simulator] warmup [%s]: failed after %s: %v", name, elapsed, err)
		return
	}
	if waitErr != nil {
		log.Printf("[simulator] warmup [%s]: block did not settle after %s: %v", name, elapsed, waitErr)
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
	requestID := nextSimRequestID()
	requestStart := time.Now()

	var req SimulateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("[simulate %s] invalid request body after %s: %v", requestID, time.Since(requestStart), err)
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(SimulateResponse{
			Success: false,
			Error:   "invalid request body: " + err.Error(),
		})
		return
	}

	if req.Cadence == "" {
		log.Printf("[simulate %s] rejected empty cadence after %s", requestID, time.Since(requestStart))
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(SimulateResponse{
			Success: false,
			Error:   "cadence script is required",
		})
		return
	}

	if _, _, err := normalizeScheduledOptions(req.Scheduled); err != nil {
		log.Printf("[simulate %s] rejected invalid scheduled options after %s: %v", requestID, time.Since(requestStart), err)
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(SimulateResponse{
			Success: false,
			Error:   err.Error(),
		})
		return
	}

	// Normalize addresses: strip 0x prefix, lowercase
	for i, a := range req.Authorizers {
		req.Authorizers[i] = normalizeAddress(a)
	}
	if err := validateSimulateRequest(req); err != nil {
		log.Printf("[simulate %s] rejected invalid request after %s: %v", requestID, time.Since(requestStart), err)
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(SimulateResponse{
			Success: false,
			Error:   err.Error(),
		})
		return
	}

	// Always use the emulator service account as payer.
	// In simulation, the payer only pays gas fees which don't matter.
	// Using the service account avoids slow state fetches for arbitrary payer addresses.
	const serviceAccount = "e467b9dd11fa00df"

	log.Printf(
		"[simulate %s] request received cadence_bytes=%d args=%d authorizers=%d scheduled=%t verbose=%t",
		requestID,
		len(req.Cadence),
		len(req.Arguments),
		len(req.Authorizers),
		req.Scheduled != nil,
		req.Verbose,
	)

	if h.recovering.Load() {
		log.Printf("[simulate %s] rejected while recovering after %s", requestID, time.Since(requestStart))
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(SimulateResponse{
			Success: false,
			Error:   "simulator is recovering, please retry shortly",
		})
		return
	}

	// Serialize: emulator can only execute one block at a time
	lockStart := time.Now()
	h.mu.Lock()
	defer h.mu.Unlock()
	logSimStage(requestID, "queue_wait", lockStart, "")

	if h.recovering.Load() {
		log.Printf("[simulate %s] became unavailable while waiting for lock after %s", requestID, time.Since(requestStart))
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(SimulateResponse{
			Success: false,
			Error:   "simulator is recovering, please retry shortly",
		})
		return
	}

	// Ensure emulator has no pending block before starting
	preReadyStart := time.Now()
	if err := h.client.WaitForBlockReady(r.Context()); err != nil {
		log.Printf("[simulate %s] pre-ready failed after %s: %v", requestID, time.Since(requestStart), err)
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(SimulateResponse{
			Success: false,
			Error:   "emulator is not ready: " + err.Error(),
		})
		return
	}
	logSimStage(requestID, "wait_ready_pre", preReadyStart, "")

	// Use the base snapshot (created after warmup) for isolation.
	// After simulation, we revert to base — this restores the warm register
	// cache while discarding transaction side effects.
	// If no base snapshot exists yet (warmup still running), fall back to
	// creating a per-request snapshot.
	snapshotStart := time.Now()
	var snapName string
	if base, ok := h.baseSnapshot.Load().(string); ok && base != "" {
		snapName = base
		logSimStage(requestID, "snapshot_create", snapshotStart, "snapshot=%s (base)", snapName)
	} else {
		var err error
		snapName, err = h.createStateSnapshot(r.Context(), "sim")
		if err != nil {
			log.Printf("[simulate %s] snapshot create failed after %s: %v", requestID, time.Since(requestStart), err)
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(SimulateResponse{
				Success: false,
				Error:   "simulation state isolation unavailable: " + err.Error(),
			})
			return
		}
		logSimStage(requestID, "snapshot_create", snapshotStart, "snapshot=%s (fallback)", snapName)
	}

	// Build and send the transaction
	txReq := &TxRequest{
		Cadence:     req.Cadence,
		Arguments:   req.Arguments,
		Authorizers: req.Authorizers,
		Payer:       serviceAccount,
	}

	sendStart := time.Now()
	result, err := h.client.SendTransaction(r.Context(), txReq)
	txID := ""
	if result != nil {
		txID = result.TxID
	}
	logSimStage(requestID, "send_transaction", sendStart, "tx_id=%s err=%v", txID, err)
	if err != nil {
		// Still wait for block to settle and revert before releasing mutex.
		waitStart := time.Now()
		waitErr := h.client.WaitForBlockReady(r.Context())
		logSimStage(requestID, "wait_ready_after_error", waitStart, "err=%v", waitErr)
		revertStart := time.Now()
		revertErr := h.revertStateSnapshot(r.Context(), snapName)
		logSimStage(requestID, "snapshot_revert_after_error", revertStart, "err=%v", revertErr)
		msg := "simulation failed: " + err.Error()
		if waitErr != nil {
			msg += "; emulator did not settle cleanly: " + waitErr.Error()
		}
		if revertErr != nil {
			msg += "; failed to restore emulator state: " + revertErr.Error()
		}
		log.Printf("[simulate %s] failed after %s: %s", requestID, time.Since(requestStart), msg)
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(SimulateResponse{
			Success: false,
			Error:   msg,
		})
		return
	}

	// Wait for emulator to finish committing the block before releasing mutex.
	// Without this, the next queued request may hit "pending block" errors.
	postReadyStart := time.Now()
	if err := h.client.WaitForBlockReady(r.Context()); err != nil {
		logSimStage(requestID, "wait_ready_post", postReadyStart, "err=%v", err)
		revertStart := time.Now()
		revertErr := h.revertStateSnapshot(r.Context(), snapName)
		logSimStage(requestID, "snapshot_revert_after_post_wait_error", revertStart, "err=%v", revertErr)
		msg := "emulator did not settle after simulation: " + err.Error()
		if revertErr != nil {
			msg += "; failed to restore emulator state: " + revertErr.Error()
		}
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(SimulateResponse{
			Success: false,
			Error:   msg,
		})
		return
	}
	logSimStage(requestID, "wait_ready_post", postReadyStart, "")

	var scheduledResults []TxResult
	if result.Success && req.Scheduled != nil {
		scheduledStart := time.Now()
		scheduledResults, err = h.executeScheduledBlocks(r.Context(), req.Scheduled)
		logSimStage(requestID, "scheduled_blocks", scheduledStart, "count=%d err=%v", len(scheduledResults), err)
		if err != nil {
			revertStart := time.Now()
			revertErr := h.revertStateSnapshot(r.Context(), snapName)
			logSimStage(requestID, "snapshot_revert_after_scheduled_error", revertStart, "err=%v", revertErr)
			msg := "scheduled transaction execution failed: " + err.Error()
			if revertErr != nil {
				msg += "; failed to restore emulator state: " + revertErr.Error()
			}
			w.WriteHeader(http.StatusBadGateway)
			json.NewEncoder(w).Encode(SimulateResponse{
				Success: false,
				Error:   msg,
			})
			return
		}
	}

	success, errMsg, allEvents, computationUsed := mergeSimulationResults(result, scheduledResults)

	resp := SimulateResponse{
		Success:          success,
		Error:            errMsg,
		Events:           allEvents,
		ScheduledResults: scheduledResults,
		ComputationUsed:  computationUsed,
	}

	parsedBalanceChanges := parseBalanceChanges(allEvents)
	if len(parsedBalanceChanges) > 0 {
		balanceStart := time.Now()
		postBalances, err := h.fetchPostBalances(r.Context(), requestID, parsedBalanceChanges)
		logSimStage(requestID, "fetch_post_balances", balanceStart, "addresses=%d err=%v", len(uniqueBalanceAddressesNeedingLookup(parsedBalanceChanges)), err)
		if err != nil {
			log.Printf("[simulator] warning: failed to enrich balances with before/after: %v", err)
		}
		resp.BalanceChanges = buildBalanceChanges(parsedBalanceChanges, postBalances)
	}

	revertStart := time.Now()
	if err := h.revertStateSnapshot(r.Context(), snapName); err != nil {
		logSimStage(requestID, "snapshot_revert", revertStart, "err=%v", err)
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(SimulateResponse{
			Success: false,
			Error:   "simulation completed but state restore failed: " + err.Error(),
		})
		return
	}
	logSimStage(requestID, "snapshot_revert", revertStart, "")

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(resp)
	log.Printf(
		"[simulate %s] completed total=%s success=%t events=%d balance_changes=%d scheduled_results=%d",
		requestID,
		time.Since(requestStart),
		resp.Success,
		len(resp.Events),
		len(resp.BalanceChanges),
		len(resp.ScheduledResults),
	)
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
	AfterHint       string
}

// parseBalanceChanges extracts token balance deltas from transaction events.
func parseBalanceChanges(events []TxEvent) []parsedBalanceChange {
	deltas := make(map[balanceKey]*big.Int)
	afterHints := make(map[balanceKey]string)
	baseFungibleKeys := make(map[balanceKey]struct{})

	for _, ev := range events {
		amount, address, key, balanceAfter, ok := parseFungibleBalanceChangeHint(ev)
		if !ok {
			continue
		}

		scaledAmount, err := parseUFix64Amount(amount)
		if err != nil {
			continue
		}

		if _, exists := deltas[key]; !exists {
			deltas[key] = new(big.Int)
		}
		if strings.Contains(ev.Type, "Withdrawn") {
			deltas[key].Sub(deltas[key], scaledAmount)
		} else {
			deltas[key].Add(deltas[key], scaledAmount)
		}

		baseFungibleKeys[key] = struct{}{}
		if address != "" && balanceAfter != "" {
			afterHints[key] = balanceAfter
		}
	}

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

		key := balanceKey{Address: address, Token: token, ContractAddress: contractAddress}
		if _, ok := baseFungibleKeys[key]; ok {
			continue
		}

		scaledAmount, err := parseUFix64Amount(amount)
		if err != nil {
			continue
		}

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
			AfterHint:       afterHints[key],
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

		key := balanceKey{
			Address:         change.Address,
			Token:           change.Token,
			ContractAddress: change.ContractAddress,
		}
		after := change.AfterHint
		if after == "" && postBalances != nil {
			after = postBalances[key]
		}
		if after != "" {
			afterScaled, err := parseUFix64Amount(after)
			if err == nil {
				beforeScaled := new(big.Int).Sub(new(big.Int).Set(afterScaled), change.DeltaScaled)
				apiChange.After = formatScaledAmount(afterScaled)
				apiChange.Before = formatScaledAmount(beforeScaled)
			}
		}

		changes = append(changes, apiChange)
	}
	return changes
}

func uniqueBalanceAddresses(changes []parsedBalanceChange) []string {
	if len(changes) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(changes))
	addresses := make([]string, 0, len(changes))
	for _, change := range changes {
		if _, ok := seen[change.Address]; ok {
			continue
		}
		seen[change.Address] = struct{}{}
		addresses = append(addresses, change.Address)
	}

	return addresses
}

func (h *Handler) fetchPostBalances(ctx context.Context, requestID string, changes []parsedBalanceChange) (map[balanceKey]string, error) {
	lookupAddresses := uniqueBalanceAddressesNeedingLookup(changes)
	if len(lookupAddresses) == 0 {
		return nil, nil
	}

	byAddress := make(map[string][]parsedBalanceChange)
	for _, change := range changes {
		if change.AfterHint != "" {
			continue
		}
		byAddress[change.Address] = append(byAddress[change.Address], change)
	}

	results := make(map[balanceKey]string, len(changes))
	for _, address := range lookupAddresses {
		addressChanges := byAddress[address]
		queryStart := time.Now()
		balances, err := h.client.GetTokenBalances(ctx, address)
		if err != nil {
			logSimStage(requestID, "balance_query", queryStart, "address=%s err=%v", address, err)
			return nil, fmt.Errorf("querying balances for %s: %w", address, err)
		}
		logSimStage(requestID, "balance_query", queryStart, "address=%s vaults=%d", address, len(balances))
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

func uniqueBalanceAddressesNeedingLookup(changes []parsedBalanceChange) []string {
	if len(changes) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(changes))
	addresses := make([]string, 0, len(changes))
	for _, change := range changes {
		if change.AfterHint != "" {
			continue
		}
		if _, ok := seen[change.Address]; ok {
			continue
		}
		seen[change.Address] = struct{}{}
		addresses = append(addresses, change.Address)
	}

	return addresses
}

func parseFungibleBalanceChangeHint(ev TxEvent) (amount string, address string, key balanceKey, balanceAfter string, ok bool) {
	if !(strings.Contains(ev.Type, "FungibleToken.Withdrawn") || strings.Contains(ev.Type, "FungibleToken.Deposited")) {
		return "", "", balanceKey{}, "", false
	}

	amount, address, vaultType, balanceAfter := parseFungibleBalanceEventPayload(ev.Payload)
	if amount == "" || address == "" || vaultType == "" {
		return "", "", balanceKey{}, "", false
	}

	contractAddress, token, ok := parseVaultIdentifier(vaultType)
	if !ok {
		return "", "", balanceKey{}, "", false
	}

	return amount, address, balanceKey{
		Address:         address,
		Token:           token,
		ContractAddress: contractAddress,
	}, balanceAfter, true
}

func parseFungibleBalanceEventPayload(payload json.RawMessage) (amount string, address string, vaultType string, balanceAfter string) {
	if len(payload) == 0 {
		return "", "", "", ""
	}

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
		return "", "", "", ""
	}

	for _, field := range cadenceEvent.Value.Fields {
		switch field.Name {
		case "amount", "balanceAfter":
			var val struct {
				Type  string `json:"type"`
				Value string `json:"value"`
			}
			if err := json.Unmarshal(field.Value, &val); err != nil {
				continue
			}
			if field.Name == "amount" {
				amount = val.Value
			} else {
				balanceAfter = val.Value
			}
		case "from", "to":
			address = extractAddress(field.Value)
		case "type":
			var val struct {
				Type  string `json:"type"`
				Value string `json:"value"`
			}
			if err := json.Unmarshal(field.Value, &val); err == nil {
				vaultType = val.Value
			}
		}
	}

	return amount, address, vaultType, balanceAfter
}

func parseVaultIdentifier(identifier string) (contractAddress string, token string, ok bool) {
	parts := strings.Split(identifier, ".")
	if len(parts) < 4 {
		return "", "", false
	}

	return parts[len(parts)-3], parts[len(parts)-2], true
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

func validateSimulateRequest(req SimulateRequest) error {
	for i, auth := range req.Authorizers {
		if auth == "" {
			return fmt.Errorf("invalid authorizer at index %d: address is required", i)
		}
		if !cadenceAddressRe.MatchString(auth) {
			return fmt.Errorf("invalid authorizer at index %d: address must be 16 hex chars, with optional 0x prefix", i)
		}
	}

	for i, arg := range req.Arguments {
		if _, err := jsoncdc.Decode(nil, arg); err != nil {
			return fmt.Errorf("invalid argument at index %d: %w", i, err)
		}
	}

	return nil
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

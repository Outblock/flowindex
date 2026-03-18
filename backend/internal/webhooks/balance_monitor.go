package webhooks

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	flowsdk "github.com/onflow/flow-go-sdk"

	"flowscan-clone/internal/config"
	"flowscan-clone/internal/eventbus"
	flowclient "flowscan-clone/internal/flow"
	"flowscan-clone/internal/repository"
)

// BalanceMonitor periodically checks FLOW token balances for subscribed
// addresses and publishes balance.check events to the event bus.
type BalanceMonitor struct {
	bus      *eventbus.Bus
	cache    *SubscriptionCache
	client   *flowclient.Client
	repo     *repository.Repository
	interval time.Duration
	lastSeen map[string]string

	queryFlowBalance  func(ctx context.Context, hexAddr string) (string, error)
	queryTokenBalance func(ctx context.Context, address, contractAddress, contractName string) (string, error)
}

// NewBalanceMonitor creates a BalanceMonitor that checks balances every interval.
func NewBalanceMonitor(
	bus *eventbus.Bus,
	cache *SubscriptionCache,
	client *flowclient.Client,
	repo *repository.Repository,
	interval time.Duration,
) *BalanceMonitor {
	bm := &BalanceMonitor{
		bus:      bus,
		cache:    cache,
		client:   client,
		repo:     repo,
		interval: interval,
		lastSeen: make(map[string]string),
	}
	bm.queryFlowBalance = bm.queryOnChainFlowBalance
	bm.queryTokenBalance = bm.queryIndexedTokenBalance
	return bm
}

// Run starts the periodic balance check loop until context is cancelled.
func (bm *BalanceMonitor) Run(ctx context.Context) {
	log.Printf("[balance_monitor] started (interval=%s)", bm.interval)
	ticker := time.NewTicker(bm.interval)
	defer ticker.Stop()

	// Run once immediately on startup.
	bm.check(ctx)

	for {
		select {
		case <-ctx.Done():
			log.Println("[balance_monitor] shutting down")
			return
		case <-ticker.C:
			bm.check(ctx)
		}
	}
}

// check iterates all balance.check subscriptions, extracts unique addresses,
// queries their FLOW balance, and publishes events.
func (bm *BalanceMonitor) check(ctx context.Context) {
	subs := bm.cache.GetByType("balance.check")
	if len(subs) == 0 {
		return
	}

	targets := extractBalanceTargets(subs)
	if len(targets) == 0 {
		return
	}

	now := time.Now()
	published := 0

	for _, target := range targets {
		balance, err := bm.queryTargetBalance(ctx, target)
		if err != nil {
			log.Printf("[balance_monitor] failed to query balance for %s (%s): %v", target.Address, target.TokenContract, err)
			continue
		}

		key := target.key()
		previousBalance, seen := bm.lastSeen[key]
		bm.lastSeen[key] = balance

		if !seen || previousBalance == balance {
			continue
		}

		data := map[string]interface{}{
			"address":          target.Address,
			"balance":          balance,
			"previous_balance": previousBalance,
			"change":           formatBalanceDelta(previousBalance, balance),
			"token":            target.Symbol,
			"token_contract":   target.TokenContract,
			"contract_address": target.ContractAddress,
			"contract_name":    target.ContractName,
		}

		bm.bus.Publish(eventbus.Event{
			Type:      "balance.check",
			Height:    0,
			Timestamp: now,
			Data:      data,
		})
		published++
	}

	if published > 0 {
		log.Printf("[balance_monitor] published %d balance checks", published)
	}
}

type balanceTarget struct {
	Address         string
	Symbol          string
	TokenContract   string
	ContractAddress string
	ContractName    string
}

func (t balanceTarget) key() string {
	return t.Address + "|" + strings.ToLower(t.TokenContract)
}

func normalizeHexAddress(value string) string {
	return strings.TrimPrefix(strings.ToLower(strings.TrimSpace(value)), "0x")
}

type balanceConditionSet struct {
	Addresses     json.RawMessage `json:"addresses"`
	TokenContract string          `json:"token_contract"`
}

func extractBalanceTargets(subs []Subscription) []balanceTarget {
	targets := make(map[string]balanceTarget)

	for _, sub := range subs {
		var cond balanceConditionSet
		if err := json.Unmarshal(sub.Conditions, &cond); err != nil {
			continue
		}

		token := parseTokenContract(cond.TokenContract)
		for _, addr := range parseBalanceAddresses(cond.Addresses) {
			target := balanceTarget{
				Address:         normalizeHexAddress(addr),
				Symbol:          token.symbol,
				TokenContract:   token.identifier,
				ContractAddress: token.address,
				ContractName:    token.name,
			}
			targets[target.key()] = target
		}
	}

	out := make([]balanceTarget, 0, len(targets))
	for _, target := range targets {
		out = append(out, target)
	}
	return out
}

func parseBalanceAddresses(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}

	var arr []string
	if err := json.Unmarshal(raw, &arr); err == nil {
		return arr
	}

	var single string
	if err := json.Unmarshal(raw, &single); err == nil && single != "" {
		parts := strings.Split(single, ",")
		out := make([]string, 0, len(parts))
		for _, part := range parts {
			part = strings.TrimSpace(part)
			if part != "" {
				out = append(out, part)
			}
		}
		return out
	}

	return nil
}

type parsedTokenContract struct {
	identifier string
	address    string
	name       string
	symbol     string
}

func parseTokenContract(value string) parsedTokenContract {
	raw := strings.TrimSpace(value)
	if raw == "" {
		flowAddress := config.Addr().FlowToken
		return parsedTokenContract{
			identifier: "A." + flowAddress + ".FlowToken",
			address:    flowAddress,
			name:       "FlowToken",
			symbol:     "FLOW",
		}
	}

	raw = strings.Replace(raw, "A.0x", "A.", 1)
	parts := strings.Split(raw, ".")
	if len(parts) >= 3 && strings.EqualFold(parts[0], "A") {
		name := parts[2]
		return parsedTokenContract{
			identifier: "A." + normalizeHexAddress(parts[1]) + "." + name,
			address:    normalizeHexAddress(parts[1]),
			name:       name,
			symbol:     deriveTokenSymbol(name),
		}
	}

	return parsedTokenContract{
		identifier: raw,
		address:    normalizeHexAddress(raw),
		symbol:     strings.ToUpper(raw),
	}
}

func deriveTokenSymbol(contractName string) string {
	switch strings.ToLower(contractName) {
	case "flowtoken":
		return "FLOW"
	case "fiattoken":
		return "USDC"
	case "stflowtoken":
		return "stFLOW"
	default:
		return contractName
	}
}

func formatBalanceDelta(previous, current string) string {
	prev, errPrev := strconv.ParseFloat(previous, 64)
	curr, errCurr := strconv.ParseFloat(current, 64)
	if errPrev != nil || errCurr != nil {
		return ""
	}
	return strconv.FormatFloat(curr-prev, 'f', -1, 64)
}

func (bm *BalanceMonitor) queryTargetBalance(ctx context.Context, target balanceTarget) (string, error) {
	if strings.EqualFold(target.ContractName, "FlowToken") && target.ContractAddress == config.Addr().FlowToken {
		return bm.queryFlowBalance(ctx, target.Address)
	}
	return bm.queryTokenBalance(ctx, target.Address, target.ContractAddress, target.ContractName)
}

// queryOnChainFlowBalance queries the Flow blockchain for the account's FLOW balance.
func (bm *BalanceMonitor) queryOnChainFlowBalance(ctx context.Context, hexAddr string) (string, error) {
	addr := flowsdk.HexToAddress(hexAddr)
	account, err := bm.client.GetAccount(ctx, addr)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%.8f", float64(account.Balance)/100_000_000.0), nil
}

func (bm *BalanceMonitor) queryIndexedTokenBalance(
	ctx context.Context,
	address string,
	contractAddress string,
	contractName string,
) (string, error) {
	if bm.repo == nil {
		return "", fmt.Errorf("repository unavailable for token balance checks")
	}

	holding, err := bm.repo.GetFTHolding(ctx, address, contractAddress, contractName)
	if err != nil {
		return "", err
	}
	if holding == nil {
		return "0", nil
	}
	return holding.Balance, nil
}

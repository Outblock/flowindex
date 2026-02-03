package ingester

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"
)

// MetaWorker builds derived indexes from raw tables (addresses, account keys, contracts).
type MetaWorker struct {
	repo *repository.Repository
}

func NewMetaWorker(repo *repository.Repository) *MetaWorker {
	return &MetaWorker{repo: repo}
}

func (w *MetaWorker) Name() string {
	return "meta_worker"
}

func (w *MetaWorker) ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error {
	txs, err := w.repo.GetRawTransactionsInRange(ctx, fromHeight, toHeight)
	if err != nil {
		return fmt.Errorf("fetch raw txs: %w", err)
	}

	events, err := w.repo.GetRawEventsInRange(ctx, fromHeight, toHeight)
	if err != nil {
		return fmt.Errorf("fetch raw events: %w", err)
	}

	addressTxs, statDeltas := w.buildAddressIndexes(txs)
	accountKeys := w.extractAccountKeys(events)
	contracts := w.extractContracts(events)

	if err := w.repo.UpsertAddressTransactions(ctx, addressTxs); err != nil {
		return err
	}
	if err := w.repo.UpdateAddressStatsBatch(ctx, statDeltas); err != nil {
		return err
	}
	if err := w.repo.UpsertAccountKeys(ctx, accountKeys); err != nil {
		return err
	}
	if err := w.repo.UpsertSmartContracts(ctx, contracts); err != nil {
		return err
	}

	return nil
}

func (w *MetaWorker) buildAddressIndexes(txs []models.Transaction) ([]models.AddressTransaction, []repository.AddressStatDelta) {
	var addressTxs []models.AddressTransaction
	statMap := make(map[string]*repository.AddressStatDelta)

	for _, t := range txs {
		seen := make(map[string]bool)

		addRole := func(addr, role string) {
			normalized := normalizeAddress(addr)
			if normalized == "" {
				return
			}

			addressTxs = append(addressTxs, models.AddressTransaction{
				Address:         normalized,
				TransactionID:   t.ID,
				BlockHeight:     t.BlockHeight,
				TransactionType: "GENERAL",
				Role:            role,
			})

			if !seen[normalized] {
				seen[normalized] = true
				if _, ok := statMap[normalized]; !ok {
					statMap[normalized] = &repository.AddressStatDelta{
						Address: normalized,
					}
				}
				statMap[normalized].TxCount += 1
				statMap[normalized].TotalGasUsed += t.GasUsed
				if t.BlockHeight > statMap[normalized].LastUpdatedBlock {
					statMap[normalized].LastUpdatedBlock = t.BlockHeight
				}
			}
		}

		addRole(t.PayerAddress, "PAYER")
		addRole(t.ProposerAddress, "PROPOSER")
		for _, auth := range t.Authorizers {
			addRole(auth, "AUTHORIZER")
		}
	}

	statDeltas := make([]repository.AddressStatDelta, 0, len(statMap))
	for _, v := range statMap {
		statDeltas = append(statDeltas, *v)
	}

	return addressTxs, statDeltas
}

func (w *MetaWorker) extractAccountKeys(events []models.Event) []models.AccountKey {
	var keys []models.AccountKey
	for _, evt := range events {
		if !strings.Contains(evt.Type, "AccountCreated") && !strings.Contains(evt.Type, "AccountKeyAdded") {
			continue
		}

		var payload map[string]interface{}
		if err := json.Unmarshal(evt.Payload, &payload); err != nil {
			continue
		}

		address := ""
		publicKey := ""

		if addr, ok := payload["address"].(string); ok {
			address = normalizeAddress(addr)
		}

		if pk, ok := payload["publicKey"].(string); ok {
			publicKey = pk
		} else if key, ok := payload["key"].(map[string]interface{}); ok {
			if pk, ok := key["publicKey"].(string); ok {
				publicKey = pk
			}
		}

		if address == "" || publicKey == "" {
			continue
		}

		key := models.AccountKey{
			PublicKey:   publicKey,
			Address:     address,
			BlockHeight: evt.BlockHeight,
		}

		if idx, ok := payload["keyIndex"].(float64); ok {
			key.KeyIndex = int(idx)
		}
		if sa, ok := payload["signingAlgorithm"].(string); ok {
			key.SigningAlgorithm = sa
		}
		if ha, ok := payload["hashingAlgorithm"].(string); ok {
			key.HashingAlgorithm = ha
		}
		if wgt, ok := payload["weight"].(float64); ok {
			key.Weight = int(wgt)
		}

		keys = append(keys, key)
	}
	return keys
}

func (w *MetaWorker) extractContracts(events []models.Event) []models.SmartContract {
	var contracts []models.SmartContract
	for _, evt := range events {
		if !strings.Contains(evt.Type, "AccountContractAdded") && !strings.Contains(evt.Type, "AccountContractUpdated") {
			continue
		}

		var payload map[string]interface{}
		if err := json.Unmarshal(evt.Payload, &payload); err != nil {
			continue
		}

		address, _ := payload["address"].(string)
		name, _ := payload["name"].(string)
		address = normalizeAddress(address)
		if address == "" || name == "" {
			continue
		}

		contracts = append(contracts, models.SmartContract{
			Address:     address,
			Name:        name,
			BlockHeight: evt.BlockHeight,
		})
	}
	return contracts
}

func normalizeAddress(addr string) string {
	normalized := strings.TrimPrefix(strings.ToLower(addr), "0x")
	if normalized == "" {
		return ""
	}
	return normalized
}

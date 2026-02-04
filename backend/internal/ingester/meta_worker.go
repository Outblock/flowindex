package ingester

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
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
		// We materialize a state table of account keys from Flow system events.
		// Note: `flow.AccountKeyRemoved` payload does NOT include the full public key bytes
		// in our JSON-CDC flattening; it includes the key index (often under "publicKey").
		if !strings.Contains(evt.Type, "AccountKeyAdded") && !strings.Contains(evt.Type, "AccountKeyRemoved") {
			continue
		}

		var payload map[string]interface{}
		if err := json.Unmarshal(evt.Payload, &payload); err != nil {
			continue
		}

		address := ""

		if addr, ok := payload["address"].(string); ok {
			address = normalizeAddress(addr)
		}
		if address == "" {
			continue
		}

		if strings.Contains(evt.Type, "AccountKeyRemoved") {
			// Removal: mark revoked by (address, key_index).
			// Payload examples:
			//   {"address":"...","publicKey":"0"}  <-- this is the key index in practice
			keyIdx := -1
			if v, ok := payload["keyIndex"]; ok {
				if n, ok := parseInt(v); ok {
					keyIdx = n
				}
			}
			if keyIdx < 0 {
				if v, ok := payload["publicKey"]; ok {
					if n, ok := parseInt(v); ok {
						keyIdx = n
					}
				}
			}
			if keyIdx < 0 {
				continue
			}

			keys = append(keys, models.AccountKey{
				Address:           address,
				KeyIndex:          keyIdx,
				Revoked:           true,
				RevokedAtHeight:   evt.BlockHeight,
				LastUpdatedHeight: evt.BlockHeight,
			})
			continue
		}

		// AccountKeyAdded: extract full public key + metadata.
		publicKey := extractPublicKey(payload["publicKey"])
		if publicKey == "" {
			if key, ok := payload["key"].(map[string]interface{}); ok {
				publicKey = extractPublicKey(key["publicKey"])
			}
		}
		publicKey = normalizePublicKey(publicKey)

		keyIdx := -1
		if v, ok := payload["keyIndex"]; ok {
			if n, ok := parseInt(v); ok {
				keyIdx = n
			}
		}
		if keyIdx < 0 || publicKey == "" {
			continue
		}

		key := models.AccountKey{
			Address:           address,
			KeyIndex:          keyIdx,
			PublicKey:         publicKey,
			Revoked:           false,
			AddedAtHeight:     evt.BlockHeight,
			LastUpdatedHeight: evt.BlockHeight,
		}

		// Signature algorithm may be under "signingAlgorithm" or inside publicKey struct.
		if sa, ok := payload["signingAlgorithm"].(string); ok {
			key.SigningAlgorithm = sa
		} else if pkObj, ok := payload["publicKey"].(map[string]interface{}); ok {
			if sa, ok := pkObj["signatureAlgorithm"].(string); ok {
				key.SigningAlgorithm = sa
			}
		}

		// Hashing algorithm may be "hashingAlgorithm" or "hashAlgorithm".
		if ha, ok := payload["hashingAlgorithm"].(string); ok {
			key.HashingAlgorithm = ha
		} else if ha, ok := payload["hashAlgorithm"].(string); ok {
			key.HashingAlgorithm = ha
		}

		if v, ok := payload["weight"]; ok {
			if wgt, ok := parseWeightToInt(v); ok {
				key.Weight = wgt
			}
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

func extractPublicKey(v interface{}) string {
	switch vv := v.(type) {
	case string:
		return vv
	case map[string]interface{}:
		// Prefer field publicKey (array of bytes)
		raw, ok := vv["publicKey"]
		if !ok {
			return ""
		}

		var bytes []byte
		switch arr := raw.(type) {
		case []interface{}:
			bytes = make([]byte, 0, len(arr))
			for _, it := range arr {
				switch x := it.(type) {
				case string:
					if n, err := strconv.Atoi(x); err == nil && n >= 0 && n <= 255 {
						bytes = append(bytes, byte(n))
					}
				case float64:
					if x >= 0 && x <= 255 {
						bytes = append(bytes, byte(x))
					}
				}
			}
		case []string:
			bytes = make([]byte, 0, len(arr))
			for _, s := range arr {
				if n, err := strconv.Atoi(s); err == nil && n >= 0 && n <= 255 {
					bytes = append(bytes, byte(n))
				}
			}
		}

		if len(bytes) == 0 {
			return ""
		}

		// Store as lowercase hex. UI can add 0x prefix if desired.
		return fmt.Sprintf("%x", bytes)
	default:
		return ""
	}
}

func normalizePublicKey(pk string) string {
	pk = strings.TrimSpace(pk)
	if pk == "" {
		return ""
	}
	pk = strings.TrimPrefix(strings.ToLower(pk), "0x")
	return pk
}

func parseInt(v interface{}) (int, bool) {
	switch vv := v.(type) {
	case float64:
		return int(vv), true
	case int:
		return vv, true
	case int64:
		return int(vv), true
	case string:
		n, err := strconv.Atoi(vv)
		if err != nil {
			return 0, false
		}
		return n, true
	default:
		return 0, false
	}
}

func parseWeightToInt(v interface{}) (int, bool) {
	switch vv := v.(type) {
	case float64:
		return int(vv), true
	case string:
		if vv == "" {
			return 0, false
		}
		// Common format: "1000.00000000"
		if strings.Contains(vv, ".") {
			f, err := strconv.ParseFloat(vv, 64)
			if err != nil {
				return 0, false
			}
			return int(f), true
		}
		n, err := strconv.Atoi(vv)
		if err != nil {
			return 0, false
		}
		return n, true
	default:
		return 0, false
	}
}

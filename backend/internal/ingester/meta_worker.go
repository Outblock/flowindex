package ingester

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"

	flowclient "flowscan-clone/internal/flow"
	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"

	"github.com/onflow/flow-go-sdk"
)

// MetaWorker builds derived indexes from raw tables (addresses, account keys, contracts).
type MetaWorker struct {
	repo              *repository.Repository
	flow              *flowclient.Client
	storeContractCode bool
}

func NewMetaWorker(repo *repository.Repository, flow *flowclient.Client) *MetaWorker {
	// Default: store contract code, because Flow RPC can return it and many APIs expect it.
	// You can disable this if storage pressure becomes an issue.
	store := strings.ToLower(strings.TrimSpace(os.Getenv("STORE_CONTRACT_CODE")))
	storeContractCode := store == "" || store == "1" || store == "true" || store == "yes"
	return &MetaWorker{repo: repo, flow: flow, storeContractCode: storeContractCode}
}

func (w *MetaWorker) Name() string {
	return "meta_worker"
}

func (w *MetaWorker) ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error {
	// Address lookups and stats are derived entirely from raw.transactions and can be
	// materialized efficiently in SQL. Importantly, the implementation must be idempotent
	// because live/head backfills and range workers may overlap.
	if err := w.repo.BackfillAddressTransactionsAndStatsRange(ctx, fromHeight, toHeight); err != nil {
		return fmt.Errorf("backfill address tx/stats: %w", err)
	}

	events, err := w.repo.GetRawEventsInRange(ctx, fromHeight, toHeight)
	if err != nil {
		return fmt.Errorf("fetch raw events: %w", err)
	}

	accountKeys := w.extractAccountKeys(events)
	contracts := w.extractContracts(ctx, events)
	// UpsertSmartContracts handles code + version; UpsertContractRegistry handles kind/first_seen/last_seen.
	// Both write to the same unified app.smart_contracts table with complementary ON CONFLICT clauses.
	contractRegistry := make([]models.SmartContract, 0, len(contracts))
	for _, c := range contracts {
		if c.Address == "" || c.Name == "" {
			continue
		}
		contractRegistry = append(contractRegistry, models.SmartContract{
			Address:         c.Address,
			Name:            c.Name,
			Kind:            "CONTRACT",
			FirstSeenHeight: c.BlockHeight,
			LastSeenHeight:  c.BlockHeight,
		})
	}

	if err := w.repo.UpsertAccountKeys(ctx, accountKeys); err != nil {
		return err
	}
	if err := w.repo.UpsertSmartContracts(ctx, contracts); err != nil {
		return err
	}
	if err := w.repo.UpsertContractRegistry(ctx, contractRegistry); err != nil {
		return err
	}

	// Opportunistic backfill for existing rows that were created before we started persisting
	// contract code. This is intentionally capped to avoid turning meta_worker into a crawler.
	if w.storeContractCode && w.flow != nil {
		perRange := 10
		if v := strings.TrimSpace(os.Getenv("CONTRACT_CODE_BACKFILL_PER_RANGE")); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n >= 0 {
				perRange = n
			}
		}
		if perRange > 0 {
			_ = w.backfillMissingContractCode(ctx, perRange)
		}
	}

	return nil
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
			address = normalizeFlowAddress(addr)
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
			key.SigningAlgorithm = normalizeSignatureAlgorithm(sa)
		} else if pkObj, ok := payload["publicKey"].(map[string]interface{}); ok {
			if sa, ok := pkObj["signatureAlgorithm"].(string); ok {
				key.SigningAlgorithm = normalizeSignatureAlgorithm(sa)
			}
		}

		// Hashing algorithm may be "hashingAlgorithm" or "hashAlgorithm".
		if ha, ok := payload["hashingAlgorithm"].(string); ok {
			key.HashingAlgorithm = normalizeHashAlgorithm(ha)
		} else if ha, ok := payload["hashAlgorithm"].(string); ok {
			key.HashingAlgorithm = normalizeHashAlgorithm(ha)
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

func (w *MetaWorker) extractContracts(ctx context.Context, events []models.Event) []models.SmartContract {
	type contractEvent struct {
		address string
		name    string
		height  uint64
		code    string
	}

	var extracted []contractEvent
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
		code, _ := payload["code"].(string) // some nodes/decoders may include this directly
		if name == "" {
			if v, ok := payload["contract"].(string); ok {
				name = v
			}
		}
		if name == "" {
			if v, ok := payload["contractName"].(string); ok {
				name = v
			}
		}
		address = normalizeFlowAddress(address)
		if address == "" || name == "" {
			continue
		}

		extracted = append(extracted, contractEvent{
			address: address,
			name:    name,
			height:  evt.BlockHeight,
			code:    code,
		})
	}

	// Best-effort: fetch contract source from Access API at the block height where it was
	// added/updated. This makes /flow/v1/contract return a non-empty "body".
	if w.storeContractCode && w.flow != nil {
		type key struct {
			addr   string
			height uint64
		}
		cache := make(map[key]map[string][]byte)
		for i := range extracted {
			if extracted[i].code != "" {
				continue
			}
			k := key{addr: extracted[i].address, height: extracted[i].height}
			contracts, ok := cache[k]
			if !ok {
				acc, err := w.flow.GetAccountAtBlockHeight(ctx, flow.HexToAddress(extracted[i].address), extracted[i].height)
				if err != nil || acc == nil {
					cache[k] = nil
					continue
				}
				cache[k] = acc.Contracts
				contracts = acc.Contracts
			}
			if contracts == nil {
				continue
			}
			if b, ok := contracts[extracted[i].name]; ok && len(b) > 0 {
				extracted[i].code = string(b)
			}
		}
	}

	out := make([]models.SmartContract, 0, len(extracted))
	for _, c := range extracted {
		out = append(out, models.SmartContract{
			Address:     c.address,
			Name:        c.name,
			Code:        c.code,
			BlockHeight: c.height,
		})
	}
	return out
}

func (w *MetaWorker) backfillMissingContractCode(ctx context.Context, limit int) error {
	missing, err := w.repo.ListSmartContractsMissingCode(ctx, limit)
	if err != nil {
		return err
	}
	for _, c := range missing {
		if c.Address == "" || c.Name == "" || c.BlockHeight == 0 {
			continue
		}
		acc, err := w.flow.GetAccountAtBlockHeight(ctx, flow.HexToAddress(c.Address), c.BlockHeight)
		if err != nil || acc == nil {
			continue
		}
		b := acc.Contracts[c.Name]
		if len(b) == 0 {
			continue
		}
		if err := w.repo.UpdateSmartContractCodeIfEmpty(ctx, c.Address, c.Name, string(b)); err != nil {
			continue
		}
	}
	return nil
}

func normalizeAddress(addr string) string {
	return normalizeFlowAddress(addr)
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

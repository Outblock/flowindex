package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"flowscan-clone/internal/flow"
	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"

	"github.com/onflow/cadence"
	flowsdk "github.com/onflow/flow-go-sdk"
)

func main() {
	var (
		startHeight uint64
		endHeight   uint64
		batchBlocks int
		workers     int
		dryRun      bool
	)

	flag.Uint64Var(&startHeight, "start", getEnvUint("BACKFILL_START", 0), "start block height (inclusive)")
	flag.Uint64Var(&endHeight, "end", getEnvUint("BACKFILL_END", 0), "end block height (inclusive)")
	flag.IntVar(&batchBlocks, "batch", getEnvInt("BACKFILL_BATCH_BLOCKS", 1000), "blocks per batch")
	flag.IntVar(&workers, "workers", getEnvInt("BACKFILL_WORKERS", 50), "concurrent tx workers")
	flag.BoolVar(&dryRun, "dry-run", getEnvBool("BACKFILL_DRY_RUN", false), "dry run (no writes)")
	flag.Parse()

	if startHeight == 0 || endHeight == 0 {
		log.Fatal("BACKFILL_START and BACKFILL_END are required")
	}
	if batchBlocks <= 0 {
		batchBlocks = 1000
	}
	if workers <= 0 {
		workers = 50
	}

	dbURL := os.Getenv("DB_URL")
	if dbURL == "" {
		log.Fatal("DB_URL is required")
	}
	flowURL := os.Getenv("FLOW_ACCESS_NODE")
	if flowURL == "" {
		flowURL = "access-001.mainnet28.nodes.onflow.org:9000"
	}

	repo, err := repository.NewRepository(dbURL)
	if err != nil {
		log.Fatalf("failed to connect to db: %v", err)
	}
	defer repo.Close()

	client, err := flow.NewClient(flowURL)
	if err != nil {
		log.Fatalf("failed to connect to flow: %v", err)
	}
	defer client.Close()

	log.Printf("token backfill start=%d end=%d batch=%d workers=%d dry_run=%v", startHeight, endHeight, batchBlocks, workers, dryRun)

	ctx := context.Background()
	startTime := time.Now()
	processed := 0
	if startHeight <= endHeight {
		for current := startHeight; current <= endHeight; {
			batchFrom := current
			batchTo := current + uint64(batchBlocks) - 1
			if batchTo > endHeight {
				batchTo = endHeight
			}

			log.Printf("backfill range %d -> %d", batchFrom, batchTo)
			start := time.Now()

			txs, err := repo.GetRawTransactionsInRange(ctx, batchFrom, batchTo+1)
			if err != nil {
				log.Printf("failed to fetch txs: %v", err)
				current = batchTo + 1
				continue
			}
			if len(txs) == 0 {
				processed++
				current = batchTo + 1
				continue
			}

			transfers, err := fetchTokenTransfers(ctx, client, txs, workers)
			if err != nil {
				log.Printf("failed to fetch token transfers: %v", err)
				current = batchTo + 1
				continue
			}

			if !dryRun && len(transfers) > 0 {
				minH, maxH := transfers[0].BlockHeight, transfers[0].BlockHeight
				for _, t := range transfers[1:] {
					if t.BlockHeight < minH {
						minH = t.BlockHeight
					}
					if t.BlockHeight > maxH {
						maxH = t.BlockHeight
					}
				}
				if err := repo.EnsureAppPartitions(ctx, minH, maxH); err != nil {
					log.Printf("ensure partitions failed: %v", err)
					current = batchTo + 1
					continue
				}
				if err := repo.UpsertTokenTransfers(ctx, transfers); err != nil {
					log.Printf("upsert token transfers failed: %v", err)
					current = batchTo + 1
					continue
				}
			}

			processed++
			log.Printf("range done: transfers=%d elapsed=%s", len(transfers), time.Since(start).Truncate(time.Millisecond))

			if batchTo == endHeight {
				break
			}
			current = batchTo + 1
		}
	} else {
		for current := startHeight; ; {
			batchFrom := current
			var batchTo uint64
			if current >= uint64(batchBlocks) {
				batchTo = current - uint64(batchBlocks) + 1
			} else {
				batchTo = 0
			}
			if batchTo < endHeight {
				batchTo = endHeight
			}

			log.Printf("backfill range %d -> %d", batchTo, batchFrom)
			start := time.Now()

			txs, err := repo.GetRawTransactionsInRange(ctx, batchTo, batchFrom+1)
			if err != nil {
				log.Printf("failed to fetch txs: %v", err)
				if batchTo == endHeight || batchTo == 0 {
					break
				}
				current = batchTo - 1
				continue
			}
			if len(txs) == 0 {
				processed++
				if batchTo == endHeight || batchTo == 0 {
					break
				}
				current = batchTo - 1
				continue
			}

			transfers, err := fetchTokenTransfers(ctx, client, txs, workers)
			if err != nil {
				log.Printf("failed to fetch token transfers: %v", err)
				if batchTo == endHeight || batchTo == 0 {
					break
				}
				current = batchTo - 1
				continue
			}

			if !dryRun && len(transfers) > 0 {
				minH, maxH := transfers[0].BlockHeight, transfers[0].BlockHeight
				for _, t := range transfers[1:] {
					if t.BlockHeight < minH {
						minH = t.BlockHeight
					}
					if t.BlockHeight > maxH {
						maxH = t.BlockHeight
					}
				}
				if err := repo.EnsureAppPartitions(ctx, minH, maxH); err != nil {
					log.Printf("ensure partitions failed: %v", err)
					if batchTo == endHeight || batchTo == 0 {
						break
					}
					current = batchTo - 1
					continue
				}
				if err := repo.UpsertTokenTransfers(ctx, transfers); err != nil {
					log.Printf("upsert token transfers failed: %v", err)
					if batchTo == endHeight || batchTo == 0 {
						break
					}
					current = batchTo - 1
					continue
				}
			}

			processed++
			log.Printf("range done: transfers=%d elapsed=%s", len(transfers), time.Since(start).Truncate(time.Millisecond))

			if batchTo == endHeight || batchTo == 0 {
				break
			}
			current = batchTo - 1
		}
	}

	log.Printf("backfill finished batches=%d total_elapsed=%s", processed, time.Since(startTime).Truncate(time.Millisecond))
}

func fetchTokenTransfers(ctx context.Context, client *flow.Client, txs []models.Transaction, workers int) ([]models.TokenTransfer, error) {
	jobs := make(chan models.Transaction, len(txs))
	var wg sync.WaitGroup
	var mu sync.Mutex
	transfers := make([]models.TokenTransfer, 0)

	worker := func() {
		defer wg.Done()
		for tx := range jobs {
			res, err := client.GetTransactionResult(ctx, flowsdk.HexToID(tx.ID))
			if err != nil {
				log.Printf("tx result error %s: %v", tx.ID, err)
				continue
			}
			for _, evt := range res.Events {
				isToken, isNFT := classifyTokenEvent(evt.Type)
				if !isToken {
					continue
				}

				payload := flattenCadenceValue(evt.Value)
				payloadJSON, _ := json.Marshal(payload)

				m := models.Event{
					TransactionID:    tx.ID,
					BlockHeight:      tx.BlockHeight,
					TransactionIndex: tx.TransactionIndex,
					EventIndex:       evt.EventIndex,
					Type:             evt.Type,
					Payload:          payloadJSON,
					Timestamp:        tx.Timestamp,
				}

				transfer := parseTokenEvent(m, isNFT)
				if transfer == nil {
					continue
				}
				mu.Lock()
				transfers = append(transfers, *transfer)
				mu.Unlock()
			}
		}
	}

	if workers < 1 {
		workers = 1
	}
	wg.Add(workers)
	for i := 0; i < workers; i++ {
		go worker()
	}

	for _, tx := range txs {
		jobs <- tx
	}
	close(jobs)
	wg.Wait()

	return transfers, nil
}

func classifyTokenEvent(eventType string) (bool, bool) {
	if strings.Contains(eventType, "NonFungibleToken.") &&
		(strings.Contains(eventType, ".Deposited") || strings.Contains(eventType, ".Withdrawn")) {
		return true, true
	}
	if strings.Contains(eventType, "FungibleToken.") &&
		(strings.Contains(eventType, ".Deposited") || strings.Contains(eventType, ".Withdrawn")) {
		return true, false
	}
	if strings.Contains(eventType, ".TokensDeposited") || strings.Contains(eventType, ".TokensWithdrawn") {
		return true, false
	}
	return false, false
}

func parseTokenEvent(evt models.Event, isNFT bool) *models.TokenTransfer {
	fields, ok := parseCadenceEventFields(evt.Payload)
	if !ok {
		return nil
	}

	amount := extractString(fields["amount"])
	toAddr := extractAddress(fields["to"])
	fromAddr := extractAddress(fields["from"])
	tokenID := extractString(fields["id"])
	if tokenID == "" {
		tokenID = extractString(fields["tokenId"])
	}

	contractAddr := normalizeTokenAddress(evt.ContractAddress)
	if contractAddr == "" {
		contractAddr = parseContractAddress(evt.Type)
	}

	if isNFT {
		if amount == "" {
			amount = "1"
		}
	} else if amount == "" {
		return nil
	}

	if toAddr == "" && fromAddr == "" {
		return nil
	}

	return &models.TokenTransfer{
		TransactionID:        evt.TransactionID,
		BlockHeight:          evt.BlockHeight,
		EventIndex:           evt.EventIndex,
		TokenContractAddress: contractAddr,
		FromAddress:          fromAddr,
		ToAddress:            toAddr,
		Amount:               amount,
		TokenID:              tokenID,
		IsNFT:                isNFT,
		Timestamp:            evt.Timestamp,
	}
}

func parseCadenceEventFields(payload []byte) (map[string]interface{}, bool) {
	var root map[string]interface{}
	if err := json.Unmarshal(payload, &root); err != nil {
		return nil, false
	}

	if _, ok := root["amount"]; ok {
		return root, true
	}

	val, ok := root["value"].(map[string]interface{})
	if !ok {
		return root, true
	}

	fields, ok := val["fields"].([]interface{})
	if !ok {
		return root, true
	}

	out := make(map[string]interface{}, len(fields))
	for _, f := range fields {
		field, ok := f.(map[string]interface{})
		if !ok {
			continue
		}
		name, _ := field["name"].(string)
		if name == "" {
			continue
		}
		out[name] = parseCadenceValue(field["value"])
	}
	return out, true
}

func parseCadenceValue(v interface{}) interface{} {
	switch val := v.(type) {
	case map[string]interface{}:
		typeName, _ := val["type"].(string)
		raw := val["value"]

		switch typeName {
		case "Optional":
			if raw == nil {
				return nil
			}
			return parseCadenceValue(raw)
		case "Address":
			if s, ok := raw.(string); ok {
				return s
			}
			return raw
		case "UFix64", "UInt64", "UInt32", "UInt16", "UInt8", "Int", "Int64", "Int32", "Int16", "Int8", "Fix64":
			if s, ok := raw.(string); ok {
				return s
			}
			return raw
		case "String", "Bool":
			return raw
		case "Array":
			if arr, ok := raw.([]interface{}); ok {
				out := make([]interface{}, 0, len(arr))
				for _, item := range arr {
					out = append(out, parseCadenceValue(item))
				}
				return out
			}
			return raw
		case "Dictionary":
			if arr, ok := raw.([]interface{}); ok {
				out := make(map[string]interface{}, len(arr))
				for _, item := range arr {
					entry, ok := item.(map[string]interface{})
					if !ok {
						continue
					}
					k := parseCadenceValue(entry["key"])
					v := parseCadenceValue(entry["value"])
					out[fmt.Sprintf("%v", k)] = v
				}
				return out
			}
			return raw
		case "Struct", "Resource", "Event":
			if obj, ok := raw.(map[string]interface{}); ok {
				if fields, ok := obj["fields"].([]interface{}); ok {
					out := make(map[string]interface{}, len(fields))
					for _, f := range fields {
						field, ok := f.(map[string]interface{})
						if !ok {
							continue
						}
						name, _ := field["name"].(string)
						if name == "" {
							continue
						}
						out[name] = parseCadenceValue(field["value"])
					}
					return out
				}
			}
			return raw
		default:
			return raw
		}
	default:
		return val
	}
}

func flattenCadenceValue(v cadence.Value) interface{} {
	if v == nil {
		return nil
	}
	switch val := v.(type) {
	case cadence.Event:
		m := make(map[string]interface{})
		fields := val.FieldsMappedByName()
		for name, fieldVal := range fields {
			m[name] = flattenCadenceValue(fieldVal)
		}
		return m
	case cadence.Struct:
		m := make(map[string]interface{})
		fields := val.FieldsMappedByName()
		for name, fieldVal := range fields {
			m[name] = flattenCadenceValue(fieldVal)
		}
		return m
	case cadence.Dictionary:
		m := make(map[string]interface{})
		for _, pair := range val.Pairs {
			key := fmt.Sprintf("%v", flattenCadenceValue(pair.Key))
			m[key] = flattenCadenceValue(pair.Value)
		}
		return m
	case cadence.Array:
		out := make([]interface{}, 0, len(val.Values))
		for _, item := range val.Values {
			out = append(out, flattenCadenceValue(item))
		}
		return out
	case cadence.Optional:
		if val.Value == nil {
			return nil
		}
		return flattenCadenceValue(val.Value)
	case cadence.Address:
		return val.String()
	case cadence.String:
		return string(val)
	case cadence.Bool:
		return bool(val)
	case cadence.Int:
		return val.String()
	case cadence.Int8:
		return val.String()
	case cadence.Int16:
		return val.String()
	case cadence.Int32:
		return val.String()
	case cadence.Int64:
		return val.String()
	case cadence.UInt:
		return val.String()
	case cadence.UInt8:
		return val.String()
	case cadence.UInt16:
		return val.String()
	case cadence.UInt32:
		return val.String()
	case cadence.UInt64:
		return val.String()
	case cadence.UFix64:
		return val.String()
	case cadence.Fix64:
		return val.String()
	default:
		return fmt.Sprintf("%v", val)
	}
}

func extractString(v interface{}) string {
	switch val := v.(type) {
	case string:
		return val
	case json.Number:
		return val.String()
	case float64:
		return fmt.Sprintf("%f", val)
	default:
		return ""
	}
}

func extractAddress(v interface{}) string {
	switch val := v.(type) {
	case string:
		return normalizeTokenAddress(val)
	case map[string]interface{}:
		if addr, ok := val["address"]; ok {
			return normalizeTokenAddress(extractString(addr))
		}
	}
	return normalizeTokenAddress(extractString(v))
}

func normalizeTokenAddress(addr string) string {
	return strings.TrimPrefix(strings.ToLower(addr), "0x")
}

func parseContractAddress(eventType string) string {
	parts := strings.Split(eventType, ".")
	if len(parts) >= 3 && parts[0] == "A" {
		return strings.TrimPrefix(strings.ToLower(parts[1]), "0x")
	}
	return ""
}

func getEnvInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil {
			return parsed
		}
	}
	return def
}

func getEnvUint(key string, def uint64) uint64 {
	if v := os.Getenv(key); v != "" {
		if parsed, err := strconv.ParseUint(v, 10, 64); err == nil {
			return parsed
		}
	}
	return def
}

func getEnvBool(key string, def bool) bool {
	if v := os.Getenv(key); v != "" {
		return v == "true" || v == "1"
	}
	return def
}

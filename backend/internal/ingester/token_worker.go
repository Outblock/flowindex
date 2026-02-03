package ingester

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"
)

type TokenWorker struct {
	repo *repository.Repository
}

func NewTokenWorker(repo *repository.Repository) *TokenWorker {
	return &TokenWorker{repo: repo}
}

func (w *TokenWorker) Name() string {
	return "token_worker"
}

func (w *TokenWorker) ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error {
	// 1. Fetch Raw Events
	events, err := w.repo.GetRawEventsInRange(ctx, fromHeight, toHeight)
	if err != nil {
		return fmt.Errorf("failed to fetch raw events: %w", err)
	}

	var transfers []models.TokenTransfer

	// 2. Parse Events
	for _, evt := range events {
		// Filter for Token events
		if isToken, isNFT := classifyTokenEvent(evt.Type); isToken {
			transfer := w.parseTokenEvent(evt, isNFT)
			if transfer != nil {
				transfers = append(transfers, *transfer)
			}
		}
	}

	// 3. Upsert to App DB
	if len(transfers) > 0 {
		minH := transfers[0].BlockHeight
		maxH := transfers[0].BlockHeight
		for _, t := range transfers[1:] {
			if t.BlockHeight < minH {
				minH = t.BlockHeight
			}
			if t.BlockHeight > maxH {
				maxH = t.BlockHeight
			}
		}
		if err := w.repo.EnsureAppPartitions(ctx, minH, maxH); err != nil {
			return fmt.Errorf("failed to ensure token partitions: %w", err)
		}
		if err := w.repo.UpsertTokenTransfers(ctx, transfers); err != nil {
			return fmt.Errorf("failed to upsert transfers: %w", err)
		}
	}

	return nil
}

// parseTokenEvent parses a raw event into a TokenTransfer model
func (w *TokenWorker) parseTokenEvent(evt models.Event, isNFT bool) *models.TokenTransfer {
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

func parseCadenceEventFields(payload []byte) (map[string]interface{}, bool) {
	var root map[string]interface{}
	if err := json.Unmarshal(payload, &root); err != nil {
		return nil, false
	}

	// Already flattened
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

package ingester

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
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

	var ftTransfers []models.TokenTransfer
	var nftTransfers []models.TokenTransfer
	ftTokens := make(map[string]models.FTToken)
	nftCollections := make(map[string]models.NFTCollection)
	contracts := make(map[string]models.Contract)

	// 2. Parse Events
	for _, evt := range events {
		// Filter for Token events
		if isToken, isNFT := classifyTokenEvent(evt.Type); isToken {
			transfer := w.parseTokenEvent(evt, isNFT)
			if transfer != nil {
				if transfer.IsNFT {
					nftTransfers = append(nftTransfers, *transfer)
				} else {
					ftTransfers = append(ftTransfers, *transfer)
				}
				contractAddr := strings.TrimSpace(transfer.TokenContractAddress)
				contractName := strings.TrimSpace(transfer.ContractName)
				if contractAddr != "" && contractName != "" && !isWrapperContractName(contractName) {
					key := contractAddr + ":" + contractName
					if isNFT {
						nftCollections[key] = models.NFTCollection{
							ContractAddress: contractAddr,
							ContractName:    contractName,
						}
						contracts[key] = models.Contract{
							ID:              formatContractIdentifier(contractAddr, contractName),
							Address:         contractAddr,
							Name:            contractName,
							Kind:            "NFT",
							FirstSeenHeight: transfer.BlockHeight,
							LastSeenHeight:  transfer.BlockHeight,
						}
					} else {
						ftTokens[key] = models.FTToken{
							ContractAddress: contractAddr,
							ContractName:    contractName,
						}
						contracts[key] = models.Contract{
							ID:              formatContractIdentifier(contractAddr, contractName),
							Address:         contractAddr,
							Name:            contractName,
							Kind:            "FT",
							FirstSeenHeight: transfer.BlockHeight,
							LastSeenHeight:  transfer.BlockHeight,
						}
					}
				}
			}
		}
	}

	// 3. Upsert to App DB
	if len(ftTransfers) > 0 || len(nftTransfers) > 0 {
		minH, maxH := uint64(0), uint64(0)
		if len(ftTransfers) > 0 {
			minH = ftTransfers[0].BlockHeight
			maxH = ftTransfers[0].BlockHeight
			for _, t := range ftTransfers[1:] {
				if t.BlockHeight < minH {
					minH = t.BlockHeight
				}
				if t.BlockHeight > maxH {
					maxH = t.BlockHeight
				}
			}
		}
		if len(nftTransfers) > 0 {
			if minH == 0 || nftTransfers[0].BlockHeight < minH {
				minH = nftTransfers[0].BlockHeight
			}
			if nftTransfers[0].BlockHeight > maxH {
				maxH = nftTransfers[0].BlockHeight
			}
			for _, t := range nftTransfers[1:] {
				if t.BlockHeight < minH {
					minH = t.BlockHeight
				}
				if t.BlockHeight > maxH {
					maxH = t.BlockHeight
				}
			}
		}
		if err := w.repo.EnsureAppPartitions(ctx, minH, maxH); err != nil {
			return fmt.Errorf("failed to ensure token partitions: %w", err)
		}
	}
	if len(ftTransfers) > 0 {
		if err := w.repo.UpsertFTTransfers(ctx, ftTransfers); err != nil {
			return fmt.Errorf("failed to upsert ft transfers: %w", err)
		}
	}
	if len(nftTransfers) > 0 {
		if err := w.repo.UpsertNFTTransfers(ctx, nftTransfers); err != nil {
			return fmt.Errorf("failed to upsert nft transfers: %w", err)
		}
	}
	if len(ftTokens) > 0 {
		out := make([]models.FTToken, 0, len(ftTokens))
		for _, t := range ftTokens {
			out = append(out, t)
		}
		if err := w.repo.UpsertFTTokens(ctx, out); err != nil {
			return fmt.Errorf("failed to upsert ft tokens: %w", err)
		}
	}
	if len(nftCollections) > 0 {
		out := make([]models.NFTCollection, 0, len(nftCollections))
		for _, c := range nftCollections {
			out = append(out, c)
		}
		if err := w.repo.UpsertNFTCollections(ctx, out); err != nil {
			return fmt.Errorf("failed to upsert nft collections: %w", err)
		}
	}
	if len(contracts) > 0 {
		out := make([]models.Contract, 0, len(contracts))
		for _, c := range contracts {
			out = append(out, c)
		}
		if err := w.repo.UpsertContracts(ctx, out); err != nil {
			return fmt.Errorf("failed to upsert contracts registry: %w", err)
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
	toAddr := extractAddressFromFields(fields, "to", "toAddress", "recipient", "receiver", "toAccount", "toAddr", "to_address", "depositTo", "depositedTo", "toVault", "newOwner", "account")
	fromAddr := extractAddressFromFields(fields, "from", "fromAddress", "sender", "fromAccount", "fromAddr", "from_address", "withdrawnFrom", "withdrawFrom", "fromVault", "burnedFrom", "owner", "account")
	tokenID := extractString(fields["id"])
	if tokenID == "" {
		tokenID = extractString(fields["tokenId"])
	}

	contractAddr := normalizeFlowAddress(evt.ContractAddress)
	if contractAddr == "" {
		contractAddr = parseContractAddress(evt.Type)
	}
	contractName := parseContractName(evt.Type)

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

	if !includeFeeTransfers() {
		if isFeeVaultAddress(fromAddr) || isFeeVaultAddress(toAddr) {
			return nil
		}
	}

	return &models.TokenTransfer{
		TransactionID:        evt.TransactionID,
		BlockHeight:          evt.BlockHeight,
		EventIndex:           evt.EventIndex,
		TokenContractAddress: contractAddr,
		ContractName:         contractName,
		FromAddress:          fromAddr,
		ToAddress:            toAddr,
		Amount:               amount,
		TokenID:              tokenID,
		IsNFT:                isNFT,
		Timestamp:            evt.Timestamp,
	}
}

func includeFeeTransfers() bool {
	return strings.ToLower(strings.TrimSpace(os.Getenv("INCLUDE_FEE_TRANSFERS"))) == "true"
}

func isFeeVaultAddress(addr string) bool {
	feeVault := strings.ToLower(strings.TrimSpace(os.Getenv("FLOW_FEES_ADDRESS")))
	if feeVault == "" {
		feeVault = "f919ee77447b7497"
	}
	feeVault = strings.TrimPrefix(feeVault, "0x")

	normalized := normalizeFlowAddress(addr)
	return normalized != "" && normalized == feeVault
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
	// Many NFT collections emit transfer events as "<Collection>.Deposit"/"<Collection>.Withdraw".
	if strings.HasSuffix(eventType, ".Deposit") || strings.HasSuffix(eventType, ".Withdraw") {
		return true, true
	}
	if strings.Contains(eventType, ".TokensDeposited") || strings.Contains(eventType, ".TokensWithdrawn") {
		return true, false
	}
	// Some FT contracts emit "<Token>.Deposited"/"<Token>.Withdrawn" (e.g. FiatToken).
	if strings.HasSuffix(eventType, ".Deposited") || strings.HasSuffix(eventType, ".Withdrawn") {
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
		return normalizeFlowAddress(val)
	case map[string]interface{}:
		if addr, ok := val["address"]; ok {
			return normalizeFlowAddress(extractString(addr))
		}
		if t, ok := val["type"].(string); ok {
			switch t {
			case "Optional":
				return extractAddress(val["value"])
			case "Address":
				return normalizeFlowAddress(extractString(val["value"]))
			}
		}
		if inner, ok := val["value"].(map[string]interface{}); ok {
			return extractAddress(inner)
		}
		if raw, ok := val["value"]; ok {
			return normalizeFlowAddress(extractString(raw))
		}
	}
	return normalizeFlowAddress(extractString(v))
}

func extractAddressFromFields(fields map[string]interface{}, keys ...string) string {
	for _, key := range keys {
		if v, ok := fields[key]; ok {
			if addr := extractAddress(v); addr != "" {
				return addr
			}
		}
	}
	return ""
}

func parseContractAddress(eventType string) string {
	parts := strings.Split(eventType, ".")
	if len(parts) >= 3 && parts[0] == "A" {
		return normalizeFlowAddress(parts[1])
	}
	return ""
}

func parseContractName(eventType string) string {
	parts := strings.Split(eventType, ".")
	if len(parts) >= 3 && parts[0] == "A" {
		return strings.TrimSpace(parts[2])
	}
	return ""
}

func isWrapperContractName(name string) bool {
	switch name {
	case "FungibleToken", "NonFungibleToken":
		return true
	default:
		return false
	}
}

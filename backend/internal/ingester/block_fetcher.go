package ingester

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"flowscan-clone/internal/flow"
	"flowscan-clone/internal/models"

	"github.com/onflow/cadence"
)

// FetchResult holds the data for a single block height
type FetchResult struct {
	Height          uint64
	Block           *models.Block
	Transactions    []models.Transaction
	Events          []models.Event
	AddressActivity []models.AddressTransaction
	TokenTransfers  []models.TokenTransfer
	AccountKeys     []models.AccountKey
	Error           error
}

// Worker is a stateless helper to fetch data for one height
type Worker struct {
	client *flow.Client
}

func NewWorker(client *flow.Client) *Worker {
	return &Worker{client: client}
}

// FetchBlockData fetches everything for a given height
func (w *Worker) FetchBlockData(ctx context.Context, height uint64) *FetchResult {
	result := &FetchResult{Height: height}

	// We pin all RPC calls for a given height to the same access node so that
	// block -> collection -> tx/result lookups stay consistent across sporks.
	const maxPinAttempts = 12

	shouldRepin := func(err error) bool {
		var sporkErr *flow.SporkRootNotFoundError
		if errors.As(err, &sporkErr) {
			return true
		}
		var nodeErr *flow.NodeUnavailableError
		if errors.As(err, &nodeErr) {
			return true
		}
		return false
	}

	for pinAttempt := 0; pinAttempt < maxPinAttempts; pinAttempt++ {
		pin, err := w.client.PinByHeight(height)
		if err != nil {
			result.Error = fmt.Errorf("failed to pin flow client for height %d: %w", height, err)
			return result
		}

		// 1. Get Block & Collections
		block, collections, err := pin.GetBlockByHeight(ctx, height)
		if err != nil {
			if shouldRepin(err) {
				continue
			}
			result.Error = fmt.Errorf("failed to get block %d: %w", height, err)
			return result
		}

		collGuarantees, _ := json.Marshal(block.CollectionGuarantees)
		blockSeals, _ := json.Marshal(block.Seals)
		signatures, _ := json.Marshal(block.Signatures)

		dbBlock := models.Block{
			Height:               block.Height,
			ID:                   block.ID.String(),
			ParentID:             block.ParentID.String(),
			Timestamp:            block.Timestamp,
			CollectionCount:      len(block.CollectionGuarantees),
			StateRootHash:        block.ID.String(), // Fallback
			CollectionGuarantees: collGuarantees,
			BlockSeals:           blockSeals,
			Signatures:           signatures,
			BlockStatus:          "BLOCK_SEALED", // Default for indexed blocks
			IsSealed:             true,
		}

		var dbTxs []models.Transaction
		var dbEvents []models.Event

		// 2. Process Collections & Transactions
		repin := false
		txIndex := 0
		for _, collection := range collections {
			for _, txID := range collection.TransactionIDs {
				// Fetch Transaction (pinned)
				tx, err := pin.GetTransaction(ctx, txID)
				if err != nil {
					if shouldRepin(err) {
						repin = true
						break
					}
					// Retry or skip? For now, we error out to be safe in the pipeline
					result.Error = fmt.Errorf("failed to get tx %s: %w", txID, err)
					return result
				}

				// Fetch Result (Status & Events) (pinned)
				res, err := pin.GetTransactionResult(ctx, txID)
				if err != nil {
					if shouldRepin(err) {
						repin = true
						break
					}
					result.Error = fmt.Errorf("failed to get tx result %s: %w", txID, err)
					return result
				}

				// Map to DB Models
				// tx.Arguments is [][]byte, where each byte slice is a JSON-CDC string.
				// defaults json.Marshal would base64 encode them. We want the raw JSON strings in an array.
				var argsList []json.RawMessage
				for _, arg := range tx.Arguments {
					argsList = append(argsList, json.RawMessage(arg))
				}
				argsJSON, _ := json.Marshal(argsList)
				authorizers := make([]string, len(tx.Authorizers))
				for i, a := range tx.Authorizers {
					authorizers[i] = a.Hex()
				}

				// Detect EVM in Script
				isEVM := strings.Contains(string(tx.Script), "import EVM")

				dbTx := models.Transaction{
					ID:                     tx.ID().String(),
					BlockHeight:            height,
					TransactionIndex:       txIndex,
					ProposerAddress:        tx.ProposalKey.Address.Hex(),
					ProposerKeyIndex:       tx.ProposalKey.KeyIndex,
					ProposerSequenceNumber: tx.ProposalKey.SequenceNumber,
					PayerAddress:           tx.Payer.Hex(),
					Authorizers:            authorizers,
					Script:                 string(tx.Script),
					Arguments:              argsJSON,
					Status:                 res.Status.String(),
					GasLimit:               tx.GasLimit,
					ComputationUsage:       res.ComputationUsage,
					StatusCode:             0, // Not directly available in SDK TransactionResult
					ExecutionStatus:        res.Status.String(),
					EventCount:             len(res.Events),
					Timestamp:              block.Timestamp,
				}

				// Redundancy: Marshal Signatures and ProposalKey
				pkJSON, _ := json.Marshal(tx.ProposalKey)
				pSigJSON, _ := json.Marshal(tx.PayloadSignatures)
				eSigJSON, _ := json.Marshal(tx.EnvelopeSignatures)

				dbTx.ReferenceBlockID = tx.ReferenceBlockID.String()
				dbTx.ProposalKey = pkJSON
				dbTx.PayloadSignatures = pSigJSON
				dbTx.EnvelopeSignatures = eSigJSON

				if res.Error != nil {
					dbTx.ErrorMessage = res.Error.Error()
				}

				// Address Activity (Participants)
				// This is used for the account transactions page. We write it for forward ingestion
				// so the UI stays fresh even if meta_worker is processing in large ranges.
				seenActivity := make(map[string]bool)
				addActivity := func(addr, role string) {
					normalized := normalizeAddress(addr)
					if normalized == "" {
						return
					}
					k := normalized + "|" + role
					if seenActivity[k] {
						return
					}
					seenActivity[k] = true
					result.AddressActivity = append(result.AddressActivity, models.AddressTransaction{
						Address:         normalized,
						TransactionID:   tx.ID().String(),
						BlockHeight:     height,
						TransactionType: "GENERAL",
						Role:            role,
					})
				}

				addActivity(tx.Payer.Hex(), "PAYER")
				addActivity(tx.ProposalKey.Address.Hex(), "PROPOSER")
				for _, auth := range tx.Authorizers {
					addActivity(auth.Hex(), "AUTHORIZER")
				}

				// Process Events
				for _, evt := range res.Events {
					payload := w.flattenCadenceValue(evt.Value)
					payloadJSON, _ := json.Marshal(payload)

					addrStr, contractStr, eventStr := w.parseEventType(evt.Type)

					dbEvent := models.Event{
						TransactionID:    tx.ID().String(),
						TransactionIndex: txIndex,
						Type:             evt.Type,
						EventIndex:       evt.EventIndex,
						ContractAddress:  addrStr,
						ContractName:     contractStr,
						EventName:        eventStr,
						Payload:          payloadJSON,
						BlockHeight:      height,
						Timestamp:        block.Timestamp,
						CreatedAt:        time.Now(),
					}
					dbEvents = append(dbEvents, dbEvent)

					// Detect EVM Events
					if strings.Contains(evt.Type, "EVM.") {
						isEVM = true
						if strings.Contains(evt.Type, "EVM.TransactionExecuted") {
							var evmPayload map[string]interface{}
							if err := json.Unmarshal(payloadJSON, &evmPayload); err == nil {
								if h, ok := evmPayload["transactionHash"].(string); ok {
									dbTx.EVMHash = h
								}
							}
						}
					}

				}

				dbTx.IsEVM = isEVM

				dbTxs = append(dbTxs, dbTx)
				txIndex++
			}
			if repin {
				break
			}
		}
		if repin {
			continue
		}

		dbBlock.TxCount = len(dbTxs)
		dbBlock.EventCount = len(dbEvents)

		result.Block = &dbBlock
		result.Transactions = dbTxs
		result.Events = dbEvents
		return result
	}

	result.Error = fmt.Errorf("failed to fetch block %d: no suitable access node available", height)
	return result
}

// ExtractAccountKeys parses events for public key mapping
func (w *Worker) ExtractAccountKeys(events []models.Event) []models.AccountKey {
	var keys []models.AccountKey
	for _, evt := range events {
		if strings.Contains(evt.Type, "AccountKeyAdded") || strings.Contains(evt.Type, "AccountKeyRemoved") {
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

			// AccountKeyAdded
			keyIdx := -1
			if v, ok := payload["keyIndex"]; ok {
				if n, ok := parseInt(v); ok {
					keyIdx = n
				}
			}
			if keyIdx < 0 {
				continue
			}

			publicKey := extractPublicKey(payload["publicKey"])
			if publicKey == "" {
				if key, ok := payload["key"].(map[string]interface{}); ok {
					publicKey = extractPublicKey(key["publicKey"])
				}
			}
			publicKey = normalizePublicKey(publicKey)
			if publicKey == "" {
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

			if sa, ok := payload["signingAlgorithm"].(string); ok {
				key.SigningAlgorithm = sa
			} else if pkObj, ok := payload["publicKey"].(map[string]interface{}); ok {
				if sa, ok := pkObj["signatureAlgorithm"].(string); ok {
					key.SigningAlgorithm = sa
				}
			}
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
	}
	return keys
}

func (w *Worker) parseTokenEvent(evtType string, payloadJSON []byte, txID string, height uint64) *models.TokenTransfer {
	var payload map[string]interface{}
	json.Unmarshal(payloadJSON, &payload)

	// Check if this is a standard FT event structure
	eventType, ok := payload["EventType"].(map[string]interface{})
	if !ok {
		return nil
	}

	location, ok := eventType["Location"].(map[string]interface{})
	if !ok {
		return nil
	}

	addrHex, ok := location["address"].(string)
	if !ok {
		return nil
	}

	contractAddr := strings.TrimPrefix(addrHex, "0x")
	amount := "0"
	toAddr := ""
	fromAddr := ""

	if val, ok := payload["amount"].(json.Number); ok {
		amount = val.String()
	} else if val, ok := payload["amount"].(float64); ok {
		amount = fmt.Sprintf("%f", val)
	}

	if strings.Contains(evtType, "TokensDeposited") {
		if toVal, ok := payload["to"].(map[string]interface{}); ok {
			if addr, ok := toVal["address"].(string); ok {
				toAddr = strings.TrimPrefix(addr, "0x")
			}
		}
	} else {
		// TokensWithdrawn
		if fromVal, ok := payload["from"].(map[string]interface{}); ok {
			if addr, ok := fromVal["address"].(string); ok {
				fromAddr = strings.TrimPrefix(addr, "0x")
			}
		}
	}

	return &models.TokenTransfer{
		TransactionID:        txID,
		BlockHeight:          height,
		TokenContractAddress: contractAddr,
		FromAddress:          fromAddr,
		ToAddress:            toAddr,
		Amount:               amount,
		IsNFT:                false, // Default to FT for now unless specialized parser
	}
}

// discoverAddresses recursively scans a payload for Flow and EVM addresses
func (w *Worker) discoverAddresses(val interface{}, discovered map[string]string) {
	switch v := val.(type) {
	case string:
		addr := strings.TrimPrefix(v, "0x")
		if isAddress(addr) {
			discovered[strings.ToLower(addr)] = "EVENT_PARTICIPANT"
		}
	case map[string]interface{}:
		for _, vv := range v {
			w.discoverAddresses(vv, discovered)
		}
	case []interface{}:
		for _, vv := range v {
			w.discoverAddresses(vv, discovered)
		}
	}
}

// isAddress checks if a hex string is a Flow (16 chars) or EVM (40 chars) address
func isAddress(s string) bool {
	s = strings.TrimPrefix(s, "0x")
	// Only count as address if it's hex and correct length
	if len(s) != 16 && len(s) != 40 {
		return false
	}
	for _, r := range s {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
			return false
		}
	}
	return true
}

func (w *Worker) parseEventType(typeID string) (address, contract, event string) {
	// Format: A.<address>.<contract>.<event> or flow.<event>
	parts := strings.Split(typeID, ".")
	if len(parts) >= 4 && parts[0] == "A" {
		return parts[1], parts[2], parts[3]
	}
	if len(parts) >= 2 {
		return "", parts[0], parts[1]
	}
	return "", "", typeID
}

func (w *Worker) flattenCadenceValue(v cadence.Value) interface{} {
	if v == nil {
		return nil
	}
	switch val := v.(type) {
	case cadence.Event:
		m := make(map[string]interface{})
		fields := val.FieldsMappedByName()
		for name, fieldVal := range fields {
			m[name] = w.flattenCadenceValue(fieldVal)
		}
		return m
	case cadence.Struct:
		m := make(map[string]interface{})
		fields := val.FieldsMappedByName()
		for name, fieldVal := range fields {
			m[name] = w.flattenCadenceValue(fieldVal)
		}
		return m
	case cadence.Dictionary:
		m := make(map[string]interface{})
		for _, pair := range val.Pairs {
			key := fmt.Sprintf("%v", w.flattenCadenceValue(pair.Key))
			m[key] = w.flattenCadenceValue(pair.Value)
		}
		return m
	case cadence.Array:
		arr := make([]interface{}, len(val.Values))
		for i, item := range val.Values {
			arr[i] = w.flattenCadenceValue(item)
		}
		return arr
	case cadence.Address:
		return val.Hex()
	case cadence.String:
		return string(val)
	case cadence.Bool:
		return bool(val)
	case cadence.Bytes:
		return fmt.Sprintf("0x%x", []byte(val))
	default:
		return val.String()
	}
}

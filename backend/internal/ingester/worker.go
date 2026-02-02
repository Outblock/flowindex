package ingester

import (
	"context"
	"encoding/json"
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

	// 1. Get Block & Collections
	block, collections, err := w.client.GetBlockByHeight(ctx, height)
	if err != nil {
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
	var addressActivity []models.AddressTransaction
	var tokenTransfers []models.TokenTransfer

	// 2. Process Collections & Transactions
	txIndex := 0
	for _, collection := range collections {
		for _, txID := range collection.TransactionIDs {
			// Fetch Transaction
			tx, err := w.client.GetTransaction(ctx, txID)
			if err != nil {
				// Retry or skip? For now, we error out to be safe in the pipeline
				result.Error = fmt.Errorf("failed to get tx %s: %w", txID, err)
				return result
			}

			// Fetch Result (Status & Events)
			res, err := w.client.GetTransactionResult(ctx, txID)
			if err != nil {
				result.Error = fmt.Errorf("failed to get tx result %s: %w", txID, err)
				return result
			}

			// Map to DB Models
			argsJSON, _ := json.Marshal(tx.Arguments)
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
			// Discovery map to deduplicate addresses within a transaction
			discoveredAddresses := make(map[string]string) // address -> role

			// Roles
			discoveredAddresses[tx.Payer.Hex()] = "PAYER"
			discoveredAddresses[tx.ProposalKey.Address.Hex()] = "PROPOSER"

			// Authorizers
			for _, auth := range tx.Authorizers {
				discoveredAddresses[auth.Hex()] = "AUTHORIZER"
			}

			// Process Events
			for _, evt := range res.Events {
				payloadJSON, _ := json.Marshal(evt.Value)
				flatValues := w.flattenCadenceValue(evt.Value)
				valuesJSON, _ := json.Marshal(flatValues)

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
					Values:           valuesJSON,
					BlockHeight:      height,
					CreatedAt:        time.Now(),
				}
				dbEvents = append(dbEvents, dbEvent)

				// Add to denormalized events list for this transaction
				dbTx.Events = append(dbTx.Events, dbEvent)

				// Aggressive discovery: scan payload for anything that looks like an address
				var payloadMap map[string]interface{}
				if err := json.Unmarshal(payloadJSON, &payloadMap); err == nil {
					w.discoverAddresses(payloadMap, discoveredAddresses)
				}

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

				// Detect Token Transfers
				if strings.Contains(evt.Type, "TokensDeposited") || strings.Contains(evt.Type, "TokensWithdrawn") {
					transferData := w.parseTokenEvent(evt.Type, payloadJSON, tx.ID().String(), height)
					if transferData != nil {
						tokenTransfers = append(tokenTransfers, *transferData)
						if transferData.ToAddress != "" {
							discoveredAddresses[transferData.ToAddress] = "ASSET_RECEIVED"
						}
						if transferData.FromAddress != "" {
							discoveredAddresses[transferData.FromAddress] = "ASSET_SENT"
						}
					}
				}

				// Detect Contract Events
				if strings.Contains(evt.Type, "AccountContractAdded") || strings.Contains(evt.Type, "AccountContractUpdated") {
					// The address for contract events is usually the account address, not tx.ID()
					// We need to parse the event payload to get the actual account address.
					// For now, we'll add a placeholder and rely on aggressive discovery to find the actual address.
					// A more robust solution would be to parse the event payload here.
					// Example: if payload has "address" field, use that.
					var contractEventPayload map[string]interface{}
					if err := json.Unmarshal(payloadJSON, &contractEventPayload); err == nil {
						if addr, ok := contractEventPayload["address"].(string); ok {
							trimmedAddr := strings.TrimPrefix(addr, "0x")
							discoveredAddresses[trimmedAddr] = "CONTRACT_DEPLOYER"
						}
					}
				}
			}

			// Add all discovered addresses to activity
			for addr, role := range discoveredAddresses {
				addressActivity = append(addressActivity, models.AddressTransaction{
					Address:         addr,
					TransactionID:   tx.ID().String(),
					BlockHeight:     height,
					TransactionType: "GENERAL",
					Role:            role,
				})
			}

			dbTx.IsEVM = isEVM

			dbTxs = append(dbTxs, dbTx)
			txIndex++
		}
	}

	dbBlock.TxCount = len(dbTxs)
	dbBlock.EventCount = len(dbEvents)

	result.Block = &dbBlock
	result.Transactions = dbTxs
	result.Events = dbEvents
	result.AddressActivity = addressActivity
	result.TokenTransfers = tokenTransfers
	result.AccountKeys = w.ExtractAccountKeys(dbEvents)
	return result
}

// ExtractAccountKeys parses events for public key mapping
func (w *Worker) ExtractAccountKeys(events []models.Event) []models.AccountKey {
	var keys []models.AccountKey
	for _, evt := range events {
		// flow.AccountCreated (A.fee1619a13d78a63.AccountCreated)
		// flow.AccountKeyAdded (A.fee1619a13d78a63.AccountKeyAdded)
		if strings.Contains(evt.Type, "AccountCreated") || strings.Contains(evt.Type, "AccountKeyAdded") {
			var payload map[string]interface{}
			if err := json.Unmarshal(evt.Payload, &payload); err != nil {
				continue
			}

			address := ""
			publicKey := ""

			// Extract address (usually in 'address' field)
			if addr, ok := payload["address"].(string); ok {
				address = strings.TrimPrefix(addr, "0x")
			}

			// Extract public key
			// AccountCreated might have a 'publicKey' field or it might be in an 'AccountKeyAdded' event immediately following.
			// AccountKeyAdded has a 'publicKey' field or 'key' field depending on the version.
			if pk, ok := payload["publicKey"].(string); ok {
				publicKey = pk
			} else if key, ok := payload["key"].(map[string]interface{}); ok {
				// Sometimes it's a struct with 'publicKey'
				if pk, ok := key["publicKey"].(string); ok {
					publicKey = pk
				}
			}

			if address != "" && publicKey != "" {
				key := models.AccountKey{
					PublicKey:     publicKey,
					Address:       address,
					TransactionID: evt.TransactionID,
					BlockHeight:   evt.BlockHeight,
					CreatedAt:     time.Now(),
				}

				// Extract more granular fields if available
				if idx, ok := payload["keyIndex"].(float64); ok {
					key.KeyIndex = int(idx)
				}
				if sa, ok := payload["signingAlgorithm"].(string); ok {
					key.SigningAlgorithm = sa
				}
				if ha, ok := payload["hashingAlgorithm"].(string); ok {
					key.HashingAlgorithm = ha
				}
				if w, ok := payload["weight"].(float64); ok {
					key.Weight = int(w)
				}

				keys = append(keys, key)
			}
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

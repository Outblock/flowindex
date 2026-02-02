package ingester

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"flowscan-clone/internal/flow"
	"flowscan-clone/internal/models"
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
		IsSealed:             true,
	}

	var dbTxs []models.Transaction
	var dbEvents []models.Event
	var addressActivity []models.AddressTransaction
	var tokenTransfers []models.TokenTransfer

	// 2. Process Collections & Transactions
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
			var evmHash string

			dbTx := models.Transaction{
				ID:                     tx.ID().String(),
				BlockHeight:            height,
				ProposerAddress:        tx.ProposalKey.Address.Hex(),
				ProposerKeyIndex:       tx.ProposalKey.KeyIndex,
				ProposerSequenceNumber: tx.ProposalKey.SequenceNumber,
				PayerAddress:           tx.Payer.Hex(),
				Authorizers:            authorizers,
				Script:                 string(tx.Script),
				Arguments:              argsJSON,
				Status:                 res.Status.String(),
				GasLimit:               tx.GasLimit,
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
			// Proposer
			addressActivity = append(addressActivity, models.AddressTransaction{
				Address:         tx.ProposalKey.Address.Hex(),
				TransactionID:   tx.ID().String(),
				BlockHeight:     height,
				TransactionType: "GENERAL",
				Role:            "PROPOSER",
			})

			// Payer
			if tx.Payer.Hex() != tx.ProposalKey.Address.Hex() {
				addressActivity = append(addressActivity, models.AddressTransaction{
					Address:         tx.Payer.Hex(),
					TransactionID:   tx.ID().String(),
					BlockHeight:     height,
					TransactionType: "GENERAL",
					Role:            "PAYER",
				})
			}

			// Authorizers
			for _, auth := range tx.Authorizers {
				authAddr := auth.Hex()
				addressActivity = append(addressActivity, models.AddressTransaction{
					Address:         authAddr,
					TransactionID:   tx.ID().String(),
					BlockHeight:     height,
					TransactionType: "GENERAL",
					Role:            "AUTHORIZER",
				})
			}

			// Process Events
			for i, evt := range res.Events {
				payloadJSON, _ := json.Marshal(evt.Value)
				dbEvent := models.Event{
					TransactionID: tx.ID().String(),
					Type:          evt.Type,
					EventIndex:    i,
					Payload:       payloadJSON,
					BlockHeight:   height,
				}
				dbEvents = append(dbEvents, dbEvent)

				// Detect EVM Execution Event
				if strings.Contains(evt.Type, "EVM.TransactionExecuted") {
					isEVM = true

					// Payload structure for EVM.TransactionExecuted:
					// { "blockHostHeight": 123, "transactionHash": "0x...", "failed": false, "vmError": null,
					//   "gasConsumed": 21000, "deployedContractAddress": null, "returnedValue": "0x", "logs": [] }
					// Note: The fields might vary slightly by Flow version, but typically `transactionHash` is key.
					// We might need to look at other events like "EVM.TransactionSubmitted" for from/to if not here,
					// but "TransactionExecuted" is the main one.
					// Actually, Flow EVM usually emits:
					// blockHeight, transactionHash, from, to, value, data, gasUsed, logs?
					// Let's assume standard fields or try to extract what we can.

					var evmPayload map[string]interface{}
					if err := json.Unmarshal(payloadJSON, &evmPayload); err == nil {
						if h, ok := evmPayload["transactionHash"].(string); ok {
							dbTx.EVMHash = h
						}
						// Try to find other fields if available in this event
						// Note: Flow EVM events are evolving. We'll capture what's common.
						// If 'from' / 'to' are missing in this event, they might be in arguments or other events.
					}
				}

				// Detect Token Transfers
				if strings.Contains(evt.Type, "TokensDeposited") || strings.Contains(evt.Type, "TokensWithdrawn") {
					transferData := w.parseTokenEvent(evt.Type, payloadJSON, tx.ID().String(), height)
					if transferData != nil {
						tokenTransfers = append(tokenTransfers, *transferData)

						// Add activity for sender/receiver
						if transferData.ToAddress != "" {
							addressActivity = append(addressActivity, models.AddressTransaction{
								Address:         transferData.ToAddress,
								TransactionID:   tx.ID().String(),
								BlockHeight:     height,
								TransactionType: "TOKEN_TRANSFER",
								Role:            "ASSET_RECEIVED",
							})
						}
						if transferData.FromAddress != "" {
							addressActivity = append(addressActivity, models.AddressTransaction{
								Address:         transferData.FromAddress,
								TransactionID:   tx.ID().String(),
								BlockHeight:     height,
								TransactionType: "TOKEN_TRANSFER",
								Role:            "ASSET_SENT",
							})
						}
					}
				}
			}

			dbTx.IsEVM = isEVM
			dbTx.EVMHash = evmHash

			dbTxs = append(dbTxs, dbTx)
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
				keys = append(keys, models.AccountKey{
					PublicKey:     publicKey,
					Address:       address,
					TransactionID: evt.TransactionID,
					BlockHeight:   evt.BlockHeight,
					CreatedAt:     time.Now(),
				})
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

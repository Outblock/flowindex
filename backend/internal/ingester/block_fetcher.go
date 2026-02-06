package ingester

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"flowscan-clone/internal/flow"
	"flowscan-clone/internal/models"

	"github.com/onflow/cadence"
	flowsdk "github.com/onflow/flow-go-sdk"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// FetchResult holds the data for a single block height
type FetchResult struct {
	Height           uint64
	Block            *models.Block
	Transactions     []models.Transaction
	Events           []models.Event
	Collections      []models.Collection
	ExecutionResults []models.ExecutionResult
	AddressActivity  []models.AddressTransaction
	TokenTransfers   []models.TokenTransfer
	AccountKeys      []models.AccountKey
	Error            error
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

		// 1. Get Block Header (+ optional collections)
		storeCollections := strings.ToLower(strings.TrimSpace(os.Getenv("STORE_COLLECTIONS"))) != "false"

		var (
			block       *flowsdk.Block
			collections []*flowsdk.Collection
		)

		if storeCollections {
			block, collections, err = pin.GetBlockByHeight(ctx, height)
		} else {
			block, err = pin.GetBlockHeaderByHeight(ctx, height)
		}
		if err != nil {
			if shouldRepin(err) {
				continue
			}
			result.Error = fmt.Errorf("failed to get block %d: %w", height, err)
			return result
		}

		// Optional: store heavy block payloads (signatures/seals/guarantees). Most explorer
		// pages don't need these, and they add significant write + storage overhead.
		storeBlockPayloads := strings.ToLower(strings.TrimSpace(os.Getenv("STORE_BLOCK_PAYLOADS"))) != "false"
		storeExecutionResults := strings.ToLower(strings.TrimSpace(os.Getenv("STORE_EXECUTION_RESULTS"))) != "false"
		var collGuarantees []byte
		var blockSeals []byte
		var signatures []byte
		var executionResultID string
		if storeBlockPayloads {
			collGuarantees, _ = json.Marshal(block.CollectionGuarantees)
			blockSeals, _ = json.Marshal(block.Seals)
			signatures, _ = json.Marshal(block.Signatures)
		}
		if len(block.Seals) > 0 && block.Seals[0] != nil {
			executionResultID = block.Seals[0].ResultId.String()
		}

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
			ExecutionResultID:    executionResultID,
			IsSealed:             true,
		}

		if storeExecutionResults {
			execResult, execErr := pin.GetExecutionResultForBlockID(ctx, block.ID)
			if execErr != nil {
				if shouldRepin(execErr) {
					continue
				}
				log.Printf("[ingester] warn: failed to get execution result for block %s (height=%d): %v", block.ID, height, execErr)
			} else if execResult != nil {
				payload, _ := json.Marshal(execResult)
				if executionResultID == "" {
					executionResultID = block.ID.String()
				}
				result.ExecutionResults = append(result.ExecutionResults, models.ExecutionResult{
					BlockHeight: block.Height,
					ID:          executionResultID,
					ChunkData:   payload,
					Timestamp:   block.Timestamp,
				})
			}
		}

		if storeCollections && len(collections) > 0 {
			result.Collections = make([]models.Collection, 0, len(collections))
			for _, coll := range collections {
				if coll == nil {
					continue
				}
				txIDs := make([]string, 0, len(coll.TransactionIDs))
				for _, tid := range coll.TransactionIDs {
					txIDs = append(txIDs, tid.String())
				}
				result.Collections = append(result.Collections, models.Collection{
					BlockHeight:    block.Height,
					ID:             coll.ID().String(),
					TransactionIDs: txIDs,
					Timestamp:      block.Timestamp,
				})
			}
		}

		// 2. Fetch All Transactions & Results for the Block (Bulk RPC)
		txs, err := pin.GetTransactionsByBlockID(ctx, block.ID)
		if err != nil {
			if shouldRepin(err) {
				continue
			}
			result.Error = fmt.Errorf("failed to get transactions for block %s: %w", block.ID, err)
			return result
		}

		// Track whether we should retry this height with a different node pin.
		repinRequested := false

		results, err := pin.GetTransactionResultsByBlockID(ctx, block.ID)
		if err != nil {
			if shouldRepin(err) {
				continue
			}

			// Some blocks have enough tx results/events to exceed the default gRPC receive limit.
			// Fall back to per-tx result calls to avoid stalling history backfill on a single busy block.
			if isGRPCMessageTooLarge(err) {
				log.Printf("[history_ingester] Warn: tx results payload too large for block %s (height=%d), falling back to per-tx calls: %v", block.ID, height, err)
				results = make([]*flowsdk.TransactionResult, 0, len(txs))
				for _, tx := range txs {
					if tx == nil {
						continue
					}
					r, rErr := pin.GetTransactionResult(ctx, tx.ID())
					if rErr != nil {
						if shouldRepin(rErr) {
							repinRequested = true
							break
						}
						result.Error = fmt.Errorf("failed to get tx result %s: %w", tx.ID().String(), rErr)
						return result
					}
					results = append(results, r)
				}
				if repinRequested {
					continue
				}
			} else {
				result.Error = fmt.Errorf("failed to get transaction results for block %s: %w", block.ID, err)
				return result
			}
		}

		resByID := make(map[string]*flowsdk.TransactionResult, len(results))
		for _, r := range results {
			if r == nil {
				continue
			}
			resByID[r.TransactionID.String()] = r
		}

		var dbTxs []models.Transaction
		var dbEvents []models.Event

		now := time.Now()

		for txIndex, tx := range txs {
			if tx == nil {
				continue
			}
			txID := tx.ID().String()

			res := resByID[txID]
			if res == nil {
				// Best-effort fallback (rare): fetch result individually.
				r, err := pin.GetTransactionResult(ctx, tx.ID())
				if err != nil {
					if shouldRepin(err) {
						// Retry the entire height with a different pin.
						repinRequested = true
						break
					}
					result.Error = fmt.Errorf("failed to get tx result %s: %w", txID, err)
					return result
				}
				res = r
			}

			// Map to DB Models
			// tx.Arguments is [][]byte, where each byte slice is a JSON-CDC string.
			// json.Marshal would base64 encode []byte; we want raw JSON strings in an array.
			argsList := make([]json.RawMessage, 0, len(tx.Arguments))
			for _, arg := range tx.Arguments {
				argsList = append(argsList, json.RawMessage(arg))
			}
			argsJSON, _ := json.Marshal(argsList)
			if len(argsList) == 0 {
				argsJSON = []byte("[]")
			}

			authorizers := make([]string, len(tx.Authorizers))
			for i, a := range tx.Authorizers {
				authorizers[i] = a.Hex()
			}

			scriptText := string(tx.Script)
			isEVM := strings.Contains(scriptText, "import EVM")

			dbTx := models.Transaction{
				ID:                     txID,
				BlockHeight:            height,
				TransactionIndex:       txIndex,
				ProposerAddress:        tx.ProposalKey.Address.Hex(),
				ProposerKeyIndex:       tx.ProposalKey.KeyIndex,
				ProposerSequenceNumber: tx.ProposalKey.SequenceNumber,
				PayerAddress:           tx.Payer.Hex(),
				Authorizers:            authorizers,
				Script:                 scriptText,
				Arguments:              argsJSON,
				Status:                 res.Status.String(),
				GasLimit:               tx.GasLimit,
				GasUsed:                res.ComputationUsage,
				ComputationUsage:       res.ComputationUsage,
				StatusCode:             0, // Not directly available in SDK TransactionResult
				ExecutionStatus:        res.Status.String(),
				EventCount:             len(res.Events),
				Timestamp:              block.Timestamp,
				CreatedAt:              now,
			}

			// Redundancy: Marshal Signatures and ProposalKey (kept in model for future use).
			// Not currently stored in schema_v2.sql.
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
					TransactionID:   txID,
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
					TransactionID:    txID,
					TransactionIndex: txIndex,
					Type:             evt.Type,
					EventIndex:       evt.EventIndex,
					ContractAddress:  addrStr,
					ContractName:     contractStr,
					EventName:        eventStr,
					Payload:          payloadJSON,
					BlockHeight:      height,
					Timestamp:        block.Timestamp,
					CreatedAt:        now,
				}
				dbEvents = append(dbEvents, dbEvent)

				// Detect EVM Events
				if strings.Contains(evt.Type, "EVM.") {
					isEVM = true
				}
			}

			dbTx.IsEVM = isEVM
			dbTxs = append(dbTxs, dbTx)
		}

		// If we broke out early due to a repin request, retry the height with a new pin.
		if repinRequested {
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
				key.SigningAlgorithm = normalizeSignatureAlgorithm(sa)
			} else if pkObj, ok := payload["publicKey"].(map[string]interface{}); ok {
				if sa, ok := pkObj["signatureAlgorithm"].(string); ok {
					key.SigningAlgorithm = normalizeSignatureAlgorithm(sa)
				}
			}
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

func isGRPCMessageTooLarge(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	if strings.Contains(msg, "received message larger than max") {
		return true
	}
	// Some SDK errors wrap the status; keep the check resilient.
	if st, ok := status.FromError(err); ok {
		if st.Code() == codes.ResourceExhausted && strings.Contains(st.Message(), "received message larger than max") {
			return true
		}
	}
	return false
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

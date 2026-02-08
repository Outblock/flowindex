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
		//
		// Collections are expensive to fetch because they require one RPC call per collection guarantee.
		// For most explorer pages we can derive everything we need from raw.transactions/events, so we
		// default to NOT fetching collections unless explicitly enabled.
		storeCollections := strings.ToLower(strings.TrimSpace(os.Getenv("STORE_COLLECTIONS"))) == "true"

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
		storeBlockPayloads := strings.ToLower(strings.TrimSpace(os.Getenv("STORE_BLOCK_PAYLOADS"))) == "true"
		storeExecutionResults := strings.ToLower(strings.TrimSpace(os.Getenv("STORE_EXECUTION_RESULTS"))) == "true"
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

				// Keep raw.blocks.execution_result_id consistent with raw.execution_results.id
				// when seals are not available from the access API.
				dbBlock.ExecutionResultID = executionResultID
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
		var totalGasUsed uint64

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
			totalGasUsed += dbTx.GasUsed

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
		dbBlock.TotalGasUsed = totalGasUsed

		result.Block = &dbBlock
		result.Transactions = dbTxs
		result.Events = dbEvents
		return result
	}

	result.Error = fmt.Errorf("failed to fetch block %d: no suitable access node available", height)
	return result
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

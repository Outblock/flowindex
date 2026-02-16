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

// FetchWarning records a non-fatal issue encountered during block fetch.
type FetchWarning struct {
	TxID    string
	TxIndex int
	Message string
}

// FetchResult holds the data for a single block height
type FetchResult struct {
	Height       uint64
	Block        *models.Block
	Transactions []models.Transaction
	Events       []models.Event
	Error        error
	Warnings     []FetchWarning
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
	const maxPinAttempts = 30

	shouldRepin := func(err error) bool {
		var sporkErr *flow.SporkRootNotFoundError
		if errors.As(err, &sporkErr) {
			return true
		}
		var nodeErr *flow.NodeUnavailableError
		if errors.As(err, &nodeErr) {
			// Permanently mark this node as unable to serve this height,
			// so PinByHeight skips it for this and all lower heights.
			w.client.MarkNodeMinHeight(nodeErr.NodeIndex, height+1)
			return true
		}
		// If a node is rate-limited (ResourceExhausted) after all retries,
		// sleep and retry the pin loop so the worker backs off.
		if st, ok := status.FromError(errors.Unwrap(err)); ok && st.Code() == codes.ResourceExhausted {
			time.Sleep(5 * time.Second)
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

		// 1. Get Block Header
		block, err := pin.GetBlockHeaderByHeight(ctx, height)
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

		// 2. Fetch All Transactions & Results for the Block
		// Try bulk APIs first; fall back to per-collection/per-tx for old spork nodes.
		var txs []*flowsdk.Transaction
		var results []*flowsdk.TransactionResult
		usedBulkTxAPI := false

		txs, err = pin.GetTransactionsByBlockID(ctx, block.ID)
		if err != nil {
			if shouldRepin(err) {
				continue
			}
			if isUnimplementedError(err) {
				// Old spork node: fall back to GetCollection + GetTransaction per-tx
				txs, err = w.fetchTransactionsViaCollections(ctx, pin, block)
				if err != nil {
					if shouldRepin(err) {
						continue
					}
					result.Error = fmt.Errorf("failed to get transactions via collections for block %s: %w", block.ID, err)
					return result
				}
			} else {
				result.Error = fmt.Errorf("failed to get transactions for block %s: %w", block.ID, err)
				return result
			}
		} else {
			usedBulkTxAPI = true
		}

		// Track whether we should retry this height with a different node pin.
		repinRequested := false

		results, err = pin.GetTransactionResultsByBlockID(ctx, block.ID)
		if err != nil {
			if shouldRepin(err) {
				continue
			}

			if isUnimplementedError(err) || isExecutionNodeError(err) || isBulkResultInternalError(err) {
				// Old spork node, execution nodes down, or bulk API bug: fall back to per-tx GetTransactionResult.
				// Force ID-based lookup (not index-based) when execution nodes are the problem.
				useIndexAPI := usedBulkTxAPI && !isExecutionNodeError(err)
				if isExecutionNodeError(err) || isBulkResultInternalError(err) {
					log.Printf("[ingester] Warn: bulk result API failed for block %s (height=%d), falling back to per-tx result calls: %v", block.ID, height, err)
				}
				results, repinRequested, err = w.fetchResultsPerTx(ctx, pin, block.ID, txs, useIndexAPI)
				if err != nil {
					result.Error = err
					return result
				}
				if repinRequested {
					continue
				}
			} else if isGRPCMessageTooLarge(err) {
				// Payload too large: fall back to per-tx result calls
				log.Printf("[ingester] Warn: tx results payload too large for block %s (height=%d), falling back to per-tx calls: %v", block.ID, height, err)
				results, repinRequested, err = w.fetchResultsPerTx(ctx, pin, block.ID, txs, usedBulkTxAPI)
				if err != nil {
					result.Error = err
					return result
				}
				if repinRequested {
					continue
				}
			} else {
				result.Error = fmt.Errorf("failed to get transaction results for block %s: %w", block.ID, err)
				return result
			}
		}

		// Build index-based result lookup. GetTransactionResultsByBlockID returns results
		// in block execution order which may differ from GetTransactionsByBlockID order.
		// Match by index position (both APIs enumerate the same block transactions).
		resByIndex := make(map[int]*flowsdk.TransactionResult, len(results))
		resByID := make(map[string]*flowsdk.TransactionResult, len(results))
		for i, r := range results {
			if r == nil {
				continue
			}
			resByIndex[i] = r
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

			// Prefer index-based matching (most reliable), fall back to txID matching.
			res := resByIndex[txIndex]
			if res == nil {
				res = resByID[txID]
			}
			if res == nil {
				// Best-effort fallback (rare): fetch result individually by block ID + index.
				// Using GetTransactionResultByIndex because system transactions require a block ID.
				r, err := pin.GetTransactionResultByIndex(ctx, block.ID, uint32(txIndex))
				if err != nil {
					if shouldRepin(err) {
						// Retry the entire height with a different pin.
						repinRequested = true
						break
					}
					// For historical blocks, execution nodes may not have results for some
					// system transactions. Use a synthetic empty result instead of blocking
					// the entire batch.
					if isNotFoundError(err) {
						log.Printf("[history] Warn: tx result not found for %s (height=%d, idx=%d), using empty result", txID, height, txIndex)
						result.Warnings = append(result.Warnings, FetchWarning{
							TxID:    txID,
							TxIndex: txIndex,
							Message: fmt.Sprintf("tx result not found: %v", err),
						})
						r = &flowsdk.TransactionResult{
							TransactionID: tx.ID(),
							Status:        flowsdk.TransactionStatusSealed,
						}
					} else {
						result.Error = fmt.Errorf("failed to get tx result %s: %w", txID, err)
						return result
					}
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
			isEVM := false

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

				// Detect EVM Events — only flag as EVM if there is an actual EVM.TransactionExecuted event
				if strings.Contains(evt.Type, "EVM.TransactionExecuted") {
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

// fetchTransactionsViaCollections fetches all transactions in a block by iterating
// over its collection guarantees. Used as fallback for old spork nodes that don't
// support GetTransactionsByBlockID.
func (w *Worker) fetchTransactionsViaCollections(ctx context.Context, pin *flow.PinnedClient, block *flowsdk.Block) ([]*flowsdk.Transaction, error) {
	var allTxs []*flowsdk.Transaction

	// System transaction (epoch/service tx) is not in any collection but is always
	// the last transaction in a block. We'll fetch it separately via GetTransactionResult
	// matching later. For now, collect only user transactions from collections.
	for _, cg := range block.CollectionGuarantees {
		coll, err := pin.GetCollection(ctx, cg.CollectionID)
		if err != nil {
			return nil, fmt.Errorf("GetCollection(%s): %w", cg.CollectionID, err)
		}
		for _, txID := range coll.TransactionIDs {
			tx, err := pin.GetTransaction(ctx, txID)
			if err != nil {
				return nil, fmt.Errorf("GetTransaction(%s): %w", txID, err)
			}
			allTxs = append(allTxs, tx)
		}
	}
	return allTxs, nil
}

// fetchResultsPerTx fetches transaction results one at a time. When usedBulkTxAPI is true,
// it uses GetTransactionResultByIndex (index-based); otherwise it uses GetTransactionResult
// (ID-based, for old spork nodes that also lack the index-based API).
func (w *Worker) fetchResultsPerTx(ctx context.Context, pin *flow.PinnedClient, blockID flowsdk.Identifier, txs []*flowsdk.Transaction, usedBulkTxAPI bool) ([]*flowsdk.TransactionResult, bool, error) {
	results := make([]*flowsdk.TransactionResult, 0, len(txs))
	for txIdx, tx := range txs {
		if tx == nil {
			continue
		}
		var r *flowsdk.TransactionResult
		var rErr error
		if usedBulkTxAPI {
			// Bulk tx API worked, so index-based result API should too
			r, rErr = pin.GetTransactionResultByIndex(ctx, blockID, uint32(txIdx))
		} else {
			// Old spork: use ID-based result fetch
			r, rErr = pin.GetTransactionResult(ctx, tx.ID())
		}
		if rErr != nil {
			var sporkErr *flow.SporkRootNotFoundError
			if errors.As(rErr, &sporkErr) {
				return nil, true, nil
			}
			var nodeErr *flow.NodeUnavailableError
			if errors.As(rErr, &nodeErr) {
				return nil, true, nil
			}
			return nil, false, fmt.Errorf("failed to get tx result %s: %w", tx.ID().String(), rErr)
		}
		results = append(results, r)
	}
	return results, false, nil
}

func isNotFoundError(err error) bool {
	if err == nil {
		return false
	}
	if st, ok := status.FromError(err); ok {
		return st.Code() == codes.NotFound
	}
	msg := err.Error()
	return strings.Contains(msg, "NotFound") || strings.Contains(msg, "not found")
}

func isExecutionNodeError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "failed to retrieve result from execution node")
}

// isBulkResultInternalError detects the "transaction failed but error message is empty" bug
// in GetTransactionResultsByBlockID. Per-tx GetTransactionResult typically works around it.
func isBulkResultInternalError(err error) bool {
	if err == nil {
		return false
	}
	if st, ok := status.FromError(err); ok {
		if st.Code() == codes.Internal && strings.Contains(st.Message(), "transaction failed but error message is empty") {
			return true
		}
	}
	msg := err.Error()
	return strings.Contains(msg, "transaction failed but error message is empty")
}

func isUnimplementedError(err error) bool {
	if err == nil {
		return false
	}
	if st, ok := status.FromError(err); ok {
		return st.Code() == codes.Unimplemented
	}
	return strings.Contains(err.Error(), "Unimplemented")
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
	case cadence.Optional:
		// Cadence optionals stringify to "nil" when empty; represent them as JSON null
		// so downstream workers don't misinterpret them as a real string value.
		if val.Value == nil {
			return nil
		}
		return w.flattenCadenceValue(val.Value)
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

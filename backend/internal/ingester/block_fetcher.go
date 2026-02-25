package ingester

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"flowscan-clone/internal/flow"
	"flowscan-clone/internal/models"

	"github.com/onflow/cadence"
	flowsdk "github.com/onflow/flow-go-sdk"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// CrescendoHeight is the root height of Spork 26 (mainnet26).
// Blocks below this height may contain old Cadence types (e.g. RestrictedType)
// that cause SDK panics, or CCF-encoded results that the SDK cannot decode.
// For these blocks we use raw gRPC with JSON-CDC encoding to bypass the decoder.
// Spork 23-24 still trigger RestrictedType panics; spork 24-25 trigger CCF decode errors.
const CrescendoHeight = 88226267

const defaultTxFetchConcurrency = 24

var (
	txFetchConcurrencyOnce sync.Once
	txFetchConcurrencyVal  = defaultTxFetchConcurrency
)

func txFetchConcurrency() int {
	txFetchConcurrencyOnce.Do(func() {
		raw := strings.TrimSpace(os.Getenv("FLOW_TX_FETCH_CONCURRENCY"))
		if raw == "" {
			return
		}
		n, err := strconv.Atoi(raw)
		if err != nil || n < 1 {
			log.Printf("[ingester] invalid FLOW_TX_FETCH_CONCURRENCY=%q, using default=%d", raw, defaultTxFetchConcurrency)
			return
		}
		txFetchConcurrencyVal = n
	})
	return txFetchConcurrencyVal
}

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
			// Only mark minHeight on permanent "height too low" style failures.
			// For transient DNS/transport errors, keep the node eligible.
			if shouldMarkNodeMinHeight(nodeErr.Err) {
				w.client.MarkNodeMinHeight(nodeErr.NodeIndex, height+1)
			}
			return true
		}
		// If a node is rate-limited (ResourceExhausted) after all retries,
		// back off and retry. Don't disable the node since for old spork
		// heights there may be only one eligible node.
		var exhaustedErr *flow.NodeExhaustedError
		if errors.As(err, &exhaustedErr) {
			log.Printf("[ingester] ResourceExhausted for height %d on node %s, sleeping 10s", height, exhaustedErr.Node)
			time.Sleep(10 * time.Second)
			return true
		}
		// Log unhandled errors for debugging
		log.Printf("[ingester] Unhandled fetch error for height %d (repin=false): %v", height, err)
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
		// If a node has been flagged as not supporting bulk APIs, skip directly to fallback.
		var txs []*flowsdk.Transaction
		var results []*flowsdk.TransactionResult
		var rawResultsByIdx map[int]*flow.RawTransactionResult // From raw gRPC fallback
		usedBulkTxAPI := false
		noBulk := pin.NoBulkAPI()

		if noBulk {
			// Skip bulk API — go straight to per-collection/per-tx fallback.
			var txWarns []FetchWarning
			txs, txWarns, err = w.fetchTransactionsViaCollections(ctx, pin, block)
			result.Warnings = append(result.Warnings, txWarns...)
			if err != nil {
				if shouldRepin(err) {
					continue
				}
				result.Error = fmt.Errorf("failed to get transactions via collections for block %s: %w", block.ID, err)
				return result
			}
		} else {
			txs, err = pin.GetTransactionsByBlockID(ctx, block.ID)
			if err != nil {
				if isUnimplementedError(err) {
					// Old spork node: mark it and fall back to per-collection/per-tx
					w.client.MarkNoBulkAPI(pin.NodeIndex())
					var txWarns []FetchWarning
					txs, txWarns, err = w.fetchTransactionsViaCollections(ctx, pin, block)
					result.Warnings = append(result.Warnings, txWarns...)
					if err != nil {
						if shouldRepin(err) {
							continue
						}
						result.Error = fmt.Errorf("failed to get transactions via collections for block %s: %w", block.ID, err)
						return result
					}
				} else if shouldRepin(err) {
					continue
				} else {
					result.Error = fmt.Errorf("failed to get transactions for block %s: %w", block.ID, err)
					return result
				}
			} else {
				usedBulkTxAPI = true
			}
		}

		// Track whether we should retry this height with a different node pin.
		repinRequested := false

		if height < CrescendoHeight {
			// Pre-Cadence 1.0: use raw gRPC for ALL tx results to avoid SDK panics
			// from unsupported old Cadence types (RestrictedType, etc.)
			var warns []FetchWarning
			results, rawResultsByIdx, warns, repinRequested, err = w.fetchResultsAllRaw(ctx, pin, block.ID, txs)
			result.Warnings = append(result.Warnings, warns...)
			if err != nil {
				result.Error = err
				return result
			}
			if repinRequested {
				continue
			}
		} else if noBulk {
			// Skip bulk result API — go straight to per-tx fallback.
			var warns []FetchWarning
			results, rawResultsByIdx, warns, repinRequested, err = w.fetchResultsPerTx(ctx, pin, block.ID, txs, false)
			result.Warnings = append(result.Warnings, warns...)
			if err != nil {
				result.Error = err
				return result
			}
			if repinRequested {
				continue
			}
		} else {
			// Wrap in panic recovery — some old spork event payloads cause the
			// Cadence JSON decoder to panic inside the Flow SDK.
			func() {
				defer func() {
					if r := recover(); r != nil {
						err = fmt.Errorf("panic in GetTransactionResultsByBlockID for height %d: %v", height, r)
						log.Printf("[ingester] Recovered from SDK panic at height %d: %v", height, r)
					}
				}()
				results, err = pin.GetTransactionResultsByBlockID(ctx, block.ID)
			}()
			isPanic := err != nil && strings.Contains(err.Error(), "panic in GetTransactionResultsByBlockID")
			if err != nil {
				if isUnimplementedError(err) {
					w.client.MarkNoBulkAPI(pin.NodeIndex())
				}
				if isPanic || isUnimplementedError(err) || isExecutionNodeError(err) || isBulkResultInternalError(err) || isCCFDecodeError(err) {
					// Old spork node, execution nodes down, bulk API bug, or CCF decode error: fall back to per-tx GetTransactionResult.
					useIndexAPI := usedBulkTxAPI && !isExecutionNodeError(err)
					if isExecutionNodeError(err) || isBulkResultInternalError(err) {
						log.Printf("[ingester] Warn: bulk result API failed for block %s (height=%d), falling back to per-tx result calls: %v", block.ID, height, err)
					}
					if isCCFDecodeError(err) {
						log.Printf("[ingester] Warn: CCF decode error for block %s (height=%d), falling back to per-tx result calls: %v", block.ID, height, err)
					}
					var warns []FetchWarning
					results, rawResultsByIdx, warns, repinRequested, err = w.fetchResultsPerTx(ctx, pin, block.ID, txs, useIndexAPI)
					result.Warnings = append(result.Warnings, warns...)
					if err != nil {
						result.Error = err
						return result
					}
					if repinRequested {
						log.Printf("[ingester] fetchResultsPerTx requested repin for height %d (node=%s)", height, pin.Node())
						continue
					}
				} else if shouldRepin(err) {
					continue
				} else if isGRPCMessageTooLarge(err) {
					log.Printf("[ingester] Warn: tx results payload too large for block %s (height=%d), falling back to per-tx calls: %v", block.ID, height, err)
					var warns []FetchWarning
					results, rawResultsByIdx, warns, repinRequested, err = w.fetchResultsPerTx(ctx, pin, block.ID, txs, usedBulkTxAPI)
					result.Warnings = append(result.Warnings, warns...)
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

			// Compute script hash early so it's available for WS broadcast enrichment
			scriptHash := ""
			if scriptText != "" {
				sum := sha256.Sum256([]byte(scriptText))
				scriptHash = hex.EncodeToString(sum[:])
			}

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
				ScriptHash:             scriptHash,
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

			// Process Events — check if this tx has raw events from gRPC fallback
			if rawRes, hasRaw := rawResultsByIdx[txIndex]; hasRaw && rawRes != nil {
				// Use raw gRPC events (SDK panicked during Cadence decoding)
				for _, rawEvt := range rawRes.Events {
					parsed := parseJSONCDCEventPayload(rawEvt.Payload)
					var payloadJSON []byte
					if parsed != nil {
						payloadJSON, _ = json.Marshal(parsed)
					} else {
						payloadJSON = rawEvt.Payload // Store raw JSON-CDC as fallback
					}

					addrStr, contractStr, eventStr := w.parseEventType(rawEvt.Type)

					dbEvent := models.Event{
						TransactionID:    txID,
						TransactionIndex: txIndex,
						Type:             rawEvt.Type,
						EventIndex:       int(rawEvt.EventIndex),
						ContractAddress:  addrStr,
						ContractName:     contractStr,
						EventName:        eventStr,
						Payload:          payloadJSON,
						BlockHeight:      height,
						Timestamp:        block.Timestamp,
						CreatedAt:        now,
					}
					dbEvents = append(dbEvents, dbEvent)

					if strings.Contains(rawEvt.Type, "EVM.TransactionExecuted") {
						isEVM = true
					}
				}
			} else {
				// Normal SDK events
				for _, evt := range res.Events {
					payload := w.safeExtractEventPayload(evt)
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

					if strings.Contains(evt.Type, "EVM.TransactionExecuted") {
						isEVM = true
					}
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

func shouldMarkNodeMinHeight(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	// Only trust explicit spork boundary signals. Generic NotFound on old nodes can
	// be transient or ambiguous and may incorrectly poison node minHeight forever.
	return strings.Contains(msg, "spork root block height")
}

// fetchTransactionsViaCollections fetches all transactions in a block by iterating
// over its collection guarantees concurrently. Used as fallback for old spork nodes
// that don't support GetTransactionsByBlockID.
func (w *Worker) fetchTransactionsViaCollections(ctx context.Context, pin *flow.PinnedClient, block *flowsdk.Block) ([]*flowsdk.Transaction, []FetchWarning, error) {
	// First collect all transaction IDs from collections (sequential, fast).
	type txRef struct {
		id    flowsdk.Identifier
		order int
	}
	var refs []txRef
	var warns []FetchWarning
	for _, cg := range block.CollectionGuarantees {
		coll, err := pin.GetCollection(ctx, cg.CollectionID)
		if err != nil {
			if isMissingCollectionError(err) {
				log.Printf("[ingester] Warn: collection unavailable for block %d collection=%s, skipping: %.160s", block.Height, cg.CollectionID, err.Error())
				warns = append(warns, FetchWarning{
					Message: fmt.Sprintf("missing collection: block=%d collection_id=%s err=%v", block.Height, cg.CollectionID, err),
				})
				continue
			}
			return nil, warns, fmt.Errorf("GetCollection(%s): %w", cg.CollectionID, err)
		}
		for _, txID := range coll.TransactionIDs {
			refs = append(refs, txRef{id: txID, order: len(refs)})
		}
	}
	if len(refs) == 0 {
		return nil, warns, nil
	}

	// Fetch all transactions concurrently.
	allTxs := make([]*flowsdk.Transaction, len(refs))
	errCh := make(chan error, len(refs))
	sem := make(chan struct{}, txFetchConcurrency())
	for _, ref := range refs {
		sem <- struct{}{}
		go func(r txRef) {
			defer func() { <-sem }()
			tx, err := pin.GetTransaction(ctx, r.id)
			if err != nil {
				errCh <- fmt.Errorf("GetTransaction(%s): %w", r.id, err)
				return
			}
			allTxs[r.order] = tx
			errCh <- nil
		}(ref)
	}
	for range refs {
		if err := <-errCh; err != nil {
			return nil, warns, err
		}
	}
	return allTxs, warns, nil
}

func isMissingCollectionError(err error) bool {
	if err == nil {
		return false
	}
	if status.Code(err) != codes.NotFound {
		return false
	}
	msg := strings.ToLower(err.Error())
	if !strings.Contains(msg, "collection") {
		return false
	}
	return strings.Contains(msg, "key not found") ||
		strings.Contains(msg, "could not look up collection") ||
		strings.Contains(msg, "no known collection")
}

// fetchResultsPerTx fetches transaction results concurrently. When usedBulkTxAPI is true,
// it uses GetTransactionResultByIndex (index-based); otherwise it uses GetTransactionResult
// (ID-based, for old spork nodes that also lack the index-based API).
func (w *Worker) fetchResultsPerTx(ctx context.Context, pin *flow.PinnedClient, blockID flowsdk.Identifier, txs []*flowsdk.Transaction, usedBulkTxAPI bool) ([]*flowsdk.TransactionResult, map[int]*flow.RawTransactionResult, []FetchWarning, bool, error) {
	type fetchRes struct {
		idx       int
		result    *flowsdk.TransactionResult
		rawResult *flow.RawTransactionResult // Fallback when SDK panics
		warning   *FetchWarning
		err       error
		repin     bool
	}

	ch := make(chan fetchRes, len(txs))
	count := 0
	sem := make(chan struct{}, txFetchConcurrency())
	for txIdx, tx := range txs {
		if tx == nil {
			continue
		}
		count++
		sem <- struct{}{}
		go func(idx int, t *flowsdk.Transaction) {
			defer func() { <-sem }()
			defer func() {
				if rec := recover(); rec != nil {
					log.Printf("[ingester] SDK panic for tx %s (idx=%d): %v — trying raw gRPC fallback", t.ID(), idx, rec)
					// Try raw gRPC with JSON-CDC encoding to bypass Cadence decoder
					rawRes, rawErr := pin.GetTransactionResultRaw(ctx, t.ID())
					if rawErr != nil {
						log.Printf("[ingester] Raw gRPC fallback also failed for tx %s: %v, returning empty result", t.ID(), rawErr)
						ch <- fetchRes{
							idx:    idx,
							result: &flowsdk.TransactionResult{Status: flowsdk.TransactionStatusSealed},
							warning: &FetchWarning{
								TxID:    t.ID().String(),
								TxIndex: idx,
								Message: fmt.Sprintf("tx result fallback failed; using empty result: %v", rawErr),
							},
						}
						return
					}
					log.Printf("[ingester] Raw gRPC fallback succeeded for tx %s: %d events recovered", t.ID(), len(rawRes.Events))
					ch <- fetchRes{idx: idx, rawResult: rawRes}
				}
			}()
			var r *flowsdk.TransactionResult
			var rErr error
			if usedBulkTxAPI {
				r, rErr = pin.GetTransactionResultByIndex(ctx, blockID, uint32(idx))
			} else {
				r, rErr = pin.GetTransactionResult(ctx, t.ID())
			}
			if rErr != nil {
				// Handle non-fatal errors on old spork nodes — return empty sealed result
				// so the block can still be saved. These include:
				//   - "key not found": tx result missing from storage
				//   - "could not retrieve": similar storage issue
				//   - "failed to execute the script on the execution node": execution node down/errors
				//   - "cadence runtime error": script replay failure
				errMsg := rErr.Error()
				if strings.Contains(errMsg, "key not found") ||
					strings.Contains(errMsg, "could not retrieve") ||
					strings.Contains(errMsg, "failed to execute the script on the execution node") ||
					strings.Contains(errMsg, "failed to retrieve result from execution node") ||
					strings.Contains(errMsg, "upstream request timeout") ||
					strings.Contains(errMsg, "cadence runtime error") ||
					strings.Contains(errMsg, "ccf: failed to decode") {
					log.Printf("[ingester] Warn: tx result unavailable for %s (idx=%d), returning empty result: %.120s", t.ID(), idx, errMsg)
					ch <- fetchRes{
						idx:    idx,
						result: &flowsdk.TransactionResult{Status: flowsdk.TransactionStatusSealed},
						warning: &FetchWarning{
							TxID:    t.ID().String(),
							TxIndex: idx,
							Message: fmt.Sprintf("tx result unavailable; using empty result: %v", rErr),
						},
					}
					return
				}
				// NodeUnavailableError wraps NotFound — for per-tx results,
				// this means the specific tx result is missing (not a node-level issue).
				// Return empty result instead of triggering a repin.
				var nodeErr *flow.NodeUnavailableError
				if errors.As(rErr, &nodeErr) {
					log.Printf("[ingester] Warn: tx result NotFound for %s (idx=%d), returning empty result", t.ID(), idx)
					ch <- fetchRes{
						idx:    idx,
						result: &flowsdk.TransactionResult{Status: flowsdk.TransactionStatusSealed},
						warning: &FetchWarning{
							TxID:    t.ID().String(),
							TxIndex: idx,
							Message: fmt.Sprintf("tx result not found; using empty result: %v", rErr),
						},
					}
					return
				}
				var sporkErr *flow.SporkRootNotFoundError
				if errors.As(rErr, &sporkErr) {
					ch <- fetchRes{repin: true}
					return
				}
				var exhaustedErr *flow.NodeExhaustedError
				if errors.As(rErr, &exhaustedErr) {
					ch <- fetchRes{repin: true}
					return
				}
				ch <- fetchRes{err: fmt.Errorf("failed to get tx result %s: %w", t.ID().String(), rErr)}
				return
			}
			ch <- fetchRes{idx: idx, result: r}
		}(txIdx, tx)
	}

	results := make([]*flowsdk.TransactionResult, len(txs))
	rawResults := make(map[int]*flow.RawTransactionResult)
	var warns []FetchWarning
	for i := 0; i < count; i++ {
		res := <-ch
		if res.repin {
			return nil, nil, nil, true, nil
		}
		if res.err != nil {
			return nil, nil, nil, false, res.err
		}
		if res.warning != nil {
			warns = append(warns, *res.warning)
		}
		if res.rawResult != nil {
			// SDK panicked — use raw result. Create a minimal TransactionResult
			// so the index mapping works; actual events come from rawResults.
			rawResults[res.idx] = res.rawResult
			results[res.idx] = &flowsdk.TransactionResult{
				Status: res.rawResult.Status,
			}
		} else {
			results[res.idx] = res.result
		}
	}

	// Compact: remove nil entries (from nil txs)
	compact := make([]*flowsdk.TransactionResult, 0, count)
	for _, r := range results {
		if r != nil {
			compact = append(compact, r)
		}
	}
	return compact, rawResults, warns, false, nil
}

// fetchResultsAllRaw fetches ALL transaction results using raw gRPC with JSON-CDC encoding,
// completely bypassing the Flow SDK's Cadence decoder. Used for pre-Crescendo blocks
// where old Cadence types like RestrictedType cause SDK panics or CCF decode errors.
//
// Strategy: try bulk API (GetTransactionResultsByBlockIDRaw) first — 1 RPC call for all results.
// If the node doesn't support bulk or returns an error, fall back to per-tx raw gRPC calls.
func (w *Worker) fetchResultsAllRaw(ctx context.Context, pin *flow.PinnedClient, blockID flowsdk.Identifier, txs []*flowsdk.Transaction) ([]*flowsdk.TransactionResult, map[int]*flow.RawTransactionResult, []FetchWarning, bool, error) {
	// Try bulk raw gRPC first (unless node is flagged as noBulkAPI)
	if !pin.NoBulkAPI() {
		rawAll, err := pin.GetTransactionResultsByBlockIDRaw(ctx, blockID)
		if err == nil {
			// Success! Build the results maps.
			results := make([]*flowsdk.TransactionResult, len(rawAll))
			rawResults := make(map[int]*flow.RawTransactionResult, len(rawAll))
			for i, r := range rawAll {
				rawResults[i] = r
				results[i] = &flowsdk.TransactionResult{Status: r.Status}
			}
			return results, rawResults, nil, false, nil
		}

		// Check if we should repin or fall back to per-tx
		var sporkErr *flow.SporkRootNotFoundError
		if errors.As(err, &sporkErr) {
			return nil, nil, nil, true, nil
		}
		var exhaustedErr *flow.NodeExhaustedError
		if errors.As(err, &exhaustedErr) {
			return nil, nil, nil, true, nil
		}
		if isUnimplementedError(err) {
			w.client.MarkNoBulkAPI(pin.NodeIndex())
		}
		// For any other error (Internal, execution node down, etc.), fall through to per-tx
		if isExecutionNodeError(err) || isBulkResultInternalError(err) || isCCFDecodeError(err) || isUnimplementedError(err) {
			// Expected fallback — don't log at high verbosity
		} else {
			log.Printf("[ingester] Warn: bulk raw results failed for block %s, falling back to per-tx: %.120s", blockID, err.Error())
		}
	}

	// Fallback: fetch each tx result individually via raw gRPC (parallel goroutines)
	return w.fetchResultsPerTxRaw(ctx, pin, blockID, txs)
}

// fetchResultsPerTxRaw fetches individual tx results via raw gRPC in parallel.
func (w *Worker) fetchResultsPerTxRaw(ctx context.Context, pin *flow.PinnedClient, blockID flowsdk.Identifier, txs []*flowsdk.Transaction) ([]*flowsdk.TransactionResult, map[int]*flow.RawTransactionResult, []FetchWarning, bool, error) {
	type fetchRes struct {
		idx       int
		rawResult *flow.RawTransactionResult
		warning   *FetchWarning
		err       error
		repin     bool
	}

	ch := make(chan fetchRes, len(txs))
	count := 0
	sem := make(chan struct{}, txFetchConcurrency())
	for txIdx, tx := range txs {
		if tx == nil {
			continue
		}
		count++
		sem <- struct{}{}
		go func(idx int, t *flowsdk.Transaction) {
			defer func() { <-sem }()
			rawRes, rawErr := pin.GetTransactionResultRaw(ctx, t.ID())
			if rawErr != nil {
				errMsg := rawErr.Error()
				// Handle non-fatal errors: return empty sealed result
				if strings.Contains(errMsg, "key not found") ||
					strings.Contains(errMsg, "could not retrieve") ||
					strings.Contains(errMsg, "failed to execute the script on the execution node") ||
					strings.Contains(errMsg, "failed to retrieve result from execution node") ||
					strings.Contains(errMsg, "upstream request timeout") ||
					strings.Contains(errMsg, "cadence runtime error") ||
					strings.Contains(errMsg, "ccf: failed to decode") {
					log.Printf("[ingester] Warn: raw tx result unavailable for %s (idx=%d): %.120s", t.ID(), idx, errMsg)
					ch <- fetchRes{
						idx:       idx,
						rawResult: &flow.RawTransactionResult{Status: flowsdk.TransactionStatusSealed},
						warning: &FetchWarning{
							TxID:    t.ID().String(),
							TxIndex: idx,
							Message: fmt.Sprintf("raw tx result unavailable; using empty result: %v", rawErr),
						},
					}
					return
				}
				var nodeErr *flow.NodeUnavailableError
				if errors.As(rawErr, &nodeErr) {
					log.Printf("[ingester] Warn: raw tx result NotFound for %s (idx=%d)", t.ID(), idx)
					ch <- fetchRes{
						idx:       idx,
						rawResult: &flow.RawTransactionResult{Status: flowsdk.TransactionStatusSealed},
						warning: &FetchWarning{
							TxID:    t.ID().String(),
							TxIndex: idx,
							Message: fmt.Sprintf("raw tx result not found; using empty result: %v", rawErr),
						},
					}
					return
				}
				var sporkErr *flow.SporkRootNotFoundError
				if errors.As(rawErr, &sporkErr) {
					ch <- fetchRes{repin: true}
					return
				}
				var exhaustedErr *flow.NodeExhaustedError
				if errors.As(rawErr, &exhaustedErr) {
					ch <- fetchRes{repin: true}
					return
				}
				ch <- fetchRes{err: fmt.Errorf("raw gRPC failed for tx %s: %w", t.ID().String(), rawErr)}
				return
			}
			ch <- fetchRes{idx: idx, rawResult: rawRes}
		}(txIdx, tx)
	}

	results := make([]*flowsdk.TransactionResult, len(txs))
	rawResults := make(map[int]*flow.RawTransactionResult)
	var warns []FetchWarning
	for i := 0; i < count; i++ {
		res := <-ch
		if res.repin {
			return nil, nil, nil, true, nil
		}
		if res.err != nil {
			return nil, nil, nil, false, res.err
		}
		if res.warning != nil {
			warns = append(warns, *res.warning)
		}
		rawResults[res.idx] = res.rawResult
		results[res.idx] = &flowsdk.TransactionResult{
			Status: res.rawResult.Status,
		}
	}

	compact := make([]*flowsdk.TransactionResult, 0, count)
	for _, r := range results {
		if r != nil {
			compact = append(compact, r)
		}
	}
	return compact, rawResults, warns, false, nil
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

func isCCFDecodeError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "ccf: failed to decode") ||
		strings.Contains(msg, "ccf convert")
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

// safeExtractEventPayload extracts event payload, falling back to raw JSON-CDC
// parsing if the Cadence decoder panics (e.g. "Restriction kind is not supported").
func (w *Worker) safeExtractEventPayload(evt flowsdk.Event) (payload interface{}) {
	defer func() {
		if r := recover(); r != nil {
			// Cadence decoder panicked — try raw JSON-CDC parsing of the event Payload
			if len(evt.Payload) > 0 {
				parsed := parseJSONCDCEventPayload(evt.Payload)
				if parsed != nil {
					payload = parsed
					return
				}
			}
			payload = nil
		}
	}()
	return w.flattenCadenceValue(evt.Value)
}

// parseJSONCDCEventPayload parses a JSON-CDC event payload into a flat map
// without using Cadence type system. This avoids "Restriction kind is not supported" panics.
func parseJSONCDCEventPayload(payload []byte) map[string]interface{} {
	var raw map[string]interface{}
	if err := json.Unmarshal(payload, &raw); err != nil {
		return nil
	}

	value, ok := raw["value"].(map[string]interface{})
	if !ok {
		return nil
	}

	fields, ok := value["fields"].([]interface{})
	if !ok {
		return nil
	}

	result := make(map[string]interface{}, len(fields))
	for _, f := range fields {
		field, ok := f.(map[string]interface{})
		if !ok {
			continue
		}
		name, _ := field["name"].(string)
		if name == "" {
			continue
		}
		val, _ := field["value"].(map[string]interface{})
		if val == nil {
			continue
		}
		result[name] = extractCDCValue(val)
	}
	return result
}

// extractCDCValue recursively extracts a value from JSON-CDC format.
func extractCDCValue(v map[string]interface{}) interface{} {
	if v == nil {
		return nil
	}

	typ, _ := v["type"].(string)
	value := v["value"]

	switch typ {
	case "Optional":
		if value == nil {
			return nil
		}
		inner, ok := value.(map[string]interface{})
		if !ok {
			return nil
		}
		return extractCDCValue(inner)

	case "Bool":
		return value

	case "String", "Character":
		return value

	case "Address":
		// Strip 0x prefix to match SDK's .Hex() output
		if s, ok := value.(string); ok {
			return strings.TrimPrefix(s, "0x")
		}
		return value

	case "UInt8", "UInt16", "UInt32", "UInt64", "UInt128", "UInt256",
		"Int8", "Int16", "Int32", "Int64", "Int128", "Int256",
		"Word8", "Word16", "Word32", "Word64",
		"UFix64", "Fix64":
		return value

	case "Array":
		arr, ok := value.([]interface{})
		if !ok {
			return nil
		}
		result := make([]interface{}, 0, len(arr))
		for _, item := range arr {
			m, ok := item.(map[string]interface{})
			if !ok {
				result = append(result, item)
				continue
			}
			result = append(result, extractCDCValue(m))
		}
		return result

	case "Dictionary":
		arr, ok := value.([]interface{})
		if !ok {
			return nil
		}
		result := make(map[string]interface{}, len(arr))
		for _, item := range arr {
			pair, ok := item.(map[string]interface{})
			if !ok {
				continue
			}
			keyMap, _ := pair["key"].(map[string]interface{})
			valMap, _ := pair["value"].(map[string]interface{})
			if keyMap == nil {
				continue
			}
			key := fmt.Sprintf("%v", extractCDCValue(keyMap))
			if valMap != nil {
				result[key] = extractCDCValue(valMap)
			} else {
				result[key] = nil
			}
		}
		return result

	case "Struct", "Resource", "Event", "Contract", "Enum":
		inner, ok := value.(map[string]interface{})
		if !ok {
			return value
		}
		fields, ok := inner["fields"].([]interface{})
		if !ok {
			return value
		}
		result := make(map[string]interface{}, len(fields))
		for _, f := range fields {
			field, ok := f.(map[string]interface{})
			if !ok {
				continue
			}
			name, _ := field["name"].(string)
			val, _ := field["value"].(map[string]interface{})
			if name != "" && val != nil {
				result[name] = extractCDCValue(val)
			}
		}
		return result

	case "Type":
		inner, ok := value.(map[string]interface{})
		if !ok {
			return value
		}
		staticType, ok := inner["staticType"].(map[string]interface{})
		if ok {
			if typeID, ok := staticType["typeID"].(string); ok {
				return typeID
			}
		}
		return inner

	case "Path":
		inner, ok := value.(map[string]interface{})
		if !ok {
			return value
		}
		domain, _ := inner["domain"].(string)
		identifier, _ := inner["identifier"].(string)
		return fmt.Sprintf("/%s/%s", domain, identifier)

	case "Capability":
		inner, ok := value.(map[string]interface{})
		if !ok {
			return value
		}
		return inner

	case "Void":
		return nil

	default:
		return value
	}
}

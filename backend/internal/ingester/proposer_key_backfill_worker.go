package ingester

import (
	"context"
	"encoding/hex"
	"fmt"
	"log"
	"sync"
	"time"

	"flowscan-clone/internal/repository"

	flowsdk "github.com/onflow/flow-go-sdk"
)

// TransactionFetcher is the subset of the Flow client needed by this worker.
type TransactionFetcher interface {
	GetTransaction(ctx context.Context, txID flowsdk.Identifier) (*flowsdk.Transaction, error)
}

// ProposerKeyBackfillWorker fills in NULL proposer_key_index and
// proposer_sequence_number values on existing raw.transactions rows
// by querying the Flow Access API for each transaction.
type ProposerKeyBackfillWorker struct {
	repo *repository.Repository
	flow TransactionFetcher
}

type proposerKeyUpdate struct {
	txID   string
	height uint64
	keyIdx uint32
	seqNum uint64
}

func NewProposerKeyBackfillWorker(repo *repository.Repository, flow TransactionFetcher) *ProposerKeyBackfillWorker {
	return &ProposerKeyBackfillWorker{repo: repo, flow: flow}
}

func (w *ProposerKeyBackfillWorker) Name() string { return "proposer_key_backfill" }

func (w *ProposerKeyBackfillWorker) ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error {
	// 1. Get transaction IDs in this range that have NULL proposer_key_index.
	txIDs, err := w.repo.GetTxIDsWithNullProposerKey(ctx, fromHeight, toHeight)
	if err != nil {
		return fmt.Errorf("get tx ids with null proposer key: %w", err)
	}

	if len(txIDs) == 0 {
		return nil
	}

	log.Printf("[proposer_key_backfill] Range [%d, %d): %d transactions to backfill", fromHeight, toHeight, len(txIDs))

	// 2. Fetch from chain concurrently and collect updates.
	const fetchConcurrency = 20
	sem := make(chan struct{}, fetchConcurrency)
	var mu sync.Mutex
	var updates []proposerKeyUpdate

	for _, row := range txIDs {
		if ctx.Err() != nil {
			break
		}

		// Parse hex tx ID to flow.Identifier
		idBytes, err := hex.DecodeString(row.ID)
		if err != nil {
			log.Printf("[proposer_key_backfill] invalid tx id hex %s: %v", row.ID, err)
			continue
		}
		var flowID flowsdk.Identifier
		copy(flowID[:], idBytes)

		sem <- struct{}{}
		go func(r repository.TxIDRow, fid flowsdk.Identifier) {
			defer func() { <-sem }()

			fetchCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			tx, err := w.flow.GetTransaction(fetchCtx, fid)
			cancel()

			if err != nil {
				// Only log once per unique tx to avoid spam
				w.repo.LogIndexingError(ctx, w.Name(), r.Height, r.ID, "FETCH_TX", err.Error(), nil)
				return
			}

			mu.Lock()
			updates = append(updates, proposerKeyUpdate{
				txID:   r.ID,
				height: r.Height,
				keyIdx: tx.ProposalKey.KeyIndex,
				seqNum: tx.ProposalKey.SequenceNumber,
			})
			mu.Unlock()
		}(row, flowID)
	}

	// Wait for all in-flight fetches to complete
	for i := 0; i < fetchConcurrency; i++ {
		sem <- struct{}{}
	}

	if ctx.Err() != nil {
		return ctx.Err()
	}

	// 3. Batch update all collected results
	const batchSize = 500
	for i := 0; i < len(updates); i += batchSize {
		end := i + batchSize
		if end > len(updates) {
			end = len(updates)
		}
		if err := w.flushBatch(ctx, updates[i:end]); err != nil {
			return err
		}
	}

	log.Printf("[proposer_key_backfill] Range [%d, %d): updated %d/%d transactions", fromHeight, toHeight, len(updates), len(txIDs))
	return nil
}

func (w *ProposerKeyBackfillWorker) flushBatch(ctx context.Context, batch []proposerKeyUpdate) error {
	ids := make([]string, len(batch))
	heights := make([]uint64, len(batch))
	keyIdxs := make([]uint32, len(batch))
	seqNums := make([]uint64, len(batch))

	for i, u := range batch {
		ids[i] = u.txID
		heights[i] = u.height
		keyIdxs[i] = u.keyIdx
		seqNums[i] = u.seqNum
	}

	return w.repo.BatchUpdateProposerKeys(ctx, ids, heights, keyIdxs, seqNums)
}

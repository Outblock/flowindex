package ingester

import (
	"context"
	"encoding/hex"
	"fmt"
	"log"
	"sync"
	"time"

	"flowscan-clone/internal/repository"

	flow "github.com/onflow/flow-go-sdk"
)

// BlockTransactionFetcher can fetch all transactions for a block at a given height.
type BlockTransactionFetcher interface {
	GetTransactionsByBlockHeight(ctx context.Context, height uint64) ([]*flow.Transaction, error)
}

// TransactionFetcher is the subset of the Flow client needed for per-tx fallback.
type TransactionFetcher interface {
	GetTransaction(ctx context.Context, txID flow.Identifier) (*flow.Transaction, error)
}

// ProposerKeyBackfillWorker fills in NULL proposer_key_index and
// proposer_sequence_number values on existing raw.transactions rows
// by fetching all transactions per block from the Flow Access API.
type ProposerKeyBackfillWorker struct {
	repo      *repository.Repository
	blockFlow BlockTransactionFetcher
	txFlow    TransactionFetcher // fallback for per-tx fetch (unused now)
}

type proposerKeyUpdate struct {
	txID   string
	height uint64
	keyIdx uint32
	seqNum uint64
}

func NewProposerKeyBackfillWorker(repo *repository.Repository, flow interface{}) *ProposerKeyBackfillWorker {
	w := &ProposerKeyBackfillWorker{repo: repo}
	if bf, ok := flow.(BlockTransactionFetcher); ok {
		w.blockFlow = bf
	}
	if tf, ok := flow.(TransactionFetcher); ok {
		w.txFlow = tf
	}
	return w
}

func (w *ProposerKeyBackfillWorker) Name() string { return "proposer_key_backfill" }

func (w *ProposerKeyBackfillWorker) ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error {
	// 1. Get distinct block heights that need backfill.
	heights, err := w.repo.GetBlockHeightsWithNullProposerKey(ctx, fromHeight, toHeight)
	if err != nil {
		return fmt.Errorf("get block heights with null proposer key: %w", err)
	}

	if len(heights) == 0 {
		return nil
	}

	log.Printf("[proposer_key_backfill] Range [%d, %d): %d blocks to backfill", fromHeight, toHeight, len(heights))

	// 2. Fetch all txs per block concurrently.
	const fetchConcurrency = 10
	sem := make(chan struct{}, fetchConcurrency)
	var mu sync.Mutex
	var updates []proposerKeyUpdate
	var fetchErrors int

	for _, h := range heights {
		if ctx.Err() != nil {
			break
		}

		sem <- struct{}{}
		go func(height uint64) {
			defer func() { <-sem }()

			fetchCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
			txs, err := w.blockFlow.GetTransactionsByBlockHeight(fetchCtx, height)
			cancel()

			if err != nil {
				mu.Lock()
				fetchErrors++
				mu.Unlock()
				w.repo.LogIndexingError(ctx, w.Name(), height, "", "FETCH_BLOCK_TXS", err.Error(), nil)
				return
			}

			var local []proposerKeyUpdate
			for _, tx := range txs {
				local = append(local, proposerKeyUpdate{
					txID:   hex.EncodeToString(tx.ID().Bytes()),
					height: height,
					keyIdx: tx.ProposalKey.KeyIndex,
					seqNum: tx.ProposalKey.SequenceNumber,
				})
			}

			mu.Lock()
			updates = append(updates, local...)
			mu.Unlock()
		}(h)
	}

	// Wait for all in-flight fetches
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

	log.Printf("[proposer_key_backfill] Range [%d, %d): updated %d txs from %d blocks (fetch_errors=%d)",
		fromHeight, toHeight, len(updates), len(heights), fetchErrors)
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

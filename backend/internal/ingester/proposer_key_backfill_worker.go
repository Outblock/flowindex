package ingester

import (
	"context"
	"encoding/hex"
	"fmt"
	"log"
	"time"

	flowclient "flowscan-clone/internal/flow"
	"flowscan-clone/internal/repository"

	flowsdk "github.com/onflow/flow-go-sdk"
)

// ProposerKeyBackfillWorker fills in NULL proposer_key_index and
// proposer_sequence_number values on existing raw.transactions rows
// by querying the Flow Access API for each transaction.
type ProposerKeyBackfillWorker struct {
	repo *repository.Repository
	flow *flowclient.Client
}

type proposerKeyUpdate struct {
	txID   string
	height uint64
	keyIdx uint32
	seqNum uint64
}

func NewProposerKeyBackfillWorker(repo *repository.Repository, flow *flowclient.Client) *ProposerKeyBackfillWorker {
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

	// 2. Fetch from chain and batch update.
	const batchSize = 100
	var batch []proposerKeyUpdate

	for _, row := range txIDs {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		// Parse hex tx ID to flow.Identifier
		idBytes, err := hex.DecodeString(row.ID)
		if err != nil {
			log.Printf("[proposer_key_backfill] invalid tx id hex %s: %v", row.ID, err)
			continue
		}
		var flowID flowsdk.Identifier
		copy(flowID[:], idBytes)

		// Fetch transaction from chain with timeout
		fetchCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		tx, err := w.flow.GetTransaction(fetchCtx, flowID)
		cancel()

		if err != nil {
			log.Printf("[proposer_key_backfill] failed to fetch tx %s: %v", row.ID, err)
			w.repo.LogIndexingError(ctx, w.Name(), row.Height, row.ID, "FETCH_TX", err.Error(), nil)
			continue // Skip this tx, don't fail the whole range
		}

		batch = append(batch, proposerKeyUpdate{
			txID:   row.ID,
			height: row.Height,
			keyIdx: tx.ProposalKey.KeyIndex,
			seqNum: tx.ProposalKey.SequenceNumber,
		})

		// Flush batch
		if len(batch) >= batchSize {
			if err := w.flushBatch(ctx, batch); err != nil {
				return err
			}
			batch = batch[:0]
		}
	}

	// Flush remaining
	if len(batch) > 0 {
		if err := w.flushBatch(ctx, batch); err != nil {
			return err
		}
	}

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

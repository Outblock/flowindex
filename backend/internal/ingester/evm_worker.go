package ingester

import (
	"context"
	"encoding/json"
	"fmt"

	"flowscan-clone/internal/models"
	"flowscan-clone/internal/repository"
)

// EVMWorker parses EVM events from raw.events and materializes app.evm_* tables.
type EVMWorker struct {
	repo *repository.Repository
}

func NewEVMWorker(repo *repository.Repository) *EVMWorker {
	return &EVMWorker{repo: repo}
}

func (w *EVMWorker) Name() string {
	return "evm_worker"
}

func (w *EVMWorker) ProcessRange(ctx context.Context, fromHeight, toHeight uint64) error {
	events, err := w.repo.GetRawEventsInRange(ctx, fromHeight, toHeight)
	if err != nil {
		return fmt.Errorf("fetch raw events: %w", err)
	}

	hashes := make([]models.EVMTxHash, 0)
	for _, evt := range events {
		if !isEVMTransactionExecutedEvent(evt.Type) {
			continue
		}

		var payload map[string]interface{}
		if err := json.Unmarshal(evt.Payload, &payload); err != nil {
			continue
		}

		h := extractEVMHashFromPayload(payload)
		if h == "" {
			continue
		}

		hashes = append(hashes, models.EVMTxHash{
			BlockHeight:   evt.BlockHeight,
			TransactionID: evt.TransactionID,
			EVMHash:       h,
			EventIndex:    evt.EventIndex,
			Timestamp:     evt.Timestamp,
		})
	}

	if len(hashes) == 0 {
		return nil
	}

	minHeight := hashes[0].BlockHeight
	maxHeight := hashes[0].BlockHeight
	for _, row := range hashes[1:] {
		if row.BlockHeight < minHeight {
			minHeight = row.BlockHeight
		}
		if row.BlockHeight > maxHeight {
			maxHeight = row.BlockHeight
		}
	}

	if err := w.repo.EnsureAppPartitions(ctx, minHeight, maxHeight); err != nil {
		return fmt.Errorf("ensure app partitions: %w", err)
	}

	if err := w.repo.UpsertEVMTxHashes(ctx, hashes); err != nil {
		return fmt.Errorf("upsert evm tx hashes: %w", err)
	}

	return nil
}

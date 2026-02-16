package repository

import (
	"context"
	"fmt"
	"sync"
)

const (
	blocksStep         = uint64(5_000_000)
	transactionsStep   = uint64(5_000_000)
	eventsStep         = uint64(10_000_000)
	tokenStep          = uint64(10_000_000)
	evmStep            = uint64(10_000_000)
	stakingStep        = uint64(5_000_000)
	defiStep           = uint64(5_000_000)
	partitionLookahead = uint64(2)
)

// partitionCache tracks which (table, startBucket, endBucket) combos have already
// been ensured this process lifetime, avoiding redundant DB round-trips.
var (
	partitionCacheMu sync.Mutex
	partitionCache   = make(map[string]bool)
)

func partitionCacheKey(table string, start, end uint64) string {
	return fmt.Sprintf("%s:%d:%d", table, start, end)
}

// EnsureRawPartitions creates partitions on-demand for raw tables.
func (r *Repository) EnsureRawPartitions(ctx context.Context, minHeight, maxHeight uint64) error {
	if err := r.createPartitions(ctx, "raw.blocks", minHeight, maxHeight, blocksStep); err != nil {
		return err
	}
	if err := r.createPartitions(ctx, "raw.transactions", minHeight, maxHeight, transactionsStep); err != nil {
		return err
	}
	if err := r.createPartitions(ctx, "raw.events", minHeight, maxHeight, eventsStep); err != nil {
		return err
	}
	return nil
}

// EnsureAppPartitions creates partitions on-demand for derived tables.
func (r *Repository) EnsureAppPartitions(ctx context.Context, minHeight, maxHeight uint64) error {
	if err := r.createPartitions(ctx, "app.ft_transfers", minHeight, maxHeight, tokenStep); err != nil {
		return err
	}
	if err := r.createPartitions(ctx, "app.nft_transfers", minHeight, maxHeight, tokenStep); err != nil {
		return err
	}
	if err := r.createPartitions(ctx, "app.evm_transactions", minHeight, maxHeight, evmStep); err != nil {
		return err
	}
	if err := r.createPartitions(ctx, "app.evm_tx_hashes", minHeight, maxHeight, evmStep); err != nil {
		return err
	}
	return nil
}

// EnsureDefiPartitions creates partitions on-demand for defi tables.
func (r *Repository) EnsureDefiPartitions(ctx context.Context, minHeight, maxHeight uint64) error {
	return r.createPartitions(ctx, "app.defi_events", minHeight, maxHeight, defiStep)
}

// EnsureStakingPartitions creates partitions on-demand for staking tables.
func (r *Repository) EnsureStakingPartitions(ctx context.Context, minHeight, maxHeight uint64) error {
	return r.createPartitions(ctx, "app.staking_events", minHeight, maxHeight, stakingStep)
}

func (r *Repository) createPartitions(ctx context.Context, table string, minHeight, maxHeight, step uint64) error {
	if step == 0 {
		return fmt.Errorf("partition step must be > 0")
	}

	start := (minHeight / step) * step
	end := ((maxHeight / step) + 1 + partitionLookahead) * step

	// Fast path: skip the DB call if we already ensured this exact range.
	key := partitionCacheKey(table, start, end)
	partitionCacheMu.Lock()
	if partitionCache[key] {
		partitionCacheMu.Unlock()
		return nil
	}
	partitionCacheMu.Unlock()

	_, err := r.db.Exec(ctx, "SELECT raw.create_partitions($1::regclass, $2, $3, $4)", table, start, end, step)
	if err != nil {
		return fmt.Errorf("create partitions for %s: %w", table, err)
	}

	partitionCacheMu.Lock()
	partitionCache[key] = true
	partitionCacheMu.Unlock()
	return nil
}

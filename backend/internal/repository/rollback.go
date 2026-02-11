package repository

import (
	"context"
	"fmt"
	"log"
)

// GetBlockIDByHeight returns the block ID for a given height (if present).
func (r *Repository) GetBlockIDByHeight(ctx context.Context, height uint64) (string, error) {
	var id string
	err := r.db.QueryRow(ctx, "SELECT id FROM raw.blocks WHERE height = $1", height).Scan(&id)
	if err != nil {
		return "", err
	}
	return id, nil
}

// RollbackFromHeight deletes raw + derived data at or above the given height.
// This performs a surgical rollback: state tables with height tracking are deleted
// precisely rather than truncated, and worker checkpoints are clamped rather than zeroed.
func (r *Repository) RollbackFromHeight(ctx context.Context, rollbackHeight uint64) error {
	checkpointHeight := uint64(0)
	if rollbackHeight > 0 {
		checkpointHeight = rollbackHeight - 1
	}

	log.Printf("[rollback] Starting surgical rollback from height %d (checkpoint will be %d)", rollbackHeight, checkpointHeight)

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Raw tables
	if _, err := tx.Exec(ctx, "DELETE FROM raw.events WHERE block_height >= $1", rollbackHeight); err != nil {
		return fmt.Errorf("rollback raw.events: %w", err)
	}
	if _, err := tx.Exec(ctx, "DELETE FROM raw.transactions WHERE block_height >= $1", rollbackHeight); err != nil {
		return fmt.Errorf("rollback raw.transactions: %w", err)
	}
	if _, err := tx.Exec(ctx, "DELETE FROM raw.blocks WHERE height >= $1", rollbackHeight); err != nil {
		return fmt.Errorf("rollback raw.blocks: %w", err)
	}
	if _, err := tx.Exec(ctx, "DELETE FROM raw.collections WHERE block_height >= $1", rollbackHeight); err != nil {
		return fmt.Errorf("rollback raw.collections: %w", err)
	}
	if _, err := tx.Exec(ctx, "DELETE FROM raw.execution_results WHERE block_height >= $1", rollbackHeight); err != nil {
		return fmt.Errorf("rollback raw.execution_results: %w", err)
	}

	// Lookups
	if _, err := tx.Exec(ctx, "DELETE FROM raw.tx_lookup WHERE block_height >= $1", rollbackHeight); err != nil {
		return fmt.Errorf("rollback raw.tx_lookup: %w", err)
	}
	if _, err := tx.Exec(ctx, "DELETE FROM raw.block_lookup WHERE height >= $1", rollbackHeight); err != nil {
		return fmt.Errorf("rollback raw.block_lookup: %w", err)
	}

	// Derived tables with block_height — precise deletes
	if _, err := tx.Exec(ctx, "DELETE FROM app.ft_transfers WHERE block_height >= $1", rollbackHeight); err != nil {
		return fmt.Errorf("rollback app.ft_transfers: %w", err)
	}
	if _, err := tx.Exec(ctx, "DELETE FROM app.nft_transfers WHERE block_height >= $1", rollbackHeight); err != nil {
		return fmt.Errorf("rollback app.nft_transfers: %w", err)
	}
	if _, err := tx.Exec(ctx, "DELETE FROM app.evm_transactions WHERE block_height >= $1", rollbackHeight); err != nil {
		return fmt.Errorf("rollback app.evm_transactions: %w", err)
	}
	if _, err := tx.Exec(ctx, "DELETE FROM app.evm_tx_hashes WHERE block_height >= $1", rollbackHeight); err != nil {
		return fmt.Errorf("rollback app.evm_tx_hashes: %w", err)
	}
	if _, err := tx.Exec(ctx, "DELETE FROM app.address_transactions WHERE block_height >= $1", rollbackHeight); err != nil {
		return fmt.Errorf("rollback app.address_transactions: %w", err)
	}
	if _, err := tx.Exec(ctx, "DELETE FROM app.tx_metrics WHERE block_height >= $1", rollbackHeight); err != nil {
		return fmt.Errorf("rollback app.tx_metrics: %w", err)
	}

	// State tables — surgical deletes using height columns instead of TRUNCATE.
	// account_keys has last_updated_height
	if _, err := tx.Exec(ctx, "DELETE FROM app.account_keys WHERE last_updated_height >= $1", rollbackHeight); err != nil {
		return fmt.Errorf("rollback app.account_keys: %w", err)
	}
	// smart_contracts has last_updated_height
	if _, err := tx.Exec(ctx, "DELETE FROM app.smart_contracts WHERE last_updated_height >= $1", rollbackHeight); err != nil {
		return fmt.Errorf("rollback app.smart_contracts: %w", err)
	}
	// daily_stats: only delete recent days that could be affected
	if _, err := tx.Exec(ctx, `
		DELETE FROM app.daily_stats
		WHERE date >= (SELECT MIN(timestamp)::date FROM raw.blocks WHERE height = $1)`, rollbackHeight); err != nil {
		// Non-fatal: daily_stats are periodically refreshed anyway
		log.Printf("[rollback] Warning: could not prune daily_stats: %v", err)
	}
	// address_stats: recalculate only affected addresses rather than truncating all.
	// We delete stats for addresses that had transactions in the rolled-back range,
	// and let the MetaWorker re-derive them.
	if _, err := tx.Exec(ctx, `
		DELETE FROM app.address_stats
		WHERE address IN (
			SELECT DISTINCT address FROM app.address_transactions WHERE block_height >= $1
		)`, rollbackHeight); err != nil {
		return fmt.Errorf("rollback app.address_stats: %w", err)
	}
	// tx_contracts: has transaction_id linkage but no direct height — delete via join
	if _, err := tx.Exec(ctx, `
		DELETE FROM app.tx_contracts
		WHERE transaction_id IN (
			SELECT id FROM raw.transactions WHERE block_height >= $1
		)`, rollbackHeight); err != nil {
		// Non-fatal: these are idempotently rebuilt
		log.Printf("[rollback] Warning: could not prune tx_contracts: %v", err)
	}
	// tx_tags: same pattern
	if _, err := tx.Exec(ctx, `
		DELETE FROM app.tx_tags
		WHERE transaction_id IN (
			SELECT id FROM raw.transactions WHERE block_height >= $1
		)`, rollbackHeight); err != nil {
		log.Printf("[rollback] Warning: could not prune tx_tags: %v", err)
	}

	// Worker leases: only delete leases that overlap with the rollback range
	if _, err := tx.Exec(ctx, "DELETE FROM app.worker_leases WHERE to_height > $1", rollbackHeight); err != nil {
		return fmt.Errorf("rollback app.worker_leases: %w", err)
	}

	// Reset main_ingester checkpoint
	if _, err := tx.Exec(ctx, "UPDATE app.indexing_checkpoints SET last_height = $1, updated_at = NOW() WHERE service_name = 'main_ingester'", checkpointHeight); err != nil {
		return fmt.Errorf("rollback main_ingester checkpoint: %w", err)
	}
	// Clamp worker checkpoints to rollbackHeight-1 instead of zeroing them.
	// Workers that were already behind the rollback point keep their progress.
	if _, err := tx.Exec(ctx, `
		UPDATE app.indexing_checkpoints
		SET last_height = LEAST(last_height, $1), updated_at = NOW()
		WHERE service_name != 'main_ingester'`, checkpointHeight); err != nil {
		return fmt.Errorf("rollback worker checkpoints: %w", err)
	}

	log.Printf("[rollback] Surgical rollback to height %d complete", rollbackHeight)
	return tx.Commit(ctx)
}

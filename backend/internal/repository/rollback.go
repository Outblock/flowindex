package repository

import (
	"context"
	"fmt"
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
// This is a safety valve for parent mismatch handling.
func (r *Repository) RollbackFromHeight(ctx context.Context, rollbackHeight uint64) error {
	checkpointHeight := uint64(0)
	if rollbackHeight > 0 {
		checkpointHeight = rollbackHeight - 1
	}

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

	// Derived tables with block_height
	if _, err := tx.Exec(ctx, "DELETE FROM app.token_transfers WHERE block_height >= $1", rollbackHeight); err != nil {
		return fmt.Errorf("rollback app.token_transfers: %w", err)
	}
	if _, err := tx.Exec(ctx, "DELETE FROM app.evm_transactions WHERE block_height >= $1", rollbackHeight); err != nil {
		return fmt.Errorf("rollback app.evm_transactions: %w", err)
	}
	if _, err := tx.Exec(ctx, "DELETE FROM app.address_transactions WHERE block_height >= $1", rollbackHeight); err != nil {
		return fmt.Errorf("rollback app.address_transactions: %w", err)
	}

	// State tables are harder to roll back precisely; reset to be rebuilt by workers.
	if _, err := tx.Exec(ctx, "TRUNCATE app.address_stats, app.smart_contracts, app.account_keys, app.daily_stats"); err != nil {
		return fmt.Errorf("rollback app state tables: %w", err)
	}

	// Reset worker leases
	if _, err := tx.Exec(ctx, "DELETE FROM app.worker_leases"); err != nil {
		return fmt.Errorf("rollback app.worker_leases: %w", err)
	}

	// Reset checkpoints to allow reprocessing
	if _, err := tx.Exec(ctx, "UPDATE app.indexing_checkpoints SET last_height = $1, updated_at = NOW() WHERE service_name = 'main_ingester'", checkpointHeight); err != nil {
		return fmt.Errorf("rollback main_ingester checkpoint: %w", err)
	}
	if _, err := tx.Exec(ctx, "UPDATE app.indexing_checkpoints SET last_height = 0, updated_at = NOW() WHERE service_name != 'main_ingester'"); err != nil {
		return fmt.Errorf("rollback worker checkpoints: %w", err)
	}

	return tx.Commit(ctx)
}

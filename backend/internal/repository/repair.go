package repository

import (
	"context"
	"fmt"
)

// RepairTxLookup backfills missing tx_lookup rows and removes orphans (bounded by limit).
func (r *Repository) RepairTxLookup(ctx context.Context, limit int) error {
	if limit <= 0 {
		limit = 1000
	}

	// Backfill missing
	_, err := r.db.Exec(ctx, `
		WITH missing AS (
			SELECT t.id, t.block_height, t.transaction_index, t.timestamp
			FROM raw.transactions t
			LEFT JOIN raw.tx_lookup l ON l.id = t.id
			WHERE l.id IS NULL
			ORDER BY t.block_height DESC
			LIMIT $1
		)
		INSERT INTO raw.tx_lookup (id, block_height, transaction_index, timestamp)
		SELECT id, block_height, transaction_index, timestamp
		FROM missing
		ON CONFLICT (id) DO UPDATE SET
			block_height = EXCLUDED.block_height,
			transaction_index = EXCLUDED.transaction_index,
			timestamp = EXCLUDED.timestamp`, limit)
	if err != nil {
		return fmt.Errorf("repair tx_lookup backfill: %w", err)
	}

	// Remove orphans
	_, err = r.db.Exec(ctx, `
		WITH orphan AS (
			SELECT l.id
			FROM raw.tx_lookup l
			LEFT JOIN raw.transactions t ON t.id = l.id AND t.block_height = l.block_height
			WHERE t.id IS NULL
			LIMIT $1
		)
		DELETE FROM raw.tx_lookup WHERE id IN (SELECT id FROM orphan)`, limit)
	if err != nil {
		return fmt.Errorf("repair tx_lookup orphan delete: %w", err)
	}

	return nil
}

// RepairBlockLookup backfills missing block_lookup rows and removes orphans (bounded by limit).
func (r *Repository) RepairBlockLookup(ctx context.Context, limit int) error {
	if limit <= 0 {
		limit = 1000
	}

	_, err := r.db.Exec(ctx, `
		WITH missing AS (
			SELECT b.id, b.height, b.timestamp
			FROM raw.blocks b
			LEFT JOIN raw.block_lookup l ON l.id = b.id
			WHERE l.id IS NULL
			ORDER BY b.height DESC
			LIMIT $1
		)
		INSERT INTO raw.block_lookup (id, height, timestamp)
		SELECT id, height, timestamp
		FROM missing
		ON CONFLICT (id) DO UPDATE SET
			height = EXCLUDED.height,
			timestamp = EXCLUDED.timestamp`, limit)
	if err != nil {
		return fmt.Errorf("repair block_lookup backfill: %w", err)
	}

	_, err = r.db.Exec(ctx, `
		WITH orphan AS (
			SELECT l.id
			FROM raw.block_lookup l
			LEFT JOIN raw.blocks b ON b.id = l.id AND b.height = l.height
			WHERE b.id IS NULL
			LIMIT $1
		)
		DELETE FROM raw.block_lookup WHERE id IN (SELECT id FROM orphan)`, limit)
	if err != nil {
		return fmt.Errorf("repair block_lookup orphan delete: %w", err)
	}

	return nil
}

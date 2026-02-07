package repository

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// GetIndexedTipHeight returns the highest block height present in the DB.
// Prefer raw.block_lookup to avoid partition scans.
func (r *Repository) GetIndexedTipHeight(ctx context.Context) (uint64, error) {
	var h uint64
	err := r.db.QueryRow(ctx, `
		SELECT height
		FROM raw.block_lookup
		ORDER BY height DESC
		LIMIT 1`).Scan(&h)
	if err == pgx.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return h, nil
}

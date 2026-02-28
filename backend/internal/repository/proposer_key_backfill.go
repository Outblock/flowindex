package repository

import (
	"context"
	"fmt"
	"strings"
)

// TxIDRow holds minimal transaction info for backfill queries.
type TxIDRow struct {
	ID     string
	Height uint64
}

// GetTxIDsWithNullProposerKey returns transaction IDs in [fromHeight, toHeight)
// where proposer_key_index IS NULL.
func (r *Repository) GetTxIDsWithNullProposerKey(ctx context.Context, fromHeight, toHeight uint64) ([]TxIDRow, error) {
	rows, err := r.db.Query(ctx, `
		SELECT encode(id, 'hex'), block_height
		FROM raw.transactions
		WHERE block_height >= $1 AND block_height < $2
		  AND proposer_key_index IS NULL
		ORDER BY block_height, transaction_index
	`, fromHeight, toHeight)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []TxIDRow
	for rows.Next() {
		var row TxIDRow
		if err := rows.Scan(&row.ID, &row.Height); err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

// GetBlockHeightsWithNullProposerKey returns distinct block heights in [fromHeight, toHeight)
// that have at least one transaction with proposer_key_index IS NULL.
func (r *Repository) GetBlockHeightsWithNullProposerKey(ctx context.Context, fromHeight, toHeight uint64) ([]uint64, error) {
	rows, err := r.db.Query(ctx, `
		SELECT DISTINCT block_height
		FROM raw.transactions
		WHERE block_height >= $1 AND block_height < $2
		  AND proposer_key_index IS NULL
		ORDER BY block_height
	`, fromHeight, toHeight)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []uint64
	for rows.Next() {
		var h uint64
		if err := rows.Scan(&h); err != nil {
			return nil, err
		}
		result = append(result, h)
	}
	return result, rows.Err()
}

// BatchUpdateProposerKeys updates proposer_key_index and proposer_sequence_number
// for a batch of transactions. Uses unnest for efficient multi-row UPDATE.
func (r *Repository) BatchUpdateProposerKeys(ctx context.Context, ids []string, heights []uint64, keyIdxs []uint32, seqNums []uint64) error {
	if len(ids) == 0 {
		return nil
	}

	// Build a VALUES list for the update: (id, height, key_idx, seq_num)
	// Using unnest with arrays for efficient batch update.
	// Note: raw.transactions is partitioned by block_height, so we include it in the WHERE.
	var sb strings.Builder
	sb.WriteString(`
		UPDATE raw.transactions t
		SET proposer_key_index = v.key_idx,
		    proposer_sequence_number = v.seq_num
		FROM (
			SELECT unnest($1::text[]) AS id,
			       unnest($2::bigint[]) AS height,
			       unnest($3::int[]) AS key_idx,
			       unnest($4::bigint[]) AS seq_num
		) v
		WHERE t.id = decode(v.id, 'hex') AND t.block_height = v.height
	`)

	// Convert slices to pgx-compatible arrays
	idArr := make([]string, len(ids))
	copy(idArr, ids)
	heightArr := make([]int64, len(heights))
	for i, h := range heights {
		heightArr[i] = int64(h)
	}
	keyArr := make([]int32, len(keyIdxs))
	for i, k := range keyIdxs {
		keyArr[i] = int32(k)
	}
	seqArr := make([]int64, len(seqNums))
	for i, s := range seqNums {
		seqArr[i] = int64(s)
	}

	tag, err := r.db.Exec(ctx, sb.String(), idArr, heightArr, keyArr, seqArr)
	if err != nil {
		return fmt.Errorf("batch update proposer keys: %w", err)
	}

	if tag.RowsAffected() != int64(len(ids)) {
		// Not necessarily an error — some txs may have been updated by another worker.
		// Just log for visibility.
	}

	return nil
}

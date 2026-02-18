package repository

import "context"

type TxMetrics struct {
	EventCount int
	GasUsed    uint64
	Fee        float64
}

func (r *Repository) GetTransactionFeesByIDs(ctx context.Context, txIDs []string) (map[string]float64, error) {
	fees := make(map[string]float64)
	if len(txIDs) == 0 {
		return fees, nil
	}

	rows, err := r.db.Query(ctx, `
		WITH input_ids AS (
			SELECT DISTINCT unnest($1::bytea[]) AS transaction_id
		),
		lookup AS (
			SELECT i.transaction_id, l.block_height
			FROM input_ids i
			JOIN raw.tx_lookup l ON l.id = i.transaction_id
		)
		SELECT encode(m.transaction_id, 'hex') AS transaction_id, COALESCE(m.fee, 0)
		FROM lookup l
		JOIN app.tx_metrics m
		  ON m.transaction_id = l.transaction_id
		 AND m.block_height = l.block_height`, sliceHexToBytes(txIDs))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var id string
		var fee float64
		if err := rows.Scan(&id, &fee); err != nil {
			return nil, err
		}
		fees[id] = fee
	}
	return fees, rows.Err()
}

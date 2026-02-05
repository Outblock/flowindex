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
		SELECT transaction_id, COALESCE(fee, 0)
		FROM app.tx_metrics
		WHERE transaction_id = ANY($1)`, txIDs)
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

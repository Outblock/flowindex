package repository

import (
	"context"
	"time"
)

type AnalyticsDailyRow struct {
	Date           string  `json:"date"`
	TxCount        int64   `json:"tx_count"`
	EVMTxCount     int64   `json:"evm_tx_count"`
	CadenceTxCount int64   `json:"cadence_tx_count"`
	TotalGasUsed   int64   `json:"total_gas_used"`
	ActiveAccounts int64   `json:"active_accounts"`
	NewContracts   int     `json:"new_contracts"`
	FailedTxCount  int64   `json:"failed_tx_count"`
	ErrorRate      float64 `json:"error_rate"`
	AvgGasPerTx    float64 `json:"avg_gas_per_tx"`
}

// GetAnalyticsDailyStats returns enriched daily stats with error rates and computed fields.
func (r *Repository) GetAnalyticsDailyStats(ctx context.Context, from, to time.Time) ([]AnalyticsDailyRow, error) {
	query := `
		WITH ds AS (
			SELECT date, tx_count, COALESCE(evm_tx_count, 0) AS evm_tx_count,
				COALESCE(total_gas_used, 0) AS total_gas_used,
				active_accounts, new_contracts
			FROM app.daily_stats
			WHERE date >= $1::date AND date <= $2::date
			ORDER BY date ASC
		),
		errors AS (
			SELECT date_trunc('day', l.timestamp)::date AS date,
				COUNT(*) FILTER (WHERE m.execution_status IS NOT NULL AND m.execution_status <> '0' AND m.execution_status <> '') AS failed_count
			FROM app.tx_metrics m
			JOIN raw.tx_lookup l ON l.id = m.transaction_id AND l.block_height = m.block_height
			WHERE l.timestamp >= $1::timestamptz AND l.timestamp < ($2::date + interval '1 day')
			GROUP BY 1
		)
		SELECT ds.date::text, ds.tx_count, ds.evm_tx_count,
			(ds.tx_count - ds.evm_tx_count) AS cadence_tx_count,
			ds.total_gas_used, ds.active_accounts, ds.new_contracts,
			COALESCE(e.failed_count, 0) AS failed_tx_count,
			CASE WHEN ds.tx_count > 0
				THEN ROUND((COALESCE(e.failed_count, 0)::numeric / ds.tx_count * 100), 2)
				ELSE 0 END AS error_rate,
			CASE WHEN ds.tx_count > 0
				THEN ROUND((ds.total_gas_used::numeric / ds.tx_count), 2)
				ELSE 0 END AS avg_gas_per_tx
		FROM ds
		LEFT JOIN errors e ON e.date = ds.date
		ORDER BY ds.date ASC`

	rows, err := r.db.Query(ctx, query, from.UTC(), to.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []AnalyticsDailyRow
	for rows.Next() {
		var row AnalyticsDailyRow
		if err := rows.Scan(
			&row.Date, &row.TxCount, &row.EVMTxCount, &row.CadenceTxCount,
			&row.TotalGasUsed, &row.ActiveAccounts, &row.NewContracts,
			&row.FailedTxCount, &row.ErrorRate, &row.AvgGasPerTx,
		); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

type TransferDailyRow struct {
	Date         string `json:"date"`
	FTTransfers  int64  `json:"ft_transfers"`
	NFTTransfers int64  `json:"nft_transfers"`
}

// GetTransferDailyStats returns daily FT and NFT transfer counts.
func (r *Repository) GetTransferDailyStats(ctx context.Context, from, to time.Time) ([]TransferDailyRow, error) {
	query := `
		WITH dates AS (
			SELECT generate_series($1::date, $2::date, '1 day'::interval)::date AS date
		),
		ft AS (
			SELECT date_trunc('day', timestamp)::date AS date, COUNT(*) AS cnt
			FROM app.ft_transfers
			WHERE timestamp >= $1::timestamptz AND timestamp < ($2::date + interval '1 day')
			GROUP BY 1
		),
		nft AS (
			SELECT date_trunc('day', timestamp)::date AS date, COUNT(*) AS cnt
			FROM app.nft_transfers
			WHERE timestamp >= $1::timestamptz AND timestamp < ($2::date + interval '1 day')
			GROUP BY 1
		)
		SELECT d.date::text, COALESCE(f.cnt, 0), COALESCE(n.cnt, 0)
		FROM dates d
		LEFT JOIN ft f ON f.date = d.date
		LEFT JOIN nft n ON n.date = d.date
		ORDER BY d.date ASC`

	rows, err := r.db.Query(ctx, query, from.UTC(), to.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []TransferDailyRow
	for rows.Next() {
		var row TransferDailyRow
		if err := rows.Scan(&row.Date, &row.FTTransfers, &row.NFTTransfers); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

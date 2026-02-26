package repository

import (
	"context"
	"time"
)

type AnalyticsDailyRow struct {
	Date               string  `json:"date"`
	TxCount            int64   `json:"tx_count"`
	EVMTxCount         int64   `json:"evm_tx_count"`
	CadenceTxCount     int64   `json:"cadence_tx_count"`
	TotalGasUsed       int64   `json:"total_gas_used"`
	ActiveAccounts     int64   `json:"active_accounts"`
	NewContracts       int     `json:"new_contracts"`
	FailedTxCount      int64   `json:"failed_tx_count"`
	ErrorRate          float64 `json:"error_rate"`
	AvgGasPerTx        float64 `json:"avg_gas_per_tx"`
	NewAccounts        int64   `json:"new_accounts"`
	COANewAccounts     int64   `json:"coa_new_accounts"`
	EVMActiveAddresses int64   `json:"evm_active_addresses"`
	DefiSwapCount      int64   `json:"defi_swap_count"`
	DefiUniqueTraders  int64   `json:"defi_unique_traders"`
	EpochPayoutTotal   string  `json:"epoch_payout_total"`
	BridgeToEVMTxs     int64   `json:"bridge_to_evm_txs"`
}

// GetAnalyticsDailyStats returns daily analytics from app.daily_stats and enriches
// module metrics with independent queries so one slow module does not block all data.
func (r *Repository) GetAnalyticsDailyStats(ctx context.Context, from, to time.Time) ([]AnalyticsDailyRow, error) {
	// Keep this endpoint fast and stable for dashboard rendering.
	// Module-level enriched metrics are fetched separately.
	return r.GetAnalyticsDailyBaseStats(ctx, from, to)
}

// GetAnalyticsDailyAccountsModule returns daily new-account metrics only.
func (r *Repository) GetAnalyticsDailyAccountsModule(ctx context.Context, from, to time.Time) ([]AnalyticsDailyRow, error) {
	query := `
		WITH dates AS (
			SELECT generate_series($1::date, $2::date, '1 day'::interval)::date AS date
		),
		new_accounts AS (
			SELECT DATE(b.timestamp)::date AS date, COUNT(*)::bigint AS cnt
			FROM app.accounts a
			JOIN raw.blocks b ON b.height = a.first_seen_height
			WHERE b.timestamp >= $1::timestamptz
			  AND b.timestamp < ($2::date + interval '1 day')
			GROUP BY 1
		),
		coa_new AS (
			SELECT DATE(b.timestamp)::date AS date, COUNT(*)::bigint AS cnt
			FROM app.coa_accounts c
			JOIN raw.blocks b ON b.height = c.block_height
			WHERE b.timestamp >= $1::timestamptz
			  AND b.timestamp < ($2::date + interval '1 day')
			GROUP BY 1
		)
		SELECT d.date::text,
			COALESCE(a.cnt, 0)::bigint,
			COALESCE(c.cnt, 0)::bigint
		FROM dates d
		LEFT JOIN new_accounts a ON a.date = d.date
		LEFT JOIN coa_new c ON c.date = d.date
		ORDER BY d.date ASC`
	rows, err := r.db.Query(ctx, query, from.UTC(), to.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]AnalyticsDailyRow, 0)
	for rows.Next() {
		var row AnalyticsDailyRow
		if err := rows.Scan(&row.Date, &row.NewAccounts, &row.COANewAccounts); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// GetAnalyticsDailyEVMModule returns daily EVM active-address metric only.
func (r *Repository) GetAnalyticsDailyEVMModule(ctx context.Context, from, to time.Time) ([]AnalyticsDailyRow, error) {
	query := `
		WITH dates AS (
			SELECT generate_series($1::date, $2::date, '1 day'::interval)::date AS date
		),
		evm_active AS (
			SELECT d::date AS date, COUNT(DISTINCT addr)::bigint AS cnt
			FROM (
				SELECT DATE(timestamp) AS d, from_address AS addr
				FROM app.evm_transactions
				WHERE timestamp >= $1::timestamptz
				  AND timestamp < ($2::date + interval '1 day')
				  AND from_address IS NOT NULL
				UNION ALL
				SELECT DATE(timestamp) AS d, to_address AS addr
				FROM app.evm_transactions
				WHERE timestamp >= $1::timestamptz
				  AND timestamp < ($2::date + interval '1 day')
				  AND to_address IS NOT NULL
			) x
			GROUP BY 1
		)
		SELECT d.date::text, COALESCE(e.cnt, 0)::bigint
		FROM dates d
		LEFT JOIN evm_active e ON e.date = d.date
		ORDER BY d.date ASC`
	rows, err := r.db.Query(ctx, query, from.UTC(), to.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]AnalyticsDailyRow, 0)
	for rows.Next() {
		var row AnalyticsDailyRow
		if err := rows.Scan(&row.Date, &row.EVMActiveAddresses); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// GetAnalyticsDailyDefiModule returns daily DeFi swap metrics only.
func (r *Repository) GetAnalyticsDailyDefiModule(ctx context.Context, from, to time.Time) ([]AnalyticsDailyRow, error) {
	query := `
		WITH dates AS (
			SELECT generate_series($1::date, $2::date, '1 day'::interval)::date AS date
		),
		defi AS (
			SELECT DATE(timestamp)::date AS date,
				COUNT(*) FILTER (WHERE event_type = 'Swap')::bigint AS swap_count,
				COUNT(DISTINCT maker) FILTER (WHERE event_type = 'Swap' AND maker IS NOT NULL)::bigint AS traders
			FROM app.defi_events
			WHERE timestamp >= $1::timestamptz
			  AND timestamp < ($2::date + interval '1 day')
			GROUP BY 1
		)
		SELECT d.date::text,
			COALESCE(f.swap_count, 0)::bigint,
			COALESCE(f.traders, 0)::bigint
		FROM dates d
		LEFT JOIN defi f ON f.date = d.date
		ORDER BY d.date ASC`
	rows, err := r.db.Query(ctx, query, from.UTC(), to.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]AnalyticsDailyRow, 0)
	for rows.Next() {
		var row AnalyticsDailyRow
		if err := rows.Scan(&row.Date, &row.DefiSwapCount, &row.DefiUniqueTraders); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// GetAnalyticsDailyEpochModule returns daily epoch payout metric only.
func (r *Repository) GetAnalyticsDailyEpochModule(ctx context.Context, from, to time.Time) ([]AnalyticsDailyRow, error) {
	query := `
		WITH dates AS (
			SELECT generate_series($1::date, $2::date, '1 day'::interval)::date AS date
		),
		payouts AS (
			SELECT DATE(payout_time)::date AS date, COALESCE(SUM(payout_total), 0)::text AS total
			FROM app.epoch_stats
			WHERE payout_time >= $1::timestamptz
			  AND payout_time < ($2::date + interval '1 day')
			GROUP BY 1
		)
		SELECT d.date::text, COALESCE(p.total, '0')
		FROM dates d
		LEFT JOIN payouts p ON p.date = d.date
		ORDER BY d.date ASC`
	rows, err := r.db.Query(ctx, query, from.UTC(), to.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]AnalyticsDailyRow, 0)
	for rows.Next() {
		var row AnalyticsDailyRow
		if err := rows.Scan(&row.Date, &row.EpochPayoutTotal); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// GetAnalyticsDailyBridgeModule returns daily bridge-to-EVM tx metric only.
func (r *Repository) GetAnalyticsDailyBridgeModule(ctx context.Context, from, to time.Time) ([]AnalyticsDailyRow, error) {
	query := `
		WITH dates AS (
			SELECT generate_series($1::date, $2::date, '1 day'::interval)::date AS date
		),
		bridge AS (
			SELECT DATE(l.timestamp)::date AS date, COUNT(*)::bigint AS cnt
			FROM app.tx_tags t
			JOIN raw.tx_lookup l ON l.id = t.transaction_id
			WHERE t.tag = 'EVM_BRIDGE'
			  AND l.timestamp >= $1::timestamptz
			  AND l.timestamp < ($2::date + interval '1 day')
			GROUP BY 1
		)
		SELECT d.date::text, COALESCE(b.cnt, 0)::bigint
		FROM dates d
		LEFT JOIN bridge b ON b.date = d.date
		ORDER BY d.date ASC`
	rows, err := r.db.Query(ctx, query, from.UTC(), to.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]AnalyticsDailyRow, 0)
	for rows.Next() {
		var row AnalyticsDailyRow
		if err := rows.Scan(&row.Date, &row.BridgeToEVMTxs); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// GetAnalyticsDailyBaseStats returns fast daily metrics from app.daily_stats only.
// This is used as a graceful fallback when enrichment queries are slow/unavailable.
func (r *Repository) GetAnalyticsDailyBaseStats(ctx context.Context, from, to time.Time) ([]AnalyticsDailyRow, error) {
	query := `
		SELECT date::text, tx_count, COALESCE(evm_tx_count, 0) AS evm_tx_count,
			(tx_count - COALESCE(evm_tx_count, 0)) AS cadence_tx_count,
			COALESCE(total_gas_used, 0) AS total_gas_used,
			COALESCE(active_accounts, 0), COALESCE(new_contracts, 0),
			COALESCE(failed_tx_count, 0) AS failed_tx_count,
			CASE WHEN tx_count > 0
				THEN ROUND(COALESCE(failed_tx_count, 0)::numeric / tx_count * 100, 2)
				ELSE 0 END AS error_rate,
			CASE WHEN tx_count > 0 AND COALESCE(total_gas_used, 0) > 0
				THEN ROUND((COALESCE(total_gas_used, 0)::numeric / tx_count), 2)
				ELSE 0 END AS avg_gas_per_tx
		FROM app.daily_stats
		WHERE date >= $1::date AND date <= $2::date
		ORDER BY date ASC`

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

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

// GetAnalyticsDailyStats returns daily analytics from app.daily_stats enriched with
// account growth, DeFi activity, EVM active addresses, epoch payouts, and bridge proxy counts.
func (r *Repository) GetAnalyticsDailyStats(ctx context.Context, from, to time.Time) ([]AnalyticsDailyRow, error) {
	query := `
		WITH bounds AS (
			SELECT $1::date AS from_date, $2::date AS to_date
		),
		base AS (
			SELECT
				date,
				tx_count,
				COALESCE(evm_tx_count, 0) AS evm_tx_count,
				(tx_count - COALESCE(evm_tx_count, 0)) AS cadence_tx_count,
				COALESCE(total_gas_used, 0) AS total_gas_used,
				COALESCE(active_accounts, 0) AS active_accounts,
				COALESCE(new_contracts, 0) AS new_contracts,
				COALESCE(failed_tx_count, 0) AS failed_tx_count
			FROM app.daily_stats d
			JOIN bounds b ON d.date >= b.from_date AND d.date <= b.to_date
		),
		new_accounts AS (
			SELECT DATE(bl.timestamp) AS date, COUNT(*)::BIGINT AS new_accounts
			FROM app.accounts a
			JOIN raw.blocks bl ON bl.height = a.first_seen_height
			JOIN bounds b ON bl.timestamp >= b.from_date::timestamptz
				AND bl.timestamp < (b.to_date::date + INTERVAL '1 day')
			GROUP BY 1
		),
		coa_new_accounts AS (
			SELECT DATE(bl.timestamp) AS date, COUNT(*)::BIGINT AS coa_new_accounts
			FROM app.coa_accounts c
			JOIN raw.blocks bl ON bl.height = c.block_height
			JOIN bounds b ON bl.timestamp >= b.from_date::timestamptz
				AND bl.timestamp < (b.to_date::date + INTERVAL '1 day')
			GROUP BY 1
		),
		evm_active AS (
			SELECT date, COUNT(DISTINCT addr)::BIGINT AS evm_active_addresses
			FROM (
				SELECT DATE(timestamp) AS date, from_address AS addr
				FROM app.evm_transactions e
				JOIN bounds b ON e.timestamp >= b.from_date::timestamptz
					AND e.timestamp < (b.to_date::date + INTERVAL '1 day')
				WHERE from_address IS NOT NULL
				UNION ALL
				SELECT DATE(timestamp) AS date, to_address AS addr
				FROM app.evm_transactions e
				JOIN bounds b ON e.timestamp >= b.from_date::timestamptz
					AND e.timestamp < (b.to_date::date + INTERVAL '1 day')
				WHERE to_address IS NOT NULL
			) x
			GROUP BY date
		),
		defi_daily AS (
			SELECT
				DATE(timestamp) AS date,
				COUNT(*) FILTER (WHERE event_type = 'Swap')::BIGINT AS defi_swap_count,
				COUNT(DISTINCT maker) FILTER (WHERE event_type = 'Swap' AND maker IS NOT NULL)::BIGINT AS defi_unique_traders
			FROM app.defi_events e
			JOIN bounds b ON e.timestamp >= b.from_date::timestamptz
				AND e.timestamp < (b.to_date::date + INTERVAL '1 day')
			GROUP BY 1
		),
		epoch_payout AS (
			SELECT
				DATE(payout_time) AS date,
				COALESCE(SUM(payout_total), 0)::TEXT AS epoch_payout_total
			FROM app.epoch_stats s
			JOIN bounds b ON s.payout_time >= b.from_date::timestamptz
				AND s.payout_time < (b.to_date::date + INTERVAL '1 day')
			WHERE payout_time IS NOT NULL
			GROUP BY 1
		),
		bridge_proxy AS (
			SELECT DATE(l.timestamp) AS date, COUNT(*)::BIGINT AS bridge_to_evm_txs
			FROM app.tx_tags t
			JOIN raw.tx_lookup l ON l.id = t.transaction_id
			JOIN bounds b ON l.timestamp >= b.from_date::timestamptz
				AND l.timestamp < (b.to_date::date + INTERVAL '1 day')
			WHERE t.tag = 'EVM_BRIDGE'
			GROUP BY 1
		)
		SELECT
			base.date::text,
			base.tx_count,
			base.evm_tx_count,
			base.cadence_tx_count,
			base.total_gas_used,
			base.active_accounts,
			base.new_contracts,
			base.failed_tx_count,
			CASE WHEN base.tx_count > 0
				THEN ROUND(base.failed_tx_count::numeric / base.tx_count * 100, 2)
				ELSE 0 END AS error_rate,
			CASE WHEN base.tx_count > 0 AND base.total_gas_used > 0
				THEN ROUND((base.total_gas_used::numeric / base.tx_count), 2)
				ELSE 0 END AS avg_gas_per_tx,
			COALESCE(na.new_accounts, 0) AS new_accounts,
			COALESCE(cna.coa_new_accounts, 0) AS coa_new_accounts,
			COALESCE(ea.evm_active_addresses, 0) AS evm_active_addresses,
			COALESCE(dd.defi_swap_count, 0) AS defi_swap_count,
			COALESCE(dd.defi_unique_traders, 0) AS defi_unique_traders,
			COALESCE(ep.epoch_payout_total, '0') AS epoch_payout_total,
			COALESCE(bp.bridge_to_evm_txs, 0) AS bridge_to_evm_txs
		FROM base
		LEFT JOIN new_accounts na ON na.date = base.date
		LEFT JOIN coa_new_accounts cna ON cna.date = base.date
		LEFT JOIN evm_active ea ON ea.date = base.date
		LEFT JOIN defi_daily dd ON dd.date = base.date
		LEFT JOIN epoch_payout ep ON ep.date = base.date
		LEFT JOIN bridge_proxy bp ON bp.date = base.date
		ORDER BY base.date ASC`

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
			&row.NewAccounts, &row.COANewAccounts, &row.EVMActiveAddresses,
			&row.DefiSwapCount, &row.DefiUniqueTraders, &row.EpochPayoutTotal,
			&row.BridgeToEVMTxs,
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

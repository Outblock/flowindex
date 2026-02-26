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

type analyticsDailyExtra struct {
	newAccounts        int64
	coaNewAccounts     int64
	evmActiveAddresses int64
	defiSwapCount      int64
	defiUniqueTraders  int64
	epochPayoutTotal   string
	bridgeToEVMTxs     int64
}

// GetAnalyticsDailyStats returns daily analytics from app.daily_stats and enriches
// module metrics with independent queries so one slow module does not block all data.
func (r *Repository) GetAnalyticsDailyStats(ctx context.Context, from, to time.Time) ([]AnalyticsDailyRow, error) {
	out, err := r.GetAnalyticsDailyBaseStats(ctx, from, to)
	if err != nil {
		return nil, err
	}

	extras, err := r.getAnalyticsDailyExtras(ctx, from, to)
	if err != nil {
		// Keep page usable even if enrichment fails.
		return out, nil
	}
	for i := range out {
		if ex, ok := extras[out[i].Date]; ok {
			out[i].NewAccounts = ex.newAccounts
			out[i].COANewAccounts = ex.coaNewAccounts
			out[i].EVMActiveAddresses = ex.evmActiveAddresses
			out[i].DefiSwapCount = ex.defiSwapCount
			out[i].DefiUniqueTraders = ex.defiUniqueTraders
			out[i].EpochPayoutTotal = ex.epochPayoutTotal
			out[i].BridgeToEVMTxs = ex.bridgeToEVMTxs
		}
	}
	return out, nil
}

func (r *Repository) getAnalyticsDailyExtras(ctx context.Context, from, to time.Time) (map[string]analyticsDailyExtra, error) {
	out := make(map[string]analyticsDailyExtra)
	type setter func(*analyticsDailyExtra, int64, string)

	mergeCount := func(rows pgxRows, set setter) error {
		defer rows.Close()
		for rows.Next() {
			var d string
			var v int64
			if err := rows.Scan(&d, &v); err != nil {
				return err
			}
			ex := out[d]
			set(&ex, v, "")
			out[d] = ex
		}
		return rows.Err()
	}

	// Query 1: new accounts
	rows, err := r.db.Query(ctx, `
		SELECT DATE(b.timestamp)::text, COUNT(*)::bigint
		FROM app.accounts a
		JOIN raw.blocks b ON b.height = a.first_seen_height
		WHERE b.timestamp >= $1::timestamptz
		  AND b.timestamp < ($2::date + interval '1 day')
		GROUP BY 1
	`, from.UTC(), to.UTC())
	if err == nil {
		_ = mergeCount(rows, func(ex *analyticsDailyExtra, v int64, _ string) { ex.newAccounts = v })
	}

	// Query 2: COA new accounts
	rows, err = r.db.Query(ctx, `
		SELECT DATE(b.timestamp)::text, COUNT(*)::bigint
		FROM app.coa_accounts c
		JOIN raw.blocks b ON b.height = c.block_height
		WHERE b.timestamp >= $1::timestamptz
		  AND b.timestamp < ($2::date + interval '1 day')
		GROUP BY 1
	`, from.UTC(), to.UTC())
	if err == nil {
		_ = mergeCount(rows, func(ex *analyticsDailyExtra, v int64, _ string) { ex.coaNewAccounts = v })
	}

	// Query 3: EVM active addresses
	rows, err = r.db.Query(ctx, `
		SELECT d::text, COUNT(DISTINCT addr)::bigint
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
	`, from.UTC(), to.UTC())
	if err == nil {
		_ = mergeCount(rows, func(ex *analyticsDailyExtra, v int64, _ string) { ex.evmActiveAddresses = v })
	}

	// Query 4: DeFi swaps/traders
	rows2, err := r.db.Query(ctx, `
		SELECT DATE(timestamp)::text,
			COUNT(*) FILTER (WHERE event_type='Swap')::bigint,
			COUNT(DISTINCT maker) FILTER (WHERE event_type='Swap' AND maker IS NOT NULL)::bigint
		FROM app.defi_events
		WHERE timestamp >= $1::timestamptz
		  AND timestamp < ($2::date + interval '1 day')
		GROUP BY 1
	`, from.UTC(), to.UTC())
	if err == nil {
		defer rows2.Close()
		for rows2.Next() {
			var d string
			var c, u int64
			if scanErr := rows2.Scan(&d, &c, &u); scanErr != nil {
				break
			}
			ex := out[d]
			ex.defiSwapCount = c
			ex.defiUniqueTraders = u
			out[d] = ex
		}
	}

	// Query 5: Epoch payout
	rows3, err := r.db.Query(ctx, `
		SELECT DATE(payout_time)::text, COALESCE(SUM(payout_total),0)::text
		FROM app.epoch_stats
		WHERE payout_time >= $1::timestamptz
		  AND payout_time < ($2::date + interval '1 day')
		GROUP BY 1
	`, from.UTC(), to.UTC())
	if err == nil {
		defer rows3.Close()
		for rows3.Next() {
			var d, v string
			if scanErr := rows3.Scan(&d, &v); scanErr != nil {
				break
			}
			ex := out[d]
			ex.epochPayoutTotal = v
			out[d] = ex
		}
	}

	// Query 6: bridge proxy count (may be zero on most deployments)
	rows, err = r.db.Query(ctx, `
		SELECT DATE(l.timestamp)::text, COUNT(*)::bigint
		FROM app.tx_tags t
		JOIN raw.tx_lookup l ON l.id = t.transaction_id
		WHERE t.tag='EVM_BRIDGE'
		  AND l.timestamp >= $1::timestamptz
		  AND l.timestamp < ($2::date + interval '1 day')
		GROUP BY 1
	`, from.UTC(), to.UTC())
	if err == nil {
		_ = mergeCount(rows, func(ex *analyticsDailyExtra, v int64, _ string) { ex.bridgeToEVMTxs = v })
	}

	return out, nil
}

// pgxRows keeps this file decoupled from pgx concrete row type.
type pgxRows interface {
	Close()
	Next() bool
	Scan(dest ...interface{}) error
	Err() error
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

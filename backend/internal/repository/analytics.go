package repository

import (
	"context"
	"fmt"
	"strings"
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
	ContractUpdates    int64   `json:"contract_updates"`
	FailedTxCount      int64   `json:"failed_tx_count"`
	ErrorRate          float64 `json:"error_rate"`
	AvgGasPerTx        float64 `json:"avg_gas_per_tx"`
	NewAccounts        int64   `json:"new_accounts"`
	COANewAccounts     int64   `json:"coa_new_accounts"`
	EVMActiveAddresses int64   `json:"evm_active_addresses"`
	DefiSwapCount      int64   `json:"defi_swap_count"`
	DefiUniqueTraders  int64   `json:"defi_unique_traders"`
	EpochPayoutTotal   string  `json:"epoch_payout_total"`
	Epoch              *int    `json:"epoch,omitempty"`
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
		)
		SELECT d.date::text,
			COALESCE(m.new_accounts, 0)::bigint,
			COALESCE(m.coa_new_accounts, 0)::bigint
		FROM dates d
		LEFT JOIN analytics.daily_metrics m ON m.date = d.date
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
		)
		SELECT d.date::text, COALESCE(m.evm_active_addresses, 0)::bigint
		FROM dates d
		LEFT JOIN analytics.daily_metrics m ON m.date = d.date
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
		)
		SELECT d.date::text,
			COALESCE(m.defi_swap_count, 0)::bigint,
			COALESCE(m.defi_unique_traders, 0)::bigint
		FROM dates d
		LEFT JOIN analytics.daily_metrics m ON m.date = d.date
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

// GetAnalyticsDailyEpochModule returns daily epoch payout metric only,
// enriched with epoch number from epoch_stats.
func (r *Repository) GetAnalyticsDailyEpochModule(ctx context.Context, from, to time.Time) ([]AnalyticsDailyRow, error) {
	query := `
		WITH dates AS (
			SELECT generate_series($1::date, $2::date, '1 day'::interval)::date AS date
		)
		SELECT d.date::text,
		       COALESCE(e.payout_total, 0)::text,
		       e.epoch
		FROM dates d
		LEFT JOIN app.epoch_stats e ON e.payout_time::date = d.date
		    AND e.payout_time > '0001-01-01'
		    AND e.payout_total > 0
		ORDER BY d.date ASC`
	rows, err := r.db.Query(ctx, query, from.UTC(), to.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]AnalyticsDailyRow, 0)
	for rows.Next() {
		var row AnalyticsDailyRow
		if err := rows.Scan(&row.Date, &row.EpochPayoutTotal, &row.Epoch); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// GetAnalyticsDailyBridgeModule returns daily bridge-to-EVM tx metric only.
// Uses block_height bounds to enable partition pruning on ft_transfers.
func (r *Repository) GetAnalyticsDailyBridgeModule(ctx context.Context, from, to time.Time) ([]AnalyticsDailyRow, error) {
	query := `
		WITH dates AS (
			SELECT generate_series($1::date, $2::date, '1 day'::interval)::date AS date
		),
		height_bounds AS (
			SELECT
				COALESCE((SELECT MIN(height) FROM raw.blocks WHERE timestamp >= $1::timestamptz), 0) AS lo,
				COALESCE((SELECT MAX(height) FROM raw.blocks WHERE timestamp < ($2::date + interval '1 day')), 0) + 1 AS hi
		),
		bridge_txs AS (
			SELECT DATE(ft.timestamp) AS d, COUNT(DISTINCT ft.transaction_id)::bigint AS cnt
			FROM app.ft_transfers ft
			WHERE ft.block_height >= (SELECT lo FROM height_bounds)
			  AND ft.block_height < (SELECT hi FROM height_bounds)
			  AND (ft.from_address IS NULL OR ft.to_address IS NULL)
			  AND EXISTS (
			    SELECT 1 FROM raw.transactions rtx
			    WHERE rtx.id = ft.transaction_id
			      AND rtx.block_height = ft.block_height
			      AND rtx.is_evm = true
			  )
			GROUP BY 1
		)
		SELECT d.date::text, COALESCE(b.cnt, 0)::bigint
		FROM dates d
		LEFT JOIN bridge_txs b ON b.d = d.date
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

// GetAnalyticsDailyContractsModule returns daily contract update counts (version > 1).
func (r *Repository) GetAnalyticsDailyContractsModule(ctx context.Context, from, to time.Time) ([]AnalyticsDailyRow, error) {
	query := `
		WITH dates AS (
			SELECT generate_series($1::date, $2::date, '1 day'::interval)::date AS date
		)
		SELECT d.date::text, COALESCE(m.contract_updates, 0)::bigint
		FROM dates d
		LEFT JOIN analytics.daily_metrics m ON m.date = d.date
		ORDER BY d.date ASC`
	rows, err := r.db.Query(ctx, query, from.UTC(), to.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]AnalyticsDailyRow, 0)
	for rows.Next() {
		var row AnalyticsDailyRow
		if err := rows.Scan(&row.Date, &row.ContractUpdates); err != nil {
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

// BigTransfer represents a large-value fungible token transfer or DeFi swap.
type BigTransfer struct {
	TxID                 string  `json:"tx_id"`
	BlockHeight          uint64  `json:"block_height"`
	Timestamp            string  `json:"timestamp"`
	Type                 string  `json:"type"`
	TokenSymbol          string  `json:"token_symbol"`
	TokenContractAddress string  `json:"token_contract_address"`
	ContractName         string  `json:"contract_name"`
	TokenLogo            string  `json:"token_logo,omitempty"`
	Amount               string  `json:"amount"`
	UsdValue             float64 `json:"usd_value"`
	FromAddress          string  `json:"from_address"`
	ToAddress            string  `json:"to_address"`
}

// GetBigTransfers returns recent large-value FT transfers and DeFi swaps whose
// estimated USD value exceeds minUSD, using the supplied priceMap for valuation.
func (r *Repository) GetBigTransfers(ctx context.Context, priceMap map[string]float64, minUSD float64, limit, offset int, transferTypes []string) ([]BigTransfer, error) {
	if limit < 1 {
		limit = 1
	}
	if limit > 200 {
		limit = 200
	}

	// Build inline price table from priceMap.
	if len(priceMap) == 0 {
		return []BigTransfer{}, nil
	}

	var valuesRows []string
	args := make([]interface{}, 0, len(priceMap)*2+4)
	argIdx := 1
	for symbol, price := range priceMap {
		valuesRows = append(valuesRows, fmt.Sprintf("($%d, $%d::numeric)", argIdx, argIdx+1))
		args = append(args, symbol, price)
		argIdx += 2
	}
	pricesCTE := "prices(symbol, usd_price) AS (VALUES " + strings.Join(valuesRows, ", ") + ")"

	// minUSD, limit, offset placeholders
	minUSDIdx := argIdx
	limitIdx := argIdx + 1
	offsetIdx := argIdx + 2
	args = append(args, minUSD, limit, offset)

	// Build optional type filter.
	var typeFilter string
	if len(transferTypes) > 0 {
		typeFilter = fmt.Sprintf(" WHERE combined.type = ANY($%d)", argIdx+3)
		args = append(args, transferTypes)
	}

	// Use block_height bounds for partition pruning on ft_transfers and defi_events.
	// Estimate: ~720k blocks per 7 days (1 block/~0.84s).
	query := fmt.Sprintf(`
WITH %s,
height_bounds AS (
  SELECT
    COALESCE((SELECT MIN(height) FROM raw.blocks WHERE timestamp > NOW() - INTERVAL '7 days'), 0) AS lo,
    COALESCE((SELECT MAX(height) FROM raw.blocks), 0) + 1 AS hi
)
SELECT tx_id, block_height, timestamp, type, token_symbol,
       token_contract_address, contract_name, token_logo, amount, usd_value,
       from_address, to_address
FROM (
  -- FT transfers
  SELECT
    encode(ft.transaction_id, 'hex') AS tx_id,
    ft.block_height,
    ft.timestamp,
    CASE
      WHEN ft.from_address IS NULL THEN 'mint'
      WHEN ft.to_address IS NULL THEN 'burn'
      ELSE 'transfer'
    END AS type,
    COALESCE(tk.symbol, tk.contract_name, '') AS token_symbol,
    COALESCE(encode(ft.token_contract_address, 'hex'), '') AS token_contract_address,
    COALESCE(ft.contract_name, '') AS contract_name,
    COALESCE(tk.logo::text, '') AS token_logo,
    ft.amount::text AS amount,
    (ft.amount * p.usd_price)::float8 AS usd_value,
    COALESCE(encode(ft.from_address, 'hex'), '') AS from_address,
    COALESCE(encode(ft.to_address, 'hex'), '') AS to_address
  FROM app.ft_transfers ft
  JOIN app.ft_tokens tk
    ON tk.contract_address = ft.token_contract_address
   AND tk.contract_name = ft.contract_name
  JOIN prices p ON p.symbol = tk.market_symbol
  WHERE ft.block_height >= (SELECT lo FROM height_bounds)
    AND ft.block_height < (SELECT hi FROM height_bounds)
    AND ft.timestamp > NOW() - INTERVAL '7 days'
    AND ft.amount * p.usd_price >= $%d

  UNION ALL

  -- DeFi swaps (use asset0 amount for valuation)
  SELECT
    encode(de.transaction_id, 'hex') AS tx_id,
    de.block_height,
    de.timestamp,
    'swap' AS type,
    COALESCE(dp.asset0_symbol, '') || '/' || COALESCE(dp.asset1_symbol, '') AS token_symbol,
    '' AS token_contract_address,
    dp.dex_key AS contract_name,
    '' AS token_logo,
    GREATEST(de.asset0_in, de.asset0_out)::text AS amount,
    (GREATEST(de.asset0_in, de.asset0_out) * p.usd_price)::float8 AS usd_value,
    COALESCE(encode(de.maker, 'hex'), '') AS from_address,
    '' AS to_address
  FROM app.defi_events de
  JOIN app.defi_pairs dp ON dp.id = de.pair_id
  JOIN prices p ON p.symbol = dp.asset0_symbol
  WHERE de.event_type = 'Swap'
    AND de.block_height >= (SELECT lo FROM height_bounds)
    AND de.block_height < (SELECT hi FROM height_bounds)
    AND de.timestamp > NOW() - INTERVAL '7 days'
    AND GREATEST(de.asset0_in, de.asset0_out) * p.usd_price >= $%d
) combined
%s
ORDER BY combined.timestamp DESC
LIMIT $%d OFFSET $%d`,
		pricesCTE,
		minUSDIdx,
		minUSDIdx,
		typeFilter,
		limitIdx,
		offsetIdx,
	)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []BigTransfer
	for rows.Next() {
		var bt BigTransfer
		var ts time.Time
		if err := rows.Scan(
			&bt.TxID, &bt.BlockHeight, &ts, &bt.Type,
			&bt.TokenSymbol, &bt.TokenContractAddress, &bt.ContractName,
			&bt.TokenLogo, &bt.Amount, &bt.UsdValue, &bt.FromAddress, &bt.ToAddress,
		); err != nil {
			return nil, err
		}
		bt.Timestamp = ts.UTC().Format(time.RFC3339)
		out = append(out, bt)
	}
	if out == nil {
		out = []BigTransfer{}
	}
	return out, rows.Err()
}

// TopContract represents a contract ranked by transaction count.
type TopContract struct {
	ContractIdentifier string `json:"contract_identifier"`
	ContractName       string `json:"contract_name"`
	Address            string `json:"address"`
	TxCount            int64  `json:"tx_count"`
	UniqueCallers      int64  `json:"unique_callers"`
}

// GetTopContracts returns contracts ranked by transaction count in the last N hours.
func (r *Repository) GetTopContracts(ctx context.Context, hours int, limit int) ([]TopContract, error) {
	if limit < 1 || limit > 50 {
		limit = 10
	}
	query := `
		SELECT tc.contract_identifier,
		       COALESCE(sc.contract_name, split_part(tc.contract_identifier, '.', 3)) AS contract_name,
		       COALESCE('0x' || encode(sc.address, 'hex'), split_part(tc.contract_identifier, '.', 2)) AS address,
		       COUNT(*)::bigint AS tx_count,
		       COUNT(DISTINCT t.proposer)::bigint AS unique_callers
		FROM app.tx_contracts tc
		JOIN raw.tx_lookup tl ON tl.id = tc.transaction_id
		JOIN raw.transactions t ON t.id = tc.transaction_id AND t.block_height = tl.block_height
		LEFT JOIN app.smart_contracts sc ON sc.identifier = tc.contract_identifier
		WHERE tl.timestamp > NOW() - make_interval(hours => $1)
		GROUP BY tc.contract_identifier, sc.contract_name, sc.address
		ORDER BY tx_count DESC
		LIMIT $2`
	rows, err := r.db.Query(ctx, query, hours, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TopContract
	for rows.Next() {
		var c TopContract
		if err := rows.Scan(&c.ContractIdentifier, &c.ContractName, &c.Address, &c.TxCount, &c.UniqueCallers); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	if out == nil {
		out = []TopContract{}
	}
	return out, rows.Err()
}

// TokenVolume represents a token ranked by transfer volume.
type TokenVolume struct {
	Symbol        string  `json:"symbol"`
	ContractName  string  `json:"contract_name"`
	Logo          string  `json:"logo,omitempty"`
	TransferCount int64   `json:"transfer_count"`
	TotalAmount   string  `json:"total_amount"`
	UsdVolume     float64 `json:"usd_volume"`
}

// GetTokenVolume returns tokens ranked by USD transfer volume in the last N hours.
func (r *Repository) GetTokenVolume(ctx context.Context, hours int, limit int, priceMap map[string]float64) ([]TokenVolume, error) {
	if limit < 1 || limit > 50 {
		limit = 10
	}
	if len(priceMap) == 0 {
		return []TokenVolume{}, nil
	}

	var valuesRows []string
	args := make([]interface{}, 0, len(priceMap)*2+2)
	argIdx := 1
	for symbol, price := range priceMap {
		valuesRows = append(valuesRows, fmt.Sprintf("($%d, $%d::numeric)", argIdx, argIdx+1))
		args = append(args, symbol, price)
		argIdx += 2
	}
	pricesCTE := "prices(symbol, usd_price) AS (VALUES " + strings.Join(valuesRows, ", ") + ")"

	hoursIdx := argIdx
	limitIdx := argIdx + 1
	args = append(args, hours, limit)

	query := fmt.Sprintf(`
		WITH %s
		SELECT
			COALESCE(tk.symbol, tk.contract_name, '') AS symbol,
			COALESCE(tk.contract_name, '') AS contract_name,
			COALESCE(tk.logo::text, '') AS logo,
			COUNT(*)::bigint AS transfer_count,
			SUM(ft.amount)::text AS total_amount,
			(SUM(ft.amount) * p.usd_price)::float8 AS usd_volume
		FROM app.ft_transfers ft
		JOIN app.ft_tokens tk ON tk.contract_address = ft.token_contract_address AND tk.contract_name = ft.contract_name
		JOIN prices p ON p.symbol = tk.market_symbol
		WHERE ft.timestamp > NOW() - make_interval(hours => $%d)
		GROUP BY tk.symbol, tk.contract_name, tk.logo, p.usd_price
		ORDER BY usd_volume DESC
		LIMIT $%d`,
		pricesCTE, hoursIdx, limitIdx)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TokenVolume
	for rows.Next() {
		var tv TokenVolume
		if err := rows.Scan(&tv.Symbol, &tv.ContractName, &tv.Logo, &tv.TransferCount, &tv.TotalAmount, &tv.UsdVolume); err != nil {
			return nil, err
		}
		out = append(out, tv)
	}
	if out == nil {
		out = []TokenVolume{}
	}
	return out, rows.Err()
}

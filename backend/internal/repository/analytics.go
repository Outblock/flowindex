package repository

import (
	"context"
	"fmt"
	"math"
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

// GetAnalyticsDailyBridgeModule returns daily bridge-to-EVM tx metric from pre-computed analytics.daily_metrics.
func (r *Repository) GetAnalyticsDailyBridgeModule(ctx context.Context, from, to time.Time) ([]AnalyticsDailyRow, error) {
	query := `
		WITH dates AS (
			SELECT generate_series($1::date, $2::date, '1 day'::interval)::date AS date
		)
		SELECT d.date::text, COALESCE(m.bridge_to_evm_txs, 0)::bigint
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
		WITH dates AS (
			SELECT generate_series($1::date, $2::date, '1 day'::interval)::date AS date
		)
		SELECT d.date::text,
			COALESCE(s.tx_count, 0)::bigint AS tx_count,
			COALESCE(s.evm_tx_count, 0)::bigint AS evm_tx_count,
			(COALESCE(s.tx_count, 0) - COALESCE(s.evm_tx_count, 0))::bigint AS cadence_tx_count,
			COALESCE(s.total_gas_used, 0)::bigint AS total_gas_used,
			COALESCE(s.active_accounts, 0)::bigint AS active_accounts,
			COALESCE(s.new_contracts, 0)::int AS new_contracts,
			COALESCE(s.failed_tx_count, 0)::bigint AS failed_tx_count,
			CASE WHEN COALESCE(s.tx_count, 0) > 0
				THEN ROUND(COALESCE(s.failed_tx_count, 0)::numeric / NULLIF(s.tx_count, 0) * 100, 2)
				ELSE 0 END AS error_rate,
			CASE WHEN COALESCE(s.tx_count, 0) > 0
				THEN ROUND(COALESCE(s.total_gas_used, 0)::numeric / NULLIF(s.tx_count, 0), 2)
				ELSE 0 END AS avg_gas_per_tx
		FROM dates d
		LEFT JOIN app.daily_stats s ON s.date = d.date
		ORDER BY d.date ASC`

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
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(out) == 0 {
		return out, nil
	}

	// Overlay recent days from raw.transactions so the dashboard stays fresh even
	// when app.daily_stats is slightly behind.
	overlayFrom := maxDate(from.UTC(), to.UTC().AddDate(0, 0, -14))
	if !overlayFrom.After(to.UTC()) {
		heightLo, heightHi := r.estimateRecentHeightBounds(ctx, overlayFrom, to.UTC())
		rows2, err := r.db.Query(ctx, `
			SELECT
				DATE(t.timestamp)::text AS date,
				COUNT(*)::bigint AS tx_count,
				COUNT(*) FILTER (WHERE t.is_evm = TRUE)::bigint AS evm_tx_count,
				COALESCE(SUM(t.gas_used), 0)::bigint AS total_gas_used,
				COUNT(DISTINCT t.proposer_address)::bigint AS active_accounts,
				COUNT(*) FILTER (WHERE t.error_message IS NOT NULL AND t.error_message != '')::bigint AS failed_tx_count
			FROM raw.transactions t
			WHERE t.block_height >= $1
			  AND t.block_height < $2
			  AND t.timestamp IS NOT NULL
			  AND DATE(t.timestamp) >= $3::date
			  AND DATE(t.timestamp) <= $4::date
			GROUP BY 1
		`, heightLo, heightHi, overlayFrom, to.UTC())
		if err == nil {
			type txAgg struct {
				TxCount        int64
				EVMTxCount     int64
				TotalGasUsed   int64
				ActiveAccounts int64
				FailedTxCount  int64
			}
			byDate := make(map[string]txAgg)
			for rows2.Next() {
				var (
					date string
					a    txAgg
				)
				if scanErr := rows2.Scan(
					&date,
					&a.TxCount,
					&a.EVMTxCount,
					&a.TotalGasUsed,
					&a.ActiveAccounts,
					&a.FailedTxCount,
				); scanErr == nil {
					byDate[date] = a
				}
			}
			rows2.Close()

			for i := range out {
				if a, ok := byDate[out[i].Date]; ok {
					out[i].TxCount = a.TxCount
					out[i].EVMTxCount = a.EVMTxCount
					out[i].CadenceTxCount = a.TxCount - a.EVMTxCount
					out[i].TotalGasUsed = a.TotalGasUsed
					out[i].ActiveAccounts = a.ActiveAccounts
					out[i].FailedTxCount = a.FailedTxCount
					if out[i].TxCount > 0 {
						out[i].ErrorRate = round2((float64(out[i].FailedTxCount) / float64(out[i].TxCount)) * 100)
						out[i].AvgGasPerTx = round2(float64(out[i].TotalGasUsed) / float64(out[i].TxCount))
					} else {
						out[i].ErrorRate = 0
						out[i].AvgGasPerTx = 0
					}
				}
			}
		}
	}

	return out, nil
}

type TransferDailyRow struct {
	Date         string `json:"date"`
	FTTransfers  int64  `json:"ft_transfers"`
	NFTTransfers int64  `json:"nft_transfers"`
}

// GetTransferDailyStats returns daily FT and NFT transfer counts.
// Reads pre-aggregated data from app.daily_stats (populated by daily_stats_worker).
func (r *Repository) GetTransferDailyStats(ctx context.Context, from, to time.Time) ([]TransferDailyRow, error) {
	query := `
		WITH dates AS (
			SELECT generate_series($1::date, $2::date, '1 day'::interval)::date AS date
		)
		SELECT d.date::text,
		       COALESCE(s.ft_transfer_count, 0),
		       COALESCE(s.nft_transfer_count, 0)
		FROM dates d
		LEFT JOIN app.daily_stats s ON s.date = d.date
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
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(out) == 0 {
		return out, nil
	}

	// Overlay recent transfer counts from source tables to avoid stale zeros when
	// daily_stats lags behind token workers.
	overlayFrom := maxDate(from.UTC(), to.UTC().AddDate(0, 0, -14))
	if !overlayFrom.After(to.UTC()) {
		heightLo, heightHi := r.estimateRecentHeightBounds(ctx, overlayFrom, to.UTC())
		rows2, err := r.db.Query(ctx, `
			WITH recent AS (
				SELECT 'ft'::text AS kind, DATE(ft.timestamp)::text AS date, COUNT(*)::bigint AS cnt
				FROM app.ft_transfers ft
				WHERE ft.block_height >= $1
				  AND ft.block_height < $2
				  AND DATE(ft.timestamp) >= $3::date
				  AND DATE(ft.timestamp) <= $4::date
				GROUP BY 1, 2
				UNION ALL
				SELECT 'nft'::text AS kind, DATE(nt.timestamp)::text AS date, COUNT(*)::bigint AS cnt
				FROM app.nft_transfers nt
				WHERE nt.block_height >= $1
				  AND nt.block_height < $2
				  AND DATE(nt.timestamp) >= $3::date
				  AND DATE(nt.timestamp) <= $4::date
				GROUP BY 1, 2
			)
			SELECT kind, date, cnt
			FROM recent
		`, heightLo, heightHi, overlayFrom, to.UTC())
		if err == nil {
			type transferAgg struct {
				FT  int64
				NFT int64
			}
			byDate := make(map[string]transferAgg)
			for rows2.Next() {
				var (
					kind string
					date string
					cnt  int64
				)
				if scanErr := rows2.Scan(&kind, &date, &cnt); scanErr == nil {
					cur := byDate[date]
					if kind == "ft" {
						cur.FT = cnt
					} else if kind == "nft" {
						cur.NFT = cnt
					}
					byDate[date] = cur
				}
			}
			rows2.Close()

			for i := range out {
				if a, ok := byDate[out[i].Date]; ok {
					out[i].FTTransfers = a.FT
					out[i].NFTTransfers = a.NFT
				}
			}
		}
	}

	return out, nil
}

func (r *Repository) estimateRecentHeightBounds(ctx context.Context, from, to time.Time) (int64, int64) {
	var latestHeight int64
	_ = r.db.QueryRow(ctx, `SELECT COALESCE(last_height, 0) FROM app.indexing_checkpoints WHERE service_name = 'main_ingester'`).Scan(&latestHeight)
	if latestHeight < 0 {
		latestHeight = 0
	}

	// Conservative estimate to avoid clipping recent dates when block cadence spikes.
	daySpan := to.Sub(from).Hours()/24 + 2
	if daySpan < 2 {
		daySpan = 2
	}
	heightLo := latestHeight - int64(daySpan*200000)
	if heightLo < 0 {
		heightLo = 0
	}
	return heightLo, latestHeight + 1
}

func maxDate(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
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

	// Build inline price table from priceMap, including per-token minimum amount
	// threshold so the DB can filter early without computing amount*price for every row.
	if len(priceMap) == 0 {
		return []BigTransfer{}, nil
	}

	var valuesRows []string
	args := make([]interface{}, 0, len(priceMap)*3+4)
	argIdx := 1
	for symbol, price := range priceMap {
		minAmount := 0.0
		if price > 0 {
			minAmount = minUSD / price
		}
		valuesRows = append(valuesRows, fmt.Sprintf("($%d, $%d::numeric, $%d::numeric)", argIdx, argIdx+1, argIdx+2))
		args = append(args, symbol, price, minAmount)
		argIdx += 3
	}
	pricesCTE := "prices(symbol, usd_price, min_amount) AS (VALUES " + strings.Join(valuesRows, ", ") + ")"

	// height lo/hi, limit, offset placeholders
	heightLoIdx := argIdx
	heightHiIdx := argIdx + 1
	limitIdx := argIdx + 2
	offsetIdx := argIdx + 3

	// Compute height bounds in Go instead of querying raw.blocks (which has no
	// timestamp index and causes full-table scans).
	// ~720k blocks per 7 days (1 block per ~0.84s).
	var latestHeight int64
	_ = r.db.QueryRow(ctx, `SELECT COALESCE(last_height, 0) FROM app.indexing_checkpoints WHERE service_name = 'main_ingester'`).Scan(&latestHeight)
	if latestHeight == 0 {
		// Fallback: quick max from the latest partition only
		_ = r.db.QueryRow(ctx, `SELECT COALESCE(MAX(block_height), 0) FROM app.ft_transfers WHERE block_height > 140000000`).Scan(&latestHeight)
	}
	heightLo := latestHeight - 750000 // ~7 days with margin
	if heightLo < 0 {
		heightLo = 0
	}
	args = append(args, heightLo, latestHeight+1, limit, offset)

	// Build optional type filter.
	var typeFilter string
	if len(transferTypes) > 0 {
		typeFilter = fmt.Sprintf(" WHERE combined.type = ANY($%d)", argIdx+4)
		args = append(args, transferTypes)
	}

	query := fmt.Sprintf(`
WITH %s
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
      WHEN ft.contract_name LIKE 'EVMVMBridgedToken_%%' THEN 'bridge'
      WHEN length(ft.from_address) = 20 OR length(ft.to_address) = 20 THEN 'bridge'
      WHEN (ft.from_address IS NULL OR ft.to_address IS NULL)
           AND ft.contract_name = 'FlowToken'
           AND EXISTS (
             SELECT 1 FROM raw.events e
             WHERE e.transaction_id = ft.transaction_id
               AND e.block_height = ft.block_height
               AND (e.type LIKE '%%FlowIDTableStaking%%'
                 OR e.type LIKE '%%FlowStakingCollection%%'
                 OR e.type LIKE '%%LockedTokens%%')
             LIMIT 1
           ) THEN 'staking'
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
  WHERE ft.block_height >= $%d
    AND ft.block_height < $%d
    AND ft.amount >= p.min_amount

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
    AND de.block_height >= $%d
    AND de.block_height < $%d
    AND GREATEST(de.asset0_in, de.asset0_out) >= p.min_amount
) combined
%s
ORDER BY combined.block_height DESC
LIMIT $%d OFFSET $%d`,
		pricesCTE,
		heightLoIdx,
		heightHiIdx,
		heightLoIdx,
		heightHiIdx,
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
	// Compute height bounds in Go to avoid scanning raw.blocks/tx_lookup by timestamp.
	var latestHeight int64
	_ = r.db.QueryRow(ctx, `SELECT COALESCE(last_height, 0) FROM app.indexing_checkpoints WHERE service_name = 'main_ingester'`).Scan(&latestHeight)
	heightLo := latestHeight - int64(hours)*100000/24
	if heightLo < 0 {
		heightLo = 0
	}

	// Two-phase: first get top contracts by tx count (fast, uses idx_tx_contracts_height),
	// then enrich with unique callers only for the top N.
	query := `
		WITH top AS (
			SELECT tc.contract_identifier,
			       COUNT(*)::bigint AS tx_count
			FROM app.tx_contracts tc
			WHERE tc.block_height >= $1 AND tc.block_height < $2
			GROUP BY tc.contract_identifier
			ORDER BY tx_count DESC
			LIMIT $3
		)
		SELECT top.contract_identifier,
		       COALESCE(sc.name, split_part(top.contract_identifier, '.', 3)) AS contract_name,
		       COALESCE('0x' || encode(sc.address, 'hex'), split_part(top.contract_identifier, '.', 2)) AS address,
		       top.tx_count,
		       COALESCE(callers.cnt, 0)::bigint AS unique_callers
		FROM top
		LEFT JOIN app.smart_contracts sc
		       ON sc.address = decode(split_part(top.contract_identifier, '.', 2), 'hex')
		      AND sc.name = split_part(top.contract_identifier, '.', 3)
		LEFT JOIN LATERAL (
			SELECT COUNT(DISTINCT t.proposer_address)::bigint AS cnt
			FROM app.tx_contracts tc2
			JOIN raw.transactions t ON t.id = tc2.transaction_id AND t.block_height = tc2.block_height
			WHERE tc2.contract_identifier = top.contract_identifier
			  AND tc2.block_height >= $1 AND tc2.block_height < $2
		) callers ON true
		ORDER BY top.tx_count DESC`
	rows, err := r.db.Query(ctx, query, heightLo, latestHeight+1, limit)
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
	args := make([]interface{}, 0, len(priceMap)*2+4)
	argIdx := 1
	for symbol, price := range priceMap {
		valuesRows = append(valuesRows, fmt.Sprintf("($%d, $%d::numeric)", argIdx, argIdx+1))
		args = append(args, symbol, price)
		argIdx += 2
	}
	pricesCTE := "prices(symbol, usd_price) AS (VALUES " + strings.Join(valuesRows, ", ") + ")"

	// Compute height bounds in Go to enable partition pruning.
	var latestHeight int64
	_ = r.db.QueryRow(ctx, `SELECT COALESCE(last_height, 0) FROM app.indexing_checkpoints WHERE service_name = 'main_ingester'`).Scan(&latestHeight)
	heightLo := latestHeight - int64(hours)*100000/24 // ~100k blocks/day
	if heightLo < 0 {
		heightLo = 0
	}

	heightLoIdx := argIdx
	heightHiIdx := argIdx + 1
	hoursIdx := argIdx + 2
	limitIdx := argIdx + 3
	args = append(args, heightLo, latestHeight+1, hours, limit)

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
		WHERE ft.block_height >= $%d AND ft.block_height < $%d
		  AND ft.timestamp > NOW() - make_interval(hours => $%d)
		GROUP BY tk.symbol, tk.contract_name, tk.logo, p.usd_price
		ORDER BY usd_volume DESC
		LIMIT $%d`,
		pricesCTE, heightLoIdx, heightHiIdx, hoursIdx, limitIdx)

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

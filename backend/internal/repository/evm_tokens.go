package repository

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// EVMTokenSummary is an API-facing projection for EVM token catalog endpoints.
type EVMTokenSummary struct {
	Address       string
	Name          string
	Symbol        string
	Decimals      int
	HolderCount   int64
	TransferCount int64
}

// ListEVMTokenSummaries returns token metadata derived from app.ft_tokens
// for native EVM tokens (20-byte address) and bridged Flow tokens (with evm_address set).
func (r *Repository) ListEVMTokenSummaries(ctx context.Context, limit, offset int) ([]EVMTokenSummary, error) {
	rows, err := r.db.Query(ctx, `
		SELECT
			CASE WHEN octet_length(t.contract_address) = 20
			     THEN encode(t.contract_address, 'hex')
			     ELSE LOWER(REPLACE(t.evm_address, '0x', ''))
			END AS address,
			COALESCE(t.name, '') AS name,
			COALESCE(t.symbol, '') AS symbol,
			COALESCE(t.decimals, 0) AS decimals,
			COALESCE((
				SELECT COUNT(*)
				FROM app.ft_holdings h
				WHERE h.contract_address = t.contract_address
				  AND h.balance > 0
			), 0) AS holder_count,
			0 AS transfer_count
		FROM app.ft_tokens t
		WHERE octet_length(t.contract_address) = 20
		   OR (COALESCE(t.evm_address, '') != '')
		ORDER BY t.updated_at DESC, t.contract_address ASC
		LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]EVMTokenSummary, 0)
	for rows.Next() {
		var row EVMTokenSummary
		if err := rows.Scan(&row.Address, &row.Name, &row.Symbol, &row.Decimals, &row.HolderCount, &row.TransferCount); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, nil
}

// GetEVMTokenSummary returns a single token summary by 20-byte hex address (no 0x).
// It first tries matching the contract_address directly (native EVM tokens),
// then falls back to matching the evm_address column (bridged Flow tokens like FLOW, stFLOW).
func (r *Repository) GetEVMTokenSummary(ctx context.Context, address string) (*EVMTokenSummary, error) {
	var row EVMTokenSummary
	// Try direct 20-byte contract_address match first.
	err := r.db.QueryRow(ctx, `
		SELECT
			encode(t.contract_address, 'hex') AS address,
			COALESCE(t.name, '') AS name,
			COALESCE(t.symbol, '') AS symbol,
			COALESCE(t.decimals, 0) AS decimals,
			COALESCE((
				SELECT COUNT(*)
				FROM app.ft_holdings h
				WHERE h.contract_address = t.contract_address
				  AND h.balance > 0
			), 0) AS holder_count,
			0 AS transfer_count
		FROM app.ft_tokens t
		WHERE t.contract_address = $1
		  AND octet_length(t.contract_address) = 20`, hexToBytes(address)).
		Scan(&row.Address, &row.Name, &row.Symbol, &row.Decimals, &row.HolderCount, &row.TransferCount)
	if err == nil {
		return &row, nil
	}
	if err != pgx.ErrNoRows {
		return nil, err
	}

	// Fallback: match against evm_address column (bridged Flow tokens).
	addrWithPrefix := "0x" + address
	err = r.db.QueryRow(ctx, `
		SELECT
			COALESCE(t.name, '') AS name,
			COALESCE(t.symbol, '') AS symbol,
			COALESCE(t.decimals, 0) AS decimals,
			COALESCE((
				SELECT COUNT(*)
				FROM app.ft_holdings h
				WHERE h.contract_address = t.contract_address
				  AND h.balance > 0
			), 0) AS holder_count,
			0 AS transfer_count
		FROM app.ft_tokens t
		WHERE LOWER(t.evm_address) = LOWER($1)
		LIMIT 1`, addrWithPrefix).
		Scan(&row.Name, &row.Symbol, &row.Decimals, &row.HolderCount, &row.TransferCount)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	row.Address = address
	return &row, nil
}

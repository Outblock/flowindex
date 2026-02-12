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

// ListEVMTokenSummaries returns token metadata derived from app.ft_tokens where address is 20 bytes.
func (r *Repository) ListEVMTokenSummaries(ctx context.Context, limit, offset int) ([]EVMTokenSummary, error) {
	rows, err := r.db.Query(ctx, `
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
		WHERE octet_length(t.contract_address) = 20
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
func (r *Repository) GetEVMTokenSummary(ctx context.Context, address string) (*EVMTokenSummary, error) {
	var row EVMTokenSummary
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
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

package repository

import (
	"context"
	"fmt"
	"strings"

	"flowscan-clone/internal/models"
)

type TokenTransferWithContract struct {
	models.TokenTransfer
	ContractName string
	TotalCount   int64
}

type FTVaultSummary struct {
	ContractAddress string
	ContractName    string
	Balance         string
	LastHeight      uint64
}

func (r *Repository) ListTokenTransfersWithContractFiltered(ctx context.Context, isNFT bool, address, token, txID string, height *uint64, limit, offset int) ([]TokenTransferWithContract, int64, error) {
	clauses := []string{"t.is_nft = $1"}
	args := []interface{}{isNFT}
	arg := 2
	if address != "" {
		clauses = append(clauses, fmt.Sprintf("(t.from_address = $%d OR t.to_address = $%d)", arg, arg))
		args = append(args, hexToBytes(address))
		arg++
	}
	if token != "" {
		clauses = append(clauses, fmt.Sprintf("t.token_contract_address = $%d", arg))
		args = append(args, hexToBytes(token))
		arg++
	}
	if txID != "" {
		clauses = append(clauses, fmt.Sprintf("t.transaction_id = $%d", arg))
		args = append(args, hexToBytes(txID))
		arg++
	}
	if height != nil {
		clauses = append(clauses, fmt.Sprintf("t.block_height = $%d", arg))
		args = append(args, *height)
		arg++
	}
	if isNFT {
		clauses = append(clauses, "COALESCE(NULLIF(split_part(e.type, '.', 3), ''), '') <> 'NonFungibleToken'")
	} else {
		clauses = append(clauses, "COALESCE(NULLIF(split_part(e.type, '.', 3), ''), '') <> 'FungibleToken'")
	}
	where := "WHERE " + strings.Join(clauses, " AND ")
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	args = append(args, limit, offset)

	rows, err := r.db.Query(ctx, `
		SELECT
			encode(t.transaction_id, 'hex') AS transaction_id,
			t.block_height,
			encode(t.token_contract_address, 'hex') AS token_contract_address,
			encode(t.from_address, 'hex') AS from_address,
			encode(t.to_address, 'hex') AS to_address,
			t.amount,
			t.token_id,
			t.event_index,
			t.is_nft,
			t.timestamp,
			t.created_at,
			COALESCE(NULLIF(split_part(e.type, '.', 3), ''), ''),
			COUNT(*) OVER() AS total_count
		FROM app.token_transfers t
		JOIN raw.tx_lookup l
			ON l.id = t.transaction_id
		LEFT JOIN raw.events e
			ON e.block_height = t.block_height
			AND e.transaction_id = t.transaction_id
			AND e.event_index = t.event_index
		`+where+`
		ORDER BY t.block_height DESC, t.event_index DESC
		LIMIT $`+fmt.Sprint(arg)+` OFFSET $`+fmt.Sprint(arg+1), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var out []TokenTransferWithContract
	var total int64
	for rows.Next() {
		var t TokenTransferWithContract
		if err := rows.Scan(
			&t.TransactionID,
			&t.BlockHeight,
			&t.TokenContractAddress,
			&t.FromAddress,
			&t.ToAddress,
			&t.Amount,
			&t.TokenID,
			&t.EventIndex,
			&t.IsNFT,
			&t.Timestamp,
			&t.CreatedAt,
			&t.ContractName,
			&t.TotalCount,
		); err != nil {
			return nil, 0, err
		}
		total = t.TotalCount
		out = append(out, t)
	}
	return out, total, nil
}

func (r *Repository) ListFTTokenContractsByAddress(ctx context.Context, address string, limit, offset int) ([]string, error) {
	rows, err := r.db.Query(ctx, `
		SELECT DISTINCT encode(token_contract_address, 'hex') AS token_contract_address
		FROM app.token_transfers
		WHERE is_nft = FALSE AND (from_address = $1 OR to_address = $1)
		ORDER BY token_contract_address ASC
		LIMIT $2 OFFSET $3`, hexToBytes(address), limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

func (r *Repository) ListFTVaultSummariesByAddress(ctx context.Context, address string, limit, offset int) ([]FTVaultSummary, error) {
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := r.db.Query(ctx, `
		SELECT
			encode(t.token_contract_address, 'hex') AS token_contract_address,
			COALESCE(NULLIF(split_part(e.type, '.', 3), ''), '') AS contract_name,
			SUM(
				CASE
					WHEN t.to_address = $1 THEN t.amount::numeric
					WHEN t.from_address = $1 THEN -t.amount::numeric
					ELSE 0::numeric
				END
			)::text AS balance,
			MAX(t.block_height) AS last_height
		FROM app.token_transfers t
		JOIN raw.tx_lookup l ON l.id = t.transaction_id
		LEFT JOIN raw.events e
			ON e.block_height = t.block_height
			AND e.transaction_id = t.transaction_id
			AND e.event_index = t.event_index
		WHERE t.is_nft = FALSE
		  AND (t.to_address = $1 OR t.from_address = $1)
		  AND COALESCE(NULLIF(split_part(e.type, '.', 3), ''), '') <> 'FungibleToken'
		GROUP BY t.token_contract_address, contract_name
		ORDER BY t.token_contract_address ASC
		LIMIT $2 OFFSET $3`, hexToBytes(address), limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []FTVaultSummary
	for rows.Next() {
		var row FTVaultSummary
		if err := rows.Scan(&row.ContractAddress, &row.ContractName, &row.Balance, &row.LastHeight); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, nil
}

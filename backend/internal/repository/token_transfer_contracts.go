package repository

import (
	"context"
	"fmt"
	"os"
	"strings"

	"flowscan-clone/internal/models"
)

type TokenTransferWithContract struct {
	models.TokenTransfer
	ContractName string
}

type FTVaultSummary struct {
	ContractAddress string
	ContractName    string
	Balance         string
	LastHeight      uint64
}

type TokenContract struct {
	Address string
	Name    string
}

func (r *Repository) ListTokenTransfersWithContractFiltered(ctx context.Context, isNFT bool, address, tokenAddress, tokenName, txID string, height *uint64, limit, offset int) ([]TokenTransferWithContract, int64, error) {
	table := "app.ft_transfers"
	if isNFT {
		table = "app.nft_transfers"
	}
	clauses := []string{}
	args := []interface{}{}
	arg := 1

	// Exclude standard wrapper contracts by address. This matches the previous intent of
	// filtering out events where split_part(e.type, '.', 3) was 'FungibleToken'/'NonFungibleToken',
	// but avoids joining raw.events in the COUNT query.
	//
	// Defaults are mainnet addresses. Override for other networks via env vars.
	wrapperAddrHex := ""
	if isNFT {
		wrapperAddrHex = os.Getenv("FLOW_NON_FUNGIBLE_TOKEN_ADDRESS")
		if wrapperAddrHex == "" {
			wrapperAddrHex = "1d7e57aa55817448"
		}
	} else {
		wrapperAddrHex = os.Getenv("FLOW_FUNGIBLE_TOKEN_ADDRESS")
		if wrapperAddrHex == "" {
			wrapperAddrHex = "f233dcee88fe0abe"
		}
	}
	if b := hexToBytes(wrapperAddrHex); len(b) > 0 {
		clauses = append(clauses, fmt.Sprintf("t.token_contract_address <> $%d", arg))
		args = append(args, b)
		arg++
	}
	if address != "" {
		clauses = append(clauses, fmt.Sprintf("(t.from_address = $%d OR t.to_address = $%d)", arg, arg))
		args = append(args, hexToBytes(address))
		arg++
	}
	if tokenAddress != "" {
		clauses = append(clauses, fmt.Sprintf("t.token_contract_address = $%d", arg))
		args = append(args, hexToBytes(tokenAddress))
		arg++
	}
	if tokenName != "" {
		clauses = append(clauses, fmt.Sprintf("t.contract_name = $%d", arg))
		args = append(args, tokenName)
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
	where := ""
	if len(clauses) > 0 {
		where = "WHERE " + strings.Join(clauses, " AND ")
	}
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	// Count query deliberately avoids window functions; those can trigger shared memory allocation
	// failures on constrained Postgres instances (we've seen /dev/shm exhaustion on Railway).
	var total int64
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM `+table+` t `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	listArgs := append(append([]interface{}{}, args...), limit, offset)
	rows, err := r.db.Query(ctx, `
			SELECT
				encode(t.transaction_id, 'hex') AS transaction_id,
				t.block_height,
				COALESCE(encode(t.token_contract_address, 'hex'), '') AS token_contract_address,
				COALESCE(encode(t.from_address, 'hex'), '') AS from_address,
				COALESCE(encode(t.to_address, 'hex'), '') AS to_address,
				`+func() string {
		if isNFT {
			return "''::text AS amount, COALESCE(t.token_id, '') AS token_id"
		}
		return "COALESCE(t.amount::text, '') AS amount, ''::text AS token_id"
	}()+`,
				t.event_index,
				t.timestamp,
				t.timestamp AS created_at,
				COALESCE(t.contract_name, '') AS contract_name
			FROM `+table+` t
			`+where+`
		ORDER BY t.block_height DESC, t.event_index DESC
		LIMIT $`+fmt.Sprint(arg)+` OFFSET $`+fmt.Sprint(arg+1), listArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var out []TokenTransferWithContract
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
			&t.Timestamp,
			&t.CreatedAt,
			&t.ContractName,
		); err != nil {
			return nil, 0, err
		}
		t.IsNFT = isNFT
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return out, total, nil
}

func (r *Repository) ListNFTItemTransfers(ctx context.Context, tokenAddress, tokenName, tokenID string, limit, offset int) ([]TokenTransferWithContract, int64, error) {
	clauses := []string{}
	args := []interface{}{}
	arg := 1

	if tokenAddress != "" {
		clauses = append(clauses, fmt.Sprintf("t.token_contract_address = $%d", arg))
		args = append(args, hexToBytes(tokenAddress))
		arg++
	}
	if tokenName != "" {
		clauses = append(clauses, fmt.Sprintf("t.contract_name = $%d", arg))
		args = append(args, tokenName)
		arg++
	}
	if tokenID != "" {
		clauses = append(clauses, fmt.Sprintf("t.token_id = $%d", arg))
		args = append(args, tokenID)
		arg++
	}
	where := ""
	if len(clauses) > 0 {
		where = "WHERE " + strings.Join(clauses, " AND ")
	}
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	var total int64
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM app.nft_transfers t `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	listArgs := append(append([]interface{}{}, args...), limit, offset)
	rows, err := r.db.Query(ctx, `
		SELECT
			encode(t.transaction_id, 'hex') AS transaction_id,
			t.block_height,
			COALESCE(encode(t.token_contract_address, 'hex'), '') AS token_contract_address,
			COALESCE(encode(t.from_address, 'hex'), '') AS from_address,
			COALESCE(encode(t.to_address, 'hex'), '') AS to_address,
			''::text AS amount,
			COALESCE(t.token_id, '') AS token_id,
			t.event_index,
			t.timestamp,
			t.timestamp AS created_at,
			COALESCE(NULLIF(t.contract_name, ''), '') AS contract_name
		FROM app.nft_transfers t
		`+where+`
		ORDER BY t.block_height DESC, t.event_index DESC
		LIMIT $`+fmt.Sprint(arg)+` OFFSET $`+fmt.Sprint(arg+1), listArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var out []TokenTransferWithContract
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
			&t.Timestamp,
			&t.CreatedAt,
			&t.ContractName,
		); err != nil {
			return nil, 0, err
		}
		t.IsNFT = true
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return out, total, nil
}

func (r *Repository) ListFTTokenContractsByAddress(ctx context.Context, address string, limit, offset int) ([]TokenContract, error) {
	rows, err := r.db.Query(ctx, `
		SELECT DISTINCT
			encode(t.token_contract_address, 'hex') AS token_contract_address,
			COALESCE(t.contract_name, '') AS contract_name
		FROM app.ft_transfers t
		WHERE (t.from_address = $1 OR t.to_address = $1)
		  AND COALESCE(t.contract_name, '') <> 'FungibleToken'
		ORDER BY token_contract_address ASC, contract_name ASC
		LIMIT $2 OFFSET $3`, hexToBytes(address), limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TokenContract
	for rows.Next() {
		var row TokenContract
		if err := rows.Scan(&row.Address, &row.Name); err != nil {
			return nil, err
		}
		out = append(out, row)
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
			encode(h.contract_address, 'hex') AS token_contract_address,
			COALESCE(h.contract_name, '') AS contract_name,
			h.balance::text AS balance,
			COALESCE(h.last_height, 0) AS last_height
		FROM app.ft_holdings h
		WHERE h.address = $1
		  AND h.balance <> 0
		ORDER BY h.contract_address ASC, h.contract_name ASC
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

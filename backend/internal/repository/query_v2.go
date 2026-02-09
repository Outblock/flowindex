package repository

import (
	"context"
	"fmt"
	"strings"

	"flowscan-clone/internal/models"
)

type TransactionFilter struct {
	Height        *uint64
	Payer         string
	Proposer      string
	Authorizer    string
	Status        string
	Limit         int
	Offset        int
	IncludeEvents bool
}

// ListTransactionsFiltered returns transactions using basic filters.
func (r *Repository) ListTransactionsFiltered(ctx context.Context, f TransactionFilter) ([]models.Transaction, error) {
	clauses := []string{}
	args := []interface{}{}
	arg := 1

	if f.Height != nil {
		clauses = append(clauses, fmt.Sprintf("block_height = $%d", arg))
		args = append(args, *f.Height)
		arg++
	}
	if f.Payer != "" {
		clauses = append(clauses, fmt.Sprintf("payer_address = $%d", arg))
		args = append(args, hexToBytes(f.Payer))
		arg++
	}
	if f.Proposer != "" {
		clauses = append(clauses, fmt.Sprintf("proposer_address = $%d", arg))
		args = append(args, hexToBytes(f.Proposer))
		arg++
	}
	if f.Authorizer != "" {
		clauses = append(clauses, fmt.Sprintf("$%d = ANY(authorizers)", arg))
		args = append(args, hexToBytes(f.Authorizer))
		arg++
	}
	if f.Status != "" {
		clauses = append(clauses, fmt.Sprintf("status = $%d", arg))
		args = append(args, f.Status)
		arg++
	}

	where := ""
	if len(clauses) > 0 {
		where = "WHERE " + strings.Join(clauses, " AND ")
	}

	if f.Limit <= 0 {
		f.Limit = 20
	}
	if f.Offset < 0 {
		f.Offset = 0
	}

	args = append(args, f.Limit, f.Offset)

	rows, err := r.db.Query(ctx, `
		SELECT encode(t.id, 'hex') AS id, t.block_height, t.transaction_index,
		       COALESCE(encode(t.proposer_address, 'hex'), '') AS proposer_address,
		       COALESCE(encode(t.payer_address, 'hex'), '') AS payer_address,
		       COALESCE(ARRAY(SELECT encode(a, 'hex') FROM unnest(t.authorizers) a), ARRAY[]::text[]) AS authorizers,
		       t.status, COALESCE(t.error_message, '') AS error_message, t.is_evm, t.gas_limit,
		       COALESCE(m.gas_used, t.gas_used) AS gas_used,
		       t.timestamp, t.timestamp AS created_at,
		       COALESCE(m.event_count, t.event_count) AS event_count
		FROM raw.transactions t
		LEFT JOIN app.tx_metrics m ON m.transaction_id = t.id AND m.block_height = t.block_height
		`+where+`
		ORDER BY t.block_height DESC, t.transaction_index DESC
		LIMIT $`+fmt.Sprint(arg)+` OFFSET $`+fmt.Sprint(arg+1), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Transaction
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers,
			&t.Status, &t.ErrorMessage, &t.IsEVM, &t.GasLimit, &t.GasUsed, &t.Timestamp, &t.CreatedAt, &t.EventCount); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, nil
}

func (r *Repository) ListTransactionsByBlock(ctx context.Context, height uint64, includeEvents bool) ([]models.Transaction, error) {
	rows, err := r.db.Query(ctx, `
		SELECT encode(t.id, 'hex') AS id, t.block_height, t.transaction_index,
		       COALESCE(encode(t.proposer_address, 'hex'), '') AS proposer_address,
		       COALESCE(encode(t.payer_address, 'hex'), '') AS payer_address,
		       COALESCE(ARRAY(SELECT encode(a, 'hex') FROM unnest(t.authorizers) a), ARRAY[]::text[]) AS authorizers,
		       t.status, COALESCE(t.error_message, '') AS error_message, t.is_evm, t.gas_limit,
		       COALESCE(m.gas_used, t.gas_used) AS gas_used,
		       t.timestamp, t.timestamp AS created_at,
		       COALESCE(m.event_count, t.event_count) AS event_count
		FROM raw.transactions t
		LEFT JOIN app.tx_metrics m ON m.transaction_id = t.id AND m.block_height = t.block_height
		WHERE t.block_height = $1
		ORDER BY t.transaction_index ASC`, height)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Transaction
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers,
			&t.Status, &t.ErrorMessage, &t.IsEVM, &t.GasLimit, &t.GasUsed, &t.Timestamp, &t.CreatedAt, &t.EventCount); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	if includeEvents && len(out) > 0 {
		events, err := r.GetEventsByTransactionIDs(ctx, collectTxIDs(out))
		if err != nil {
			return nil, err
		}
		byTx := make(map[string][]models.Event)
		for _, e := range events {
			byTx[e.TransactionID] = append(byTx[e.TransactionID], e)
		}
		for i := range out {
			out[i].Events = byTx[out[i].ID]
		}
	}
	return out, nil
}

func (r *Repository) GetEventsByTransactionIDs(ctx context.Context, txIDs []string) ([]models.Event, error) {
	if len(txIDs) == 0 {
		return nil, nil
	}
	txIDBytes := sliceHexToBytes(txIDs)
	rows, err := r.db.Query(ctx, `
		SELECT COALESCE(internal_id, 0) AS id,
		       encode(transaction_id, 'hex') AS transaction_id,
		       transaction_index, type, event_index,
		       COALESCE(encode(contract_address, 'hex'), '') AS contract_address,
		       '' AS contract_name,
		       COALESCE(event_name, '') AS event_name,
		       COALESCE(payload, '{}'::jsonb) AS payload,
		       '{}'::jsonb AS values,
		       block_height, timestamp
		FROM raw.events
		WHERE transaction_id = ANY($1)
		ORDER BY block_height DESC, transaction_index ASC, event_index ASC`, txIDBytes)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Event
	for rows.Next() {
		var e models.Event
		if err := rows.Scan(&e.ID, &e.TransactionID, &e.TransactionIndex, &e.Type, &e.EventIndex, &e.ContractAddress, &e.ContractName,
			&e.EventName, &e.Payload, &e.Values, &e.BlockHeight, &e.Timestamp); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, nil
}

func (r *Repository) GetEventsByBlockHeight(ctx context.Context, height uint64) ([]models.Event, error) {
	rows, err := r.db.Query(ctx, `
		SELECT COALESCE(internal_id, 0) AS id,
		       encode(transaction_id, 'hex') AS transaction_id,
		       transaction_index, type, event_index,
		       COALESCE(encode(contract_address, 'hex'), '') AS contract_address,
		       '' AS contract_name,
		       COALESCE(event_name, '') AS event_name,
		       COALESCE(payload, '{}'::jsonb) AS payload,
		       '{}'::jsonb AS values,
		       block_height, timestamp
		FROM raw.events
		WHERE block_height = $1
		ORDER BY transaction_index ASC, event_index ASC`, height)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Event
	for rows.Next() {
		var e models.Event
		if err := rows.Scan(&e.ID, &e.TransactionID, &e.TransactionIndex, &e.Type, &e.EventIndex, &e.ContractAddress, &e.ContractName,
			&e.EventName, &e.Payload, &e.Values, &e.BlockHeight, &e.Timestamp); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, nil
}

func collectTxIDs(txs []models.Transaction) []string {
	out := make([]string, 0, len(txs))
	for _, t := range txs {
		out = append(out, t.ID)
	}
	return out
}

// Token transfers (FT/NFT)
func (r *Repository) ListTokenTransfersFiltered(ctx context.Context, isNFT bool, address, token, txID string, height *uint64, limit, offset int) ([]models.TokenTransfer, error) {
	clauses := []string{"is_nft = $1"}
	args := []interface{}{isNFT}
	arg := 2
	if address != "" {
		clauses = append(clauses, fmt.Sprintf("(from_address = $%d OR to_address = $%d)", arg, arg))
		args = append(args, hexToBytes(address))
		arg++
	}
	if token != "" {
		clauses = append(clauses, fmt.Sprintf("token_contract_address = $%d", arg))
		args = append(args, hexToBytes(token))
		arg++
	}
	if txID != "" {
		clauses = append(clauses, fmt.Sprintf("transaction_id = $%d", arg))
		args = append(args, hexToBytes(txID))
		arg++
	}
	if height != nil {
		clauses = append(clauses, fmt.Sprintf("block_height = $%d", arg))
		args = append(args, *height)
		arg++
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
			encode(transaction_id, 'hex') AS transaction_id,
			block_height,
			encode(token_contract_address, 'hex') AS token_contract_address,
			COALESCE(contract_name, '') AS contract_name,
			COALESCE(encode(from_address, 'hex'), '') AS from_address,
			COALESCE(encode(to_address, 'hex'), '') AS to_address,
			amount,
			COALESCE(token_id, '') AS token_id,
			event_index,
			is_nft,
			timestamp,
			created_at
		FROM app.token_transfers
		`+where+`
		ORDER BY block_height DESC, event_index DESC
		LIMIT $`+fmt.Sprint(arg)+` OFFSET $`+fmt.Sprint(arg+1), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.TokenTransfer
	for rows.Next() {
		var t models.TokenTransfer
		if err := rows.Scan(&t.TransactionID, &t.BlockHeight, &t.TokenContractAddress, &t.ContractName, &t.FromAddress, &t.ToAddress, &t.Amount, &t.TokenID, &t.EventIndex, &t.IsNFT, &t.Timestamp, &t.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, nil
}

func (r *Repository) GetTokenTransfersByRange(ctx context.Context, fromHeight, toHeight uint64, isNFT bool) ([]models.TokenTransfer, error) {
	rows, err := r.db.Query(ctx, `
		SELECT
			encode(transaction_id, 'hex') AS transaction_id,
			block_height,
			encode(token_contract_address, 'hex') AS token_contract_address,
			COALESCE(contract_name, '') AS contract_name,
			COALESCE(encode(from_address, 'hex'), '') AS from_address,
			COALESCE(encode(to_address, 'hex'), '') AS to_address,
			amount,
			COALESCE(token_id, '') AS token_id,
			event_index,
			is_nft,
			timestamp,
			created_at
		FROM app.token_transfers
		WHERE block_height >= $1 AND block_height < $2 AND is_nft = $3
		ORDER BY block_height ASC, event_index ASC`, fromHeight, toHeight, isNFT)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.TokenTransfer
	for rows.Next() {
		var t models.TokenTransfer
		if err := rows.Scan(&t.TransactionID, &t.BlockHeight, &t.TokenContractAddress, &t.ContractName, &t.FromAddress, &t.ToAddress, &t.Amount, &t.TokenID, &t.EventIndex, &t.IsNFT, &t.Timestamp, &t.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, nil
}

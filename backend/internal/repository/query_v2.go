package repository

import (
	"context"
	"encoding/json"
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
		SELECT event_index AS id,
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
		SELECT event_index AS id,
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
	table := "app.ft_transfers"
	if isNFT {
		table = "app.nft_transfers"
	}
	clauses := []string{}
	args := []interface{}{}
	arg := 1
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
	args = append(args, limit, offset)

	rows, err := r.db.Query(ctx, `
		SELECT
			encode(transaction_id, 'hex') AS transaction_id,
			block_height,
			encode(token_contract_address, 'hex') AS token_contract_address,
			COALESCE(contract_name, '') AS contract_name,
			COALESCE(encode(from_address, 'hex'), '') AS from_address,
			COALESCE(encode(to_address, 'hex'), '') AS to_address,
			`+func() string {
		if isNFT {
			return "''::text AS amount, COALESCE(token_id, '') AS token_id"
		}
		return "amount, ''::text AS token_id"
	}()+`,
			event_index,
			timestamp,
			timestamp AS created_at
		FROM `+table+`
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
		if err := rows.Scan(&t.TransactionID, &t.BlockHeight, &t.TokenContractAddress, &t.ContractName, &t.FromAddress, &t.ToAddress, &t.Amount, &t.TokenID, &t.EventIndex, &t.Timestamp, &t.CreatedAt); err != nil {
			return nil, err
		}
		t.IsNFT = isNFT
		out = append(out, t)
	}
	return out, nil
}

func (r *Repository) GetTokenTransfersByRange(ctx context.Context, fromHeight, toHeight uint64, isNFT bool) ([]models.TokenTransfer, error) {
	table := "app.ft_transfers"
	if isNFT {
		table = "app.nft_transfers"
	}
	rows, err := r.db.Query(ctx, `
		SELECT
			encode(transaction_id, 'hex') AS transaction_id,
			block_height,
			encode(token_contract_address, 'hex') AS token_contract_address,
			COALESCE(contract_name, '') AS contract_name,
			COALESCE(encode(from_address, 'hex'), '') AS from_address,
			COALESCE(encode(to_address, 'hex'), '') AS to_address,
			`+func() string {
		if isNFT {
			return "''::text AS amount, COALESCE(token_id, '') AS token_id"
		}
		return "amount, ''::text AS token_id"
	}()+`,
			event_index,
			timestamp,
			timestamp AS created_at
		FROM `+table+`
		WHERE block_height >= $1 AND block_height < $2
		ORDER BY block_height ASC, event_index ASC`, fromHeight, toHeight)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.TokenTransfer
	for rows.Next() {
		var t models.TokenTransfer
		if err := rows.Scan(&t.TransactionID, &t.BlockHeight, &t.TokenContractAddress, &t.ContractName, &t.FromAddress, &t.ToAddress, &t.Amount, &t.TokenID, &t.EventIndex, &t.Timestamp, &t.CreatedAt); err != nil {
			return nil, err
		}
		t.IsNFT = isNFT
		out = append(out, t)
	}
	return out, nil
}

// FTTransferSummaryItem represents a single FT token aggregation within a transaction.
type FTTransferSummaryItem struct {
	Token     string `json:"token"`
	Amount    string `json:"amount"`
	Direction string `json:"direction"`
}

// NFTTransferSummaryItem represents a single NFT collection aggregation within a transaction.
type NFTTransferSummaryItem struct {
	Collection string `json:"collection"`
	Count      int    `json:"count"`
	Direction  string `json:"direction"`
}

// TransferSummary holds aggregated FT and NFT transfer info for a single transaction.
type TransferSummary struct {
	FT  []FTTransferSummaryItem  `json:"ft"`
	NFT []NFTTransferSummaryItem `json:"nft"`
}

// GetTransferSummariesByTxIDs returns a map of transaction ID -> TransferSummary.
// The address parameter is used to determine direction (withdraw vs deposit).
func (r *Repository) GetTransferSummariesByTxIDs(ctx context.Context, txIDs []string, address string) (map[string]TransferSummary, error) {
	if len(txIDs) == 0 {
		return map[string]TransferSummary{}, nil
	}
	out := make(map[string]TransferSummary, len(txIDs))
	txIDBytes := sliceHexToBytes(txIDs)
	addrBytes := hexToBytes(address)

	// FT transfers: group by (transaction_id, token_contract_address, contract_name, direction)
	// Exclude generic FungibleToken events (duplicates of specific token events like FlowToken).
	ftRows, err := r.db.Query(ctx, `
		SELECT encode(transaction_id, 'hex') AS tx_id,
		       COALESCE('A.' || encode(token_contract_address, 'hex') || '.' || NULLIF(contract_name, ''), encode(token_contract_address, 'hex')) AS token,
		       SUM(CAST(amount AS NUMERIC)) AS total_amount,
		       CASE WHEN from_address = $2 THEN 'out' ELSE 'in' END AS direction
		FROM app.ft_transfers
		WHERE transaction_id = ANY($1)
		  AND contract_name NOT IN ('FungibleToken', 'NonFungibleToken')
		GROUP BY transaction_id, token_contract_address, contract_name,
		         CASE WHEN from_address = $2 THEN 'out' ELSE 'in' END`, txIDBytes, addrBytes)
	if err != nil {
		return nil, err
	}
	defer ftRows.Close()
	for ftRows.Next() {
		var txID, token, amount, direction string
		if err := ftRows.Scan(&txID, &token, &amount, &direction); err != nil {
			return nil, err
		}
		s := out[txID]
		s.FT = append(s.FT, FTTransferSummaryItem{Token: token, Amount: amount, Direction: direction})
		out[txID] = s
	}

	// NFT transfers: group by (transaction_id, token_contract_address, contract_name, direction)
	// Exclude generic NonFungibleToken events (duplicates of specific collection events).
	nftRows, err := r.db.Query(ctx, `
		SELECT encode(transaction_id, 'hex') AS tx_id,
		       COALESCE('A.' || encode(token_contract_address, 'hex') || '.' || NULLIF(contract_name, ''), encode(token_contract_address, 'hex')) AS collection,
		       COUNT(*) AS cnt,
		       CASE WHEN from_address = $2 THEN 'out' ELSE 'in' END AS direction
		FROM app.nft_transfers
		WHERE transaction_id = ANY($1)
		  AND contract_name NOT IN ('FungibleToken', 'NonFungibleToken')
		GROUP BY transaction_id, token_contract_address, contract_name,
		         CASE WHEN from_address = $2 THEN 'out' ELSE 'in' END`, txIDBytes, addrBytes)
	if err != nil {
		return nil, err
	}
	defer nftRows.Close()
	for nftRows.Next() {
		var txID, collection, direction string
		var count int
		if err := nftRows.Scan(&txID, &collection, &count, &direction); err != nil {
			return nil, err
		}
		s := out[txID]
		s.NFT = append(s.NFT, NFTTransferSummaryItem{Collection: collection, Count: count, Direction: direction})
		out[txID] = s
	}

	return out, nil
}

// TokenMetadataInfo is a lightweight struct for token display info (icon, symbol, name).
type TokenMetadataInfo struct {
	Name        string          `json:"name"`
	Symbol      string          `json:"symbol"`
	Decimals    int             `json:"decimals"`
	Logo        json.RawMessage `json:"logo,omitempty"`
	Description string          `json:"description,omitempty"`
}

// GetFTTokenMetadataByIdentifiers returns display metadata for a set of token identifiers (e.g. "A.1654653399040a61.FlowToken").
func (r *Repository) GetFTTokenMetadataByIdentifiers(ctx context.Context, identifiers []string) (map[string]TokenMetadataInfo, error) {
	out := make(map[string]TokenMetadataInfo, len(identifiers))
	if len(identifiers) == 0 {
		return out, nil
	}
	// Build unique (address, contract_name) pairs.
	type key struct{ addr, name string }
	seen := make(map[key][]string) // key -> original identifiers
	for _, id := range identifiers {
		parts := strings.SplitN(id, ".", 3) // A.hex.Name
		if len(parts) < 3 {
			continue
		}
		addr := strings.TrimPrefix(parts[1], "0x")
		name := parts[2]
		k := key{addr, name}
		seen[k] = append(seen[k], id)
	}

	for k, origIDs := range seen {
		var t models.FTToken
		err := r.db.QueryRow(ctx, `
			SELECT COALESCE(name,''), COALESCE(symbol,''), COALESCE(decimals,0),
			       COALESCE(logo, 'null'::jsonb), COALESCE(description,'')
			FROM app.ft_tokens
			WHERE contract_address = $1 AND contract_name = $2`, hexToBytes(k.addr), k.name).
			Scan(&t.Name, &t.Symbol, &t.Decimals, &t.Logo, &t.Description)
		if err != nil {
			continue // token not found or error, skip
		}
		info := TokenMetadataInfo{Name: t.Name, Symbol: t.Symbol, Decimals: t.Decimals, Description: t.Description}
		if len(t.Logo) > 0 && string(t.Logo) != "null" {
			info.Logo = t.Logo
		}
		for _, origID := range origIDs {
			out[origID] = info
		}
	}
	return out, nil
}

// GetNFTCollectionMetadataByIdentifiers returns display metadata for NFT collection identifiers.
func (r *Repository) GetNFTCollectionMetadataByIdentifiers(ctx context.Context, identifiers []string) (map[string]TokenMetadataInfo, error) {
	out := make(map[string]TokenMetadataInfo, len(identifiers))
	if len(identifiers) == 0 {
		return out, nil
	}
	type key struct{ addr, name string }
	seen := make(map[key][]string)
	for _, id := range identifiers {
		parts := strings.SplitN(id, ".", 3)
		if len(parts) < 3 {
			continue
		}
		addr := strings.TrimPrefix(parts[1], "0x")
		name := parts[2]
		k := key{addr, name}
		seen[k] = append(seen[k], id)
	}

	for k, origIDs := range seen {
		var name, symbol, description string
		var squareImage []byte
		err := r.db.QueryRow(ctx, `
			SELECT COALESCE(name,''), COALESCE(symbol,''), COALESCE(description,''),
			       COALESCE(square_image, 'null'::jsonb)
			FROM app.nft_collections
			WHERE contract_address = $1 AND contract_name = $2`, hexToBytes(k.addr), k.name).
			Scan(&name, &symbol, &description, &squareImage)
		if err != nil {
			continue
		}
		info := TokenMetadataInfo{Name: name, Symbol: symbol, Description: description}
		if len(squareImage) > 0 && string(squareImage) != "null" {
			info.Logo = squareImage
		}
		for _, origID := range origIDs {
			out[origID] = info
		}
	}
	return out, nil
}

// GetScheduledTransactionsByAddress returns transactions involving FlowTransactionScheduler for a given address.
func (r *Repository) GetScheduledTransactionsByAddress(ctx context.Context, address string, limit, offset int) ([]models.Transaction, error) {
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := r.db.Query(ctx, `
		SELECT DISTINCT ON (t.block_height, t.id)
		       encode(t.id, 'hex') AS id, t.block_height, t.transaction_index,
		       COALESCE(encode(t.proposer_address, 'hex'), '') AS proposer_address,
		       COALESCE(encode(t.payer_address, 'hex'), '') AS payer_address,
		       COALESCE(ARRAY(SELECT encode(a, 'hex') FROM unnest(t.authorizers) a), ARRAY[]::text[]) AS authorizers,
		       t.status, COALESCE(t.error_message, '') AS error_message, t.is_evm, t.gas_limit,
		       COALESCE(m.gas_used, t.gas_used) AS gas_used,
		       t.timestamp, t.timestamp AS created_at,
		       COALESCE(m.event_count, t.event_count) AS event_count
		FROM app.tx_contracts tc
		JOIN app.address_transactions at ON at.transaction_id = tc.transaction_id
		JOIN raw.transactions t ON t.id = tc.transaction_id AND t.block_height = at.block_height
		LEFT JOIN app.tx_metrics m ON m.transaction_id = t.id AND m.block_height = t.block_height
		WHERE at.address = $1 AND tc.contract_identifier LIKE '%FlowTransactionScheduler%'
		ORDER BY t.block_height DESC, t.id DESC
		LIMIT $2 OFFSET $3`, hexToBytes(address), limit, offset)
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

// GetScheduledTransactions returns transactions involving FlowTransactionScheduler globally.
func (r *Repository) GetScheduledTransactions(ctx context.Context, limit, offset int) ([]models.Transaction, error) {
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := r.db.Query(ctx, `
		SELECT encode(t.id, 'hex') AS id, t.block_height, t.transaction_index,
		       COALESCE(encode(t.proposer_address, 'hex'), '') AS proposer_address,
		       COALESCE(encode(t.payer_address, 'hex'), '') AS payer_address,
		       COALESCE(ARRAY(SELECT encode(a, 'hex') FROM unnest(t.authorizers) a), ARRAY[]::text[]) AS authorizers,
		       t.status, COALESCE(t.error_message, '') AS error_message, t.is_evm, t.gas_limit,
		       COALESCE(m.gas_used, t.gas_used) AS gas_used,
		       t.timestamp, t.timestamp AS created_at,
		       COALESCE(m.event_count, t.event_count) AS event_count
		FROM app.tx_contracts tc
		JOIN raw.transactions t ON t.id = tc.transaction_id
		LEFT JOIN app.tx_metrics m ON m.transaction_id = t.id AND m.block_height = t.block_height
		WHERE tc.contract_identifier LIKE '%FlowTransactionScheduler%'
		ORDER BY t.block_height DESC, t.transaction_index DESC
		LIMIT $1 OFFSET $2`, limit, offset)
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

// GetTransactionsByContract returns transactions that interact with a given contract identifier.
func (r *Repository) GetTransactionsByContract(ctx context.Context, contractIdentifier string, limit, offset int) ([]models.Transaction, error) {
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := r.db.Query(ctx, `
		SELECT encode(t.id, 'hex') AS id, t.block_height, t.transaction_index,
		       COALESCE(encode(t.proposer_address, 'hex'), '') AS proposer_address,
		       COALESCE(encode(t.payer_address, 'hex'), '') AS payer_address,
		       COALESCE(ARRAY(SELECT encode(a, 'hex') FROM unnest(t.authorizers) a), ARRAY[]::text[]) AS authorizers,
		       t.status, COALESCE(t.error_message, '') AS error_message, t.is_evm, t.gas_limit,
		       COALESCE(m.gas_used, t.gas_used) AS gas_used,
		       t.timestamp, t.timestamp AS created_at,
		       COALESCE(m.event_count, t.event_count) AS event_count
		FROM app.tx_contracts tc
		JOIN raw.transactions t ON t.id = tc.transaction_id
		LEFT JOIN app.tx_metrics m ON m.transaction_id = t.id AND m.block_height = t.block_height
		WHERE tc.contract_identifier = $1
		ORDER BY t.block_height DESC, t.transaction_index DESC
		LIMIT $2 OFFSET $3`, contractIdentifier, limit, offset)
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

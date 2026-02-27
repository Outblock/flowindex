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
	if f.Limit <= 0 {
		f.Limit = 20
	}
	if f.Offset < 0 {
		f.Offset = 0
	}

	// Fast path: no filters → use tx_lookup (non-partitioned, indexed) to find
	// latest tx IDs, then join raw.transactions with known heights for partition pruning.
	hasFilters := f.Height != nil || f.Payer != "" || f.Proposer != "" || f.Authorizer != "" || f.Status != ""
	if !hasFilters {
		return r.listLatestTransactions(ctx, f.Limit, f.Offset)
	}

	// Slow path: filtered query directly on partitioned table.
	clauses := []string{}
	args := []interface{}{}
	arg := 1

	if f.Height != nil {
		clauses = append(clauses, fmt.Sprintf("t.block_height = $%d", arg))
		args = append(args, *f.Height)
		arg++
	}
	if f.Payer != "" {
		clauses = append(clauses, fmt.Sprintf("t.payer_address = $%d", arg))
		args = append(args, hexToBytes(f.Payer))
		arg++
	}
	if f.Proposer != "" {
		clauses = append(clauses, fmt.Sprintf("t.proposer_address = $%d", arg))
		args = append(args, hexToBytes(f.Proposer))
		arg++
	}
	if f.Authorizer != "" {
		clauses = append(clauses, fmt.Sprintf("$%d = ANY(t.authorizers)", arg))
		args = append(args, hexToBytes(f.Authorizer))
		arg++
	}
	if f.Status != "" {
		clauses = append(clauses, fmt.Sprintf("t.status = $%d", arg))
		args = append(args, f.Status)
		arg++
	}

	where := ""
	if len(clauses) > 0 {
		where = "WHERE " + strings.Join(clauses, " AND ")
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
		       COALESCE(m.event_count, t.event_count) AS event_count,
		       COALESCE(t.script_hash, '') AS script_hash
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
	seen := make(map[string]bool)
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers,
			&t.Status, &t.ErrorMessage, &t.IsEVM, &t.GasLimit, &t.GasUsed, &t.Timestamp, &t.CreatedAt, &t.EventCount, &t.ScriptHash); err != nil {
			return nil, err
		}
		if seen[t.ID] {
			continue
		}
		seen[t.ID] = true
		out = append(out, t)
	}
	return out, nil
}

// listLatestTransactions uses tx_lookup (non-partitioned, B-tree on block_height)
// to quickly find the most recent tx IDs, then joins raw.transactions with the
// known block_height for each row so PostgreSQL can prune partitions.
func (r *Repository) listLatestTransactions(ctx context.Context, limit, offset int) ([]models.Transaction, error) {
	rows, err := r.db.Query(ctx, `
		WITH latest AS (
			SELECT id, block_height, transaction_index
			FROM raw.tx_lookup
			ORDER BY block_height DESC, transaction_index DESC
			LIMIT $1 OFFSET $2
		)
		SELECT encode(t.id, 'hex') AS id, t.block_height, t.transaction_index,
		       COALESCE(encode(t.proposer_address, 'hex'), '') AS proposer_address,
		       COALESCE(encode(t.payer_address, 'hex'), '') AS payer_address,
		       COALESCE(ARRAY(SELECT encode(a, 'hex') FROM unnest(t.authorizers) a), ARRAY[]::text[]) AS authorizers,
		       t.status, COALESCE(t.error_message, '') AS error_message, t.is_evm, t.gas_limit,
		       COALESCE(m.gas_used, t.gas_used) AS gas_used,
		       t.timestamp, t.timestamp AS created_at,
		       COALESCE(m.event_count, t.event_count) AS event_count,
		       COALESCE(t.script_hash, '') AS script_hash
		FROM latest l
		JOIN raw.transactions t ON t.id = l.id AND t.block_height = l.block_height
		LEFT JOIN app.tx_metrics m ON m.transaction_id = t.id AND m.block_height = t.block_height
		ORDER BY t.block_height DESC, t.transaction_index DESC`,
		limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []models.Transaction
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers,
			&t.Status, &t.ErrorMessage, &t.IsEVM, &t.GasLimit, &t.GasUsed, &t.Timestamp, &t.CreatedAt, &t.EventCount, &t.ScriptHash); err != nil {
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
		       COALESCE(m.event_count, t.event_count) AS event_count,
		       COALESCE(t.script_hash, '') AS script_hash
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
			&t.Status, &t.ErrorMessage, &t.IsEVM, &t.GasLimit, &t.GasUsed, &t.Timestamp, &t.CreatedAt, &t.EventCount, &t.ScriptHash); err != nil {
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
	Token        string `json:"token"`
	Amount       string `json:"amount"`
	Direction    string `json:"direction"`
	Counterparty string `json:"counterparty,omitempty"`
}

// NFTTransferSummaryItem represents a single NFT collection aggregation within a transaction.
type NFTTransferSummaryItem struct {
	Collection   string `json:"collection"`
	Count        int    `json:"count"`
	Direction    string `json:"direction"`
	Counterparty string `json:"counterparty,omitempty"`
}

// TransferSummary holds aggregated FT and NFT transfer info for a single transaction.
type TransferSummary struct {
	FT  []FTTransferSummaryItem  `json:"ft"`
	NFT []NFTTransferSummaryItem `json:"nft"`
}

// TxRef is a lightweight (ID, BlockHeight) pair used for partition-pruned queries.
type TxRef struct {
	ID          string
	BlockHeight uint64
}

// GetTransferSummariesByTxRefs returns a map of transaction ID -> TransferSummary.
// Uses transaction_id = ANY + block_height = ANY for runtime partition pruning.
// When address is provided, determines direction (out/in) relative to that address.
// When address is empty, returns transfers without direction grouping (from→to).
func (r *Repository) GetTransferSummariesByTxRefs(ctx context.Context, refs []TxRef, address string) (map[string]TransferSummary, error) {
	if len(refs) == 0 {
		return map[string]TransferSummary{}, nil
	}

	if address == "" {
		return r.getTransferSummariesNoDirectionByRefs(ctx, refs)
	}

	out := make(map[string]TransferSummary, len(refs))
	txIDBytes, heights := splitTxRefs(refs)
	addrBytes := hexToBytes(address)

	// Resolve COA address for this Flow address so we can match cross-VM transfers.
	var coaBytes []byte
	var coaHex string
	_ = r.db.QueryRow(ctx, `SELECT encode(coa_address, 'hex') FROM app.coa_accounts WHERE flow_address = $1`, addrBytes).Scan(&coaHex)
	if coaHex != "" {
		coaBytes = hexToBytes(coaHex)
	}

	// FT transfers: block_height = ANY enables runtime partition pruning.
	ftRows, err := r.db.Query(ctx, `
		SELECT encode(ft.transaction_id, 'hex') AS tx_id,
		       COALESCE('A.' || encode(ft.token_contract_address, 'hex') || '.' || NULLIF(ft.contract_name, ''), encode(ft.token_contract_address, 'hex')) AS token,
		       SUM(CAST(ft.amount AS NUMERIC)) AS total_amount,
		       CASE WHEN ft.from_address = $3 OR ($4::bytea IS NOT NULL AND ft.from_address = $4) THEN 'out' ELSE 'in' END AS direction,
		       COALESCE(string_agg(DISTINCT CASE WHEN ft.from_address = $3 OR ($4::bytea IS NOT NULL AND ft.from_address = $4)
		            THEN encode(ft.to_address, 'hex')
		            ELSE encode(ft.from_address, 'hex') END, ','), '') AS counterparty
		FROM app.ft_transfers ft
		WHERE ft.transaction_id = ANY($1) AND ft.block_height = ANY($2)
		  AND ft.contract_name NOT IN ('FungibleToken', 'NonFungibleToken')
		GROUP BY ft.transaction_id, ft.token_contract_address, ft.contract_name,
		         CASE WHEN ft.from_address = $3 OR ($4::bytea IS NOT NULL AND ft.from_address = $4) THEN 'out' ELSE 'in' END`,
		txIDBytes, heights, addrBytes, coaBytes)
	if err != nil {
		return nil, err
	}
	defer ftRows.Close()
	for ftRows.Next() {
		var txID, token, amount, direction, counterparty string
		if err := ftRows.Scan(&txID, &token, &amount, &direction, &counterparty); err != nil {
			return nil, err
		}
		s := out[txID]
		s.FT = append(s.FT, FTTransferSummaryItem{Token: token, Amount: amount, Direction: direction, Counterparty: counterparty})
		out[txID] = s
	}

	// NFT transfers: block_height = ANY enables runtime partition pruning.
	nftRows, err := r.db.Query(ctx, `
		SELECT encode(nft.transaction_id, 'hex') AS tx_id,
		       COALESCE('A.' || encode(nft.token_contract_address, 'hex') || '.' || NULLIF(nft.contract_name, ''), encode(nft.token_contract_address, 'hex')) AS collection,
		       COUNT(*) AS cnt,
		       CASE WHEN nft.from_address = $3 OR ($4::bytea IS NOT NULL AND nft.from_address = $4) THEN 'out' ELSE 'in' END AS direction,
		       COALESCE(string_agg(DISTINCT CASE WHEN nft.from_address = $3 OR ($4::bytea IS NOT NULL AND nft.from_address = $4)
		            THEN encode(nft.to_address, 'hex')
		            ELSE encode(nft.from_address, 'hex') END, ','), '') AS counterparty
		FROM app.nft_transfers nft
		WHERE nft.transaction_id = ANY($1) AND nft.block_height = ANY($2)
		  AND nft.contract_name NOT IN ('FungibleToken', 'NonFungibleToken')
		GROUP BY nft.transaction_id, nft.token_contract_address, nft.contract_name,
		         CASE WHEN nft.from_address = $3 OR ($4::bytea IS NOT NULL AND nft.from_address = $4) THEN 'out' ELSE 'in' END`,
		txIDBytes, heights, addrBytes, coaBytes)
	if err != nil {
		return nil, err
	}
	defer nftRows.Close()
	for nftRows.Next() {
		var txID, collection, direction, counterparty string
		var count int
		if err := nftRows.Scan(&txID, &collection, &count, &direction, &counterparty); err != nil {
			return nil, err
		}
		s := out[txID]
		s.NFT = append(s.NFT, NFTTransferSummaryItem{Collection: collection, Count: count, Direction: direction, Counterparty: counterparty})
		out[txID] = s
	}

	return out, nil
}

// getTransferSummariesNoDirectionByRefs returns transfer summaries without direction/grouping.
// Used for the global tx list where there's no "current address" context.
func (r *Repository) getTransferSummariesNoDirectionByRefs(ctx context.Context, refs []TxRef) (map[string]TransferSummary, error) {
	out := make(map[string]TransferSummary, len(refs))
	txIDBytes, heights := splitTxRefs(refs)

	ftRows, err := r.db.Query(ctx, `
		SELECT encode(ft.transaction_id, 'hex') AS tx_id,
		       COALESCE('A.' || encode(ft.token_contract_address, 'hex') || '.' || NULLIF(ft.contract_name, ''), encode(ft.token_contract_address, 'hex')) AS token,
		       SUM(CAST(ft.amount AS NUMERIC)) AS total_amount,
		       COALESCE(string_agg(DISTINCT encode(ft.from_address, 'hex'), ','), '') AS from_addrs,
		       COALESCE(string_agg(DISTINCT encode(ft.to_address, 'hex'), ','), '') AS to_addrs
		FROM app.ft_transfers ft
		WHERE ft.transaction_id = ANY($1) AND ft.block_height = ANY($2)
		  AND ft.contract_name NOT IN ('FungibleToken', 'NonFungibleToken')
		GROUP BY ft.transaction_id, ft.token_contract_address, ft.contract_name`, txIDBytes, heights)
	if err != nil {
		return nil, err
	}
	defer ftRows.Close()
	for ftRows.Next() {
		var txID, token, amount, fromAddrs, toAddrs string
		if err := ftRows.Scan(&txID, &token, &amount, &fromAddrs, &toAddrs); err != nil {
			return nil, err
		}
		s := out[txID]
		s.FT = append(s.FT, FTTransferSummaryItem{Token: token, Amount: amount, Direction: "transfer", Counterparty: fromAddrs + ">" + toAddrs})
		out[txID] = s
	}

	nftRows, err := r.db.Query(ctx, `
		SELECT encode(nft.transaction_id, 'hex') AS tx_id,
		       COALESCE('A.' || encode(nft.token_contract_address, 'hex') || '.' || NULLIF(nft.contract_name, ''), encode(nft.token_contract_address, 'hex')) AS collection,
		       COUNT(*) AS cnt,
		       COALESCE(string_agg(DISTINCT encode(nft.from_address, 'hex'), ','), '') AS from_addrs,
		       COALESCE(string_agg(DISTINCT encode(nft.to_address, 'hex'), ','), '') AS to_addrs
		FROM app.nft_transfers nft
		WHERE nft.transaction_id = ANY($1) AND nft.block_height = ANY($2)
		  AND nft.contract_name NOT IN ('FungibleToken', 'NonFungibleToken')
		GROUP BY nft.transaction_id, nft.token_contract_address, nft.contract_name`, txIDBytes, heights)
	if err != nil {
		return nil, err
	}
	defer nftRows.Close()
	for nftRows.Next() {
		var txID, collection, fromAddrs, toAddrs string
		var count int
		if err := nftRows.Scan(&txID, &collection, &count, &fromAddrs, &toAddrs); err != nil {
			return nil, err
		}
		s := out[txID]
		s.NFT = append(s.NFT, NFTTransferSummaryItem{Collection: collection, Count: count, Direction: "transfer", Counterparty: fromAddrs + ">" + toAddrs})
		out[txID] = s
	}

	return out, nil
}

// splitTxRefs splits TxRef slice into separate tx ID bytes and unique block heights
// for use with ANY($1) and ANY($2) parameters enabling runtime partition pruning.
func splitTxRefs(refs []TxRef) ([][]byte, []uint64) {
	txIDs := make([][]byte, 0, len(refs))
	heightSet := make(map[uint64]struct{}, len(refs))
	for _, ref := range refs {
		txIDs = append(txIDs, hexToBytes(ref.ID))
		heightSet[ref.BlockHeight] = struct{}{}
	}
	heights := make([]uint64, 0, len(heightSet))
	for h := range heightSet {
		heights = append(heights, h)
	}
	return txIDs, heights
}

// TokenMetadataInfo is a lightweight struct for token display info (icon, symbol, name).
type TokenMetadataInfo struct {
	Name         string `json:"name"`
	Symbol       string `json:"symbol"`
	Decimals     int    `json:"decimals"`
	Logo         string `json:"logo,omitempty"`
	Description  string `json:"description,omitempty"`
	MarketSymbol string `json:"market_symbol,omitempty"`
}

// GetFTTokenMetadataByIdentifiers returns display metadata for a set of token identifiers (e.g. "A.1654653399040a61.FlowToken").
// Also accepts vault identifiers like "A.1654653399040a61.FlowToken.Vault" — the .Vault suffix is stripped.
func (r *Repository) GetFTTokenMetadataByIdentifiers(ctx context.Context, identifiers []string) (map[string]TokenMetadataInfo, error) {
	out := make(map[string]TokenMetadataInfo, len(identifiers))
	if len(identifiers) == 0 {
		return out, nil
	}
	// Build unique (address, contract_name) pairs.
	type key struct{ addr, name string }
	seen := make(map[key][]string) // key -> original identifiers
	for _, id := range identifiers {
		parts := strings.SplitN(id, ".", 3) // A.hex.Name or A.hex.Name.Vault
		if len(parts) < 3 {
			continue
		}
		addr := strings.TrimPrefix(parts[1], "0x")
		name := strings.TrimSuffix(parts[2], ".Vault")
		k := key{addr, name}
		seen[k] = append(seen[k], id)
	}

	for k, origIDs := range seen {
		var t models.FTToken
		var marketSymbol string
		err := r.db.QueryRow(ctx, `
			SELECT COALESCE(name,''), COALESCE(symbol,''), COALESCE(decimals,0),
			       COALESCE(logo::text, ''), COALESCE(description,''), COALESCE(market_symbol,'')
			FROM app.ft_tokens
			WHERE contract_address = $1 AND contract_name = $2`, hexToBytes(k.addr), k.name).
			Scan(&t.Name, &t.Symbol, &t.Decimals, &t.Logo, &t.Description, &marketSymbol)
		if err != nil {
			continue // token not found or error, skip
		}
		info := TokenMetadataInfo{Name: t.Name, Symbol: t.Symbol, Decimals: t.Decimals, Description: t.Description, Logo: t.Logo, MarketSymbol: marketSymbol}
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
		var name, symbol, description, squareImage string
		err := r.db.QueryRow(ctx, `
			SELECT COALESCE(name,''), COALESCE(symbol,''), COALESCE(description,''),
			       COALESCE(square_image::text, '')
			FROM app.nft_collections
			WHERE contract_address = $1 AND contract_name = $2`, hexToBytes(k.addr), k.name).
			Scan(&name, &symbol, &description, &squareImage)
		if err != nil {
			continue
		}
		info := TokenMetadataInfo{Name: name, Symbol: symbol, Description: description, Logo: squareImage}
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
		       COALESCE(m.event_count, t.event_count) AS event_count,
		       COALESCE(t.script_hash, '') AS script_hash
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
			&t.Status, &t.ErrorMessage, &t.IsEVM, &t.GasLimit, &t.GasUsed, &t.Timestamp, &t.CreatedAt, &t.EventCount, &t.ScriptHash); err != nil {
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
		WITH candidates AS (
			SELECT tc.transaction_id, tc.block_height
			FROM app.tx_contracts tc
			WHERE tc.contract_identifier LIKE '%FlowTransactionScheduler%'
			ORDER BY tc.block_height DESC NULLS LAST
			LIMIT $1 OFFSET $2
		),
		page AS (
			SELECT c.transaction_id,
			       COALESCE(c.block_height, tl.block_height) AS block_height
			FROM candidates c
			LEFT JOIN raw.tx_lookup tl ON tl.id = c.transaction_id AND c.block_height IS NULL
		)
		SELECT encode(t.id, 'hex') AS id, t.block_height, t.transaction_index,
		       COALESCE(encode(t.proposer_address, 'hex'), '') AS proposer_address,
		       COALESCE(encode(t.payer_address, 'hex'), '') AS payer_address,
		       COALESCE(ARRAY(SELECT encode(a, 'hex') FROM unnest(t.authorizers) a), ARRAY[]::text[]) AS authorizers,
		       t.status, COALESCE(t.error_message, '') AS error_message, t.is_evm, t.gas_limit,
		       COALESCE(m.gas_used, t.gas_used) AS gas_used,
		       t.timestamp, t.timestamp AS created_at,
		       COALESCE(m.event_count, t.event_count) AS event_count,
		       COALESCE(t.script_hash, '') AS script_hash
		FROM page p
		JOIN raw.transactions t ON t.id = p.transaction_id AND t.block_height = p.block_height
		LEFT JOIN app.tx_metrics m ON m.transaction_id = t.id AND m.block_height = t.block_height
		ORDER BY t.block_height DESC, t.transaction_index DESC`, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Transaction
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers,
			&t.Status, &t.ErrorMessage, &t.IsEVM, &t.GasLimit, &t.GasUsed, &t.Timestamp, &t.CreatedAt, &t.EventCount, &t.ScriptHash); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, nil
}

// GetTransactionsByContract returns transactions that interact with a given contract identifier.
// Uses a two-step approach: first selects matching transaction_ids from tx_contracts using the
// index on (contract_identifier, block_height), then resolves block_height via tx_lookup for
// partition-pruned joins with raw.transactions.
func (r *Repository) GetTransactionsByContract(ctx context.Context, contractIdentifier string, limit, offset int) ([]models.Transaction, error) {
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := r.db.Query(ctx, `
		WITH candidates AS (
			SELECT tc.transaction_id, tc.block_height
			FROM app.tx_contracts tc
			WHERE tc.contract_identifier = $1 AND tc.block_height IS NOT NULL
			ORDER BY tc.block_height DESC
			LIMIT $2 OFFSET $3
		)
		SELECT encode(t.id, 'hex') AS id, t.block_height, t.transaction_index,
		       COALESCE(encode(t.proposer_address, 'hex'), '') AS proposer_address,
		       COALESCE(encode(t.payer_address, 'hex'), '') AS payer_address,
		       COALESCE(ARRAY(SELECT encode(a, 'hex') FROM unnest(t.authorizers) a), ARRAY[]::text[]) AS authorizers,
		       t.status, COALESCE(t.error_message, '') AS error_message, t.is_evm, t.gas_limit,
		       COALESCE(m.gas_used, t.gas_used) AS gas_used,
		       t.timestamp, t.timestamp AS created_at,
		       COALESCE(m.event_count, t.event_count) AS event_count,
		       COALESCE(t.script_hash, '') AS script_hash
		FROM candidates c
		JOIN raw.transactions t ON t.id = c.transaction_id AND t.block_height = c.block_height
		LEFT JOIN app.tx_metrics m ON m.transaction_id = t.id AND m.block_height = t.block_height
		ORDER BY t.block_height DESC, t.transaction_index DESC`, contractIdentifier, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Transaction
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers,
			&t.Status, &t.ErrorMessage, &t.IsEVM, &t.GasLimit, &t.GasUsed, &t.Timestamp, &t.CreatedAt, &t.EventCount, &t.ScriptHash); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, nil
}

// FTTransferRow is a raw FT transfer row for a transaction.
type FTTransferRow struct {
	Token        string `json:"token"`
	ContractName string `json:"contract_name"`
	FromAddress  string `json:"from_address"`
	ToAddress    string `json:"to_address"`
	Amount       string `json:"amount"`
	EventIndex   int    `json:"event_index"`
}

// GetFTTransfersByTransactionID returns all FT transfer rows for a transaction.
func (r *Repository) GetFTTransfersByTransactionID(ctx context.Context, txID string) ([]FTTransferRow, error) {
	txBytes := hexToBytes(txID)
	if txBytes == nil {
		return nil, nil
	}
	rows, err := r.db.Query(ctx, `
		SELECT COALESCE('A.' || encode(token_contract_address, 'hex') || '.' || NULLIF(contract_name, ''), encode(token_contract_address, 'hex')) AS token,
		       COALESCE(contract_name, '') AS contract_name,
		       COALESCE(encode(from_address, 'hex'), '') AS from_address,
		       COALESCE(encode(to_address, 'hex'), '') AS to_address,
		       COALESCE(amount::text, '0') AS amount,
		       event_index
		FROM app.ft_transfers
		WHERE transaction_id = $1
		  AND contract_name NOT IN ('FungibleToken', 'NonFungibleToken')
		ORDER BY event_index`, txBytes)
	if err != nil {
		return nil, fmt.Errorf("get ft transfers by tx: %w", err)
	}
	defer rows.Close()
	var out []FTTransferRow
	for rows.Next() {
		var r FTTransferRow
		if err := rows.Scan(&r.Token, &r.ContractName, &r.FromAddress, &r.ToAddress, &r.Amount, &r.EventIndex); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// NFTTransferRow is a raw NFT transfer row for a transaction.
type NFTTransferRow struct {
	Token        string `json:"token"`
	ContractName string `json:"contract_name"`
	FromAddress  string `json:"from_address"`
	ToAddress    string `json:"to_address"`
	TokenID      string `json:"token_id"`
	EventIndex   int    `json:"event_index"`
}

// GetNFTTransfersByTransactionID returns all NFT transfer rows for a transaction.
func (r *Repository) GetNFTTransfersByTransactionID(ctx context.Context, txID string) ([]NFTTransferRow, error) {
	txBytes := hexToBytes(txID)
	if txBytes == nil {
		return nil, nil
	}
	rows, err := r.db.Query(ctx, `
		SELECT COALESCE('A.' || encode(token_contract_address, 'hex') || '.' || NULLIF(contract_name, ''), encode(token_contract_address, 'hex')) AS token,
		       COALESCE(contract_name, '') AS contract_name,
		       COALESCE(encode(from_address, 'hex'), '') AS from_address,
		       COALESCE(encode(to_address, 'hex'), '') AS to_address,
		       COALESCE(token_id, '') AS token_id,
		       event_index
		FROM app.nft_transfers
		WHERE transaction_id = $1
		  AND contract_name NOT IN ('FungibleToken', 'NonFungibleToken')
		ORDER BY event_index`, txBytes)
	if err != nil {
		return nil, fmt.Errorf("get nft transfers by tx: %w", err)
	}
	defer rows.Close()
	var out []NFTTransferRow
	for rows.Next() {
		var nr NFTTransferRow
		if err := rows.Scan(&nr.Token, &nr.ContractName, &nr.FromAddress, &nr.ToAddress, &nr.TokenID, &nr.EventIndex); err != nil {
			return nil, err
		}
		out = append(out, nr)
	}
	return out, rows.Err()
}

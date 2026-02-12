package repository

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"

	"flowscan-clone/internal/models"
)

const systemFlowAddressHex = "0000000000000000"

func nonSystemTxSQL(alias string) string {
	return fmt.Sprintf(
		`NOT (
			COALESCE(%[1]s.payer_address, '\x'::bytea) = '\x%[2]s'::bytea
			AND COALESCE(%[1]s.proposer_address, '\x'::bytea) = '\x%[2]s'::bytea
		)`,
		alias,
		systemFlowAddressHex,
	)
}

func recentTxWindowFromEnv() int64 {
	const defaultWindow int64 = 20000
	raw := strings.TrimSpace(os.Getenv("API_RECENT_TX_WINDOW"))
	if raw == "" {
		return defaultWindow
	}
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || v <= 0 {
		return defaultWindow
	}
	return v
}

func (r *Repository) ListBlocks(ctx context.Context, limit, offset int) ([]models.Block, error) {
	rows, err := r.db.Query(ctx, `
		SELECT height,
		       encode(id, 'hex') AS id,
		       encode(parent_id, 'hex') AS parent_id,
		       timestamp, collection_count, tx_count, event_count,
		       encode(state_root_hash, 'hex') AS state_root_hash,
		       total_gas_used, is_sealed
		FROM raw.blocks 
		ORDER BY height DESC 
		LIMIT $1 OFFSET $2`,
		limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var blocks []models.Block
	for rows.Next() {
		var b models.Block
		err := rows.Scan(
			&b.Height, &b.ID, &b.ParentID, &b.Timestamp, &b.CollectionCount, &b.TxCount,
			&b.EventCount, &b.StateRootHash, &b.TotalGasUsed, &b.IsSealed,
		)
		if err != nil {
			return nil, err
		}
		blocks = append(blocks, b)
	}
	return blocks, nil
}

func (r *Repository) GetRecentBlocks(ctx context.Context, limit, offset int) ([]models.Block, error) {
	query := `
		SELECT b.height,
		       encode(b.id, 'hex') AS id,
		       encode(b.parent_id, 'hex') AS parent_id,
		       b.timestamp, b.collection_count, b.total_gas_used, b.is_sealed, b.tx_count
		FROM raw.blocks b 
		ORDER BY b.height DESC 
		LIMIT $1 OFFSET $2`

	rows, err := r.db.Query(ctx, query, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var blocks []models.Block
	for rows.Next() {
		var b models.Block
		if err := rows.Scan(&b.Height, &b.ID, &b.ParentID, &b.Timestamp, &b.CollectionCount, &b.TotalGasUsed, &b.IsSealed, &b.TxCount); err != nil {
			return nil, err
		}
		blocks = append(blocks, b)
	}
	return blocks, nil
}

func (r *Repository) GetBlocksByCursor(ctx context.Context, limit int, cursorHeight *uint64) ([]models.Block, error) {
	query := `
		SELECT b.height,
		       encode(b.id, 'hex') AS id,
		       encode(b.parent_id, 'hex') AS parent_id,
		       b.timestamp, b.collection_count, b.total_gas_used, b.is_sealed, b.tx_count
		FROM raw.blocks b
		WHERE ($1::bigint IS NULL OR b.height < $1)
		ORDER BY b.height DESC
		LIMIT $2`

	rows, err := r.db.Query(ctx, query, cursorHeight, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var blocks []models.Block
	for rows.Next() {
		var b models.Block
		if err := rows.Scan(&b.Height, &b.ID, &b.ParentID, &b.Timestamp, &b.CollectionCount, &b.TotalGasUsed, &b.IsSealed, &b.TxCount); err != nil {
			return nil, err
		}
		blocks = append(blocks, b)
	}
	return blocks, nil
}

func (r *Repository) GetBlockByID(ctx context.Context, id string) (*models.Block, error) {
	var height uint64
	err := r.db.QueryRow(ctx, "SELECT height FROM raw.block_lookup WHERE id = $1", hexToBytes(id)).Scan(&height)
	if err != nil {
		return nil, err
	}
	return r.GetBlockByHeight(ctx, height)
}

func (r *Repository) GetBlockByHeight(ctx context.Context, height uint64) (*models.Block, error) {
	var b models.Block
	err := r.db.QueryRow(ctx, `
		SELECT
			height,
			encode(id, 'hex') AS id,
			COALESCE(encode(parent_id, 'hex'), '') AS parent_id,
			timestamp,
			COALESCE(collection_count, 0) AS collection_count,
			COALESCE(total_gas_used, 0) AS total_gas_used,
			COALESCE(is_sealed, FALSE) AS is_sealed
		FROM raw.blocks
		WHERE height = $1
	`, height).
		Scan(&b.Height, &b.ID, &b.ParentID, &b.Timestamp, &b.CollectionCount, &b.TotalGasUsed, &b.IsSealed)
	if err != nil {
		return nil, err
	}

	// Get transactions for this block
	txRows, err := r.db.Query(ctx, `
		SELECT
			encode(id, 'hex') AS id,
			block_height,
			transaction_index,
			COALESCE(encode(proposer_address, 'hex'), '') AS proposer_address,
			COALESCE(encode(payer_address, 'hex'), '') AS payer_address,
			COALESCE(ARRAY(SELECT encode(a, 'hex') FROM unnest(authorizers) a), ARRAY[]::text[]) AS authorizers,
			COALESCE(status, '') AS status,
			COALESCE(error_message, '') AS error_message,
			COALESCE(is_evm, FALSE) AS is_evm,
			COALESCE(gas_limit, 0) AS gas_limit,
			COALESCE(gas_used, 0) AS gas_used,
			timestamp
		FROM raw.transactions
		WHERE block_height = $1
		ORDER BY transaction_index ASC
	`, height)
	if err != nil {
		// If no transactions, just return block without them
		b.TxCount = 0
		return &b, nil
	}
	defer txRows.Close()

	var transactions []models.Transaction
	for txRows.Next() {
		var t models.Transaction
		if err := txRows.Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers, &t.Status, &t.ErrorMessage, &t.IsEVM, &t.GasLimit, &t.GasUsed, &t.Timestamp); err != nil {
			return nil, err
		}
		transactions = append(transactions, t)
	}

	b.Transactions = transactions
	b.TxCount = len(transactions)
	return &b, nil
}

func (r *Repository) GetTransactionByID(ctx context.Context, id string) (*models.Transaction, error) {
	var t models.Transaction

	// Normalize ID: remove 0x if present for consistent DB matching if it's an EVM hash search
	normalizedID := strings.TrimPrefix(strings.ToLower(id), "0x")
	has0x := strings.HasPrefix(strings.ToLower(id), "0x")

	// Search by transactions.id OR evm_transactions.evm_hash
	// Search by transactions.id OR evm_transactions.evm_hash
	// NEW LOGIC: Use lookups or search both.

	// 1. Try resolving ID via raw.tx_lookup
	var blockHeight uint64
	err := r.db.QueryRow(ctx, "SELECT block_height FROM raw.tx_lookup WHERE id = $1", hexToBytes(id)).Scan(&blockHeight)
	if err != nil && has0x {
		err = r.db.QueryRow(ctx, "SELECT block_height FROM raw.tx_lookup WHERE id = $1", hexToBytes(normalizedID)).Scan(&blockHeight)
	}

	query := ""
	args := []interface{}{}

	if err == nil {
		// Found in lookup, efficient query
		// Note: We need to JOIN for EVM details if applicable.
		// NOTE: raw.transactions does NOT have EVM logs. app.evm_transactions has them.
		// For simplicity, we query raw.transactions and app.evm_transactions.
		query = `
			SELECT
				encode(t.id, 'hex') AS id,
				t.block_height,
				t.transaction_index,
				COALESCE(encode(t.proposer_address, 'hex'), '') AS proposer_address,
				COALESCE(t.proposer_key_index, 0), COALESCE(t.proposer_sequence_number, 0),
				COALESCE(encode(t.payer_address, 'hex'), '') AS payer_address,
				COALESCE(ARRAY(SELECT encode(a, 'hex') FROM unnest(t.authorizers) a), ARRAY[]::text[]) AS authorizers,
				COALESCE(t.script, s.script_text, '') AS script,
				t.arguments,
				COALESCE(t.status, '') AS status,
				COALESCE(t.error_message, '') AS error_message,
				COALESCE(t.is_evm, FALSE) AS is_evm,
				COALESCE(t.gas_limit, 0) AS gas_limit,
				COALESCE(m.gas_used, t.gas_used, 0) AS gas_used,
				COALESCE(m.event_count, t.event_count, 0) AS event_count,
				t.timestamp,
				COALESCE(encode(et.evm_hash, 'hex'), '') AS evm_hash,
				COALESCE(encode(et.from_address, 'hex'), '') AS from_address,
				COALESCE(encode(et.to_address, 'hex'), '') AS to_address,
				'' AS evm_value
			FROM raw.transactions t
			LEFT JOIN raw.scripts s ON t.script_hash = s.script_hash
			LEFT JOIN app.evm_transactions et ON t.id = et.transaction_id AND t.block_height = et.block_height
			LEFT JOIN app.tx_metrics m ON m.transaction_id = t.id AND m.block_height = t.block_height
			WHERE t.id = $1 AND t.block_height = $2`
		args = []interface{}{hexToBytes(id), blockHeight}
	} else {
		// Fallback (or EVM Hash Search)
		// If ID is not found, maybe it's EVM Hash?
		// EVM hash -> Cadence tx mapping is derived data and is stored in app.* only.
		var txID string
		var bh uint64
		errEvm := r.db.QueryRow(ctx, "SELECT encode(transaction_id, 'hex'), block_height FROM app.evm_tx_hashes WHERE evm_hash = $1", hexToBytes(normalizedID)).Scan(&txID, &bh)
		if errEvm == nil {
			query = `
				SELECT
					encode(t.id, 'hex') AS id,
					t.block_height,
					t.transaction_index,
					COALESCE(encode(t.proposer_address, 'hex'), '') AS proposer_address,
					COALESCE(t.proposer_key_index, 0), COALESCE(t.proposer_sequence_number, 0),
					COALESCE(encode(t.payer_address, 'hex'), '') AS payer_address,
					COALESCE(ARRAY(SELECT encode(a, 'hex') FROM unnest(t.authorizers) a), ARRAY[]::text[]) AS authorizers,
					COALESCE(t.script, s.script_text, '') AS script,
					t.arguments,
					COALESCE(t.status, '') AS status,
					COALESCE(t.error_message, '') AS error_message,
					COALESCE(t.is_evm, FALSE) AS is_evm,
					COALESCE(t.gas_limit, 0) AS gas_limit,
					COALESCE(m.gas_used, t.gas_used, 0) AS gas_used,
					COALESCE(m.event_count, t.event_count, 0) AS event_count,
					t.timestamp,
					COALESCE(encode(et.evm_hash, 'hex'), '') AS evm_hash,
					COALESCE(encode(et.from_address, 'hex'), '') AS from_address,
					COALESCE(encode(et.to_address, 'hex'), '') AS to_address,
					'' AS evm_value
				FROM raw.transactions t
				LEFT JOIN raw.scripts s ON t.script_hash = s.script_hash
				LEFT JOIN app.evm_transactions et ON t.id = et.transaction_id AND t.block_height = et.block_height
				LEFT JOIN app.tx_metrics m ON m.transaction_id = t.id AND m.block_height = t.block_height
				WHERE t.id = $1 AND t.block_height = $2`
			args = []interface{}{hexToBytes(txID), bh}
		} else {
			// Try finding by EVM hash in app.evm_transactions
			errEvm = r.db.QueryRow(ctx, "SELECT encode(transaction_id, 'hex'), block_height FROM app.evm_transactions WHERE evm_hash = $1", hexToBytes(normalizedID)).Scan(&txID, &bh)
			if errEvm != nil && has0x {
				// If stored with 0x prefix, try that too
				errEvm = r.db.QueryRow(ctx, "SELECT encode(transaction_id, 'hex'), block_height FROM app.evm_transactions WHERE evm_hash = $1", hexToBytes(id)).Scan(&txID, &bh)
			}
			if errEvm == nil {
				query = `
					SELECT
						encode(t.id, 'hex') AS id,
						t.block_height,
						t.transaction_index,
						COALESCE(encode(t.proposer_address, 'hex'), '') AS proposer_address,
						COALESCE(t.proposer_key_index, 0), COALESCE(t.proposer_sequence_number, 0),
						COALESCE(encode(t.payer_address, 'hex'), '') AS payer_address,
						COALESCE(ARRAY(SELECT encode(a, 'hex') FROM unnest(t.authorizers) a), ARRAY[]::text[]) AS authorizers,
						COALESCE(t.script, s.script_text, '') AS script,
						t.arguments,
						COALESCE(t.status, '') AS status,
						COALESCE(t.error_message, '') AS error_message,
						COALESCE(t.is_evm, FALSE) AS is_evm,
						COALESCE(t.gas_limit, 0) AS gas_limit,
						COALESCE(m.gas_used, t.gas_used, 0) AS gas_used,
						COALESCE(m.event_count, t.event_count, 0) AS event_count,
						t.timestamp,
						COALESCE(encode(et.evm_hash, 'hex'), '') AS evm_hash,
						COALESCE(encode(et.from_address, 'hex'), '') AS from_address,
						COALESCE(encode(et.to_address, 'hex'), '') AS to_address,
						'' AS evm_value
					FROM raw.transactions t
					LEFT JOIN raw.scripts s ON t.script_hash = s.script_hash
					LEFT JOIN app.evm_transactions et ON t.id = et.transaction_id AND t.block_height = et.block_height
					LEFT JOIN app.tx_metrics m ON m.transaction_id = t.id AND m.block_height = t.block_height
					WHERE t.id = $1 AND t.block_height = $2`
				args = []interface{}{hexToBytes(txID), bh}
			} else {
				return nil, fmt.Errorf("transaction not found")
			}
		}
	}

	err = r.db.QueryRow(ctx, query, args...).
		Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.ProposerKeyIndex, &t.ProposerSequenceNumber,
			&t.PayerAddress, &t.Authorizers, &t.Script, &t.Arguments, &t.Status, &t.ErrorMessage, &t.IsEVM, &t.GasLimit, &t.GasUsed, &t.EventCount, &t.Timestamp,
			&t.EVMHash, &t.EVMFrom, &t.EVMTo, &t.EVMValue)

	if err != nil {
		return nil, err
	}

	// Fetch events for this transaction separately to ensure they are always present
	events, err := r.GetEventsByTransactionID(ctx, t.ID)
	if err == nil {
		t.Events = events
	}

	return &t, nil
}

func (r *Repository) GetEventsByTransactionID(ctx context.Context, txID string) ([]models.Event, error) {
	var blockHeight uint64
	err := r.db.QueryRow(ctx, "SELECT block_height FROM raw.tx_lookup WHERE id = $1", hexToBytes(txID)).Scan(&blockHeight)
	if err != nil {
		return nil, err
	}

	rows, err := r.db.Query(ctx, `
		SELECT encode(transaction_id, 'hex') AS transaction_id, block_height, transaction_index, type, event_index, payload, timestamp
		FROM raw.events
		WHERE transaction_id = $1 AND block_height = $2
		ORDER BY event_index ASC`, hexToBytes(txID), blockHeight)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []models.Event
	for rows.Next() {
		var e models.Event
		if err := rows.Scan(&e.TransactionID, &e.BlockHeight, &e.TransactionIndex, &e.Type, &e.EventIndex, &e.Payload, &e.Timestamp); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, nil
}

func (r *Repository) GetTransactionsByAddress(ctx context.Context, address string, limit, offset int) ([]models.Transaction, error) {
	// TODO: After a full reindex, this UNION can be simplified to just query
	// app.address_transactions, since the token_worker now writes FT_SENDER,
	// FT_RECEIVER, NFT_SENDER, NFT_RECEIVER roles there. The UNION with
	// ft_transfers/nft_transfers is kept for backward compatibility with data
	// indexed before that change.
	query := `
		WITH addr_txs AS (
			-- 1) Signed participation (payer/proposer/authorizer) + transfer roles
			SELECT at.block_height, at.transaction_id
			FROM app.address_transactions at
			WHERE at.address = $1

			UNION

			-- 2) Token/NFT transfer participation (from/to)
			-- Kept for backward compatibility until a full reindex populates transfer roles in address_transactions.
			SELECT ft.block_height, ft.transaction_id
			FROM app.ft_transfers ft
			WHERE ft.from_address = $1

			UNION

			SELECT ft.block_height, ft.transaction_id
			FROM app.ft_transfers ft
			WHERE ft.to_address = $1

			UNION

			SELECT nt.block_height, nt.transaction_id
			FROM app.nft_transfers nt
			WHERE nt.from_address = $1

			UNION

			SELECT nt.block_height, nt.transaction_id
			FROM app.nft_transfers nt
			WHERE nt.to_address = $1
		)
		SELECT DISTINCT ON (a.block_height, a.transaction_id)
			encode(t.id, 'hex') AS id,
			t.block_height,
			t.transaction_index,
			COALESCE(encode(t.proposer_address, 'hex'), '') AS proposer_address,
			COALESCE(encode(t.payer_address, 'hex'), '') AS payer_address,
			COALESCE(ARRAY(SELECT encode(a, 'hex') FROM unnest(t.authorizers) a), ARRAY[]::text[]) AS authorizers,
			COALESCE(t.status, '') AS status,
			COALESCE(t.error_message, '') AS error_message,
			COALESCE(m.gas_used, t.gas_used, 0) AS gas_used,
			COALESCE(m.event_count, t.event_count, 0) AS event_count,
			t.timestamp
		FROM addr_txs a
		JOIN raw.transactions t ON t.id = a.transaction_id AND t.block_height = a.block_height
		LEFT JOIN app.tx_metrics m ON m.transaction_id = t.id AND m.block_height = t.block_height
		ORDER BY a.block_height DESC, a.transaction_id DESC
		LIMIT $2 OFFSET $3
	`

	rows, err := r.db.Query(ctx, query, hexToBytes(address), limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txs []models.Transaction
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers, &t.Status, &t.ErrorMessage, &t.GasUsed, &t.EventCount, &t.Timestamp); err != nil {
			return nil, err
		}
		txs = append(txs, t)
	}
	return txs, nil
}

type AddressTxCursor struct {
	BlockHeight uint64
	TxID        string
}

func (r *Repository) GetTransactionsByAddressCursor(ctx context.Context, address string, limit int, cursor *AddressTxCursor) ([]models.Transaction, error) {
	// TODO: After a full reindex, this UNION can be simplified to just query
	// app.address_transactions, since the token_worker now writes FT_SENDER,
	// FT_RECEIVER, NFT_SENDER, NFT_RECEIVER roles there.
	query := `
		WITH addr_txs AS (
			SELECT at.block_height, at.transaction_id
			FROM app.address_transactions at
			WHERE at.address = $1

			UNION

			SELECT ft.block_height, ft.transaction_id
			FROM app.ft_transfers ft
			WHERE ft.from_address = $1

			UNION

			SELECT ft.block_height, ft.transaction_id
			FROM app.ft_transfers ft
			WHERE ft.to_address = $1

			UNION

			SELECT nt.block_height, nt.transaction_id
			FROM app.nft_transfers nt
			WHERE nt.from_address = $1

			UNION

			SELECT nt.block_height, nt.transaction_id
			FROM app.nft_transfers nt
			WHERE nt.to_address = $1
		)
		SELECT DISTINCT ON (a.block_height, a.transaction_id)
			encode(t.id, 'hex') AS id,
			t.block_height,
			t.transaction_index,
			COALESCE(encode(t.proposer_address, 'hex'), '') AS proposer_address,
			COALESCE(encode(t.payer_address, 'hex'), '') AS payer_address,
			COALESCE(ARRAY(SELECT encode(a, 'hex') FROM unnest(t.authorizers) a), ARRAY[]::text[]) AS authorizers,
			COALESCE(t.status, '') AS status,
			COALESCE(t.error_message, '') AS error_message,
			COALESCE(m.gas_used, t.gas_used, 0) AS gas_used,
			COALESCE(m.event_count, t.event_count, 0) AS event_count,
			t.timestamp
		FROM addr_txs a
		JOIN raw.transactions t ON t.id = a.transaction_id AND t.block_height = a.block_height
		LEFT JOIN app.tx_metrics m ON m.transaction_id = t.id AND m.block_height = t.block_height
		WHERE ($2::bigint IS NULL OR (a.block_height, a.transaction_id) < ($2, $3))
		ORDER BY a.block_height DESC, a.transaction_id DESC
		LIMIT $4
	`

	var (
		bh interface{}
		id interface{}
	)
	if cursor != nil {
		bh = cursor.BlockHeight
		id = hexToBytes(cursor.TxID)
	}

	rows, err := r.db.Query(ctx, query, hexToBytes(address), bh, id, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txs []models.Transaction
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers, &t.Status, &t.ErrorMessage, &t.GasUsed, &t.EventCount, &t.Timestamp); err != nil {
			return nil, err
		}
		txs = append(txs, t)
	}
	return txs, nil
}

func (r *Repository) GetRecentTransactions(ctx context.Context, limit, offset int) ([]models.Transaction, error) {
	query := fmt.Sprintf(`
		SELECT
			encode(t.id, 'hex') AS id,
			t.block_height,
			t.transaction_index,
			COALESCE(encode(t.proposer_address, 'hex'), '') AS proposer_address,
			COALESCE(encode(t.payer_address, 'hex'), '') AS payer_address,
			COALESCE(ARRAY(SELECT encode(a, 'hex') FROM unnest(t.authorizers) a), ARRAY[]::text[]) AS authorizers,
			COALESCE(t.status, '') AS status,
			COALESCE(t.error_message, '') AS error_message,
			t.timestamp
		FROM raw.transactions t
		WHERE %s
		ORDER BY t.block_height DESC, t.transaction_index DESC, t.id DESC
		LIMIT $1 OFFSET $2`, nonSystemTxSQL("t"))

	rows, err := r.db.Query(ctx, query, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txs []models.Transaction
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers, &t.Status, &t.ErrorMessage, &t.Timestamp); err != nil {
			return nil, err
		}
		txs = append(txs, t)
	}
	return txs, nil
}

type TxCursor struct {
	BlockHeight uint64
	TxIndex     int
	ID          string
}

type TokenTransferCursor struct {
	BlockHeight uint64
	TxID        string
	EventIndex  int
}

func (r *Repository) GetTransactionsByCursor(ctx context.Context, limit int, cursor *TxCursor) ([]models.Transaction, error) {
	query := fmt.Sprintf(`
		SELECT
			encode(t.id, 'hex') AS id,
			t.block_height,
			t.transaction_index,
			COALESCE(encode(t.proposer_address, 'hex'), '') AS proposer_address,
			COALESCE(encode(t.payer_address, 'hex'), '') AS payer_address,
			COALESCE(ARRAY(SELECT encode(a, 'hex') FROM unnest(t.authorizers) a), ARRAY[]::text[]) AS authorizers,
			COALESCE(t.status, '') AS status,
			COALESCE(t.error_message, '') AS error_message,
			t.timestamp
		FROM raw.transactions t
		WHERE %s
		  AND ($1::bigint IS NULL OR (t.block_height, t.transaction_index, t.id) < ($1, $2, $3))
		ORDER BY t.block_height DESC, t.transaction_index DESC, t.id DESC
		LIMIT $4`, nonSystemTxSQL("t"))

	var (
		bh interface{}
		ti interface{}
		id interface{}
	)

	if cursor == nil {
		window := recentTxWindowFromEnv()
		rows, err := r.db.Query(ctx, fmt.Sprintf(`
			WITH latest AS (
				SELECT COALESCE(MAX(height), 0) AS max_height
				FROM raw.blocks
			)
			SELECT
				encode(t.id, 'hex') AS id,
				t.block_height,
				t.transaction_index,
				COALESCE(encode(t.proposer_address, 'hex'), '') AS proposer_address,
				COALESCE(encode(t.payer_address, 'hex'), '') AS payer_address,
				COALESCE(ARRAY(SELECT encode(a, 'hex') FROM unnest(t.authorizers) a), ARRAY[]::text[]) AS authorizers,
				COALESCE(t.status, '') AS status,
				COALESCE(t.error_message, '') AS error_message,
				t.timestamp
			FROM raw.transactions t
			WHERE %s
			  AND t.block_height >= GREATEST((SELECT max_height FROM latest) - $1, 0)
			ORDER BY t.block_height DESC, t.transaction_index DESC, t.id DESC
			LIMIT $2`, nonSystemTxSQL("t")), window, limit)
		if err != nil {
			return nil, err
		}
		defer rows.Close()

		var txs []models.Transaction
		for rows.Next() {
			var t models.Transaction
			if err := rows.Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers, &t.Status, &t.ErrorMessage, &t.Timestamp); err != nil {
				return nil, err
			}
			txs = append(txs, t)
		}
		if len(txs) > 0 {
			return txs, nil
		}
	}

	if cursor != nil {
		bh = cursor.BlockHeight
		ti = cursor.TxIndex
		id = hexToBytes(cursor.ID)
	}

	rows, err := r.db.Query(ctx, query, bh, ti, id, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txs []models.Transaction
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers, &t.Status, &t.ErrorMessage, &t.Timestamp); err != nil {
			return nil, err
		}
		txs = append(txs, t)
	}
	return txs, nil
}

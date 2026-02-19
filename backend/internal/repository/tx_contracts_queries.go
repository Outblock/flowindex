package repository

import (
	"context"
	"fmt"

	"flowscan-clone/internal/models"

	"github.com/jackc/pgx/v5"
)

// TxScript is a lightweight struct with only ID and Script (no other tx fields).
type TxScript struct {
	ID     string
	Script string
}

// EventTypeRow is a lightweight struct with only TransactionID and Type (no payload).
type EventTypeRow struct {
	TransactionID string
	Type          string
}

// GetTxScriptsInRange fetches only (id, script) for transactions in the given height range.
// Much lighter than GetRawTransactionsInRange which also fetches proposer, payer, authorizers, etc.
func (r *Repository) GetTxScriptsInRange(ctx context.Context, fromHeight, toHeight uint64) ([]TxScript, error) {
	rows, err := r.db.Query(ctx, `
		SELECT
			encode(t.id, 'hex') AS id,
			COALESCE(t.script, s.script_text, '') AS script
		FROM raw.transactions t
		LEFT JOIN raw.scripts s ON s.script_hash = t.script_hash
		WHERE t.block_height >= $1 AND t.block_height < $2`,
		fromHeight, toHeight)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []TxScript
	for rows.Next() {
		var t TxScript
		if err := rows.Scan(&t.ID, &t.Script); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// GetEventTypesInRange fetches only (transaction_id, type) from raw events.
// Skips payload, event_index, timestamp, contract_address — massive data savings.
func (r *Repository) GetEventTypesInRange(ctx context.Context, fromHeight, toHeight uint64) ([]EventTypeRow, error) {
	rows, err := r.db.Query(ctx, `
		SELECT encode(transaction_id, 'hex') AS transaction_id, type
		FROM raw.events
		WHERE block_height >= $1 AND block_height < $2`,
		fromHeight, toHeight)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []EventTypeRow
	for rows.Next() {
		var e EventTypeRow
		if err := rows.Scan(&e.TransactionID, &e.Type); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// GetTransferTxIDsInRange returns distinct transaction IDs that have FT or NFT transfers
// in the given height range. Much lighter than GetTokenTransfersByRange.
func (r *Repository) GetTransferTxIDsInRange(ctx context.Context, fromHeight, toHeight uint64, isNFT bool) ([]string, error) {
	table := "app.ft_transfers"
	if isNFT {
		table = "app.nft_transfers"
	}
	rows, err := r.db.Query(ctx, `
		SELECT DISTINCT encode(transaction_id, 'hex') AS transaction_id
		FROM `+table+`
		WHERE block_height >= $1 AND block_height < $2`,
		fromHeight, toHeight)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var txID string
		if err := rows.Scan(&txID); err != nil {
			return nil, err
		}
		out = append(out, txID)
	}
	return out, rows.Err()
}

// BulkUpsertTxContracts uses COPY + temp table for fewer round trips and less lock time
// compared to the batch INSERT approach.
func (r *Repository) BulkUpsertTxContracts(ctx context.Context, rows []models.TxContract) error {
	if len(rows) == 0 {
		return nil
	}
	conn, err := r.db.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("upsert tx contracts: %w", err)
	}
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("upsert tx contracts: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		CREATE TEMP TABLE tmp_tx_contracts (
			transaction_id BYTEA,
			contract_identifier TEXT,
			source TEXT
		) ON COMMIT DROP`); err != nil {
		return fmt.Errorf("upsert tx contracts: %w", err)
	}

	copyRows := make([][]interface{}, len(rows))
	for i, r := range rows {
		copyRows[i] = []interface{}{hexToBytes(r.TransactionID), r.ContractIdentifier, r.Source}
	}
	if _, err := tx.CopyFrom(ctx,
		pgx.Identifier{"tmp_tx_contracts"},
		[]string{"transaction_id", "contract_identifier", "source"},
		pgx.CopyFromRows(copyRows),
	); err != nil {
		return fmt.Errorf("upsert tx contracts: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO app.tx_contracts (transaction_id, contract_identifier, source)
		SELECT transaction_id, contract_identifier, source FROM tmp_tx_contracts
		ON CONFLICT (transaction_id, contract_identifier) DO UPDATE SET
			source = EXCLUDED.source`); err != nil {
		return fmt.Errorf("upsert tx contracts: %w", err)
	}

	return tx.Commit(ctx)
}

// BulkUpsertTxTags uses COPY + temp table for fewer round trips.
func (r *Repository) BulkUpsertTxTags(ctx context.Context, rows []models.TxTag) error {
	if len(rows) == 0 {
		return nil
	}
	conn, err := r.db.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("upsert tx tags: %w", err)
	}
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("upsert tx tags: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		CREATE TEMP TABLE tmp_tx_tags (
			transaction_id BYTEA,
			tag TEXT
		) ON COMMIT DROP`); err != nil {
		return fmt.Errorf("upsert tx tags: %w", err)
	}

	copyRows := make([][]interface{}, len(rows))
	for i, r := range rows {
		copyRows[i] = []interface{}{hexToBytes(r.TransactionID), r.Tag}
	}
	if _, err := tx.CopyFrom(ctx,
		pgx.Identifier{"tmp_tx_tags"},
		[]string{"transaction_id", "tag"},
		pgx.CopyFromRows(copyRows),
	); err != nil {
		return fmt.Errorf("upsert tx tags: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO app.tx_tags (transaction_id, tag)
		SELECT transaction_id, tag FROM tmp_tx_tags
		ON CONFLICT (transaction_id, tag) DO NOTHING`); err != nil {
		return fmt.Errorf("upsert tx tags: %w", err)
	}

	return tx.Commit(ctx)
}

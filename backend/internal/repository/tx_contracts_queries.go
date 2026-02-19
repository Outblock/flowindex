package repository

import (
	"context"
	"fmt"

	"flowscan-clone/internal/models"

	"github.com/jackc/pgx/v5"
)

// TxScriptHash is a lightweight struct with only ID and ScriptHash (no script text).
type TxScriptHash struct {
	ID           string
	ScriptHash   string // SHA-256 hash; empty if no script
	InlineScript string // only populated for legacy rows with no script_hash
}

// EventTypeRow is a lightweight struct with only TransactionID and Type (no payload).
type EventTypeRow struct {
	TransactionID string
	Type          string
}

// GetTxScriptHashesInRange fetches (id, script_hash) for transactions in the given height range.
// No JOIN with raw.scripts — much lighter than fetching full script text per row.
// For legacy rows that have inline script but no script_hash, also returns the inline script
// so the caller can still extract imports.
func (r *Repository) GetTxScriptHashesInRange(ctx context.Context, fromHeight, toHeight uint64) ([]TxScriptHash, error) {
	rows, err := r.db.Query(ctx, `
		SELECT
			encode(id, 'hex') AS id,
			COALESCE(script_hash, '') AS script_hash,
			CASE WHEN script_hash IS NULL AND script IS NOT NULL THEN script ELSE '' END AS inline_script
		FROM raw.transactions
		WHERE block_height >= $1 AND block_height < $2`,
		fromHeight, toHeight)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []TxScriptHash
	for rows.Next() {
		var t TxScriptHash
		if err := rows.Scan(&t.ID, &t.ScriptHash, &t.InlineScript); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// GetScriptTextsByHashes fetches script texts for a set of script_hash values.
// Returns a map of script_hash -> script_text.
func (r *Repository) GetScriptTextsByHashes(ctx context.Context, hashes []string) (map[string]string, error) {
	if len(hashes) == 0 {
		return nil, nil
	}
	rows, err := r.db.Query(ctx, `
		SELECT script_hash, COALESCE(script_text, '')
		FROM raw.scripts
		WHERE script_hash = ANY($1)`, hashes)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]string, len(hashes))
	for rows.Next() {
		var hash, text string
		if err := rows.Scan(&hash, &text); err != nil {
			return nil, err
		}
		out[hash] = text
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

// GetEVMEventsInRange fetches only EVM.TransactionExecuted events (with payload).
// Much lighter than GetRawEventsInRange which returns ALL events (~4% filter ratio).
func (r *Repository) GetEVMEventsInRange(ctx context.Context, fromHeight, toHeight uint64) ([]models.Event, error) {
	rows, err := r.db.Query(ctx, `
		SELECT
			block_height,
			encode(transaction_id, 'hex') AS transaction_id,
			event_index,
			transaction_index,
			type,
			payload,
			COALESCE(encode(contract_address, 'hex'), '') AS contract_address,
			event_name,
			timestamp
		FROM raw.events
		WHERE block_height >= $1 AND block_height < $2
		  AND type LIKE '%EVM.TransactionExecuted%'
		ORDER BY block_height ASC, transaction_index ASC, event_index ASC`,
		fromHeight, toHeight,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []models.Event
	for rows.Next() {
		var e models.Event
		if err := rows.Scan(&e.BlockHeight, &e.TransactionID, &e.EventIndex, &e.TransactionIndex, &e.Type, &e.Payload, &e.ContractAddress, &e.EventName, &e.Timestamp); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, rows.Err()
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
		SELECT DISTINCT ON (transaction_id, contract_identifier) transaction_id, contract_identifier, source
		FROM tmp_tx_contracts
		ON CONFLICT (transaction_id, contract_identifier) DO UPDATE SET
			source = EXCLUDED.source`); err != nil {
		return fmt.Errorf("upsert tx contracts: %w", err)
	}

	return tx.Commit(ctx)
}

// BulkUpsertScriptImports inserts unique (script_hash, contract_identifier) rows
// into app.script_imports. Uses COPY + temp table for efficiency.
func (r *Repository) BulkUpsertScriptImports(ctx context.Context, rows []models.ScriptImport) error {
	if len(rows) == 0 {
		return nil
	}
	conn, err := r.db.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("upsert script imports: %w", err)
	}
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return fmt.Errorf("upsert script imports: %w", err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `
		CREATE TEMP TABLE tmp_script_imports (
			script_hash VARCHAR(64),
			contract_identifier TEXT
		) ON COMMIT DROP`); err != nil {
		return fmt.Errorf("upsert script imports: %w", err)
	}

	copyRows := make([][]interface{}, len(rows))
	for i, r := range rows {
		copyRows[i] = []interface{}{r.ScriptHash, r.ContractIdentifier}
	}
	if _, err := tx.CopyFrom(ctx,
		pgx.Identifier{"tmp_script_imports"},
		[]string{"script_hash", "contract_identifier"},
		pgx.CopyFromRows(copyRows),
	); err != nil {
		return fmt.Errorf("upsert script imports: %w", err)
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO app.script_imports (script_hash, contract_identifier)
		SELECT DISTINCT script_hash, contract_identifier
		FROM tmp_script_imports
		ON CONFLICT (script_hash, contract_identifier) DO NOTHING`); err != nil {
		return fmt.Errorf("upsert script imports: %w", err)
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
		SELECT DISTINCT ON (transaction_id, tag) transaction_id, tag
		FROM tmp_tx_tags
		ON CONFLICT (transaction_id, tag) DO NOTHING`); err != nil {
		return fmt.Errorf("upsert tx tags: %w", err)
	}

	return tx.Commit(ctx)
}

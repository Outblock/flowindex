package repository

import (
	"context"
	"fmt"
	"time"

	"flowscan-clone/internal/models"

	"github.com/jackc/pgx/v5"
)

// GetRawTransactionsInRange fetches raw transactions for a height range.
func (r *Repository) GetRawTransactionsInRange(ctx context.Context, fromHeight, toHeight uint64) ([]models.Transaction, error) {
	rows, err := r.db.Query(ctx, `
		SELECT
			encode(id, 'hex') AS id,
			block_height,
			transaction_index,
			COALESCE(encode(proposer_address, 'hex'), '') AS proposer_address,
			COALESCE(encode(payer_address, 'hex'), '') AS payer_address,
			COALESCE(ARRAY(SELECT encode(a, 'hex') FROM unnest(authorizers) a), ARRAY[]::text[]) AS authorizers,
			COALESCE(raw.transactions.script, raw.scripts.script_text, '') AS script,
			gas_used,
			timestamp
		FROM raw.transactions
		LEFT JOIN raw.scripts ON raw.scripts.script_hash = raw.transactions.script_hash
		WHERE block_height >= $1 AND block_height < $2
		ORDER BY block_height ASC, transaction_index ASC`, fromHeight, toHeight)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txs []models.Transaction
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers, &t.Script, &t.GasUsed, &t.Timestamp); err != nil {
			return nil, err
		}
		txs = append(txs, t)
	}
	return txs, nil
}

// UpsertAccountKeys inserts/updates account keys.
func (r *Repository) UpsertAccountKeys(ctx context.Context, keys []models.AccountKey) error {
	if len(keys) == 0 {
		return nil
	}

	batch := &pgx.Batch{}
	for _, ak := range keys {
		// Revocation events don't include the full public key payload in our stored JSON,
		// so we update by (address, key_index) without touching the public key field.
		if ak.Revoked && ak.PublicKey == "" {
			batch.Queue(`
				UPDATE app.account_keys
				SET revoked = TRUE,
					revoked_at_height = $3,
					last_updated_height = $3,
					updated_at = NOW()
				WHERE address = $1 AND key_index = $2
				  AND $3 >= last_updated_height`,
				hexToBytes(ak.Address), ak.KeyIndex, ak.RevokedAtHeight,
			)
			continue
		}

		// Add/update event
		var revokedAt *uint64
		if ak.RevokedAtHeight != 0 {
			revokedAt = &ak.RevokedAtHeight
		}
		batch.Queue(`
			INSERT INTO app.account_keys (
				address, key_index, public_key,
				signing_algorithm, hashing_algorithm, weight,
				revoked, added_at_height, revoked_at_height, last_updated_height,
				created_at, updated_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
			ON CONFLICT (address, key_index) DO UPDATE SET
				public_key = EXCLUDED.public_key,
				signing_algorithm = EXCLUDED.signing_algorithm,
				hashing_algorithm = EXCLUDED.hashing_algorithm,
				weight = EXCLUDED.weight,
				revoked = EXCLUDED.revoked,
				added_at_height = COALESCE(app.account_keys.added_at_height, EXCLUDED.added_at_height),
				revoked_at_height = CASE WHEN EXCLUDED.revoked THEN EXCLUDED.revoked_at_height ELSE NULL END,
				last_updated_height = EXCLUDED.last_updated_height,
				updated_at = NOW()
			WHERE EXCLUDED.last_updated_height >= app.account_keys.last_updated_height`,
			hexToBytes(ak.Address),
			ak.KeyIndex,
			hexToBytes(ak.PublicKey),
			parseSmallInt(ak.SigningAlgorithm),
			parseSmallInt(ak.HashingAlgorithm),
			ak.Weight,
			ak.Revoked,
			ak.AddedAtHeight,
			revokedAt,
			ak.LastUpdatedHeight,
		)
	}

	br := r.db.SendBatch(ctx, batch)
	defer br.Close()

	for i := 0; i < len(keys); i++ {
		if _, err := br.Exec(); err != nil {
			return fmt.Errorf("upsert account keys: %w", err)
		}
	}
	return nil
}

// UpsertSmartContracts inserts/updates smart contracts.
func (r *Repository) UpsertSmartContracts(ctx context.Context, contracts []models.SmartContract) error {
	if len(contracts) == 0 {
		return nil
	}

	batch := &pgx.Batch{}
	for _, c := range contracts {
		batch.Queue(`
			INSERT INTO app.smart_contracts (address, name, code, last_updated_height, created_at, updated_at)
			VALUES ($1, $2, NULLIF($3, ''), $4, NOW(), NOW())
			ON CONFLICT (address, name) DO UPDATE SET
				last_updated_height = EXCLUDED.last_updated_height,
				code = COALESCE(EXCLUDED.code, app.smart_contracts.code),
				version = app.smart_contracts.version + 1,
				updated_at = NOW()`,
			hexToBytes(c.Address), c.Name, c.Code, c.BlockHeight,
		)
	}

	br := r.db.SendBatch(ctx, batch)
	defer br.Close()

	for i := 0; i < len(contracts); i++ {
		if _, err := br.Exec(); err != nil {
			return fmt.Errorf("upsert smart contracts: %w", err)
		}
	}
	return nil
}

// UpsertContracts inserts/updates contract registry entries.
func (r *Repository) UpsertContracts(ctx context.Context, rows []models.Contract) error {
	if len(rows) == 0 {
		return nil
	}

	batch := &pgx.Batch{}
	for _, c := range rows {
		if c.ID == "" || c.Address == "" || c.Name == "" {
			continue
		}
		firstSeen := c.FirstSeenHeight
		lastSeen := c.LastSeenHeight
		if firstSeen == 0 {
			firstSeen = lastSeen
		}
		if lastSeen == 0 {
			lastSeen = firstSeen
		}
		batch.Queue(`
			INSERT INTO app.contracts (
				id, address, name, kind,
				first_seen_height, last_seen_height,
				created_at, updated_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
			ON CONFLICT (id) DO UPDATE SET
				kind = COALESCE(app.contracts.kind, EXCLUDED.kind),
				first_seen_height = LEAST(COALESCE(app.contracts.first_seen_height, EXCLUDED.first_seen_height), EXCLUDED.first_seen_height),
				last_seen_height = GREATEST(COALESCE(app.contracts.last_seen_height, EXCLUDED.last_seen_height), EXCLUDED.last_seen_height),
				updated_at = NOW()`,
			c.ID,
			hexToBytes(c.Address),
			c.Name,
			nullIfEmpty(c.Kind),
			firstSeen,
			lastSeen,
		)
	}

	br := r.db.SendBatch(ctx, batch)
	defer br.Close()

	for i := 0; i < len(rows); i++ {
		if _, err := br.Exec(); err != nil {
			return fmt.Errorf("upsert contracts: %w", err)
		}
	}
	return nil
}

// UpsertAddressTransactions inserts address->tx relations.
func (r *Repository) UpsertAddressTransactions(ctx context.Context, rows []models.AddressTransaction) error {
	if len(rows) == 0 {
		return nil
	}

	batch := &pgx.Batch{}
	for _, at := range rows {
		batch.Queue(`
			INSERT INTO app.address_transactions (address, transaction_id, block_height, role)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (address, block_height, transaction_id, role) DO NOTHING`,
			hexToBytes(at.Address), hexToBytes(at.TransactionID), at.BlockHeight, at.Role,
		)
	}

	br := r.db.SendBatch(ctx, batch)
	defer br.Close()

	for i := 0; i < len(rows); i++ {
		if _, err := br.Exec(); err != nil {
			return fmt.Errorf("upsert address transactions: %w", err)
		}
	}
	return nil
}

// UpsertEVMTxHashes inserts EVM hash mappings derived from raw.events.
// It also keeps app.evm_transactions populated with a single representative hash per Cadence tx.
func (r *Repository) UpsertEVMTxHashes(ctx context.Context, rows []models.EVMTxHash) error {
	if len(rows) == 0 {
		return nil
	}

	now := time.Now()

	batch := &pgx.Batch{}
	for _, row := range rows {
		ts := row.Timestamp
		if ts.IsZero() {
			ts = now
		}
		createdAt := row.CreatedAt
		if createdAt.IsZero() {
			createdAt = now
		}

		batch.Queue(`
			INSERT INTO app.evm_tx_hashes (
				block_height, transaction_id, evm_hash,
				event_index, timestamp, created_at
			)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (block_height, transaction_id, event_index, evm_hash) DO NOTHING`,
			row.BlockHeight,
			hexToBytes(row.TransactionID),
			hexToBytes(row.EVMHash),
			row.EventIndex,
			ts,
			createdAt,
		)
	}

	br := r.db.SendBatch(ctx, batch)
	defer br.Close()

	for i := 0; i < len(rows); i++ {
		if _, err := br.Exec(); err != nil {
			return fmt.Errorf("upsert evm_tx_hashes: %w", err)
		}
	}

	summaryBatch := &pgx.Batch{}
	for _, row := range rows {
		ts := row.Timestamp
		if ts.IsZero() {
			ts = now
		}
		fromAddr := nullIfEmptyBytes(hexToBytes(row.FromAddress))
		toAddr := nullIfEmptyBytes(hexToBytes(row.ToAddress))
		var dataVal interface{}
		if row.Data != "" {
			dataVal = row.Data
		}
		var logsVal interface{}
		if row.Logs != "" {
			logsVal = row.Logs
		}
		var gasPriceVal interface{}
		if row.GasPrice != "" {
			gasPriceVal = row.GasPrice
		}
		var gasFeeCapVal interface{}
		if row.GasFeeCap != "" {
			gasFeeCapVal = row.GasFeeCap
		}
		var gasTipCapVal interface{}
		if row.GasTipCap != "" {
			gasTipCapVal = row.GasTipCap
		}
		var valueVal interface{}
		if row.Value != "" {
			valueVal = row.Value
		}
		var chainIDVal interface{}
		if row.ChainID != "" {
			chainIDVal = row.ChainID
		}
		var statusVal interface{}
		if row.Status != "" {
			statusVal = row.Status
		}
		summaryBatch.Queue(`
			INSERT INTO app.evm_transactions (
				block_height, transaction_id, evm_hash, event_index, transaction_index,
				from_address, to_address, nonce, gas_limit, gas_used,
				gas_price, gas_fee_cap, gas_tip_cap, value, tx_type, chain_id,
				data, logs, status_code, status,
				timestamp, created_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
			        $11, $12, $13, $14, $15, $16,
			        $17, $18, $19, $20,
			        $21, NOW())
			ON CONFLICT (block_height, transaction_id, event_index, evm_hash) DO UPDATE SET
				from_address = COALESCE(app.evm_transactions.from_address, EXCLUDED.from_address),
				to_address = COALESCE(app.evm_transactions.to_address, EXCLUDED.to_address),
				nonce = COALESCE(app.evm_transactions.nonce, EXCLUDED.nonce),
				gas_limit = COALESCE(app.evm_transactions.gas_limit, EXCLUDED.gas_limit),
				gas_used = COALESCE(app.evm_transactions.gas_used, EXCLUDED.gas_used),
				gas_price = COALESCE(app.evm_transactions.gas_price, EXCLUDED.gas_price),
				gas_fee_cap = COALESCE(app.evm_transactions.gas_fee_cap, EXCLUDED.gas_fee_cap),
				gas_tip_cap = COALESCE(app.evm_transactions.gas_tip_cap, EXCLUDED.gas_tip_cap),
				value = COALESCE(app.evm_transactions.value, EXCLUDED.value),
				tx_type = COALESCE(app.evm_transactions.tx_type, EXCLUDED.tx_type),
				chain_id = COALESCE(app.evm_transactions.chain_id, EXCLUDED.chain_id),
				data = COALESCE(app.evm_transactions.data, EXCLUDED.data),
				logs = COALESCE(app.evm_transactions.logs, EXCLUDED.logs),
				status_code = COALESCE(app.evm_transactions.status_code, EXCLUDED.status_code),
				status = COALESCE(app.evm_transactions.status, EXCLUDED.status),
				transaction_index = COALESCE(app.evm_transactions.transaction_index, EXCLUDED.transaction_index),
				timestamp = EXCLUDED.timestamp`,
			row.BlockHeight,
			hexToBytes(row.TransactionID),
			hexToBytes(row.EVMHash),
			row.EventIndex,
			row.TransactionIndex,
			fromAddr,
			toAddr,
			row.Nonce,
			row.GasLimit,
			row.GasUsed,
			gasPriceVal,
			gasFeeCapVal,
			gasTipCapVal,
			valueVal,
			row.TxType,
			chainIDVal,
			dataVal,
			logsVal,
			row.StatusCode,
			statusVal,
			ts,
		)
	}

	br2 := r.db.SendBatch(ctx, summaryBatch)
	defer br2.Close()

	for i := 0; i < len(rows); i++ {
		if _, err := br2.Exec(); err != nil {
			return fmt.Errorf("upsert evm_transactions summary: %w", err)
		}
	}

	return nil
}

// BackfillAddressTransactionsRange populates app.address_transactions from raw.transactions
// for a block height range [fromHeight, toHeight). It is safe to run repeatedly.
func (r *Repository) BackfillAddressTransactionsRange(ctx context.Context, fromHeight, toHeight uint64) (int64, error) {
	if toHeight <= fromHeight {
		return 0, nil
	}

	cmd, err := r.db.Exec(ctx, `
		INSERT INTO app.address_transactions (address, transaction_id, block_height, role)
		SELECT address, transaction_id, block_height, role
		FROM (
			SELECT payer_address AS address, id AS transaction_id, block_height, 'PAYER' AS role
			FROM raw.transactions
			WHERE block_height >= $1 AND block_height < $2

			UNION ALL
			SELECT proposer_address AS address, id AS transaction_id, block_height, 'PROPOSER' AS role
			FROM raw.transactions
			WHERE block_height >= $1 AND block_height < $2

			UNION ALL
			SELECT unnest(authorizers) AS address, id AS transaction_id, block_height, 'AUTHORIZER' AS role
			FROM raw.transactions
			WHERE block_height >= $1 AND block_height < $2
		) s
		WHERE address IS NOT NULL
		ON CONFLICT (address, block_height, transaction_id, role) DO NOTHING
	`, fromHeight, toHeight)
	if err != nil {
		return 0, fmt.Errorf("backfill address transactions: %w", err)
	}

	return cmd.RowsAffected(), nil
}

// BackfillAddressTransactionsAndStatsRange inserts app.address_transactions for the given
// height range and updates app.address_stats based on newly inserted rows only.
//
// This is safe to run repeatedly (idempotent) because address_stats is updated from the
// INSERT .. RETURNING rows (ON CONFLICT DO NOTHING).
func (r *Repository) BackfillAddressTransactionsAndStatsRange(ctx context.Context, fromHeight, toHeight uint64) error {
	if toHeight <= fromHeight {
		return nil
	}

	_, err := r.db.Exec(ctx, `
		WITH ins AS (
			INSERT INTO app.address_transactions (address, transaction_id, block_height, role)
			SELECT address, transaction_id, block_height, role
			FROM (
				SELECT payer_address AS address, id AS transaction_id, block_height, 'PAYER' AS role
				FROM raw.transactions
				WHERE block_height >= $1 AND block_height < $2

				UNION ALL
				SELECT proposer_address AS address, id AS transaction_id, block_height, 'PROPOSER' AS role
				FROM raw.transactions
				WHERE block_height >= $1 AND block_height < $2

				UNION ALL
				SELECT unnest(authorizers) AS address, id AS transaction_id, block_height, 'AUTHORIZER' AS role
				FROM raw.transactions
				WHERE block_height >= $1 AND block_height < $2
			) s
			WHERE address IS NOT NULL
			ON CONFLICT (address, block_height, transaction_id, role) DO NOTHING
			RETURNING address, transaction_id, block_height
		),
		dedup AS (
			SELECT address, transaction_id, block_height
			FROM ins
			GROUP BY address, transaction_id, block_height
		),
		agg AS (
			SELECT d.address,
			       COUNT(*)::bigint AS tx_count,
			       COALESCE(SUM(t.gas_used), 0)::bigint AS total_gas_used,
			       MAX(d.block_height)::bigint AS last_updated_block
			FROM dedup d
			JOIN raw.transactions t
			  ON t.block_height = d.block_height
			 AND t.id = d.transaction_id
			GROUP BY d.address
		)
		INSERT INTO app.address_stats (address, tx_count, total_gas_used, last_updated_block, created_at, updated_at)
		SELECT address, tx_count, total_gas_used, last_updated_block, NOW(), NOW()
		FROM agg
		ON CONFLICT (address) DO UPDATE SET
			tx_count = app.address_stats.tx_count + EXCLUDED.tx_count,
			total_gas_used = app.address_stats.total_gas_used + EXCLUDED.total_gas_used,
			last_updated_block = GREATEST(app.address_stats.last_updated_block, EXCLUDED.last_updated_block),
			updated_at = NOW()
	`, fromHeight, toHeight)
	return err
}

type AddressStatDelta struct {
	Address          string
	TxCount          int64
	TotalGasUsed     uint64
	LastUpdatedBlock uint64
}

// UpdateAddressStatsBatch updates address_stats using aggregated deltas.
func (r *Repository) UpdateAddressStatsBatch(ctx context.Context, deltas []AddressStatDelta) error {
	if len(deltas) == 0 {
		return nil
	}

	batch := &pgx.Batch{}
	for _, d := range deltas {
		batch.Queue(`
			INSERT INTO app.address_stats (address, tx_count, total_gas_used, last_updated_block, created_at, updated_at)
			VALUES ($1, $2, $3, $4, NOW(), NOW())
			ON CONFLICT (address) DO UPDATE SET
				tx_count = app.address_stats.tx_count + EXCLUDED.tx_count,
				total_gas_used = app.address_stats.total_gas_used + EXCLUDED.total_gas_used,
				last_updated_block = GREATEST(app.address_stats.last_updated_block, EXCLUDED.last_updated_block),
				updated_at = NOW()`,
			hexToBytes(d.Address), d.TxCount, d.TotalGasUsed, d.LastUpdatedBlock,
		)
	}

	br := r.db.SendBatch(ctx, batch)
	defer br.Close()

	for i := 0; i < len(deltas); i++ {
		if _, err := br.Exec(); err != nil {
			return fmt.Errorf("update address stats: %w", err)
		}
	}
	return nil
}

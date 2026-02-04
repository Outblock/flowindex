package repository

import (
	"context"
	"fmt"

	"flowscan-clone/internal/models"

	"github.com/jackc/pgx/v5"
)

// GetRawTransactionsInRange fetches raw transactions for a height range.
func (r *Repository) GetRawTransactionsInRange(ctx context.Context, fromHeight, toHeight uint64) ([]models.Transaction, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id, block_height, transaction_index, proposer_address, payer_address, authorizers, gas_used, timestamp
		FROM raw.transactions
		WHERE block_height >= $1 AND block_height < $2
		ORDER BY block_height ASC, transaction_index ASC`, fromHeight, toHeight)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txs []models.Transaction
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers, &t.GasUsed, &t.Timestamp); err != nil {
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
				ak.Address, ak.KeyIndex, ak.RevokedAtHeight,
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
			ak.Address,
			ak.KeyIndex,
			ak.PublicKey,
			ak.SigningAlgorithm,
			ak.HashingAlgorithm,
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
			INSERT INTO app.smart_contracts (address, name, last_updated_height, created_at, updated_at)
			VALUES ($1, $2, $3, NOW(), NOW())
			ON CONFLICT (address, name) DO UPDATE SET
				last_updated_height = EXCLUDED.last_updated_height,
				version = app.smart_contracts.version + 1,
				updated_at = NOW()`,
			c.Address, c.Name, c.BlockHeight,
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
			at.Address, at.TransactionID, at.BlockHeight, at.Role,
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
		WHERE address IS NOT NULL AND address <> ''
		ON CONFLICT (address, block_height, transaction_id, role) DO NOTHING
	`, fromHeight, toHeight)
	if err != nil {
		return 0, fmt.Errorf("backfill address transactions: %w", err)
	}

	return cmd.RowsAffected(), nil
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
			d.Address, d.TxCount, d.TotalGasUsed, d.LastUpdatedBlock,
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

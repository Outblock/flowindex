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
		batch.Queue(`
			INSERT INTO app.account_keys (public_key, address, key_index, signing_algorithm, hashing_algorithm, weight, revoked, last_updated_height)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			ON CONFLICT (public_key, address) DO UPDATE SET
				key_index = EXCLUDED.key_index,
				signing_algorithm = EXCLUDED.signing_algorithm,
				hashing_algorithm = EXCLUDED.hashing_algorithm,
				weight = EXCLUDED.weight,
				revoked = EXCLUDED.revoked,
				last_updated_height = EXCLUDED.last_updated_height`,
			ak.PublicKey, ak.Address, ak.KeyIndex, ak.SigningAlgorithm, ak.HashingAlgorithm, ak.Weight, ak.Revoked, ak.BlockHeight,
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

package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"flowscan-clone/internal/models"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(dbURL string) (*Repository, error) {
	config, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		return nil, fmt.Errorf("unable to parse db url: %w", err)
	}

	// Apply Pool Settings
	if maxConnStr := os.Getenv("DB_MAX_OPEN_CONNS"); maxConnStr != "" {
		if maxConn, err := strconv.Atoi(maxConnStr); err == nil {
			config.MaxConns = int32(maxConn)
		}
	}
	if minConnStr := os.Getenv("DB_MAX_IDLE_CONNS"); minConnStr != "" {
		if minConn, err := strconv.Atoi(minConnStr); err == nil {
			config.MinConns = int32(minConn)
		}
	}

	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil, fmt.Errorf("unable to connect to database: %w", err)
	}

	return &Repository{db: pool}, nil
}

func (r *Repository) Migrate(schemaPath string) error {
	content, err := os.ReadFile(schemaPath)
	if err != nil {
		return fmt.Errorf("failed to read schema file: %w", err)
	}

	// Execute the entire schema script
	_, err = r.db.Exec(context.Background(), string(content))
	if err != nil {
		return fmt.Errorf("failed to execute schema: %w", err)
	}
	return nil
}

func (r *Repository) Close() {
	r.db.Close()
}

// GetLastIndexedHeight gets the last sync height from checkpoints
func (r *Repository) GetLastIndexedHeight(ctx context.Context, serviceName string) (uint64, error) {
	var height uint64
	err := r.db.QueryRow(ctx, "SELECT last_height FROM app.indexing_checkpoints WHERE service_name = $1", serviceName).Scan(&height)
	if err == pgx.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return height, nil
}

// SaveBatch atomicially saves a batch of blocks and all related data
// SaveBatch saves a batch of blocks and related data atomically
func (r *Repository) SaveBatch(ctx context.Context, blocks []*models.Block, txs []models.Transaction, events []models.Event, addressActivity []models.AddressTransaction, tokenTransfers []models.TokenTransfer, accountKeys []models.AccountKey, serviceName string, checkpointHeight uint64) error {
	if len(blocks) == 0 {
		return nil
	}

	enableDerivedWrites := os.Getenv("ENABLE_DERIVED_WRITES") == "true"

	minHeight := blocks[0].Height
	maxHeight := blocks[0].Height
	for _, b := range blocks {
		if b.Height < minHeight {
			minHeight = b.Height
		}
		if b.Height > maxHeight {
			maxHeight = b.Height
		}
	}

	if err := r.EnsureRawPartitions(ctx, minHeight, maxHeight); err != nil {
		return err
	}
	if enableDerivedWrites {
		if err := r.EnsureAppPartitions(ctx, minHeight, maxHeight); err != nil {
			return err
		}
	}

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Precompute block timestamps for downstream inserts
	blockTimeByHeight := make(map[uint64]time.Time, len(blocks))

	// 1. Insert Blocks
	for _, b := range blocks {
		blockTimeByHeight[b.Height] = b.Timestamp

		// Insert into partitioned raw.blocks
		_, err := tx.Exec(ctx, `
			INSERT INTO raw.blocks (height, id, parent_id, timestamp, collection_count, tx_count, event_count, state_root_hash, collection_guarantees, block_seals, signatures, execution_result_id, total_gas_used, is_sealed, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
			ON CONFLICT (height) DO UPDATE SET
				id = EXCLUDED.id,
				tx_count = EXCLUDED.tx_count,
				event_count = EXCLUDED.event_count,
				state_root_hash = EXCLUDED.state_root_hash,
				collection_guarantees = EXCLUDED.collection_guarantees,
				block_seals = EXCLUDED.block_seals,
				signatures = EXCLUDED.signatures,
				execution_result_id = EXCLUDED.execution_result_id,
				is_sealed = EXCLUDED.is_sealed`,
			b.Height, b.ID, b.ParentID, b.Timestamp, b.CollectionCount, b.TxCount, b.EventCount, b.StateRootHash, b.CollectionGuarantees, b.BlockSeals, b.Signatures, b.ExecutionResultID, b.TotalGasUsed, b.IsSealed, time.Now(),
		)
		if err != nil {
			return fmt.Errorf("failed to insert block %d: %w", b.Height, err)
		}

		// Insert into raw.block_lookup (Atomic Lookup)
		_, err = tx.Exec(ctx, `
			INSERT INTO raw.block_lookup (id, height, timestamp, created_at)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (id) DO UPDATE SET
				height = EXCLUDED.height,
				timestamp = EXCLUDED.timestamp`,
			b.ID, b.Height, b.Timestamp, time.Now(),
		)
		if err != nil {
			return fmt.Errorf("failed to insert block lookup %d: %w", b.Height, err)
		}
	}

	// 2. Insert Transactions
	for _, t := range txs {
		// eventsJSON, _ := json.Marshal(t.Events) // No longer needed in raw.transactions? Plan says "raw tables only", strict schema.
		// Actually schema has `arguments JSONB`.
		// NOTE: raw.transactions definition misses 'events' column in new schema?
		// Let's check schema provided. `raw.transactions` does NOT have `events` JSON column.
		// It has `event_count`.
		// So we REMOVE events from raw.transactions insert.

		// Ensure timestamp is present; default to block timestamp if missing
		txTimestamp := t.Timestamp
		if txTimestamp.IsZero() {
			if ts, ok := blockTimeByHeight[t.BlockHeight]; ok {
				txTimestamp = ts
			}
		}
		if txTimestamp.IsZero() {
			txTimestamp = time.Now()
		}
		createdAt := time.Now()

		eventCount := t.EventCount
		if eventCount == 0 {
			eventCount = len(t.Events)
		}

		_, err := tx.Exec(ctx, `
			INSERT INTO raw.transactions (block_height, id, transaction_index, proposer_address, payer_address, authorizers, script, arguments, status, error_message, is_evm, gas_limit, gas_used, event_count, timestamp, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
			ON CONFLICT (block_height, id) DO UPDATE SET
				transaction_index = EXCLUDED.transaction_index,
				status = EXCLUDED.status,
				error_message = EXCLUDED.error_message,
				gas_used = EXCLUDED.gas_used,
				event_count = EXCLUDED.event_count,
				is_evm = EXCLUDED.is_evm, 
				created_at = EXCLUDED.created_at`,
			t.BlockHeight, t.ID, t.TransactionIndex, t.ProposerAddress, t.PayerAddress, t.Authorizers, t.Script, t.Arguments, t.Status, t.ErrorMessage, t.IsEVM, t.GasLimit, t.GasUsed, eventCount, txTimestamp, createdAt,
		)
		if err != nil {
			return fmt.Errorf("failed to insert tx %s: %w", t.ID, err)
		}

		// Insert into raw.tx_lookup (Atomic Lookup)
		_, err = tx.Exec(ctx, `
			INSERT INTO raw.tx_lookup (id, evm_hash, block_height, transaction_index, timestamp, created_at)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (id) DO UPDATE SET
				evm_hash = COALESCE(EXCLUDED.evm_hash, raw.tx_lookup.evm_hash),
				block_height = EXCLUDED.block_height,
				transaction_index = EXCLUDED.transaction_index,
				timestamp = EXCLUDED.timestamp`,
			t.ID, func() *string {
				if t.EVMHash == "" {
					return nil
				}
				normalized := strings.TrimPrefix(strings.ToLower(t.EVMHash), "0x")
				if normalized == "" {
					return nil
				}
				return &normalized
			}(), t.BlockHeight, t.TransactionIndex, txTimestamp, createdAt,
		)
		if err != nil {
			return fmt.Errorf("failed to insert tx lookup %s: %w", t.ID, err)
		}

		// 2a. Insert EVM Transaction details if applicable (to App DB)
		if enableDerivedWrites && t.IsEVM {
			// Schema v2: app.evm_transactions (block_height, transaction_id, ...)
			// Note: logs are JSONB.

			// We need to fetch 'logs' if available. Assuming t.EVMLogs exists or similiar.
			// Current model might not have strict match. We'll skip logs for now or fix model.
			// Based on previous code, we just insert basic EVM fields.

			_, err := tx.Exec(ctx, `
				INSERT INTO app.evm_transactions (block_height, transaction_id, evm_hash, from_address, to_address, timestamp, created_at)
				VALUES ($1, $2, $3, $4, $5, $6, $7)
				ON CONFLICT (block_height, transaction_id) DO NOTHING`,
				t.BlockHeight, t.ID, t.EVMHash, t.EVMFrom, t.EVMTo, txTimestamp, time.Now(),
			)
			if err != nil {
				return fmt.Errorf("failed to insert evm tx %s: %w", t.ID, err)
			}
		}
	}

	// 3. Insert Events
	for _, e := range events {
		eventTimestamp := e.Timestamp
		if eventTimestamp.IsZero() {
			if ts, ok := blockTimeByHeight[e.BlockHeight]; ok {
				eventTimestamp = ts
			}
		}
		if eventTimestamp.IsZero() {
			eventTimestamp = time.Now()
		}
		createdAt := time.Now()

		// raw.events (block_height, transaction_id, event_index, type, payload, contract_address, event_name, timestamp)
		// Removing 'values' and 'contract_name' if not in schema. Schema has `contract_address`, `event_name`.
		// Schema has `payload JSONB`.
		_, err := tx.Exec(ctx, `
			INSERT INTO raw.events (
				block_height, transaction_id, event_index, 
				transaction_index, type, payload, 
				contract_address, event_name, 
				timestamp, created_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			ON CONFLICT (block_height, transaction_id, event_index) DO NOTHING`,
			e.BlockHeight, e.TransactionID, e.EventIndex,
			e.TransactionIndex, e.Type, e.Payload,
			e.ContractAddress, e.EventName,
			eventTimestamp, createdAt,
		)
		if err != nil {
			return fmt.Errorf("failed to insert event: %w", err)
		}
	}

	// 4. Insert Account Keys (app schema)
	if enableDerivedWrites {
		for _, ak := range accountKeys {
			_, err := tx.Exec(ctx, `
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
			if err != nil {
				return fmt.Errorf("failed to insert account key: %w", err)
			}
		}
	}

	// 4. Insert Address Activity (app.address_transactions)
	// NOTE: Check if table 'app.address_transactions' exists. User schema didn't have it.
	// We'll trust availability for query support.
	if enableDerivedWrites {
		for _, aa := range addressActivity {
			_, err := tx.Exec(ctx, `
			INSERT INTO app.address_transactions (address, transaction_id, block_height, role)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (address, block_height, transaction_id, role) DO NOTHING`,
				aa.Address, aa.TransactionID, aa.BlockHeight, aa.Role,
			)
			if err != nil {
				// Fail softly here if table missing? No, fail hard so I know to fix it.
				return fmt.Errorf("failed to insert addr tx: %w", err)
			}
		}
	}

	// 5. Update Address Stats
	// Sort unique addresses to prevent deadlocks
	if enableDerivedWrites {
		uniqueAddresses := make(map[string]bool)
		for _, aa := range addressActivity {
			uniqueAddresses[aa.Address] = true
		}

		sortedAddresses := make([]string, 0, len(uniqueAddresses))
		for addr := range uniqueAddresses {
			sortedAddresses = append(sortedAddresses, addr)
		}
		sort.Strings(sortedAddresses)

		for _, addr := range sortedAddresses {
			// Find any activity for this address to get the block height
			var blockHeight uint64
			for _, aa := range addressActivity {
				if aa.Address == addr {
					blockHeight = aa.BlockHeight
					break
				}
			}

			// app.address_stats
			_, err := tx.Exec(ctx, `
				INSERT INTO app.address_stats (address, tx_count, total_gas_used, last_updated_block, created_at, updated_at)
				VALUES ($1, 1, 0, $2, NOW(), NOW())
				ON CONFLICT (address) DO UPDATE SET 
					tx_count = app.address_stats.tx_count + 1,
					last_updated_block = GREATEST(app.address_stats.last_updated_block, EXCLUDED.last_updated_block),
					updated_at = NOW()`,
				addr, blockHeight,
			)
			if err != nil {
				return fmt.Errorf("failed to update address stats for %s: %w", addr, err)
			}
		}
	}

	// 6. Track Smart Contracts (app schema)
	if enableDerivedWrites {
		for _, e := range events {
			if strings.Contains(e.Type, "AccountContractAdded") || strings.Contains(e.Type, "AccountContractUpdated") {
				var payload map[string]interface{}
				if err := json.Unmarshal(e.Payload, &payload); err == nil {
					address, _ := payload["address"].(string)
					name, _ := payload["name"].(string)
					if address != "" && name != "" {
						_, err := tx.Exec(ctx, `
							INSERT INTO app.smart_contracts (address, name, last_updated_height, created_at, updated_at)
							VALUES ($1, $2, $3, $4, $5)
							ON CONFLICT (address, name) DO UPDATE SET
								last_updated_height = EXCLUDED.last_updated_height,
								version = app.smart_contracts.version + 1,
								updated_at = EXCLUDED.updated_at`,
							address, name, e.BlockHeight, time.Now(), time.Now(),
						)
						if err != nil {
							return fmt.Errorf("failed to track contract %s: %w", name, err)
						}
					}
				}
			}
		}
	}

	// 7. Update Checkpoint (app schema)
	_, err = tx.Exec(ctx, `
		INSERT INTO app.indexing_checkpoints (service_name, last_height, updated_at)
		VALUES ($1, $2, $3)
		ON CONFLICT (service_name) DO UPDATE SET last_height = EXCLUDED.last_height, updated_at = EXCLUDED.updated_at`,
		serviceName, checkpointHeight, time.Now(),
	)
	if err != nil {
		return fmt.Errorf("failed to update checkpoint: %w", err)
	}

	return tx.Commit(ctx)
}

// SaveBlockOnly inserts a block without affecting the checkpoint or other tables.
// Used for pre-insertion in batches to satisfy FK constraints.
func (r *Repository) SaveBlockOnly(ctx context.Context, block models.Block) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO raw.blocks (height, id, parent_id, timestamp, collection_count, total_gas_used, is_sealed, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (height) DO NOTHING`,
		block.Height, block.ID, block.ParentID, block.Timestamp, block.CollectionCount, block.TotalGasUsed, block.IsSealed, time.Now(),
	)
	if err != nil {
		// Log ALL errors for debugging
		fmt.Printf("DB Error (Block %d): %v\n", block.Height, err)
		return err
	}
	return nil
}

// --- Read Methods ---

func (r *Repository) ListBlocks(ctx context.Context, limit, offset int) ([]models.Block, error) {
	rows, err := r.db.Query(ctx, `
		SELECT height, id, parent_id, timestamp, collection_count, tx_count, event_count, state_root_hash, total_gas_used, is_sealed
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
		SELECT b.height, b.id, b.parent_id, b.timestamp, b.collection_count, b.total_gas_used, b.is_sealed, b.created_at, b.tx_count
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
		if err := rows.Scan(&b.Height, &b.ID, &b.ParentID, &b.Timestamp, &b.CollectionCount, &b.TotalGasUsed, &b.IsSealed, &b.CreatedAt, &b.TxCount); err != nil {
			return nil, err
		}
		blocks = append(blocks, b)
	}
	return blocks, nil
}

func (r *Repository) GetBlocksByCursor(ctx context.Context, limit int, cursorHeight *uint64) ([]models.Block, error) {
	query := `
		SELECT b.height, b.id, b.parent_id, b.timestamp, b.collection_count, b.total_gas_used, b.is_sealed, b.created_at, b.tx_count
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
		if err := rows.Scan(&b.Height, &b.ID, &b.ParentID, &b.Timestamp, &b.CollectionCount, &b.TotalGasUsed, &b.IsSealed, &b.CreatedAt, &b.TxCount); err != nil {
			return nil, err
		}
		blocks = append(blocks, b)
	}
	return blocks, nil
}

func (r *Repository) GetBlockByID(ctx context.Context, id string) (*models.Block, error) {
	var height uint64
	err := r.db.QueryRow(ctx, "SELECT height FROM raw.block_lookup WHERE id = $1", id).Scan(&height)
	if err != nil {
		return nil, err
	}
	return r.GetBlockByHeight(ctx, height)
}

func (r *Repository) GetBlockByHeight(ctx context.Context, height uint64) (*models.Block, error) {
	var b models.Block
	err := r.db.QueryRow(ctx, "SELECT height, id, parent_id, timestamp, collection_count, total_gas_used, is_sealed, created_at FROM raw.blocks WHERE height = $1", height).
		Scan(&b.Height, &b.ID, &b.ParentID, &b.Timestamp, &b.CollectionCount, &b.TotalGasUsed, &b.IsSealed, &b.CreatedAt)
	if err != nil {
		return nil, err
	}

	// Get transactions for this block
	txRows, err := r.db.Query(ctx, `
		SELECT id, block_height, transaction_index, proposer_address, payer_address, authorizers, script, arguments, status, error_message, is_evm, gas_limit, gas_used, created_at 
		FROM raw.transactions 
		WHERE block_height = $1 
		ORDER BY transaction_index ASC`, height)
	if err != nil {
		// If no transactions, just return block without them
		b.TxCount = 0
		return &b, nil
	}
	defer txRows.Close()

	var transactions []models.Transaction
	for txRows.Next() {
		var t models.Transaction
		if err := txRows.Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers, &t.Script, &t.Arguments, &t.Status, &t.ErrorMessage, &t.IsEVM, &t.GasLimit, &t.GasUsed, &t.CreatedAt); err != nil {
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
	err := r.db.QueryRow(ctx, "SELECT block_height FROM raw.tx_lookup WHERE id = $1", id).Scan(&blockHeight)
	if err != nil && has0x {
		err = r.db.QueryRow(ctx, "SELECT block_height FROM raw.tx_lookup WHERE id = $1", normalizedID).Scan(&blockHeight)
	}

	query := ""
	args := []interface{}{}

	if err == nil {
		// Found in lookup, efficient query
		// Note: We need to JOIN for EVM details if applicable.
		// NOTE: raw.transactions does NOT have EVM logs. app.evm_transactions has them.
		// For simplicity, we query raw.transactions and app.evm_transactions.
		query = `
			SELECT t.id, t.block_height, t.transaction_index, t.proposer_address, 
			       COALESCE(0, 0), COALESCE(0, 0), -- placeholders for key_index/seq_num if missing in raw table
			       t.payer_address, t.authorizers, t.script, t.arguments, t.status, t.error_message, t.is_evm, t.gas_limit, t.gas_used, t.created_at,
			       COALESCE(et.evm_hash, ''), COALESCE(et.from_address, ''), COALESCE(et.to_address, ''), ''
			FROM raw.transactions t
			LEFT JOIN app.evm_transactions et ON t.id = et.transaction_id AND t.block_height = et.block_height
			WHERE t.id = $1 AND t.block_height = $2`
		args = []interface{}{id, blockHeight}
	} else {
		// Fallback (or EVM Hash Search)
		// If ID is not found, maybe it's EVM Hash?
		// Try finding by EVM hash in raw.tx_lookup first (fast path)
		var txID string
		var bh uint64
		errLookup := r.db.QueryRow(ctx, "SELECT id, block_height FROM raw.tx_lookup WHERE evm_hash = $1", normalizedID).Scan(&txID, &bh)
		if errLookup == nil {
			query = `
				SELECT t.id, t.block_height, t.transaction_index, t.proposer_address, 
   				       COALESCE(0, 0), COALESCE(0, 0),
				       t.payer_address, t.authorizers, t.script, t.arguments, t.status, t.error_message, t.is_evm, t.gas_limit, t.gas_used, t.created_at,
				       COALESCE(et.evm_hash, ''), COALESCE(et.from_address, ''), COALESCE(et.to_address, ''), ''
				FROM raw.transactions t
				LEFT JOIN app.evm_transactions et ON t.id = et.transaction_id AND t.block_height = et.block_height
				WHERE t.id = $1 AND t.block_height = $2`
			args = []interface{}{txID, bh}
		} else {
			// Try finding by EVM hash in app.evm_transactions
			var txID string
			var bh uint64
			errEvm := r.db.QueryRow(ctx, "SELECT transaction_id, block_height FROM app.evm_transactions WHERE evm_hash = $1", normalizedID).Scan(&txID, &bh)
			if errEvm != nil && has0x {
				// If stored with 0x prefix, try that too
				errEvm = r.db.QueryRow(ctx, "SELECT transaction_id, block_height FROM app.evm_transactions WHERE evm_hash = $1", id).Scan(&txID, &bh)
			}
			if errEvm == nil {
				// Found via EVM Hash
				query = `
					SELECT t.id, t.block_height, t.transaction_index, t.proposer_address, 
	   				       COALESCE(0, 0), COALESCE(0, 0),
					       t.payer_address, t.authorizers, t.script, t.arguments, t.status, t.error_message, t.is_evm, t.gas_limit, t.gas_used, t.created_at,
					       COALESCE(et.evm_hash, ''), COALESCE(et.from_address, ''), COALESCE(et.to_address, ''), ''
					FROM raw.transactions t
					LEFT JOIN app.evm_transactions et ON t.id = et.transaction_id AND t.block_height = et.block_height
					WHERE t.id = $1 AND t.block_height = $2`
				args = []interface{}{txID, bh}
			} else {
				return nil, fmt.Errorf("transaction not found")
			}
		}
	}

	err = r.db.QueryRow(ctx, query, args...).
		Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.ProposerKeyIndex, &t.ProposerSequenceNumber,
			&t.PayerAddress, &t.Authorizers, &t.Script, &t.Arguments, &t.Status, &t.ErrorMessage, &t.IsEVM, &t.GasLimit, &t.GasUsed, &t.CreatedAt,
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
	err := r.db.QueryRow(ctx, "SELECT block_height FROM raw.tx_lookup WHERE id = $1", txID).Scan(&blockHeight)
	if err != nil {
		return nil, err
	}

	rows, err := r.db.Query(ctx, `
		SELECT transaction_id, block_height, transaction_index, type, event_index, payload, timestamp, created_at
		FROM raw.events
		WHERE transaction_id = $1 AND block_height = $2
		ORDER BY event_index ASC`, txID, blockHeight)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []models.Event
	for rows.Next() {
		var e models.Event
		if err := rows.Scan(&e.TransactionID, &e.BlockHeight, &e.TransactionIndex, &e.Type, &e.EventIndex, &e.Payload, &e.Timestamp, &e.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, nil
}

func (r *Repository) GetTransactionsByAddress(ctx context.Context, address string, limit, offset int) ([]models.Transaction, error) {
	query := `
		SELECT t.id, t.block_height, t.transaction_index, t.proposer_address, t.payer_address, t.authorizers, t.script, t.status, t.created_at
		FROM app.address_transactions at
		JOIN raw.transactions t ON at.transaction_id = t.id AND at.block_height = t.block_height
		WHERE at.address = $1
		ORDER BY at.block_height DESC
		LIMIT $2 OFFSET $3`

	rows, err := r.db.Query(ctx, query, address, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txs []models.Transaction
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers, &t.Script, &t.Status, &t.CreatedAt); err != nil {
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
	query := `
		SELECT t.id, t.block_height, t.transaction_index, t.proposer_address, t.payer_address, t.authorizers, t.script, t.status, t.created_at
		FROM app.address_transactions at
		JOIN raw.transactions t ON at.transaction_id = t.id AND at.block_height = t.block_height
		WHERE at.address = $1
		  AND ($2::bigint IS NULL OR (at.block_height, at.transaction_id) < ($2, $3))
		ORDER BY at.block_height DESC, at.transaction_id DESC
		LIMIT $4`

	var (
		bh interface{}
		id interface{}
	)
	if cursor != nil {
		bh = cursor.BlockHeight
		id = cursor.TxID
	}

	rows, err := r.db.Query(ctx, query, address, bh, id, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txs []models.Transaction
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers, &t.Script, &t.Status, &t.CreatedAt); err != nil {
			return nil, err
		}
		txs = append(txs, t)
	}
	return txs, nil
}

func (r *Repository) GetRecentTransactions(ctx context.Context, limit, offset int) ([]models.Transaction, error) {
	query := `
		SELECT t.id, t.block_height, t.transaction_index, t.proposer_address, t.payer_address, t.authorizers, t.script, t.status, t.error_message, t.created_at
		FROM raw.transactions t
		ORDER BY t.block_height DESC, t.transaction_index DESC, t.id DESC
		LIMIT $1 OFFSET $2`

	rows, err := r.db.Query(ctx, query, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txs []models.Transaction
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers, &t.Script, &t.Status, &t.ErrorMessage, &t.CreatedAt); err != nil {
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
	query := `
		SELECT t.id, t.block_height, t.transaction_index, t.proposer_address, t.payer_address, t.authorizers, t.script, t.status, t.error_message, t.created_at
		FROM raw.transactions t
		WHERE ($1::bigint IS NULL OR (t.block_height, t.transaction_index, t.id) < ($1, $2, $3))
		ORDER BY t.block_height DESC, t.transaction_index DESC, t.id DESC
		LIMIT $4`

	var (
		bh interface{}
		ti interface{}
		id interface{}
	)
	if cursor != nil {
		bh = cursor.BlockHeight
		ti = cursor.TxIndex
		id = cursor.ID
	}

	rows, err := r.db.Query(ctx, query, bh, ti, id, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txs []models.Transaction
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers, &t.Script, &t.Status, &t.ErrorMessage, &t.CreatedAt); err != nil {
			return nil, err
		}
		txs = append(txs, t)
	}
	return txs, nil
}

// --- Token History Methods ---

func (r *Repository) GetTokenTransfersByAddress(ctx context.Context, address string, limit int) ([]models.TokenTransfer, error) {
	query := `
		SELECT tt.internal_id, tt.transaction_id, tt.block_height, tt.token_contract_address, tt.from_address, tt.to_address, tt.amount, tt.token_id, tt.event_index, tt.is_nft, tt.timestamp, tt.created_at
		FROM app.token_transfers tt
		WHERE tt.from_address = $1 OR tt.to_address = $1
		ORDER BY tt.block_height DESC, tt.transaction_id DESC, tt.event_index DESC
		LIMIT $2`

	rows, err := r.db.Query(ctx, query, address, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var transfers []models.TokenTransfer
	for rows.Next() {
		var t models.TokenTransfer
		if err := rows.Scan(&t.ID, &t.TransactionID, &t.BlockHeight, &t.TokenContractAddress, &t.FromAddress, &t.ToAddress, &t.Amount, &t.TokenID, &t.EventIndex, &t.IsNFT, &t.Timestamp, &t.CreatedAt); err != nil {
			return nil, err
		}
		transfers = append(transfers, t)
	}
	return transfers, nil
}

func (r *Repository) GetTokenTransfersByAddressCursor(ctx context.Context, address string, limit int, cursor *TokenTransferCursor) ([]models.TokenTransfer, error) {
	query := `
		SELECT tt.internal_id, tt.transaction_id, tt.block_height, tt.token_contract_address, tt.from_address, tt.to_address, tt.amount, tt.token_id, tt.event_index, tt.is_nft, tt.timestamp, tt.created_at
		FROM app.token_transfers tt
		WHERE (tt.from_address = $1 OR tt.to_address = $1)
		  AND ($2::bigint IS NULL OR (tt.block_height, tt.transaction_id, tt.event_index) < ($2, $3, $4))
		ORDER BY tt.block_height DESC, tt.transaction_id DESC, tt.event_index DESC
		LIMIT $5`

	var (
		bh interface{}
		tx interface{}
		ev interface{}
	)
	if cursor != nil {
		bh = cursor.BlockHeight
		tx = cursor.TxID
		ev = cursor.EventIndex
	}

	rows, err := r.db.Query(ctx, query, address, bh, tx, ev, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var transfers []models.TokenTransfer
	for rows.Next() {
		var t models.TokenTransfer
		if err := rows.Scan(&t.ID, &t.TransactionID, &t.BlockHeight, &t.TokenContractAddress, &t.FromAddress, &t.ToAddress, &t.Amount, &t.TokenID, &t.EventIndex, &t.IsNFT, &t.Timestamp, &t.CreatedAt); err != nil {
			return nil, err
		}
		transfers = append(transfers, t)
	}
	return transfers, nil
}

func (r *Repository) GetNFTTransfersByAddress(ctx context.Context, address string) ([]models.NFTTransfer, error) {
	rows, err := r.db.Query(ctx, `
		SELECT internal_id, transaction_id, block_height, token_contract_address, token_id, from_address, to_address, event_index, timestamp, created_at
		FROM app.token_transfers
		WHERE (from_address = $1 OR to_address = $1) AND is_nft = TRUE
		ORDER BY block_height DESC, transaction_id DESC, event_index DESC`, address)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var transfers []models.NFTTransfer
	for rows.Next() {
		var t models.NFTTransfer
		err := rows.Scan(&t.ID, &t.TransactionID, &t.BlockHeight, &t.TokenContractAddress, &t.NFTID, &t.FromAddress, &t.ToAddress, &t.EventIndex, &t.Timestamp, &t.CreatedAt)
		if err != nil {
			return nil, err
		}
		transfers = append(transfers, t)
	}
	return transfers, nil
}

func (r *Repository) GetNFTTransfersByAddressCursor(ctx context.Context, address string, limit int, cursor *TokenTransferCursor) ([]models.NFTTransfer, error) {
	query := `
		SELECT tt.internal_id, tt.transaction_id, tt.block_height, tt.token_contract_address, tt.token_id, tt.from_address, tt.to_address, tt.event_index, tt.timestamp, tt.created_at
		FROM app.token_transfers tt
		WHERE (tt.from_address = $1 OR tt.to_address = $1)
		  AND tt.is_nft = TRUE
		  AND ($2::bigint IS NULL OR (tt.block_height, tt.transaction_id, tt.event_index) < ($2, $3, $4))
		ORDER BY tt.block_height DESC, tt.transaction_id DESC, tt.event_index DESC
		LIMIT $5`

	var (
		bh interface{}
		tx interface{}
		ev interface{}
	)
	if cursor != nil {
		bh = cursor.BlockHeight
		tx = cursor.TxID
		ev = cursor.EventIndex
	}

	rows, err := r.db.Query(ctx, query, address, bh, tx, ev, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var transfers []models.NFTTransfer
	for rows.Next() {
		var t models.NFTTransfer
		if err := rows.Scan(&t.ID, &t.TransactionID, &t.BlockHeight, &t.TokenContractAddress, &t.NFTID, &t.FromAddress, &t.ToAddress, &t.EventIndex, &t.Timestamp, &t.CreatedAt); err != nil {
			return nil, err
		}
		transfers = append(transfers, t)
	}
	return transfers, nil
}

// GetAddressStats retrieves pre-calculated stats for an address
func (r *Repository) GetAddressStats(ctx context.Context, address string) (*models.AddressStats, error) {
	var s models.AddressStats
	err := r.db.QueryRow(ctx, `
		SELECT address, tx_count, token_transfer_count, 0, total_gas_used, last_updated_block, created_at, updated_at
		FROM app.address_stats
		WHERE address = $1`, address).Scan(
		&s.Address, &s.TxCount, &s.TokenTransferCount, &s.NFTTransferCount, &s.TotalGasUsed, &s.LastUpdatedBlock, &s.CreatedAt, &s.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

// GetContractByAddress retrieves contract metadata
func (r *Repository) GetContractByAddress(ctx context.Context, address string) (*models.SmartContract, error) {
	var c models.SmartContract
	err := r.db.QueryRow(ctx, `
		SELECT address, name, version, last_updated_height, created_at, updated_at
		FROM app.smart_contracts
		WHERE address = $1
		LIMIT 1`, address).Scan(
		&c.Address, &c.Name, &c.Version, &c.BlockHeight, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	c.ID = 0
	c.TransactionID = ""
	c.IsEVM = false
	return &c, nil
}

// RefreshDailyStats aggregates transaction counts by date into daily_stats table
func (r *Repository) RefreshDailyStats(ctx context.Context) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO app.daily_stats (date, tx_count, updated_at)
		SELECT 
			DATE(timestamp) as date, 
			COUNT(*) as tx_count,
			NOW() as updated_at
		FROM raw.transactions
		WHERE timestamp IS NOT NULL
		  AND timestamp >= NOW() - INTERVAL '30 days'
		GROUP BY DATE(timestamp)
		ON CONFLICT (date) DO UPDATE SET 
			tx_count = EXCLUDED.tx_count,
			updated_at = NOW();
	`)
	if err != nil {
		return fmt.Errorf("failed to refresh daily stats: %w", err)
	}
	return nil
}

// GetDailyStats retrieves the last 14 days of stats
func (r *Repository) GetDailyStats(ctx context.Context) ([]models.DailyStat, error) {
	rows, err := r.db.Query(ctx, `
		SELECT date::text, tx_count, active_accounts, new_contracts
		FROM app.daily_stats
		WHERE date >= CURRENT_DATE - INTERVAL '13 days'
		ORDER BY date ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var stats []models.DailyStat
	for rows.Next() {
		var s models.DailyStat
		if err := rows.Scan(&s.Date, &s.TxCount, &s.ActiveAccounts, &s.NewContracts); err != nil {
			return nil, err
		}
		stats = append(stats, s)
	}
	return stats, nil
}

func (r *Repository) GetTotalTransactions(ctx context.Context) (int64, error) {
	estimate, err := r.estimatePartitionCount(ctx, "raw", "transactions_p%")
	if err == nil && estimate > 0 {
		return estimate, nil
	}

	var count int64
	err = r.db.QueryRow(ctx, "SELECT COUNT(*) FROM raw.transactions").Scan(&count)
	return count, err
}

func (r *Repository) GetTotalEvents(ctx context.Context) (int64, error) {
	estimate, err := r.estimatePartitionCount(ctx, "raw", "events_p%")
	if err == nil && estimate > 0 {
		return estimate, nil
	}

	var count int64
	err = r.db.QueryRow(ctx, "SELECT COUNT(*) FROM raw.events").Scan(&count)
	return count, err
}

func (r *Repository) GetTotalAddresses(ctx context.Context) (int64, error) {
	estimate, err := r.estimateTableCount(ctx, "app", "address_stats")
	if err == nil && estimate > 0 {
		return estimate, nil
	}

	var count int64
	err = r.db.QueryRow(ctx, "SELECT COUNT(*) FROM app.address_stats").Scan(&count)
	return count, err
}

func (r *Repository) GetTotalContracts(ctx context.Context) (int64, error) {
	estimate, err := r.estimateTableCount(ctx, "app", "smart_contracts")
	if err == nil && estimate > 0 {
		return estimate, nil
	}

	var count int64
	err = r.db.QueryRow(ctx, "SELECT COUNT(*) FROM app.smart_contracts").Scan(&count)
	return count, err
}

// GetBlockRange returns min height, max height, and total count of blocks
func (r *Repository) GetBlockRange(ctx context.Context) (uint64, uint64, int64, error) {
	var minH, maxH uint64
	// Use coalesce(..., 0) to handle empty table for min/max.
	err := r.db.QueryRow(ctx, `
		SELECT 
			COALESCE(MIN(height), 0), 
			COALESCE(MAX(height), 0)
		FROM raw.blocks
	`).Scan(&minH, &maxH)
	if err != nil {
		return 0, 0, 0, err
	}

	count, err := r.estimatePartitionCount(ctx, "raw", "blocks_p%")
	if err != nil {
		count = 0
	}
	return minH, maxH, count, nil
}

func (r *Repository) estimatePartitionCount(ctx context.Context, schema, relPattern string) (int64, error) {
	var estimate int64
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(c.reltuples), 0)::bigint
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = $1
		  AND c.relkind = 'r'
		  AND c.relname LIKE $2
	`, schema, relPattern).Scan(&estimate)
	if err != nil {
		return 0, err
	}
	return estimate, nil
}

func (r *Repository) estimateTableCount(ctx context.Context, schema, table string) (int64, error) {
	var estimate int64
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(c.reltuples, 0)::bigint
		FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = $1
		  AND c.relkind = 'r'
		  AND c.relname = $2
	`, schema, table).Scan(&estimate)
	if err != nil {
		return 0, err
	}
	return estimate, nil
}

func (r *Repository) GetAllCheckpoints(ctx context.Context) (map[string]uint64, error) {
	rows, err := r.db.Query(ctx, "SELECT service_name, last_height FROM app.indexing_checkpoints")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := make(map[string]uint64)
	for rows.Next() {
		var name string
		var height uint64
		if err := rows.Scan(&name, &height); err != nil {
			return nil, err
		}
		results[name] = height
	}
	return results, nil
}

// GetAddressByPublicKey finds the address associated with a public key
func (r *Repository) GetAddressByPublicKey(ctx context.Context, publicKey string) (string, error) {
	var address string
	err := r.db.QueryRow(ctx, "SELECT address FROM app.account_keys WHERE public_key = $1 LIMIT 1", publicKey).Scan(&address)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	return address, err
}

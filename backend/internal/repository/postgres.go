package repository

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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

	dbtx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer dbtx.Rollback(ctx)

	// Indexing data is reconstructable from the chain. For high-throughput ingestion, we can trade
	// a small durability window for speed by disabling synchronous commit at the transaction level.
	// This is opt-in via env var to keep the default conservative.
	if strings.ToLower(strings.TrimSpace(os.Getenv("DB_SYNCHRONOUS_COMMIT"))) == "off" {
		// Best-effort: if this fails, continue with default settings.
		_, _ = dbtx.Exec(ctx, "SET LOCAL synchronous_commit = off")
	}

	// Precompute block timestamps for downstream inserts
	blockTimeByHeight := make(map[uint64]time.Time, len(blocks))

	// 1. Insert Blocks
	hasHeavyBlockPayloads := false
	for _, b := range blocks {
		blockTimeByHeight[b.Height] = b.Timestamp
		if len(b.CollectionGuarantees) > 0 || len(b.BlockSeals) > 0 || len(b.Signatures) > 0 || strings.TrimSpace(b.ExecutionResultID) != "" {
			hasHeavyBlockPayloads = true
		}
	}

	// Hot path: bulk upsert blocks + block_lookup in ~2 statements instead of 2*len(blocks).
	//
	// NOTE: this path intentionally skips the heavy JSON payload columns (collection_guarantees,
	// seals, signatures). If STORE_BLOCK_PAYLOADS is enabled (and we received non-empty payloads),
	// we fall back to the slower per-row UPSERT to preserve those columns.
	if !hasHeavyBlockPayloads && strings.ToLower(strings.TrimSpace(os.Getenv("DB_BULK_COPY"))) != "false" {
		heights := make([]int64, len(blocks))
		ids := make([]string, len(blocks))
		parentIDs := make([]string, len(blocks))
		timestamps := make([]time.Time, len(blocks))
		collectionCounts := make([]int32, len(blocks))
		txCounts := make([]int64, len(blocks))
		eventCounts := make([]int64, len(blocks))
		stateRootHashes := make([]string, len(blocks))
		totalGasUsed := make([]int64, len(blocks))
		isSealed := make([]bool, len(blocks))

		for i, b := range blocks {
			heights[i] = int64(b.Height)
			ids[i] = b.ID
			parentIDs[i] = b.ParentID
			timestamps[i] = b.Timestamp
			collectionCounts[i] = int32(b.CollectionCount)
			txCounts[i] = int64(b.TxCount)
			eventCounts[i] = int64(b.EventCount)
			stateRootHashes[i] = b.StateRootHash
			totalGasUsed[i] = int64(b.TotalGasUsed)
			isSealed[i] = b.IsSealed
		}

		batchCreatedAt := time.Now()

		_, err := dbtx.Exec(ctx, `
			INSERT INTO raw.blocks (
				height, id, parent_id, timestamp,
				collection_count, tx_count, event_count,
				state_root_hash, total_gas_used, is_sealed,
				created_at
			)
			SELECT
				u.height,
				u.id,
				NULLIF(u.parent_id, '') AS parent_id,
				u.timestamp,
				u.collection_count,
				u.tx_count,
				u.event_count,
				NULLIF(u.state_root_hash, '') AS state_root_hash,
				u.total_gas_used,
				u.is_sealed,
				$11 AS created_at
			FROM UNNEST(
				$1::bigint[],      -- height
				$2::text[],        -- id
				$3::text[],        -- parent_id
				$4::timestamptz[], -- timestamp
				$5::int[],         -- collection_count
				$6::bigint[],      -- tx_count
				$7::bigint[],      -- event_count
				$8::text[],        -- state_root_hash
				$9::bigint[],      -- total_gas_used
				$10::bool[]        -- is_sealed
			) AS u(
				height, id, parent_id, timestamp,
				collection_count, tx_count, event_count,
				state_root_hash, total_gas_used, is_sealed
			)
			ON CONFLICT (height) DO UPDATE SET
				id = EXCLUDED.id,
				parent_id = EXCLUDED.parent_id,
				timestamp = EXCLUDED.timestamp,
				collection_count = EXCLUDED.collection_count,
				tx_count = EXCLUDED.tx_count,
				event_count = EXCLUDED.event_count,
				state_root_hash = EXCLUDED.state_root_hash,
				total_gas_used = EXCLUDED.total_gas_used,
				is_sealed = EXCLUDED.is_sealed
		`, heights, ids, parentIDs, timestamps, collectionCounts, txCounts, eventCounts, stateRootHashes, totalGasUsed, isSealed, batchCreatedAt)
		if err != nil {
			return fmt.Errorf("failed to bulk upsert blocks: %w", err)
		}

		_, err = dbtx.Exec(ctx, `
			INSERT INTO raw.block_lookup (id, height, timestamp, created_at)
			SELECT DISTINCT ON (u.id)
				u.id,
				u.height,
				u.timestamp,
				$4 AS created_at
			FROM UNNEST($1::text[], $2::bigint[], $3::timestamptz[]) AS u(id, height, timestamp)
			ORDER BY u.id, u.height DESC
			ON CONFLICT (id) DO UPDATE SET
				height = EXCLUDED.height,
				timestamp = EXCLUDED.timestamp
		`, ids, heights, timestamps, batchCreatedAt)
		if err != nil {
			return fmt.Errorf("failed to bulk upsert block lookup: %w", err)
		}
	} else {
		for _, b := range blocks {
			// Insert into partitioned raw.blocks
			_, err := dbtx.Exec(ctx, `
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
			_, err = dbtx.Exec(ctx, `
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
	}

	// 2. Insert Transactions
	scriptInlineMaxBytes := 0
	if v := os.Getenv("TX_SCRIPT_INLINE_MAX_BYTES"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			scriptInlineMaxBytes = n
		}
	}

	// Precompute script hashes and upsert unique scripts in one statement (reduces DB round trips).
	scriptHashes := make([]string, len(txs))
	scriptInlines := make([]string, len(txs))
	scriptsByHash := make(map[string]string)
	for i := range txs {
		scriptText := strings.TrimSpace(txs[i].Script)
		if scriptText == "" {
			continue
		}
		sum := sha256.Sum256([]byte(scriptText))
		scriptHash := hex.EncodeToString(sum[:])
		scriptHashes[i] = scriptHash
		if _, ok := scriptsByHash[scriptHash]; !ok {
			scriptsByHash[scriptHash] = scriptText
		}
		if scriptInlineMaxBytes > 0 && len(scriptText) <= scriptInlineMaxBytes {
			scriptInlines[i] = scriptText
		}
	}

	if len(scriptsByHash) > 0 {
		hashes := make([]string, 0, len(scriptsByHash))
		texts := make([]string, 0, len(scriptsByHash))
		for h, t := range scriptsByHash {
			hashes = append(hashes, h)
			texts = append(texts, t)
		}
		_, err := dbtx.Exec(ctx, `
			INSERT INTO raw.scripts (script_hash, script_text, created_at)
			SELECT u.script_hash, u.script_text, NOW()
			FROM UNNEST($1::text[], $2::text[]) AS u(script_hash, script_text)
			ON CONFLICT (script_hash) DO NOTHING
		`, hashes, texts)
		if err != nil {
			return fmt.Errorf("failed to upsert raw.scripts batch: %w", err)
		}
	}

	// Fast path: bulk COPY raw.transactions inside a savepoint.
	// If COPY fails (e.g. due to a duplicate key), we roll back to the savepoint and fall back to UPSERT loops.
	usedCopyForTx := false
	if len(txs) > 0 && strings.ToLower(strings.TrimSpace(os.Getenv("DB_BULK_COPY"))) != "false" {
		batchCreatedAt := time.Now()
		sub, err := dbtx.Begin(ctx) // savepoint
		if err == nil {
			defer sub.Rollback(ctx)

			_, errTx := sub.CopyFrom(ctx,
				pgx.Identifier{"raw", "transactions"},
				[]string{
					"block_height", "id", "transaction_index",
					"proposer_address", "payer_address", "authorizers",
					"script_hash", "script", "arguments",
					"status", "error_message", "is_evm",
					"gas_limit", "gas_used", "event_count",
					"timestamp", "created_at",
				},
				pgx.CopyFromSlice(len(txs), func(i int) ([]any, error) {
					t := txs[i]

					// Ensure timestamp is present; default to block timestamp if missing
					txTimestamp := t.Timestamp
					if txTimestamp.IsZero() {
						if ts, ok := blockTimeByHeight[t.BlockHeight]; ok {
							txTimestamp = ts
						}
					}
					if txTimestamp.IsZero() {
						txTimestamp = batchCreatedAt
					}

					eventCount := t.EventCount
					if eventCount == 0 {
						eventCount = len(t.Events)
					}

					var scriptHash any
					if scriptHashes[i] != "" {
						scriptHash = scriptHashes[i]
					}
					var scriptInline any
					if scriptInlines[i] != "" {
						scriptInline = scriptInlines[i]
					}

					var args any
					if len(t.Arguments) > 0 {
						args = t.Arguments
					}

					var errMsg any
					if strings.TrimSpace(t.ErrorMessage) != "" {
						errMsg = t.ErrorMessage
					}

					return []any{
						t.BlockHeight, t.ID, t.TransactionIndex,
						t.ProposerAddress, t.PayerAddress, t.Authorizers,
						scriptHash, scriptInline, args,
						t.Status, errMsg, t.IsEVM,
						t.GasLimit, t.GasUsed, eventCount,
						txTimestamp, batchCreatedAt,
					}, nil
				}),
			)

			if errTx == nil {
				if err := sub.Commit(ctx); err == nil {
					usedCopyForTx = true
				}
			}

			if !usedCopyForTx {
				_ = sub.Rollback(ctx)
			}
		}
	}

	// raw.tx_lookup needs UPSERT semantics (id is globally unique). We batch UPSERT it with UNNEST
	// so we don't spam the DB with per-row inserts, while still being idempotent across retries.
	if usedCopyForTx {
		ids := make([]string, len(txs))
		evmHashes := make([]string, len(txs))
		heights := make([]int64, len(txs))
		txIndexes := make([]int32, len(txs))
		timestamps := make([]time.Time, len(txs))

		batchCreatedAt := time.Now()

		for i := range txs {
			t := txs[i]
			ids[i] = t.ID
			heights[i] = int64(t.BlockHeight)
			txIndexes[i] = int32(t.TransactionIndex)

			// Keep the same timestamp fallback as raw.transactions COPY.
			ts := t.Timestamp
			if ts.IsZero() {
				if bts, ok := blockTimeByHeight[t.BlockHeight]; ok {
					ts = bts
				}
			}
			if ts.IsZero() {
				ts = batchCreatedAt
			}
			timestamps[i] = ts

			if t.EVMHash != "" {
				normalized := strings.TrimPrefix(strings.ToLower(t.EVMHash), "0x")
				evmHashes[i] = normalized
			}
		}

		_, err := dbtx.Exec(ctx, `
			INSERT INTO raw.tx_lookup (id, evm_hash, block_height, transaction_index, timestamp, created_at)
			SELECT DISTINCT ON (u.id)
				u.id, NULLIF(u.evm_hash, ''), u.block_height, u.transaction_index, u.timestamp, $6
			FROM UNNEST($1::text[], $2::text[], $3::bigint[], $4::int[], $5::timestamptz[]) AS u(
				id, evm_hash, block_height, transaction_index, timestamp
			)
			ORDER BY u.id, u.block_height DESC, u.transaction_index DESC
			ON CONFLICT (id) DO UPDATE SET
				evm_hash = COALESCE(EXCLUDED.evm_hash, raw.tx_lookup.evm_hash),
				block_height = EXCLUDED.block_height,
				transaction_index = EXCLUDED.transaction_index,
				timestamp = EXCLUDED.timestamp
		`, ids, evmHashes, heights, txIndexes, timestamps, batchCreatedAt)
		if err != nil {
			return fmt.Errorf("failed to upsert tx_lookup batch: %w", err)
		}
	}

	// Fallback: row-by-row UPSERT (safe, slower).
	if !usedCopyForTx {
		for i, t := range txs {
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

			var scriptHash any
			if scriptHashes[i] != "" {
				scriptHash = scriptHashes[i]
			}
			var scriptInline any
			if scriptInlines[i] != "" {
				scriptInline = scriptInlines[i]
			}

			_, err := dbtx.Exec(ctx, `
				INSERT INTO raw.transactions (
					block_height, id, transaction_index,
					proposer_address, payer_address, authorizers,
					script_hash, script, arguments,
					status, error_message, is_evm,
					gas_limit, gas_used, event_count,
					timestamp, created_at
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
				ON CONFLICT (block_height, id) DO UPDATE SET
					transaction_index = EXCLUDED.transaction_index,
					status = EXCLUDED.status,
					error_message = EXCLUDED.error_message,
					gas_used = EXCLUDED.gas_used,
					event_count = EXCLUDED.event_count,
					is_evm = EXCLUDED.is_evm,
					script_hash = COALESCE(EXCLUDED.script_hash, raw.transactions.script_hash),
					created_at = EXCLUDED.created_at`,
				t.BlockHeight, t.ID, t.TransactionIndex,
				t.ProposerAddress, t.PayerAddress, t.Authorizers,
				scriptHash, scriptInline, t.Arguments,
				t.Status, func() any {
					if strings.TrimSpace(t.ErrorMessage) == "" {
						return nil
					}
					return t.ErrorMessage
				}(), t.IsEVM,
				t.GasLimit, t.GasUsed, eventCount,
				txTimestamp, createdAt,
			)
			if err != nil {
				return fmt.Errorf("failed to insert tx %s: %w", t.ID, err)
			}

			// Insert into raw.tx_lookup (Atomic Lookup)
			_, err = dbtx.Exec(ctx, `
				INSERT INTO raw.tx_lookup (id, evm_hash, block_height, transaction_index, timestamp, created_at)
				VALUES ($1, $2, $3, $4, $5, $6)
				ON CONFLICT (id) DO UPDATE SET
					evm_hash = COALESCE(EXCLUDED.evm_hash, raw.tx_lookup.evm_hash),
					block_height = EXCLUDED.block_height,
					transaction_index = EXCLUDED.transaction_index,
					timestamp = EXCLUDED.timestamp`,
				t.ID, func() any {
					if t.EVMHash == "" {
						return nil
					}
					normalized := strings.TrimPrefix(strings.ToLower(t.EVMHash), "0x")
					if normalized == "" {
						return nil
					}
					return normalized
				}(), t.BlockHeight, t.TransactionIndex, txTimestamp, createdAt,
			)
			if err != nil {
				return fmt.Errorf("failed to insert tx lookup %s: %w", t.ID, err)
			}

			// 2a. Insert EVM Transaction details if applicable (to App DB)
			if enableDerivedWrites && t.IsEVM {
				_, err := dbtx.Exec(ctx, `
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
	}

	// 3. Insert Events
	usedCopyForEvents := false
	if len(events) > 0 && strings.ToLower(strings.TrimSpace(os.Getenv("DB_BULK_COPY"))) != "false" {
		sub, err := dbtx.Begin(ctx) // savepoint
		if err == nil {
			defer sub.Rollback(ctx)

			batchCreatedAt := time.Now()

			_, errCopy := sub.CopyFrom(ctx,
				pgx.Identifier{"raw", "events"},
				[]string{
					"block_height", "transaction_id", "event_index",
					"transaction_index", "type", "payload",
					"contract_address", "event_name",
					"timestamp", "created_at",
				},
				pgx.CopyFromSlice(len(events), func(i int) ([]any, error) {
					e := events[i]

					eventTimestamp := e.Timestamp
					if eventTimestamp.IsZero() {
						if ts, ok := blockTimeByHeight[e.BlockHeight]; ok {
							eventTimestamp = ts
						}
					}
					if eventTimestamp.IsZero() {
						eventTimestamp = batchCreatedAt
					}

					var payload any
					if len(e.Payload) > 0 {
						payload = e.Payload
					}

					return []any{
						e.BlockHeight, e.TransactionID, e.EventIndex,
						e.TransactionIndex, e.Type, payload,
						e.ContractAddress, e.EventName,
						eventTimestamp, batchCreatedAt,
					}, nil
				}),
			)
			if errCopy == nil {
				if err := sub.Commit(ctx); err == nil {
					usedCopyForEvents = true
				}
			}

			if !usedCopyForEvents {
				_ = sub.Rollback(ctx)
			}
		}
	}

	if !usedCopyForEvents {
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

			_, err := dbtx.Exec(ctx, `
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
	}

	// 4. Insert Account Keys (app schema)
	if enableDerivedWrites {
		for _, ak := range accountKeys {
			// Revocation events update state by (address, key_index).
			if ak.Revoked && ak.PublicKey == "" {
				_, err := dbtx.Exec(ctx, `
					UPDATE app.account_keys
					SET revoked = TRUE,
						revoked_at_height = $3,
						last_updated_height = $3,
						updated_at = NOW()
					WHERE address = $1 AND key_index = $2
					  AND $3 >= last_updated_height`,
					ak.Address, ak.KeyIndex, ak.RevokedAtHeight,
				)
				if err != nil {
					return fmt.Errorf("failed to update account key revoke: %w", err)
				}
				continue
			}

			_, err := dbtx.Exec(ctx, `
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
				ak.Address, ak.KeyIndex, ak.PublicKey,
				ak.SigningAlgorithm, ak.HashingAlgorithm, ak.Weight,
				ak.Revoked, ak.AddedAtHeight, func() *uint64 {
					if ak.RevokedAtHeight == 0 {
						return nil
					}
					return &ak.RevokedAtHeight
				}(), ak.LastUpdatedHeight,
			)
			if err != nil {
				return fmt.Errorf("failed to upsert account key: %w", err)
			}
		}
	}

	// 4. Insert Address Activity (app.address_transactions)
	// NOTE: Check if table 'app.address_transactions' exists. User schema didn't have it.
	// We'll trust availability for query support.
	if enableDerivedWrites {
		for _, aa := range addressActivity {
			_, err := dbtx.Exec(ctx, `
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
			_, err := dbtx.Exec(ctx, `
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
						_, err := dbtx.Exec(ctx, `
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
	_, err = dbtx.Exec(ctx, `
		INSERT INTO app.indexing_checkpoints (service_name, last_height, updated_at)
		VALUES ($1, $2, $3)
		ON CONFLICT (service_name) DO UPDATE SET last_height = EXCLUDED.last_height, updated_at = EXCLUDED.updated_at`,
		serviceName, checkpointHeight, time.Now(),
	)
	if err != nil {
		return fmt.Errorf("failed to update checkpoint: %w", err)
	}

	return dbtx.Commit(ctx)
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
	err := r.db.QueryRow(ctx, `
		SELECT
			height,
			id,
			COALESCE(parent_id, '') AS parent_id,
			timestamp,
			COALESCE(collection_count, 0) AS collection_count,
			COALESCE(total_gas_used, 0) AS total_gas_used,
			COALESCE(is_sealed, FALSE) AS is_sealed,
			created_at
		FROM raw.blocks
		WHERE height = $1
	`, height).
		Scan(&b.Height, &b.ID, &b.ParentID, &b.Timestamp, &b.CollectionCount, &b.TotalGasUsed, &b.IsSealed, &b.CreatedAt)
	if err != nil {
		return nil, err
	}

	// Get transactions for this block
	txRows, err := r.db.Query(ctx, `
		SELECT
			id,
			block_height,
			transaction_index,
			COALESCE(proposer_address, '') AS proposer_address,
			COALESCE(payer_address, '') AS payer_address,
			COALESCE(authorizers, ARRAY[]::text[]) AS authorizers,
			COALESCE(status, '') AS status,
			COALESCE(error_message, '') AS error_message,
			COALESCE(is_evm, FALSE) AS is_evm,
			COALESCE(gas_limit, 0) AS gas_limit,
			COALESCE(gas_used, 0) AS gas_used,
			timestamp,
			created_at
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
		if err := txRows.Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers, &t.Status, &t.ErrorMessage, &t.IsEVM, &t.GasLimit, &t.GasUsed, &t.Timestamp, &t.CreatedAt); err != nil {
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
			SELECT
				t.id,
				t.block_height,
				t.transaction_index,
				COALESCE(t.proposer_address, '') AS proposer_address,
				COALESCE(0, 0), COALESCE(0, 0), -- placeholders for key_index/seq_num if missing in raw table
				COALESCE(t.payer_address, '') AS payer_address,
				COALESCE(t.authorizers, ARRAY[]::text[]) AS authorizers,
				COALESCE(t.script, s.script_text, '') AS script,
				t.arguments,
				COALESCE(t.status, '') AS status,
				COALESCE(t.error_message, '') AS error_message,
				COALESCE(t.is_evm, FALSE) AS is_evm,
				COALESCE(t.gas_limit, 0) AS gas_limit,
				COALESCE(t.gas_used, 0) AS gas_used,
				t.timestamp,
				t.created_at,
				COALESCE(et.evm_hash, '') AS evm_hash,
				COALESCE(et.from_address, '') AS from_address,
				COALESCE(et.to_address, '') AS to_address,
				'' AS evm_value
			FROM raw.transactions t
			LEFT JOIN raw.scripts s ON t.script_hash = s.script_hash
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
				SELECT
					t.id,
					t.block_height,
					t.transaction_index,
					COALESCE(t.proposer_address, '') AS proposer_address,
					COALESCE(0, 0), COALESCE(0, 0),
					COALESCE(t.payer_address, '') AS payer_address,
					COALESCE(t.authorizers, ARRAY[]::text[]) AS authorizers,
					COALESCE(t.script, s.script_text, '') AS script,
					t.arguments,
					COALESCE(t.status, '') AS status,
					COALESCE(t.error_message, '') AS error_message,
					COALESCE(t.is_evm, FALSE) AS is_evm,
					COALESCE(t.gas_limit, 0) AS gas_limit,
					COALESCE(t.gas_used, 0) AS gas_used,
					t.timestamp,
					t.created_at,
					COALESCE(et.evm_hash, '') AS evm_hash,
					COALESCE(et.from_address, '') AS from_address,
					COALESCE(et.to_address, '') AS to_address,
					'' AS evm_value
				FROM raw.transactions t
				LEFT JOIN raw.scripts s ON t.script_hash = s.script_hash
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
					SELECT
						t.id,
						t.block_height,
						t.transaction_index,
						COALESCE(t.proposer_address, '') AS proposer_address,
						COALESCE(0, 0), COALESCE(0, 0),
						COALESCE(t.payer_address, '') AS payer_address,
						COALESCE(t.authorizers, ARRAY[]::text[]) AS authorizers,
						COALESCE(t.script, s.script_text, '') AS script,
						t.arguments,
						COALESCE(t.status, '') AS status,
						COALESCE(t.error_message, '') AS error_message,
						COALESCE(t.is_evm, FALSE) AS is_evm,
						COALESCE(t.gas_limit, 0) AS gas_limit,
						COALESCE(t.gas_used, 0) AS gas_used,
						t.timestamp,
						t.created_at,
						COALESCE(et.evm_hash, '') AS evm_hash,
						COALESCE(et.from_address, '') AS from_address,
						COALESCE(et.to_address, '') AS to_address,
						'' AS evm_value
					FROM raw.transactions t
					LEFT JOIN raw.scripts s ON t.script_hash = s.script_hash
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
			&t.PayerAddress, &t.Authorizers, &t.Script, &t.Arguments, &t.Status, &t.ErrorMessage, &t.IsEVM, &t.GasLimit, &t.GasUsed, &t.Timestamp, &t.CreatedAt,
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
		WITH addr_txs AS (
			-- 1) Signed participation (payer/proposer/authorizer)
			SELECT at.block_height, at.transaction_id
			FROM app.address_transactions at
			WHERE at.address = $1

			UNION

			-- 2) Token/NFT transfer participation (from/to)
			-- Note: written by token_worker from raw.events, so this does not require reindexing.
			SELECT tt.block_height, tt.transaction_id
			FROM app.token_transfers tt
			WHERE tt.from_address = $1

			UNION

			SELECT tt.block_height, tt.transaction_id
			FROM app.token_transfers tt
			WHERE tt.to_address = $1
		)
		SELECT DISTINCT ON (a.block_height, a.transaction_id)
			t.id,
			t.block_height,
			t.transaction_index,
			COALESCE(t.proposer_address, '') AS proposer_address,
			COALESCE(t.payer_address, '') AS payer_address,
			COALESCE(t.authorizers, ARRAY[]::text[]) AS authorizers,
			COALESCE(t.status, '') AS status,
			COALESCE(t.error_message, '') AS error_message,
			t.timestamp,
			t.created_at
		FROM addr_txs a
		JOIN raw.transactions t ON t.id = a.transaction_id AND t.block_height = a.block_height
		ORDER BY a.block_height DESC, a.transaction_id DESC
		LIMIT $2 OFFSET $3
	`

	rows, err := r.db.Query(ctx, query, address, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var txs []models.Transaction
	for rows.Next() {
		var t models.Transaction
		if err := rows.Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers, &t.Status, &t.ErrorMessage, &t.Timestamp, &t.CreatedAt); err != nil {
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
		WITH addr_txs AS (
			SELECT at.block_height, at.transaction_id
			FROM app.address_transactions at
			WHERE at.address = $1

			UNION

			SELECT tt.block_height, tt.transaction_id
			FROM app.token_transfers tt
			WHERE tt.from_address = $1

			UNION

			SELECT tt.block_height, tt.transaction_id
			FROM app.token_transfers tt
			WHERE tt.to_address = $1
		)
		SELECT DISTINCT ON (a.block_height, a.transaction_id)
			t.id,
			t.block_height,
			t.transaction_index,
			COALESCE(t.proposer_address, '') AS proposer_address,
			COALESCE(t.payer_address, '') AS payer_address,
			COALESCE(t.authorizers, ARRAY[]::text[]) AS authorizers,
			COALESCE(t.status, '') AS status,
			COALESCE(t.error_message, '') AS error_message,
			t.timestamp,
			t.created_at
		FROM addr_txs a
		JOIN raw.transactions t ON t.id = a.transaction_id AND t.block_height = a.block_height
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
		if err := rows.Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers, &t.Status, &t.ErrorMessage, &t.Timestamp, &t.CreatedAt); err != nil {
			return nil, err
		}
		txs = append(txs, t)
	}
	return txs, nil
}

func (r *Repository) GetRecentTransactions(ctx context.Context, limit, offset int) ([]models.Transaction, error) {
	query := `
		SELECT
			t.id,
			t.block_height,
			t.transaction_index,
			COALESCE(t.proposer_address, '') AS proposer_address,
			COALESCE(t.payer_address, '') AS payer_address,
			COALESCE(t.authorizers, ARRAY[]::text[]) AS authorizers,
			COALESCE(t.status, '') AS status,
			COALESCE(t.error_message, '') AS error_message,
			t.timestamp,
			t.created_at
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
		if err := rows.Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers, &t.Status, &t.ErrorMessage, &t.Timestamp, &t.CreatedAt); err != nil {
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
		SELECT
			t.id,
			t.block_height,
			t.transaction_index,
			COALESCE(t.proposer_address, '') AS proposer_address,
			COALESCE(t.payer_address, '') AS payer_address,
			COALESCE(t.authorizers, ARRAY[]::text[]) AS authorizers,
			COALESCE(t.status, '') AS status,
			COALESCE(t.error_message, '') AS error_message,
			t.timestamp,
			t.created_at
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
		if err := rows.Scan(&t.ID, &t.BlockHeight, &t.TransactionIndex, &t.ProposerAddress, &t.PayerAddress, &t.Authorizers, &t.Status, &t.ErrorMessage, &t.Timestamp, &t.CreatedAt); err != nil {
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

// GetDailyStats retrieves the last 30 days of stats
func (r *Repository) GetDailyStats(ctx context.Context) ([]models.DailyStat, error) {
	rows, err := r.db.Query(ctx, `
		SELECT date::text, tx_count, active_accounts, new_contracts
		FROM app.daily_stats
		WHERE date >= CURRENT_DATE - INTERVAL '29 days'
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
	publicKey = strings.TrimSpace(publicKey)
	publicKey = strings.TrimPrefix(strings.ToLower(publicKey), "0x")
	if publicKey == "" {
		return "", nil
	}

	var address string
	err := r.db.QueryRow(ctx, `
		SELECT address
		FROM app.account_keys
		WHERE public_key = $1 AND revoked = FALSE
		ORDER BY last_updated_height DESC
		LIMIT 1`, publicKey).Scan(&address)
	if err == pgx.ErrNoRows {
		return "", nil
	}
	return address, err
}

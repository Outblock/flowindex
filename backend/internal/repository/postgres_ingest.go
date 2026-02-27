package repository

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"flowscan-clone/internal/models"

	"github.com/jackc/pgx/v5"
)

// sanitizeForPG removes PostgreSQL-incompatible bytes from strings:
// null bytes (\x00 / \u0000) and invalid UTF-8 sequences.
func sanitizeForPG(s string) string {
	s = strings.ReplaceAll(s, "\\u0000", "")
	s = strings.ReplaceAll(s, "\\U0000", "")
	if strings.ContainsRune(s, 0) {
		s = strings.ReplaceAll(s, "\x00", "")
	}
	if !utf8.ValidString(s) {
		s = strings.ToValidUTF8(s, "")
	}
	return s
}

// sanitizeJSONB sanitizes a json.RawMessage for PostgreSQL JSONB insertion.
// Removes null bytes and invalid UTF-8, then validates JSON. Returns nil if invalid/empty.
func sanitizeJSONB(raw json.RawMessage) any {
	if len(raw) == 0 {
		return nil
	}
	s := sanitizeForPG(string(raw))
	if !json.Valid([]byte(s)) {
		return nil
	}
	return []byte(s)
}

// SaveBatch atomicially saves a batch of blocks and all related data
// SaveBatch saves a batch of blocks and related data atomically
func (r *Repository) SaveBatch(ctx context.Context, blocks []*models.Block, txs []models.Transaction, events []models.Event, serviceName string, checkpointHeight uint64) error {
	if len(blocks) == 0 {
		return nil
	}

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
		ids := make([][]byte, len(blocks))
		parentIDs := make([][]byte, len(blocks))
		timestamps := make([]time.Time, len(blocks))
		collectionCounts := make([]int32, len(blocks))
		txCounts := make([]int64, len(blocks))
		eventCounts := make([]int64, len(blocks))
		stateRootHashes := make([][]byte, len(blocks))
		totalGasUsed := make([]int64, len(blocks))
		isSealed := make([]bool, len(blocks))

		for i, b := range blocks {
			heights[i] = int64(b.Height)
			ids[i] = hexToBytes(b.ID)
			parentIDs[i] = hexToBytes(b.ParentID)
			timestamps[i] = b.Timestamp
			collectionCounts[i] = int32(b.CollectionCount)
			txCounts[i] = int64(b.TxCount)
			eventCounts[i] = int64(b.EventCount)
			stateRootHashes[i] = hexToBytes(b.StateRootHash)
			totalGasUsed[i] = int64(b.TotalGasUsed)
			isSealed[i] = b.IsSealed
		}

		_, err := dbtx.Exec(ctx, `
			INSERT INTO raw.blocks (
				height, id, parent_id, timestamp,
				collection_count, tx_count, event_count,
				state_root_hash, total_gas_used, is_sealed
			)
			SELECT
				u.height,
				u.id,
				u.parent_id,
				u.timestamp,
				u.collection_count,
				u.tx_count,
				u.event_count,
				u.state_root_hash,
				u.total_gas_used,
				u.is_sealed
			FROM UNNEST(
				$1::bigint[],      -- height
				$2::bytea[],       -- id
				$3::bytea[],       -- parent_id
				$4::timestamptz[], -- timestamp
				$5::int[],         -- collection_count
				$6::bigint[],      -- tx_count
				$7::bigint[],      -- event_count
				$8::bytea[],       -- state_root_hash
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
		`, heights, ids, parentIDs, timestamps, collectionCounts, txCounts, eventCounts, stateRootHashes, totalGasUsed, isSealed)
		if err != nil {
			return fmt.Errorf("failed to bulk upsert blocks: %w", err)
		}

		_, err = dbtx.Exec(ctx, `
			INSERT INTO raw.block_lookup (id, height, timestamp)
			SELECT DISTINCT ON (u.id)
				u.id,
				u.height,
				u.timestamp
			FROM UNNEST($1::bytea[], $2::bigint[], $3::timestamptz[]) AS u(id, height, timestamp)
			ORDER BY u.id, u.height DESC
			ON CONFLICT (id) DO UPDATE SET
				height = EXCLUDED.height,
				timestamp = EXCLUDED.timestamp
		`, ids, heights, timestamps)
		if err != nil {
			return fmt.Errorf("failed to bulk upsert block lookup: %w", err)
		}
	} else {
		for _, b := range blocks {
			// Insert into partitioned raw.blocks
			_, err := dbtx.Exec(ctx, `
				INSERT INTO raw.blocks (height, id, parent_id, timestamp, collection_count, tx_count, event_count, state_root_hash, collection_guarantees, block_seals, signatures, execution_result_id, total_gas_used, is_sealed)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
				b.Height,
				hexToBytes(b.ID),
				hexToBytes(b.ParentID),
				b.Timestamp,
				b.CollectionCount,
				b.TxCount,
				b.EventCount,
				hexToBytes(b.StateRootHash),
				b.CollectionGuarantees,
				b.BlockSeals,
				b.Signatures,
				hexToBytes(b.ExecutionResultID),
				b.TotalGasUsed,
				b.IsSealed,
			)
			if err != nil {
				return fmt.Errorf("failed to insert block %d: %w", b.Height, err)
			}

			// Insert into raw.block_lookup (Atomic Lookup)
			_, err = dbtx.Exec(ctx, `
				INSERT INTO raw.block_lookup (id, height, timestamp)
				VALUES ($1, $2, $3)
				ON CONFLICT (id) DO UPDATE SET
					height = EXCLUDED.height,
					timestamp = EXCLUDED.timestamp`,
				hexToBytes(b.ID), b.Height, b.Timestamp,
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
			scriptsByHash[scriptHash] = sanitizeForPG(scriptText)
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
					"timestamp",
					"proposer_key_index", "proposer_sequence_number",
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
						scriptInline = sanitizeForPG(scriptInlines[i])
					}

					var args any
					if len(t.Arguments) > 0 {
						args = sanitizeJSONB(t.Arguments)
					}

					var errMsg any
					if strings.TrimSpace(t.ErrorMessage) != "" {
						errMsg = sanitizeForPG(t.ErrorMessage)
					}

					return []any{
						t.BlockHeight,
						hexToBytes(t.ID),
						t.TransactionIndex,
						hexToBytes(t.ProposerAddress),
						hexToBytes(t.PayerAddress),
						sliceHexToBytes(t.Authorizers),
						scriptHash,
						scriptInline,
						args,
						t.Status,
						errMsg,
						t.IsEVM,
						t.GasLimit,
						t.GasUsed,
						eventCount,
						txTimestamp,
						int32(t.ProposerKeyIndex),
						int64(t.ProposerSequenceNumber),
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
		ids := make([][]byte, 0, len(txs))
		heights := make([]int64, 0, len(txs))
		txIndexes := make([]int32, 0, len(txs))
		timestamps := make([]time.Time, 0, len(txs))

		batchCreatedAt := time.Now()

		for _, t := range txs {
			if isSystemTransaction(t.PayerAddress, t.ProposerAddress) {
				continue
			}

			ids = append(ids, hexToBytes(t.ID))
			heights = append(heights, int64(t.BlockHeight))
			txIndexes = append(txIndexes, int32(t.TransactionIndex))

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
			timestamps = append(timestamps, ts)
		}

		if len(ids) > 0 {
			_, err := dbtx.Exec(ctx, `
				INSERT INTO raw.tx_lookup (id, block_height, transaction_index, timestamp)
				SELECT DISTINCT ON (u.id)
					u.id, u.block_height, u.transaction_index, u.timestamp
				FROM UNNEST($1::bytea[], $2::bigint[], $3::int[], $4::timestamptz[]) AS u(
					id, block_height, transaction_index, timestamp
				)
				ORDER BY u.id, u.block_height DESC, u.transaction_index DESC
				ON CONFLICT (id) DO UPDATE SET
					block_height = EXCLUDED.block_height,
					transaction_index = EXCLUDED.transaction_index,
					timestamp = EXCLUDED.timestamp
			`, ids, heights, txIndexes, timestamps)
			if err != nil {
				return fmt.Errorf("failed to upsert tx_lookup batch: %w", err)
			}
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

			// Savepoint so a single bad tx doesn't abort the whole batch.
			dbtx.Exec(ctx, "SAVEPOINT tx_insert")

			_, err := dbtx.Exec(ctx, `
				INSERT INTO raw.transactions (
					block_height, id, transaction_index,
					proposer_address, payer_address, authorizers,
					script_hash, script, arguments,
					status, error_message, is_evm,
					gas_limit, gas_used, event_count,
					timestamp,
					proposer_key_index, proposer_sequence_number
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
				ON CONFLICT (block_height, id) DO UPDATE SET
					transaction_index = EXCLUDED.transaction_index,
					status = EXCLUDED.status,
					error_message = EXCLUDED.error_message,
					gas_used = EXCLUDED.gas_used,
					event_count = EXCLUDED.event_count,
					is_evm = EXCLUDED.is_evm,
					script_hash = COALESCE(EXCLUDED.script_hash, raw.transactions.script_hash),
					proposer_key_index = EXCLUDED.proposer_key_index,
					proposer_sequence_number = EXCLUDED.proposer_sequence_number`,
				t.BlockHeight, hexToBytes(t.ID), t.TransactionIndex,
				hexToBytes(t.ProposerAddress), hexToBytes(t.PayerAddress), sliceHexToBytes(t.Authorizers),
				scriptHash, func() any {
					if s, ok := scriptInline.(string); ok {
						return sanitizeForPG(s)
					}
					return scriptInline
				}(), sanitizeJSONB(t.Arguments),
				t.Status, func() any {
					if strings.TrimSpace(t.ErrorMessage) == "" {
						return nil
					}
					return sanitizeForPG(t.ErrorMessage)
				}(), t.IsEVM,
				t.GasLimit, t.GasUsed, eventCount,
				txTimestamp,
				int32(t.ProposerKeyIndex), int64(t.ProposerSequenceNumber),
			)
			if err != nil {
				// Rollback to savepoint, log the error, and continue with remaining txs.
				dbtx.Exec(ctx, "ROLLBACK TO SAVEPOINT tx_insert")
				log.Printf("[ingest] Skipping tx %s at height %d: %v", t.ID, t.BlockHeight, err)
				continue
			}

			// Insert into raw.tx_lookup (Atomic Lookup)
			if !isSystemTransaction(t.PayerAddress, t.ProposerAddress) {
				_, err = dbtx.Exec(ctx, `
					INSERT INTO raw.tx_lookup (id, block_height, transaction_index, timestamp)
					VALUES ($1, $2, $3, $4)
					ON CONFLICT (id) DO UPDATE SET
						block_height = EXCLUDED.block_height,
						transaction_index = EXCLUDED.transaction_index,
						timestamp = EXCLUDED.timestamp`,
					hexToBytes(t.ID), t.BlockHeight, t.TransactionIndex, txTimestamp,
				)
				if err != nil {
					dbtx.Exec(ctx, "ROLLBACK TO SAVEPOINT tx_insert")
					log.Printf("[ingest] Skipping tx_lookup %s: %v", t.ID, err)
					continue
				}
			}

			dbtx.Exec(ctx, "RELEASE SAVEPOINT tx_insert")
		}
	}

	// 3. Insert Events
	usedCopyForEvents := false
	if len(events) > 0 && strings.ToLower(strings.TrimSpace(os.Getenv("DB_BULK_COPY"))) != "false" {
		sub, err := dbtx.Begin(ctx) // savepoint
		if err == nil {
			defer sub.Rollback(ctx)

			_, errCopy := sub.CopyFrom(ctx,
				pgx.Identifier{"raw", "events"},
				[]string{
					"block_height", "transaction_id", "event_index",
					"transaction_index", "type", "payload",
					"contract_address", "event_name",
					"timestamp",
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
						eventTimestamp = time.Now()
					}

					var payload any
					if len(e.Payload) > 0 {
						payload = sanitizeJSONB(e.Payload)
					}

					return []any{
						e.BlockHeight,
						hexToBytes(e.TransactionID),
						e.EventIndex,
						e.TransactionIndex,
						e.Type,
						payload,
						hexToBytes(e.ContractAddress),
						e.EventName,
						eventTimestamp,
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
			_, err := dbtx.Exec(ctx, `
				INSERT INTO raw.events (
					block_height, transaction_id, event_index,
					transaction_index, type, payload,
					contract_address, event_name,
					timestamp
				)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
				ON CONFLICT (block_height, transaction_id, event_index) DO NOTHING`,
				e.BlockHeight, hexToBytes(e.TransactionID), e.EventIndex,
				e.TransactionIndex, e.Type, sanitizeJSONB(e.Payload),
				hexToBytes(e.ContractAddress), e.EventName,
				eventTimestamp,
			)
			if err != nil {
				return fmt.Errorf("failed to insert event %s idx=%d at height %d: %w", e.TransactionID, e.EventIndex, e.BlockHeight, err)
			}
		}
	}

	// 4. Update Checkpoint (app schema)
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
		INSERT INTO raw.blocks (height, id, parent_id, timestamp, collection_count, total_gas_used, is_sealed)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (height) DO NOTHING`,
		block.Height, hexToBytes(block.ID), hexToBytes(block.ParentID), block.Timestamp, block.CollectionCount, block.TotalGasUsed, block.IsSealed,
	)
	if err != nil {
		// Log ALL errors for debugging
		fmt.Printf("DB Error (Block %d): %v\n", block.Height, err)
		return err
	}
	return nil
}

// --- Read Methods ---

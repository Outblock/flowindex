package repository

import (
	"context"
	"fmt"

	"flowscan-clone/internal/models"

	"github.com/jackc/pgx/v5"
)

// --- Work Leasing Methods ---

// AcquireLease attempts to acquire a new lease (Insert-on-Claim)
// Returns leaseID > 0 if successful, 0 if conflict
func (r *Repository) AcquireLease(ctx context.Context, workerType string, fromHeight, toHeight uint64, leasedBy string) (int64, error) {
	var leaseID int64
	// Option B: INSERT ... ON CONFLICT DO NOTHING RETURNING id
	err := r.db.QueryRow(ctx, `
		INSERT INTO app.worker_leases (worker_type, from_height, to_height, leased_by, lease_expires_at, status, attempt)
		VALUES ($1, $2, $3, $4, NOW() + INTERVAL '5 min', 'ACTIVE', 0)
		ON CONFLICT (worker_type, from_height) DO NOTHING
		RETURNING id`,
		workerType, fromHeight, toHeight, leasedBy,
	).Scan(&leaseID)

	if err == pgx.ErrNoRows {
		// Conflict occurred, we didn't get the lease
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return leaseID, nil
}

// ReclaimLease attempts to reclaim a FAILED lease (Option A: Attempt stays same, Status=ACTIVE)
func (r *Repository) ReclaimLease(ctx context.Context, workerType string, fromHeight, toHeight uint64, leasedBy string) (int64, error) {
	var leaseID int64
	// Only reclaim if status='FAILED' and attempt < 5
	err := r.db.QueryRow(ctx, `
		UPDATE app.worker_leases
		SET leased_by = $1, 
		    lease_expires_at = NOW() + INTERVAL '5 min', 
		    status = 'ACTIVE'
		    -- NOTE: attempt count is NOT incremented during Reclaim (Option A)
		WHERE worker_type = $2 
		  AND from_height = $3 
		  AND status = 'FAILED' 
		  AND attempt < 5
		RETURNING id`,
		leasedBy, workerType, fromHeight,
	).Scan(&leaseID)

	if err == pgx.ErrNoRows {
		// No matching failed lease found
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return leaseID, nil
}

// CompleteLease marks a lease as COMPLETED
func (r *Repository) CompleteLease(ctx context.Context, leaseID int64) error {
	_, err := r.db.Exec(ctx, `
		UPDATE app.worker_leases
		SET status = 'COMPLETED', updated_at = NOW()
		WHERE id = $1`,
		leaseID,
	)
	return err
}

// FailLease marks a lease as FAILED (called if worker encounters error)
// Note: This is explicit failure. Reaper also handles expiration.
func (r *Repository) FailLease(ctx context.Context, leaseID int64, errMessage string) error {
	// We increment attempt here? The Plan didn't specify Explicit Fail policy,
	// but implies Reaper handles timeouts.
	// However, if we catch a panic/error, we should probably mark it failed.
	// Let's increment attempt here too to be safe/consistent with Reaper logic.
	_, err := r.db.Exec(ctx, `
		UPDATE app.worker_leases
		SET status = 'FAILED', 
		    attempt = attempt + 1,
		    updated_at = NOW()
		WHERE id = $1`,
		leaseID,
	)
	return err
}

// LogIndexingError logs an error to raw.indexing_errors
func (r *Repository) LogIndexingError(ctx context.Context, workerName string, height uint64, txID, errHash, errMsg string, payload []byte) error {
	// Truncate payload if too large? The plan says "truncated payload (cap in app code)".
	// We'll write to 'payload' if small, or 'raw_data' if unknown.
	// Actually schema has `payload JSONB`. And `raw_data JSONB`.
	// Let's put it in raw_data for now unless strictly structured.

	// We use ON CONFLICT DO NOTHING to avoid spamming the same error
	_, err := r.db.Exec(ctx, `
		INSERT INTO raw.indexing_errors (worker_name, block_height, transaction_id, error_hash, error_message, raw_data)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (worker_name, block_height, transaction_id, error_hash) DO NOTHING`,
		workerName, height, txID, errHash, errMsg, payload,
	)
	return err
}

// UpdateCheckpoint updates the contiguous watermark
func (r *Repository) UpdateCheckpoint(ctx context.Context, serviceName string, height uint64) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO app.indexing_checkpoints (service_name, last_height, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (service_name) DO UPDATE SET 
			last_height = GREATEST(app.indexing_checkpoints.last_height, EXCLUDED.last_height),
			updated_at = NOW()`,
		serviceName, height,
	)
	return err
}

// AdvanceCheckpointSafe moves the checkpoint to the highest contiguous completed height
func (r *Repository) AdvanceCheckpointSafe(ctx context.Context, workerType string) (uint64, error) {
	// 1. Get current checkpoint
	currentHeight, err := r.GetLastIndexedHeight(ctx, workerType)
	if err != nil {
		return 0, err
	}

	// 2. Find the start of the first "gap" or "non-completed" range
	// We look for any lease starting at or after currentHeight that is NOT completed.
	// The first such lease defines the upper bound of our contiguous chain.
	var gapStart uint64
	err = r.db.QueryRow(ctx, `
		SELECT from_height 
		FROM app.worker_leases 
		WHERE worker_type = $1 
		  AND from_height >= $2 
		  AND status != 'COMPLETED'
		ORDER BY from_height ASC 
		LIMIT 1`,
		workerType, currentHeight,
	).Scan(&gapStart)

	var newHeight uint64

	if err == nil {
		// Found a gap (active or failed lease) at gapStart.
		// So we can safely advance ONLY up to gapStart.
		newHeight = gapStart
	} else if err == pgx.ErrNoRows {
		// No gaps found! All leases starting >= current are COMPLETED (or there are none).
		// We can advance to the MAX to_height of completed leases.
		var maxCompleted uint64
		errMax := r.db.QueryRow(ctx, `
			SELECT COALESCE(MAX(to_height), $2)
			FROM app.worker_leases
			WHERE worker_type = $1
			  AND status = 'COMPLETED'`,
			workerType, currentHeight,
		).Scan(&maxCompleted)

		if errMax != nil {
			return 0, errMax
		}
		newHeight = maxCompleted
	} else {
		return 0, err
	}

	// 3. Update if newHeight > currentHeight
	if newHeight > currentHeight {
		err = r.UpdateCheckpoint(ctx, workerType, newHeight)
		if err != nil {
			return 0, err
		}
		return newHeight, nil
	}

	return currentHeight, nil
}

// --- Async Worker Data Methods ---

// GetRawEventsInRange fetches raw events for a height range
// Used by Async Workers to process data
func (r *Repository) GetRawEventsInRange(ctx context.Context, fromHeight, toHeight uint64) ([]models.Event, error) {
	// Select from partitioned raw.events
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
			timestamp,
			created_at
		FROM raw.events
		WHERE block_height >= $1 AND block_height < $2
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
		if err := rows.Scan(&e.BlockHeight, &e.TransactionID, &e.EventIndex, &e.TransactionIndex, &e.Type, &e.Payload, &e.ContractAddress, &e.EventName, &e.Timestamp, &e.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, nil
}

// UpsertTokenTransfers bulk inserts/updates token transfers
// Used by TokenWorker
func (r *Repository) UpsertTokenTransfers(ctx context.Context, transfers []models.TokenTransfer) error {
	if len(transfers) == 0 {
		return nil
	}

	batch := &pgx.Batch{}
	for _, t := range transfers {
		batch.Queue(`
			INSERT INTO app.token_transfers (
				block_height, transaction_id, event_index,
				token_contract_address, from_address, to_address,
				amount, token_id, is_nft, timestamp, created_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
			ON CONFLICT (block_height, transaction_id, event_index) DO UPDATE SET
				token_contract_address = EXCLUDED.token_contract_address,
				from_address = EXCLUDED.from_address,
				to_address = EXCLUDED.to_address,
				amount = EXCLUDED.amount,
				token_id = EXCLUDED.token_id,
				is_nft = EXCLUDED.is_nft,
				updated_at = NOW()`,
			t.BlockHeight, hexToBytes(t.TransactionID), t.EventIndex,
			hexToBytes(t.TokenContractAddress), hexToBytes(t.FromAddress), hexToBytes(t.ToAddress),
			t.Amount, t.TokenID, t.IsNFT, t.Timestamp,
		)
	}

	br := r.db.SendBatch(ctx, batch)
	defer br.Close()

	for i := 0; i < len(transfers); i++ {
		_, err := br.Exec()
		if err != nil {
			return fmt.Errorf("failed to insert token transfer batch: %w", err)
		}
	}
	return nil
}

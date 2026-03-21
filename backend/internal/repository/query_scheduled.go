package repository

import (
	"context"
	"encoding/hex"
	"fmt"
	"time"

	"flowscan-clone/internal/models"
)

// ScheduledExecUpdate holds data for marking a scheduled tx as executed.
type ScheduledExecUpdate struct {
	ScheduledID int64
	Block       uint64
	TxID        string
	Timestamp   time.Time
}

// ScheduledCancelUpdate holds data for marking a scheduled tx as canceled.
type ScheduledCancelUpdate struct {
	ScheduledID  int64
	Block        uint64
	TxID         string
	Timestamp    time.Time
	FeesReturned string
	FeesDeducted string
}

func (r *Repository) UpsertScheduledTransactions(ctx context.Context, items []models.ScheduledTransaction) error {
	if len(items) == 0 {
		return nil
	}
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for _, item := range items {
		ownerBytes, _ := hex.DecodeString(item.HandlerOwner)
		txIDBytes, _ := hex.DecodeString(item.ScheduledTxID)
		_, err := tx.Exec(ctx, `
			INSERT INTO app.scheduled_transactions (
				scheduled_id, priority, expected_timestamp, execution_effort, fees,
				handler_owner, handler_type, handler_uuid, handler_public_path,
				scheduled_block, scheduled_tx_id, scheduled_at, status
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'SCHEDULED')
			ON CONFLICT (scheduled_id) DO UPDATE SET
				priority = EXCLUDED.priority,
				expected_timestamp = EXCLUDED.expected_timestamp,
				execution_effort = EXCLUDED.execution_effort,
				fees = EXCLUDED.fees,
				handler_owner = EXCLUDED.handler_owner,
				handler_type = EXCLUDED.handler_type,
				handler_uuid = EXCLUDED.handler_uuid,
				handler_public_path = EXCLUDED.handler_public_path,
				scheduled_block = EXCLUDED.scheduled_block,
				scheduled_tx_id = EXCLUDED.scheduled_tx_id,
				scheduled_at = EXCLUDED.scheduled_at
		`, item.ScheduledID, item.Priority, item.ExpectedTimestamp, item.ExecutionEffort, item.Fees,
			ownerBytes, item.HandlerType, item.HandlerUUID, item.HandlerPublicPath,
			item.ScheduledBlock, txIDBytes, item.ScheduledAt)
		if err != nil {
			return fmt.Errorf("upsert scheduled_id %d: %w", item.ScheduledID, err)
		}
	}
	return tx.Commit(ctx)
}

func (r *Repository) UpdateScheduledTransactionsExecuted(ctx context.Context, items []ScheduledExecUpdate) error {
	if len(items) == 0 {
		return nil
	}
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for _, item := range items {
		txIDBytes, _ := hex.DecodeString(item.TxID)
		_, err := tx.Exec(ctx, `
			UPDATE app.scheduled_transactions
			SET status = 'EXECUTED', executed_block = $2, executed_tx_id = $3, executed_at = $4
			WHERE scheduled_id = $1 AND status != 'EXECUTED'
		`, item.ScheduledID, item.Block, txIDBytes, item.Timestamp)
		if err != nil {
			return fmt.Errorf("update executed scheduled_id %d: %w", item.ScheduledID, err)
		}
	}
	return tx.Commit(ctx)
}

func (r *Repository) UpdateScheduledTransactionsCanceled(ctx context.Context, items []ScheduledCancelUpdate) error {
	if len(items) == 0 {
		return nil
	}
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	for _, item := range items {
		txIDBytes, _ := hex.DecodeString(item.TxID)
		_, err := tx.Exec(ctx, `
			UPDATE app.scheduled_transactions
			SET status = 'CANCELED', executed_block = $2, executed_tx_id = $3, executed_at = $4,
			    fees_returned = $5, fees_deducted = $6
			WHERE scheduled_id = $1 AND status != 'CANCELED'
		`, item.ScheduledID, item.Block, txIDBytes, item.Timestamp, item.FeesReturned, item.FeesDeducted)
		if err != nil {
			return fmt.Errorf("update canceled scheduled_id %d: %w", item.ScheduledID, err)
		}
	}
	return tx.Commit(ctx)
}

// GetScheduledTransactionsPage returns scheduled transactions ordered by scheduled_id DESC.
func (r *Repository) GetScheduledTransactionsPage(ctx context.Context, limit, offset int, status string) ([]models.ScheduledTransaction, int, error) {
	where := ""
	args := []interface{}{}
	argIdx := 1

	if status != "" {
		where = fmt.Sprintf(" WHERE status = $%d", argIdx)
		args = append(args, status)
		argIdx++
	}

	// Count
	var total int
	countQ := "SELECT COUNT(*) FROM app.scheduled_transactions" + where
	if err := r.db.QueryRow(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	// Data
	args = append(args, limit, offset)
	q := fmt.Sprintf(`
		SELECT scheduled_id, priority, expected_timestamp, execution_effort, fees,
			encode(handler_owner, 'hex'), handler_type, handler_uuid, COALESCE(handler_public_path, ''),
			scheduled_block, encode(scheduled_tx_id, 'hex'), scheduled_at,
			status,
			executed_block, CASE WHEN executed_tx_id IS NOT NULL THEN encode(executed_tx_id, 'hex') ELSE NULL END,
			executed_at,
			fees_returned, fees_deducted
		FROM app.scheduled_transactions
		%s
		ORDER BY scheduled_id DESC
		LIMIT $%d OFFSET $%d
	`, where, argIdx, argIdx+1)

	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var results []models.ScheduledTransaction
	for rows.Next() {
		var st models.ScheduledTransaction
		if err := rows.Scan(
			&st.ScheduledID, &st.Priority, &st.ExpectedTimestamp, &st.ExecutionEffort, &st.Fees,
			&st.HandlerOwner, &st.HandlerType, &st.HandlerUUID, &st.HandlerPublicPath,
			&st.ScheduledBlock, &st.ScheduledTxID, &st.ScheduledAt,
			&st.Status,
			&st.ExecutedBlock, &st.ExecutedTxID, &st.ExecutedAt,
			&st.FeesReturned, &st.FeesDeducted,
		); err != nil {
			return nil, 0, err
		}
		results = append(results, st)
	}
	return results, total, nil
}

// GetScheduledTransactionByID returns a single scheduled transaction by its scheduled_id.
func (r *Repository) GetScheduledTransactionByID(ctx context.Context, id int64) (*models.ScheduledTransaction, error) {
	q := `
		SELECT scheduled_id, priority, expected_timestamp, execution_effort, fees,
			encode(handler_owner, 'hex'), handler_type, handler_uuid, COALESCE(handler_public_path, ''),
			scheduled_block, encode(scheduled_tx_id, 'hex'), scheduled_at,
			status,
			executed_block, CASE WHEN executed_tx_id IS NOT NULL THEN encode(executed_tx_id, 'hex') ELSE NULL END,
			executed_at,
			fees_returned, fees_deducted
		FROM app.scheduled_transactions
		WHERE scheduled_id = $1
	`
	var st models.ScheduledTransaction
	err := r.db.QueryRow(ctx, q, id).Scan(
		&st.ScheduledID, &st.Priority, &st.ExpectedTimestamp, &st.ExecutionEffort, &st.Fees,
		&st.HandlerOwner, &st.HandlerType, &st.HandlerUUID, &st.HandlerPublicPath,
		&st.ScheduledBlock, &st.ScheduledTxID, &st.ScheduledAt,
		&st.Status,
		&st.ExecutedBlock, &st.ExecutedTxID, &st.ExecutedAt,
		&st.FeesReturned, &st.FeesDeducted,
	)
	if err != nil {
		return nil, err
	}
	return &st, nil
}

// GetScheduledHandlerStats returns status counts for a given handler owner.
func (r *Repository) GetScheduledHandlerStats(ctx context.Context, owner string) (map[string]int, error) {
	ownerBytes, _ := hex.DecodeString(owner)
	rows, err := r.db.Query(ctx, `
		SELECT status, COUNT(*) FROM app.scheduled_transactions
		WHERE handler_owner = $1
		GROUP BY status
	`, ownerBytes)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	stats := map[string]int{}
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			return nil, err
		}
		stats[status] = count
	}
	return stats, nil
}

// GetScheduledHandlers returns a paginated list of distinct handlers with aggregated stats.
func (r *Repository) GetScheduledHandlers(ctx context.Context, limit, offset int, ownerFilter string) ([]models.ScheduledHandler, int, error) {
	where := ""
	args := []interface{}{}
	argIdx := 1

	if ownerFilter != "" {
		ownerBytes, _ := hex.DecodeString(ownerFilter)
		where = fmt.Sprintf(" WHERE handler_owner = $%d", argIdx)
		args = append(args, ownerBytes)
		argIdx++
	}

	// Count distinct handlers (by owner + type, merging all UUID instances)
	var total int
	countQ := "SELECT COUNT(DISTINCT (handler_owner, handler_type)) FROM app.scheduled_transactions" + where
	if err := r.db.QueryRow(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	// Aggregated data — group by owner + type (merge all UUID instances)
	args = append(args, limit, offset)
	q := fmt.Sprintf(`
		SELECT
			encode(handler_owner, 'hex'),
			handler_type,
			COUNT(DISTINCT handler_uuid) AS instance_count,
			COUNT(*) AS total_count,
			COUNT(*) FILTER (WHERE status = 'SCHEDULED') AS scheduled_count,
			COUNT(*) FILTER (WHERE status = 'EXECUTED') AS executed_count,
			COUNT(*) FILTER (WHERE status = 'CANCELED') AS canceled_count,
			COALESCE(SUM(fees::numeric), 0)::text AS total_fees,
			MIN(scheduled_at) AS first_scheduled,
			MAX(scheduled_at) AS last_scheduled,
			MAX(executed_at) AS last_executed_at,
			CASE WHEN COUNT(*) > 1
				THEN EXTRACT(EPOCH FROM (MAX(scheduled_at) - MIN(scheduled_at))) / NULLIF(COUNT(*) - 1, 0)
				ELSE NULL
			END AS avg_interval_sec
		FROM app.scheduled_transactions
		%s
		GROUP BY handler_owner, handler_type
		ORDER BY MAX(scheduled_id) DESC
		LIMIT $%d OFFSET $%d
	`, where, argIdx, argIdx+1)

	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var results []models.ScheduledHandler
	for rows.Next() {
		var h models.ScheduledHandler
		if err := rows.Scan(
			&h.HandlerOwner, &h.HandlerType, &h.InstanceCount,
			&h.TotalCount, &h.ScheduledCount, &h.ExecutedCount, &h.CanceledCount,
			&h.TotalFees,
			&h.FirstScheduled, &h.LastScheduled, &h.LastExecutedAt,
			&h.AvgIntervalSec,
		); err != nil {
			return nil, 0, err
		}
		results = append(results, h)
	}
	return results, total, nil
}

// GetScheduledTransactionsByHandler returns scheduled transactions for a specific handler UUID.
func (r *Repository) GetScheduledTransactionsByHandler(ctx context.Context, owner string, handlerUUID int64, limit, offset int) ([]models.ScheduledTransaction, int, error) {
	ownerBytes, _ := hex.DecodeString(owner)

	var total int
	if err := r.db.QueryRow(ctx,
		"SELECT COUNT(*) FROM app.scheduled_transactions WHERE handler_owner = $1 AND handler_uuid = $2",
		ownerBytes, handlerUUID,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	q := `
		SELECT scheduled_id, priority, expected_timestamp, execution_effort, fees,
			encode(handler_owner, 'hex'), handler_type, handler_uuid, COALESCE(handler_public_path, ''),
			scheduled_block, encode(scheduled_tx_id, 'hex'), scheduled_at,
			status,
			executed_block, CASE WHEN executed_tx_id IS NOT NULL THEN encode(executed_tx_id, 'hex') ELSE NULL END,
			executed_at,
			fees_returned, fees_deducted
		FROM app.scheduled_transactions
		WHERE handler_owner = $1 AND handler_uuid = $2
		ORDER BY scheduled_id DESC
		LIMIT $3 OFFSET $4
	`
	rows, err := r.db.Query(ctx, q, ownerBytes, handlerUUID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var results []models.ScheduledTransaction
	for rows.Next() {
		var st models.ScheduledTransaction
		if err := rows.Scan(
			&st.ScheduledID, &st.Priority, &st.ExpectedTimestamp, &st.ExecutionEffort, &st.Fees,
			&st.HandlerOwner, &st.HandlerType, &st.HandlerUUID, &st.HandlerPublicPath,
			&st.ScheduledBlock, &st.ScheduledTxID, &st.ScheduledAt,
			&st.Status,
			&st.ExecutedBlock, &st.ExecutedTxID, &st.ExecutedAt,
			&st.FeesReturned, &st.FeesDeducted,
		); err != nil {
			return nil, 0, err
		}
		results = append(results, st)
	}
	return results, total, nil
}

// GetScheduledTransactionsByHandlerType returns scheduled transactions for a specific handler type + owner.
func (r *Repository) GetScheduledTransactionsByHandlerType(ctx context.Context, owner string, handlerType string, limit, offset int) ([]models.ScheduledTransaction, int, error) {
	ownerBytes, _ := hex.DecodeString(owner)

	var total int
	if err := r.db.QueryRow(ctx,
		"SELECT COUNT(*) FROM app.scheduled_transactions WHERE handler_owner = $1 AND handler_type = $2",
		ownerBytes, handlerType,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	q := `
		SELECT scheduled_id, priority, expected_timestamp, execution_effort, fees,
			encode(handler_owner, 'hex'), handler_type, handler_uuid, COALESCE(handler_public_path, ''),
			scheduled_block, encode(scheduled_tx_id, 'hex'), scheduled_at,
			status,
			executed_block, CASE WHEN executed_tx_id IS NOT NULL THEN encode(executed_tx_id, 'hex') ELSE NULL END,
			executed_at,
			fees_returned, fees_deducted
		FROM app.scheduled_transactions
		WHERE handler_owner = $1 AND handler_type = $2
		ORDER BY scheduled_id DESC
		LIMIT $3 OFFSET $4
	`
	rows, err := r.db.Query(ctx, q, ownerBytes, handlerType, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var results []models.ScheduledTransaction
	for rows.Next() {
		var st models.ScheduledTransaction
		if err := rows.Scan(
			&st.ScheduledID, &st.Priority, &st.ExpectedTimestamp, &st.ExecutionEffort, &st.Fees,
			&st.HandlerOwner, &st.HandlerType, &st.HandlerUUID, &st.HandlerPublicPath,
			&st.ScheduledBlock, &st.ScheduledTxID, &st.ScheduledAt,
			&st.Status,
			&st.ExecutedBlock, &st.ExecutedTxID, &st.ExecutedAt,
			&st.FeesReturned, &st.FeesDeducted,
		); err != nil {
			return nil, 0, err
		}
		results = append(results, st)
	}
	return results, total, nil
}

// GetScheduledTransactionsByOwner returns scheduled transactions for a specific handler owner.
func (r *Repository) GetScheduledTransactionsByOwner(ctx context.Context, owner string, limit, offset int) ([]models.ScheduledTransaction, int, error) {
	ownerBytes, _ := hex.DecodeString(owner)

	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM app.scheduled_transactions WHERE handler_owner = $1", ownerBytes).Scan(&total); err != nil {
		return nil, 0, err
	}

	q := `
		SELECT scheduled_id, priority, expected_timestamp, execution_effort, fees,
			encode(handler_owner, 'hex'), handler_type, handler_uuid, COALESCE(handler_public_path, ''),
			scheduled_block, encode(scheduled_tx_id, 'hex'), scheduled_at,
			status,
			executed_block, CASE WHEN executed_tx_id IS NOT NULL THEN encode(executed_tx_id, 'hex') ELSE NULL END,
			executed_at,
			fees_returned, fees_deducted
		FROM app.scheduled_transactions
		WHERE handler_owner = $1
		ORDER BY scheduled_id DESC
		LIMIT $2 OFFSET $3
	`
	rows, err := r.db.Query(ctx, q, ownerBytes, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var results []models.ScheduledTransaction
	for rows.Next() {
		var st models.ScheduledTransaction
		if err := rows.Scan(
			&st.ScheduledID, &st.Priority, &st.ExpectedTimestamp, &st.ExecutionEffort, &st.Fees,
			&st.HandlerOwner, &st.HandlerType, &st.HandlerUUID, &st.HandlerPublicPath,
			&st.ScheduledBlock, &st.ScheduledTxID, &st.ScheduledAt,
			&st.Status,
			&st.ExecutedBlock, &st.ExecutedTxID, &st.ExecutedAt,
			&st.FeesReturned, &st.FeesDeducted,
		); err != nil {
			return nil, 0, err
		}
		results = append(results, st)
	}
	return results, total, nil
}

// SearchScheduledByEvent searches for scheduled transactions whose executor tx
// emitted events matching the given event_type and optional JSONB field conditions.
func (r *Repository) SearchScheduledByEvent(ctx context.Context, eventType string, fieldKey, fieldValue string, limit, offset int) ([]models.ScheduledTxSearchResult, int, error) {
	args := []interface{}{eventType}
	argIdx := 2

	fieldClause := ""
	if fieldKey != "" && fieldValue != "" {
		fieldClause = fmt.Sprintf(" AND e.payload->>$%d ILIKE $%d", argIdx, argIdx+1)
		args = append(args, fieldKey, "%"+fieldValue+"%")
		argIdx += 2
	}

	// Count
	var total int
	countQ := fmt.Sprintf(`
		SELECT COUNT(DISTINCT st.scheduled_id)
		FROM app.scheduled_transactions st
		JOIN raw.events e ON e.transaction_id = st.executed_tx_id AND e.block_height = st.executed_block
		WHERE st.status = 'EXECUTED'
		  AND e.type ILIKE '%%' || $1 || '%%'
		  %s
	`, fieldClause)
	if err := r.db.QueryRow(ctx, countQ, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count search: %w", err)
	}

	args = append(args, limit, offset)
	q := fmt.Sprintf(`
		SELECT DISTINCT ON (st.scheduled_id)
			st.scheduled_id, st.priority, st.expected_timestamp, st.execution_effort, st.fees,
			encode(st.handler_owner, 'hex'), st.handler_type, st.handler_uuid, COALESCE(st.handler_public_path, ''),
			st.scheduled_block, encode(st.scheduled_tx_id, 'hex'), st.scheduled_at,
			st.status,
			st.executed_block, CASE WHEN st.executed_tx_id IS NOT NULL THEN encode(st.executed_tx_id, 'hex') ELSE NULL END,
			st.executed_at,
			st.fees_returned, st.fees_deducted,
			e.type, COALESCE(e.event_name, '')
		FROM app.scheduled_transactions st
		JOIN raw.events e ON e.transaction_id = st.executed_tx_id AND e.block_height = st.executed_block
		WHERE st.status = 'EXECUTED'
		  AND e.type ILIKE '%%' || $1 || '%%'
		  %s
		ORDER BY st.scheduled_id DESC
		LIMIT $%d OFFSET $%d
	`, fieldClause, argIdx, argIdx+1)

	rows, err := r.db.Query(ctx, q, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("search query: %w", err)
	}
	defer rows.Close()

	var results []models.ScheduledTxSearchResult
	for rows.Next() {
		var sr models.ScheduledTxSearchResult
		if err := rows.Scan(
			&sr.ScheduledID, &sr.Priority, &sr.ExpectedTimestamp, &sr.ExecutionEffort, &sr.Fees,
			&sr.HandlerOwner, &sr.HandlerType, &sr.HandlerUUID, &sr.HandlerPublicPath,
			&sr.ScheduledBlock, &sr.ScheduledTxID, &sr.ScheduledAt,
			&sr.Status,
			&sr.ExecutedBlock, &sr.ExecutedTxID, &sr.ExecutedAt,
			&sr.FeesReturned, &sr.FeesDeducted,
			&sr.MatchedEventType, &sr.MatchedEventName,
		); err != nil {
			return nil, 0, fmt.Errorf("scan search result: %w", err)
		}
		results = append(results, sr)
	}
	return results, total, nil
}

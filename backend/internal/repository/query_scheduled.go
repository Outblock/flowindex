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

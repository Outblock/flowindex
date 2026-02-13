package repository

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// ScriptTemplate represents a row in app.script_templates.
type ScriptTemplate struct {
	ScriptHash    string    `json:"script_hash"`
	Category      string    `json:"category"`
	Label         string    `json:"label"`
	Description   string    `json:"description"`
	TxCount       int64     `json:"tx_count"`
	ScriptPreview string    `json:"script_preview,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// ScriptTemplateStats holds coverage statistics.
type ScriptTemplateStats struct {
	Total       int64   `json:"total"`
	Labeled     int64   `json:"labeled"`
	Unlabeled   int64   `json:"unlabeled"`
	CoveragePct float64 `json:"coverage_pct"`
	LabeledTx   int64   `json:"labeled_tx"`
	TotalTx     int64   `json:"total_tx"`
}

// TxScriptTemplate is the category/label for a single transaction.
type TxScriptTemplate struct {
	Category string
	Label    string
}

// AdminListScriptTemplates returns script templates sorted by tx_count DESC with optional filters.
func (r *Repository) AdminListScriptTemplates(ctx context.Context, search, category string, labeledOnly bool, limit, offset int) ([]ScriptTemplate, error) {
	query := `
		SELECT st.script_hash, COALESCE(st.category, ''), COALESCE(st.label, ''),
		       COALESCE(st.description, ''), st.tx_count,
		       COALESCE(LEFT(s.script_text, 200), ''),
		       st.created_at, st.updated_at
		FROM app.script_templates st
		LEFT JOIN raw.scripts s ON s.script_hash = st.script_hash
		WHERE 1=1`
	args := []interface{}{}
	argN := 1

	if search != "" {
		query += fmt.Sprintf(` AND (st.script_hash ILIKE $%d OR st.label ILIKE $%d OR st.category ILIKE $%d OR s.script_text ILIKE $%d)`, argN, argN, argN, argN)
		args = append(args, "%"+search+"%")
		argN++
	}
	if category != "" {
		query += fmt.Sprintf(` AND st.category = $%d`, argN)
		args = append(args, category)
		argN++
	}
	if labeledOnly {
		query += ` AND st.category IS NOT NULL AND st.category != ''`
	}

	query += ` ORDER BY st.tx_count DESC`
	query += fmt.Sprintf(` LIMIT $%d OFFSET $%d`, argN, argN+1)
	args = append(args, limit, offset)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []ScriptTemplate
	for rows.Next() {
		var t ScriptTemplate
		if err := rows.Scan(&t.ScriptHash, &t.Category, &t.Label,
			&t.Description, &t.TxCount, &t.ScriptPreview,
			&t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, t)
	}
	return result, rows.Err()
}

// AdminUpdateScriptTemplate updates category/label/description for a script hash.
func (r *Repository) AdminUpdateScriptTemplate(ctx context.Context, hash, category, label, description string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE app.script_templates
		SET category = $1, label = $2, description = $3, updated_at = NOW()
		WHERE script_hash = $4`,
		nilIfEmpty(category), nilIfEmpty(label), nilIfEmpty(description), hash)
	return err
}

// AdminGetScriptTemplateStats returns coverage statistics.
func (r *Repository) AdminGetScriptTemplateStats(ctx context.Context) (*ScriptTemplateStats, error) {
	var stats ScriptTemplateStats
	err := r.db.QueryRow(ctx, `
		SELECT
			COUNT(*),
			COUNT(*) FILTER (WHERE category IS NOT NULL AND category != ''),
			COUNT(*) FILTER (WHERE category IS NULL OR category = ''),
			COALESCE(SUM(tx_count) FILTER (WHERE category IS NOT NULL AND category != ''), 0),
			COALESCE(SUM(tx_count), 0)
		FROM app.script_templates`).Scan(
		&stats.Total, &stats.Labeled, &stats.Unlabeled, &stats.LabeledTx, &stats.TotalTx)
	if err != nil {
		return nil, err
	}
	if stats.TotalTx > 0 {
		stats.CoveragePct = float64(stats.LabeledTx) / float64(stats.TotalTx) * 100
	}
	return &stats, nil
}

// AdminRefreshScriptTemplateCounts inserts all script hashes from raw.scripts
// and updates tx_count from raw.transactions.
func (r *Repository) AdminRefreshScriptTemplateCounts(ctx context.Context) (int64, error) {
	// Insert missing hashes
	_, err := r.db.Exec(ctx, `
		INSERT INTO app.script_templates (script_hash)
		SELECT s.script_hash FROM raw.scripts s
		ON CONFLICT (script_hash) DO NOTHING`)
	if err != nil {
		return 0, fmt.Errorf("insert missing hashes: %w", err)
	}

	// Update counts
	tag, err := r.db.Exec(ctx, `
		UPDATE app.script_templates st
		SET tx_count = sub.cnt, updated_at = NOW()
		FROM (
			SELECT script_hash, COUNT(*) as cnt
			FROM raw.transactions
			WHERE script_hash IS NOT NULL AND script_hash != ''
			GROUP BY script_hash
		) sub
		WHERE st.script_hash = sub.script_hash AND st.tx_count != sub.cnt`)
	if err != nil {
		return 0, fmt.Errorf("update counts: %w", err)
	}
	return tag.RowsAffected(), nil
}

// AdminGetScriptText returns the full script text for a given hash.
func (r *Repository) AdminGetScriptText(ctx context.Context, hash string) (string, error) {
	var text string
	err := r.db.QueryRow(ctx, `SELECT COALESCE(script_text, '') FROM raw.scripts WHERE script_hash = $1`, hash).Scan(&text)
	return text, err
}

// GetScriptTemplatesByTxIDs batch-looks up template category/label for a set of transaction IDs.
// Returns a map of txID -> TxScriptTemplate for transactions that have a labeled template.
func (r *Repository) GetScriptTemplatesByTxIDs(ctx context.Context, txIDs []string) (map[string]TxScriptTemplate, error) {
	if len(txIDs) == 0 {
		return nil, nil
	}

	// Build hex array for the query
	hexIDs := make([]string, 0, len(txIDs))
	for _, id := range txIDs {
		id = strings.TrimPrefix(strings.ToLower(id), "0x")
		hexIDs = append(hexIDs, id)
	}

	// Join transactions to script_templates via script_hash
	query := `
		SELECT encode(t.id, 'hex'), st.category, st.label
		FROM raw.transactions t
		JOIN app.script_templates st ON st.script_hash = t.script_hash
		WHERE t.id = ANY($1::bytea[])
		  AND st.category IS NOT NULL AND st.category != ''`

	byteIDs := make([][]byte, 0, len(hexIDs))
	for _, h := range hexIDs {
		byteIDs = append(byteIDs, hexToBytes(h))
	}

	rows, err := r.db.Query(ctx, query, byteIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string]TxScriptTemplate)
	for rows.Next() {
		var txID, category, label string
		if err := rows.Scan(&txID, &category, &label); err != nil {
			return nil, err
		}
		result[txID] = TxScriptTemplate{Category: category, Label: label}
	}
	return result, rows.Err()
}

func nilIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

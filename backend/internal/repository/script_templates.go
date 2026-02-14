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

// TxScriptTemplate is the category/label/description/hash for a single transaction.
type TxScriptTemplate struct {
	ScriptHash  string
	Category    string
	Label       string
	Description string
}

// AdminListScriptTemplates returns script templates sorted by tx_count DESC with optional filters.
func (r *Repository) AdminListScriptTemplates(ctx context.Context, search, category string, labeledOnly, unlabeledOnly bool, limit, offset int) ([]ScriptTemplate, error) {
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
	if unlabeledOnly {
		query += ` AND (st.category IS NULL OR st.category = '')`
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

	hexIDs := make([]string, 0, len(txIDs))
	for _, id := range txIDs {
		id = strings.TrimPrefix(strings.ToLower(id), "0x")
		hexIDs = append(hexIDs, id)
	}
	byteIDs := make([][]byte, 0, len(hexIDs))
	for _, h := range hexIDs {
		byteIDs = append(byteIDs, hexToBytes(h))
	}

	// Step 1: Get script_hash from raw.transactions.
	// Using ANY on a partitioned table without block_height scans all partitions,
	// but for a small number of IDs (~20) this is fast enough with bitmap index scans.
	txHashRows, err := r.db.Query(ctx, `
		SELECT encode(id, 'hex'), COALESCE(script_hash, '')
		FROM raw.transactions
		WHERE id = ANY($1::bytea[])
		  AND script_hash IS NOT NULL AND script_hash != ''`, byteIDs)
	if err != nil {
		return nil, err
	}
	defer txHashRows.Close()

	type txHash struct {
		txID       string
		scriptHash string
	}
	var txHashes []txHash
	hashSet := make(map[string]struct{})
	for txHashRows.Next() {
		var th txHash
		if err := txHashRows.Scan(&th.txID, &th.scriptHash); err != nil {
			return nil, err
		}
		txHashes = append(txHashes, th)
		hashSet[th.scriptHash] = struct{}{}
	}
	if len(txHashes) == 0 {
		return nil, nil
	}

	// Step 2: Batch lookup script_templates by PK (script_hash).
	// This avoids the expensive Hash Join on the full script_templates table.
	uniqueHashes := make([]string, 0, len(hashSet))
	for h := range hashSet {
		uniqueHashes = append(uniqueHashes, h)
	}
	stRows, err := r.db.Query(ctx, `
		SELECT script_hash, COALESCE(category, ''), COALESCE(label, ''), COALESCE(description, '')
		FROM app.script_templates
		WHERE script_hash = ANY($1::varchar[])`, uniqueHashes)
	if err != nil {
		return nil, err
	}
	defer stRows.Close()

	templates := make(map[string]TxScriptTemplate)
	for stRows.Next() {
		var scriptHash, category, label, description string
		if err := stRows.Scan(&scriptHash, &category, &label, &description); err != nil {
			return nil, err
		}
		templates[scriptHash] = TxScriptTemplate{ScriptHash: scriptHash, Category: category, Label: label, Description: description}
	}

	// Step 3: Merge results — map txID -> template info.
	result := make(map[string]TxScriptTemplate, len(txHashes))
	for _, th := range txHashes {
		if tmpl, ok := templates[th.scriptHash]; ok {
			result[th.txID] = tmpl
		} else {
			result[th.txID] = TxScriptTemplate{ScriptHash: th.scriptHash}
		}
	}
	return result, nil
}

// AdminListUnlabeledScriptTemplates returns unlabeled templates with tx_count >= minTxCount,
// sorted by tx_count DESC, limited to `limit` rows.
func (r *Repository) AdminListUnlabeledScriptTemplates(ctx context.Context, minTxCount, limit int) ([]ScriptTemplate, error) {
	rows, err := r.db.Query(ctx, `
		SELECT st.script_hash, COALESCE(st.category, ''), COALESCE(st.label, ''),
		       COALESCE(st.description, ''), st.tx_count,
		       COALESCE(LEFT(s.script_text, 200), ''),
		       st.created_at, st.updated_at
		FROM app.script_templates st
		LEFT JOIN raw.scripts s ON s.script_hash = st.script_hash
		WHERE (st.category IS NULL OR st.category = '')
		  AND st.tx_count >= $1
		ORDER BY st.tx_count DESC
		LIMIT $2`, minTxCount, limit)
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

func nilIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

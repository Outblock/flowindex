package repository

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// ScriptTemplate represents a row in app.script_templates.
type ScriptTemplate struct {
	ScriptHash     string    `json:"script_hash"`
	NormalizedHash string    `json:"normalized_hash,omitempty"`
	Category       string    `json:"category"`
	Label          string    `json:"label"`
	Description    string    `json:"description"`
	TxCount        int64     `json:"tx_count"`
	VariantCount   int       `json:"variant_count,omitempty"` // number of script_hash variants sharing the same normalized_hash
	ScriptPreview  string    `json:"script_preview,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
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

// AdminListScriptTemplates returns script templates sorted by aggregated tx_count DESC.
// When normalized_hash is available, rows sharing the same normalized_hash are grouped:
// we pick one representative row per group and SUM their tx_counts.
func (r *Repository) AdminListScriptTemplates(ctx context.Context, search, category string, labeledOnly, unlabeledOnly bool, limit, offset int) ([]ScriptTemplate, error) {
	// The non-search path avoids joining raw.scripts for all grouped rows.
	// We page grouped rows first, then join scripts only for the current page.
	query := `
		WITH grouped AS (
			SELECT
				COALESCE(st.normalized_hash, st.script_hash) AS group_key,
				(ARRAY_AGG(st.script_hash ORDER BY st.tx_count DESC))[1] AS script_hash,
				MAX(COALESCE(st.normalized_hash, '')) AS normalized_hash,
				MAX(COALESCE(st.category, ''))  AS category,
				MAX(COALESCE(st.label, ''))     AS label,
				MAX(COALESCE(st.description, '')) AS description,
				SUM(st.tx_count)                AS tx_count,
				COUNT(*)                        AS variant_count,
				MIN(st.created_at)              AS created_at,
				MAX(st.updated_at)              AS updated_at
			FROM app.script_templates st
			GROUP BY COALESCE(st.normalized_hash, st.script_hash)
		),
		page AS (
			SELECT
				g.script_hash, g.normalized_hash, g.category, g.label, g.description,
				g.tx_count, g.variant_count, g.created_at, g.updated_at
			FROM grouped g
			WHERE 1=1`
	args := []interface{}{}
	argN := 1

	if search != "" {
		query += fmt.Sprintf(` AND (g.script_hash ILIKE $%d OR g.label ILIKE $%d OR g.category ILIKE $%d OR EXISTS (
			SELECT 1 FROM raw.scripts s2 WHERE s2.script_hash = g.script_hash AND s2.script_text ILIKE $%d
		))`, argN, argN, argN, argN)
		args = append(args, "%"+search+"%")
		argN++
	}
	if category != "" {
		query += fmt.Sprintf(` AND category = $%d`, argN)
		args = append(args, category)
		argN++
	}
	if labeledOnly {
		query += ` AND category IS NOT NULL AND category != ''`
	}
	if unlabeledOnly {
		query += ` AND (category IS NULL OR category = '')`
	}

	query += ` ORDER BY tx_count DESC`
	query += fmt.Sprintf(` LIMIT $%d OFFSET $%d
		)
		SELECT p.script_hash, p.normalized_hash, p.category, p.label, p.description,
		       p.tx_count, p.variant_count,
		       COALESCE(LEFT(s.script_text, 200), ''),
		       p.created_at, p.updated_at
		FROM page p
		LEFT JOIN raw.scripts s ON s.script_hash = p.script_hash
		ORDER BY p.tx_count DESC`, argN, argN+1)
	args = append(args, limit, offset)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []ScriptTemplate
	for rows.Next() {
		var t ScriptTemplate
		if err := rows.Scan(&t.ScriptHash, &t.NormalizedHash, &t.Category, &t.Label,
			&t.Description, &t.TxCount, &t.VariantCount, &t.ScriptPreview,
			&t.CreatedAt, &t.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, t)
	}
	return result, rows.Err()
}

// AdminUpdateScriptTemplate updates category/label/description for a script hash.
// If the template has a normalized_hash, propagate the classification to all variants.
func (r *Repository) AdminUpdateScriptTemplate(ctx context.Context, hash, category, label, description string) error {
	cat := nilIfEmpty(category)
	lbl := nilIfEmpty(label)
	desc := nilIfEmpty(description)

	// First, check if this template has a normalized_hash.
	var normHash *string
	_ = r.db.QueryRow(ctx, `SELECT normalized_hash FROM app.script_templates WHERE script_hash = $1`, hash).Scan(&normHash)

	if normHash != nil && *normHash != "" {
		// Propagate to all variants sharing the same normalized_hash.
		_, err := r.db.Exec(ctx, `
			UPDATE app.script_templates
			SET category = $1, label = $2, description = $3, updated_at = NOW()
			WHERE normalized_hash = $4`,
			cat, lbl, desc, *normHash)
		return err
	}

	// Fallback: update only the specific hash.
	_, err := r.db.Exec(ctx, `
		UPDATE app.script_templates
		SET category = $1, label = $2, description = $3, updated_at = NOW()
		WHERE script_hash = $4`,
		cat, lbl, desc, hash)
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

// AdminRefreshScriptTemplateCounts inserts all script hashes from raw.scripts,
// updates tx_count from raw.transactions, and backfills normalized_hash.
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

	// Backfill normalized_hash for templates that don't have one yet.
	if err := r.backfillNormalizedHashes(ctx); err != nil {
		return tag.RowsAffected(), fmt.Errorf("backfill normalized hashes: %w", err)
	}

	return tag.RowsAffected(), nil
}

// backfillNormalizedHashes computes normalized_hash for script_templates missing it.
func (r *Repository) backfillNormalizedHashes(ctx context.Context) error {
	rows, err := r.db.Query(ctx, `
		SELECT st.script_hash, s.script_text
		FROM app.script_templates st
		JOIN raw.scripts s ON s.script_hash = st.script_hash
		WHERE st.normalized_hash IS NULL AND s.script_text IS NOT NULL`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type pair struct {
		scriptHash     string
		normalizedHash string
	}
	var pairs []pair
	for rows.Next() {
		var hash, text string
		if err := rows.Scan(&hash, &text); err != nil {
			return err
		}
		nh := NormalizedScriptHash(text)
		if nh != "" {
			pairs = append(pairs, pair{hash, nh})
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}

	// Batch update in chunks.
	for i := 0; i < len(pairs); i += 500 {
		end := i + 500
		if end > len(pairs) {
			end = len(pairs)
		}
		hashes := make([]string, 0, end-i)
		norms := make([]string, 0, end-i)
		for _, p := range pairs[i:end] {
			hashes = append(hashes, p.scriptHash)
			norms = append(norms, p.normalizedHash)
		}
		_, err := r.db.Exec(ctx, `
			UPDATE app.script_templates st
			SET normalized_hash = u.normalized_hash
			FROM UNNEST($1::text[], $2::text[]) AS u(script_hash, normalized_hash)
			WHERE st.script_hash = u.script_hash`,
			hashes, norms)
		if err != nil {
			return err
		}
	}
	return nil
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

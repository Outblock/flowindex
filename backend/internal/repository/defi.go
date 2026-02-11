package repository

import (
	"context"
	"fmt"
	"time"

	"flowscan-clone/internal/models"

	"github.com/jackc/pgx/v5"
)

// defiEventRow is used by the API layer for serialization.
type defiEventRow = models.DefiEvent

// DefiAsset represents a unique asset from defi pairs.
type DefiAsset struct {
	ID     string
	Symbol string
}

// numericOrZero returns "0" for empty strings so PostgreSQL NUMERIC columns don't choke.
func numericOrZero(s string) string {
	if s == "" {
		return "0"
	}
	return s
}

// UpsertDefiPairs batch upserts DeFi pair records.
func (r *Repository) UpsertDefiPairs(ctx context.Context, pairs []models.DefiPair) error {
	if len(pairs) == 0 {
		return nil
	}

	batch := &pgx.Batch{}
	for _, p := range pairs {
		batch.Queue(`
			INSERT INTO app.defi_pairs (
				id, dex_key, asset0_id, asset1_id,
				asset0_symbol, asset1_symbol, fee_bps,
				reserves_asset0, reserves_asset1, updated_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			ON CONFLICT (id) DO UPDATE SET
				reserves_asset0 = EXCLUDED.reserves_asset0,
				reserves_asset1 = EXCLUDED.reserves_asset1,
				asset0_symbol = COALESCE(NULLIF(EXCLUDED.asset0_symbol, ''), app.defi_pairs.asset0_symbol),
				asset1_symbol = COALESCE(NULLIF(EXCLUDED.asset1_symbol, ''), app.defi_pairs.asset1_symbol),
				updated_at = EXCLUDED.updated_at`,
			p.ID, p.DexKey, p.Asset0ID, p.Asset1ID,
			p.Asset0Symbol, p.Asset1Symbol, p.FeeBps,
			numericOrZero(p.ReservesAsset0), numericOrZero(p.ReservesAsset1), time.Now(),
		)
	}

	br := r.db.SendBatch(ctx, batch)
	defer br.Close()

	for i := 0; i < len(pairs); i++ {
		if _, err := br.Exec(); err != nil {
			return fmt.Errorf("upsert defi pairs: %w", err)
		}
	}
	return nil
}

// UpsertDefiEvents batch inserts DeFi event records.
func (r *Repository) UpsertDefiEvents(ctx context.Context, events []models.DefiEvent) error {
	if len(events) == 0 {
		return nil
	}

	batch := &pgx.Batch{}
	for _, e := range events {
		batch.Queue(`
			INSERT INTO app.defi_events (
				block_height, transaction_id, event_index,
				pair_id, event_type, maker,
				asset0_in, asset0_out, asset1_in, asset1_out,
				price_native, timestamp
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
			ON CONFLICT (block_height, transaction_id, event_index) DO NOTHING`,
			e.BlockHeight, hexToBytes(e.TransactionID), e.EventIndex,
			e.PairID, e.EventType, hexToBytes(e.Maker),
			numericOrZero(e.Asset0In), numericOrZero(e.Asset0Out),
			numericOrZero(e.Asset1In), numericOrZero(e.Asset1Out),
			numericOrZero(e.PriceNative), e.Timestamp,
		)
	}

	br := r.db.SendBatch(ctx, batch)
	defer br.Close()

	for i := 0; i < len(events); i++ {
		if _, err := br.Exec(); err != nil {
			return fmt.Errorf("upsert defi events: %w", err)
		}
	}
	return nil
}

// ListDefiPairs returns defi pairs, optionally filtered by dex_key.
func (r *Repository) ListDefiPairs(ctx context.Context, dexKey string, limit, offset int) ([]models.DefiPair, error) {
	var query string
	var args []interface{}

	if dexKey != "" {
		query = `
			SELECT id, dex_key, asset0_id, asset1_id,
				COALESCE(asset0_symbol, ''), COALESCE(asset1_symbol, ''),
				COALESCE(fee_bps, 0),
				COALESCE(reserves_asset0, 0)::TEXT, COALESCE(reserves_asset1, 0)::TEXT,
				updated_at
			FROM app.defi_pairs
			WHERE dex_key = $1
			ORDER BY updated_at DESC
			LIMIT $2 OFFSET $3`
		args = []interface{}{dexKey, limit, offset}
	} else {
		query = `
			SELECT id, dex_key, asset0_id, asset1_id,
				COALESCE(asset0_symbol, ''), COALESCE(asset1_symbol, ''),
				COALESCE(fee_bps, 0),
				COALESCE(reserves_asset0, 0)::TEXT, COALESCE(reserves_asset1, 0)::TEXT,
				updated_at
			FROM app.defi_pairs
			ORDER BY updated_at DESC
			LIMIT $1 OFFSET $2`
		args = []interface{}{limit, offset}
	}

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list defi pairs: %w", err)
	}
	defer rows.Close()

	var pairs []models.DefiPair
	for rows.Next() {
		var p models.DefiPair
		if err := rows.Scan(
			&p.ID, &p.DexKey, &p.Asset0ID, &p.Asset1ID,
			&p.Asset0Symbol, &p.Asset1Symbol, &p.FeeBps,
			&p.ReservesAsset0, &p.ReservesAsset1, &p.UpdatedAt,
		); err != nil {
			return nil, err
		}
		pairs = append(pairs, p)
	}
	return pairs, rows.Err()
}

// ListDefiEvents returns defi events, optionally filtered by pair_id and/or event_type.
func (r *Repository) ListDefiEvents(ctx context.Context, pairID, eventType string, limit, offset int) ([]models.DefiEvent, error) {
	query := `
		SELECT block_height, encode(transaction_id, 'hex') AS transaction_id,
			event_index, pair_id, event_type,
			COALESCE(encode(maker, 'hex'), '') AS maker,
			COALESCE(asset0_in, 0)::TEXT, COALESCE(asset0_out, 0)::TEXT,
			COALESCE(asset1_in, 0)::TEXT, COALESCE(asset1_out, 0)::TEXT,
			COALESCE(price_native, 0)::TEXT, timestamp
		FROM app.defi_events
		WHERE ($1 = '' OR pair_id = $1)
		  AND ($2 = '' OR event_type = $2)
		ORDER BY block_height DESC, event_index DESC
		LIMIT $3 OFFSET $4`

	rows, err := r.db.Query(ctx, query, pairID, eventType, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list defi events: %w", err)
	}
	defer rows.Close()

	var events []models.DefiEvent
	for rows.Next() {
		var e models.DefiEvent
		if err := rows.Scan(
			&e.BlockHeight, &e.TransactionID, &e.EventIndex,
			&e.PairID, &e.EventType, &e.Maker,
			&e.Asset0In, &e.Asset0Out, &e.Asset1In, &e.Asset1Out,
			&e.PriceNative, &e.Timestamp,
		); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, rows.Err()
}

// GetLatestSwap returns the most recent swap event, optionally for a specific pair.
func (r *Repository) GetLatestSwap(ctx context.Context, pairID string) (*models.DefiEvent, error) {
	query := `
		SELECT block_height, encode(transaction_id, 'hex') AS transaction_id,
			event_index, pair_id, event_type,
			COALESCE(encode(maker, 'hex'), '') AS maker,
			COALESCE(asset0_in, 0)::TEXT, COALESCE(asset0_out, 0)::TEXT,
			COALESCE(asset1_in, 0)::TEXT, COALESCE(asset1_out, 0)::TEXT,
			COALESCE(price_native, 0)::TEXT, timestamp
		FROM app.defi_events
		WHERE event_type = 'Swap'
		  AND ($1 = '' OR pair_id = $1)
		ORDER BY block_height DESC, event_index DESC
		LIMIT 1`

	var e models.DefiEvent
	err := r.db.QueryRow(ctx, query, pairID).Scan(
		&e.BlockHeight, &e.TransactionID, &e.EventIndex,
		&e.PairID, &e.EventType, &e.Maker,
		&e.Asset0In, &e.Asset0Out, &e.Asset1In, &e.Asset1Out,
		&e.PriceNative, &e.Timestamp,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, fmt.Errorf("get latest swap: %w", err)
	}
	return &e, nil
}

// GetDefiLatestBlock returns the latest block height in defi_events.
func (r *Repository) GetDefiLatestBlock(ctx context.Context) (uint64, error) {
	var height uint64
	err := r.db.QueryRow(ctx, `SELECT COALESCE(MAX(block_height), 0) FROM app.defi_events`).Scan(&height)
	if err != nil {
		return 0, fmt.Errorf("get defi latest block: %w", err)
	}
	return height, nil
}

// ListDefiAssets returns unique assets from defi_pairs.
func (r *Repository) ListDefiAssets(ctx context.Context) ([]DefiAsset, error) {
	rows, err := r.db.Query(ctx, `
		SELECT DISTINCT asset_id, asset_symbol FROM (
			SELECT asset0_id AS asset_id, COALESCE(asset0_symbol, '') AS asset_symbol FROM app.defi_pairs
			UNION
			SELECT asset1_id AS asset_id, COALESCE(asset1_symbol, '') AS asset_symbol FROM app.defi_pairs
		) sub
		ORDER BY asset_id`)
	if err != nil {
		return nil, fmt.Errorf("list defi assets: %w", err)
	}
	defer rows.Close()

	var assets []DefiAsset
	for rows.Next() {
		var a DefiAsset
		if err := rows.Scan(&a.ID, &a.Symbol); err != nil {
			return nil, err
		}
		assets = append(assets, a)
	}
	return assets, rows.Err()
}

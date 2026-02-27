package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type MarketPrice struct {
	Asset          string
	Currency       string
	Price          float64
	PriceChange24h float64
	MarketCap      float64
	Source         string
	AsOf           time.Time
	CreatedAt      time.Time
}

func (r *Repository) InsertMarketPrice(ctx context.Context, p MarketPrice) error {
	asset := strings.ToUpper(strings.TrimSpace(p.Asset))
	currency := strings.ToUpper(strings.TrimSpace(p.Currency))

	_, err := r.db.Exec(ctx, `
		INSERT INTO app.market_prices (
			asset, currency, price, price_change_24h, market_cap, source, as_of, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
	`, asset, currency, p.Price, p.PriceChange24h, p.MarketCap, p.Source, p.AsOf)
	return err
}

func (r *Repository) GetLatestMarketPrice(ctx context.Context, asset, currency string) (*MarketPrice, error) {
	var p MarketPrice
	err := r.db.QueryRow(ctx, `
		SELECT asset, currency, price, price_change_24h, market_cap, source, as_of, created_at
		FROM app.market_prices
		WHERE UPPER(asset) = UPPER($1) AND UPPER(currency) = UPPER($2)
		ORDER BY as_of DESC
		LIMIT 1
	`, asset, currency).Scan(
		&p.Asset, &p.Currency, &p.Price, &p.PriceChange24h, &p.MarketCap, &p.Source, &p.AsOf, &p.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// GetMarketPriceHistory returns up to `limit` recent price records, sampled
// to roughly one per hour when data is dense (10-min polling).
func (r *Repository) GetMarketPriceHistory(ctx context.Context, asset, currency string, limit int) ([]MarketPrice, error) {
	if limit <= 0 || limit > 8760 {
		limit = 168 // 7 days of hourly data
	}
	rows, err := r.db.Query(ctx, `
		SELECT asset, currency, price, price_change_24h, market_cap, source, as_of, created_at
		FROM (
			SELECT *
			FROM (
				SELECT asset, currency, price, price_change_24h, market_cap, source, as_of, created_at,
					ROW_NUMBER() OVER (PARTITION BY DATE_TRUNC('hour', as_of) ORDER BY as_of DESC) AS rn
				FROM app.market_prices
				WHERE UPPER(asset) = UPPER($1) AND UPPER(currency) = UPPER($2)
			) sampled
			WHERE rn = 1
			ORDER BY as_of DESC
			LIMIT $3
		) latest
		ORDER BY as_of ASC
	`, asset, currency, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var prices []MarketPrice
	for rows.Next() {
		var p MarketPrice
		if err := rows.Scan(&p.Asset, &p.Currency, &p.Price, &p.PriceChange24h, &p.MarketCap, &p.Source, &p.AsOf, &p.CreatedAt); err != nil {
			return nil, err
		}
		prices = append(prices, p)
	}
	return prices, nil
}

// GetEarliestMarketPrice returns the oldest price record for the given asset/currency pair.
func (r *Repository) GetEarliestMarketPrice(ctx context.Context, asset, currency string) (*MarketPrice, error) {
	var p MarketPrice
	err := r.db.QueryRow(ctx, `
		SELECT asset, currency, price, price_change_24h, market_cap, source, as_of, created_at
		FROM app.market_prices
		WHERE UPPER(asset) = UPPER($1) AND UPPER(currency) = UPPER($2)
		ORDER BY as_of ASC
		LIMIT 1
	`, asset, currency).Scan(
		&p.Asset, &p.Currency, &p.Price, &p.PriceChange24h, &p.MarketCap, &p.Source, &p.AsOf, &p.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// BulkInsertMarketPrices inserts multiple price records, skipping any that
// would duplicate an existing record for the same (asset, currency, day).
func (r *Repository) BulkInsertMarketPrices(ctx context.Context, prices []MarketPrice) (int64, error) {
	if len(prices) == 0 {
		return 0, nil
	}

	var total int64
	for _, p := range prices {
		asset := strings.ToUpper(strings.TrimSpace(p.Asset))
		currency := strings.ToUpper(strings.TrimSpace(p.Currency))

		tag, err := r.db.Exec(ctx, `
			INSERT INTO app.market_prices (
				asset, currency, price, price_change_24h, market_cap, source, as_of, created_at
			)
			SELECT $1, $2, $3, $4, $5, $6, $7, NOW()
			WHERE NOT EXISTS (
				SELECT 1 FROM app.market_prices
				WHERE asset = $1 AND currency = $2
				  AND CAST(as_of AT TIME ZONE 'UTC' AS DATE) = CAST($7::timestamptz AT TIME ZONE 'UTC' AS DATE)
			)
		`, asset, currency, p.Price, p.PriceChange24h, p.MarketCap, p.Source, p.AsOf)
		if err != nil {
			return total, fmt.Errorf("insert market price at %v: %w", p.AsOf, err)
		}
		total += tag.RowsAffected()
	}

	return total, nil
}

func (r *Repository) GetDistinctPriceAssets(ctx context.Context) ([]string, error) {
	rows, err := r.db.Query(ctx, `SELECT DISTINCT UPPER(asset) FROM app.market_prices ORDER BY 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var assets []string
	for rows.Next() {
		var a string
		if err := rows.Scan(&a); err != nil {
			return nil, err
		}
		assets = append(assets, a)
	}
	return assets, nil
}

func (r *Repository) GetDistinctMarketSymbols(ctx context.Context) ([]string, error) {
	rows, err := r.db.Query(ctx, `
		SELECT DISTINCT market_symbol FROM app.ft_tokens
		WHERE market_symbol IS NOT NULL AND market_symbol != ''
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var symbols []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		symbols = append(symbols, s)
	}
	return symbols, nil
}

// GetCoingeckoToMarketSymbolMap returns a map of coingecko_id -> market_symbol
// so DeFi Llama prices can be stored under the correct asset name.
func (r *Repository) GetCoingeckoToMarketSymbolMap(ctx context.Context) (map[string]string, error) {
	rows, err := r.db.Query(ctx, `
		SELECT DISTINCT coingecko_id, market_symbol FROM app.ft_tokens
		WHERE coingecko_id IS NOT NULL AND coingecko_id != ''
		  AND market_symbol IS NOT NULL AND market_symbol != ''
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := make(map[string]string)
	for rows.Next() {
		var cgID, sym string
		if err := rows.Scan(&cgID, &sym); err != nil {
			return nil, err
		}
		m[cgID] = sym
	}
	return m, nil
}

// GetContractNameToMarketSymbolMap returns a map of contract_name -> market_symbol
// for all FT tokens that have a market_symbol set.
func (r *Repository) GetContractNameToMarketSymbolMap(ctx context.Context) (map[string]string, error) {
	rows, err := r.db.Query(ctx, `
		SELECT contract_name, market_symbol FROM app.ft_tokens
		WHERE market_symbol IS NOT NULL AND market_symbol != ''
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := make(map[string]string)
	for rows.Next() {
		var cn, ms string
		if err := rows.Scan(&cn, &ms); err != nil {
			return nil, err
		}
		m[cn] = ms
	}
	return m, nil
}

func IsNoRows(err error) bool {
	return err == pgx.ErrNoRows
}

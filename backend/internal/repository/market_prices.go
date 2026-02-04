package repository

import (
	"context"
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
	_, err := r.db.Exec(ctx, `
		INSERT INTO app.market_prices (
			asset, currency, price, price_change_24h, market_cap, source, as_of, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
	`, p.Asset, p.Currency, p.Price, p.PriceChange24h, p.MarketCap, p.Source, p.AsOf)
	return err
}

func (r *Repository) GetLatestMarketPrice(ctx context.Context, asset, currency string) (*MarketPrice, error) {
	var p MarketPrice
	err := r.db.QueryRow(ctx, `
		SELECT asset, currency, price, price_change_24h, market_cap, source, as_of, created_at
		FROM app.market_prices
		WHERE asset = $1 AND currency = $2
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

func IsNoRows(err error) bool {
	return err == pgx.ErrNoRows
}


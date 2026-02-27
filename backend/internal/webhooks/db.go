package webhooks

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type WebhookDB struct {
	Pool *pgxpool.Pool
}

func NewWebhookDB(dbURL string) (*WebhookDB, error) {
	if dbURL == "" {
		return nil, fmt.Errorf("SUPABASE_DB_URL is required for webhook system")
	}

	config, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		return nil, fmt.Errorf("parse supabase db url: %w", err)
	}

	config.MaxConns = 20
	config.MinConns = 2
	config.MaxConnLifetime = 30 * time.Minute
	config.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil, fmt.Errorf("connect to supabase db: %w", err)
	}

	return &WebhookDB{Pool: pool}, nil
}

func (db *WebhookDB) Close() {
	db.Pool.Close()
}

func (db *WebhookDB) Migrate(schemaSQL string) error {
	_, err := db.Pool.Exec(context.Background(), schemaSQL)
	return err
}

package repository

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(dbURL string) (*Repository, error) {
	config, err := pgxpool.ParseConfig(dbURL)
	if err != nil {
		return nil, fmt.Errorf("unable to parse db url: %w", err)
	}

	// Apply Pool Settings
	if maxConnStr := os.Getenv("DB_MAX_OPEN_CONNS"); maxConnStr != "" {
		if maxConn, err := strconv.Atoi(maxConnStr); err == nil {
			config.MaxConns = int32(maxConn)
		}
	}
	if minConnStr := os.Getenv("DB_MAX_IDLE_CONNS"); minConnStr != "" {
		if minConn, err := strconv.Atoi(minConnStr); err == nil {
			config.MinConns = int32(minConn)
		}
	}

	// Prevent stale connections from surviving across deployments.
	// MaxConnLifetime ensures connections are recycled periodically.
	config.MaxConnLifetime = 30 * time.Minute
	config.MaxConnIdleTime = 5 * time.Minute

	// Set per-connection PostgreSQL parameters to auto-kill orphaned queries/transactions.
	// - statement_timeout: kill any single query that runs longer than 5 minutes
	// - idle_in_transaction_session_timeout: kill connections idle inside a transaction
	//   for more than 2 minutes (prevents lock-holding ghosts after deploys)
	if config.ConnConfig.RuntimeParams == nil {
		config.ConnConfig.RuntimeParams = map[string]string{}
	}
	if _, ok := config.ConnConfig.RuntimeParams["statement_timeout"]; !ok {
		config.ConnConfig.RuntimeParams["statement_timeout"] = getEnvDefault("DB_STATEMENT_TIMEOUT", "300000") // 5 min
	}
	if _, ok := config.ConnConfig.RuntimeParams["idle_in_transaction_session_timeout"]; !ok {
		config.ConnConfig.RuntimeParams["idle_in_transaction_session_timeout"] = getEnvDefault("DB_IDLE_TX_TIMEOUT", "120000") // 2 min
	}

	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil, fmt.Errorf("unable to connect to database: %w", err)
	}

	repo := &Repository{db: pool}
	if err := repo.ensureScriptTemplatesSchema(context.Background()); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ensure script_templates schema: %w", err)
	}
	return repo, nil
}

func getEnvDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func (r *Repository) Migrate(schemaPath string) error {
	content, err := os.ReadFile(schemaPath)
	if err != nil {
		return fmt.Errorf("failed to read schema file: %w", err)
	}

	// Execute the entire schema script
	_, err = r.db.Exec(context.Background(), string(content))
	if err != nil {
		return fmt.Errorf("failed to execute schema: %w", err)
	}
	return nil
}

func (r *Repository) Close() {
	r.db.Close()
}

// TerminateIdleConnections kills non-active connections from previous backend instances
// that may hold locks and block DDL in migrations. Returns the number terminated.
func (r *Repository) TerminateIdleConnections(ctx context.Context) (int, error) {
	var count int
	err := r.db.QueryRow(ctx, `
		SELECT count(*) FROM (
			SELECT pg_terminate_backend(pid)
			FROM pg_stat_activity
			WHERE datname = current_database()
			  AND pid <> pg_backend_pid()
			  AND state != 'active'
		) t
	`).Scan(&count)
	return count, err
}

func (r *Repository) ensureScriptTemplatesSchema(ctx context.Context) error {
	const ddl = `
		CREATE TABLE IF NOT EXISTS app.script_templates (
			script_hash     VARCHAR(64) PRIMARY KEY,
			normalized_hash VARCHAR(64),
			category        TEXT,
			label           TEXT,
			description     TEXT,
			tx_count        BIGINT NOT NULL DEFAULT 0,
			created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

		CREATE INDEX IF NOT EXISTS idx_script_templates_normalized_hash
			ON app.script_templates (normalized_hash);

		CREATE INDEX IF NOT EXISTS idx_script_templates_tx_count_desc
			ON app.script_templates (tx_count DESC);

		CREATE INDEX IF NOT EXISTS idx_script_templates_category
			ON app.script_templates (category);

		CREATE INDEX IF NOT EXISTS idx_script_templates_group_key
			ON app.script_templates ((COALESCE(normalized_hash, script_hash)));
	`
	_, err := r.db.Exec(ctx, ddl)
	return err
}

// GetLastIndexedHeight gets the last sync height from checkpoints
func (r *Repository) GetLastIndexedHeight(ctx context.Context, serviceName string) (uint64, error) {
	var height uint64
	err := r.db.QueryRow(ctx, "SELECT last_height FROM app.indexing_checkpoints WHERE service_name = $1", serviceName).Scan(&height)
	if err == pgx.ErrNoRows {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return height, nil
}

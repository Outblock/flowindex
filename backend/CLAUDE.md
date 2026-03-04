# Backend — FlowIndex Indexer + API Server

> Part of the [FlowIndex](../CLAUDE.md) monorepo. See root CLAUDE.md for full architecture and deployment details.

## Overview

Go 1.24+ service that indexes the Flow blockchain and serves a REST/WebSocket API. Uses PostgreSQL (pgx), Flow SDK, and Gorilla Mux/WebSocket.

## Structure

```
backend/
├── main.go                    # Entry point — ingesters, derivers, workers, API server
├── internal/
│   ├── api/server.go          # REST + WebSocket endpoints
│   ├── ingester/              # Forward (live) + Backward (history) block ingestion
│   ├── repository/postgres.go # Data layer (pgx CopyFrom for bulk inserts)
│   ├── flow/                  # Flow SDK wrappers, spork-aware access nodes
│   ├── models/models.go       # All Go structs
│   ├── eventbus/              # Internal event bus for webhooks
│   ├── webhooks/              # Webhook delivery (Svix + HTTP + Discord/Slack)
│   └── market/                # CoinGecko price feed
├── schema_v2.sql              # Main database schema (auto-migrated on startup)
├── schema_webhooks.sql        # Webhook tables
├── docs/openapi.yaml          # OpenAPI spec (consumed by frontend gen:api)
└── cmd/archive-import/        # Separate Go module for archive data import
```

## Commands

```bash
# Install deps
go mod download && go mod tidy

# Build
CGO_CFLAGS="-std=gnu99" CGO_ENABLED=1 go build -o indexer main.go

# Run (requires PostgreSQL)
DB_URL=postgres://flowscan:secretpassword@localhost:5432/flowscan \
FLOW_ACCESS_NODE=access-001.mainnet28.nodes.onflow.org:9000 \
PORT=8080 ./indexer

# Run migrations only
./indexer migrate

# Tests
go test ./...
```

## Key Patterns

- **Dual Ingester**: Forward (live, ascending, broadcasts via WebSocket) + Backward (history backfill, descending)
- **Derivers**: LiveDerivers / HistoryDerivers process tokens, accounts, etc. from raw blocks
- **Workers**: 17 async worker types (token, evm, staking, defi, etc.) with lease-based concurrency
- **EVM detection**: `import EVM` in transaction scripts → sets `is_evm`, stores in `evm_transactions`
- **Spork-aware**: `FLOW_HISTORIC_ACCESS_NODES` for per-spork history backfill

## API Routes

- Base: `/health`, `/status`, `/blocks`, `/transactions`, `/accounts/{address}`
- V1: `/flow/v1/...` (also at `/api/v1/flow/v1/...`)
- WebSocket: `/ws` for live updates

## Schema Conventions

- Addresses: lowercase hex without `0x` prefix
- EVM hashes: lowercase without `0x` in `raw.tx_lookup.evm_hash`
- Timestamps: `TIMESTAMPTZ`
- Complex data: JSONB columns

## Gotchas

- **NUMERIC + empty strings**: Use `numericOrZero()` for Cadence event fields that may return `""`
- **Schema migrations**: `CREATE TABLE IF NOT EXISTS` doesn't modify existing tables — pair with `ALTER TABLE ADD COLUMN IF NOT EXISTS`
- **ALTER TABLE before CREATE INDEX** if index references new columns
- **Dead worker leases**: Fix stuck FAILED leases with `DELETE FROM app.worker_leases WHERE worker_type = 'xxx' AND status = 'FAILED'`

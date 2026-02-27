<p align="center">
  <img src="docs/assets/logo.png" alt="FlowIndex Logo" width="80" />
</p>

<h1 align="center">FlowIndex</h1>

<p align="center">
  A high-performance blockchain explorer and indexer for the <a href="https://flow.com">Flow blockchain</a>, with Flow-EVM support.<br/>
  Think Etherscan/Blockscout, but for Flow.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#api">API Docs</a> &middot;
  <a href="#contributing">Contributing</a> &middot;
  <a href="LICENSE">MIT License</a>
</p>

---

## Screenshots

<table>
  <tr>
    <td><b>Dashboard</b></td>
    <td><b>Analytics</b></td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/homepage.png" alt="Homepage" width="480" /></td>
    <td><img src="docs/assets/screenshots/analytics.png" alt="Analytics" width="480" /></td>
  </tr>
  <tr>
    <td><b>Transaction Detail</b></td>
    <td><b>Account Detail</b></td>
  </tr>
  <tr>
    <td><img src="docs/assets/screenshots/transaction.png" alt="Transaction" width="480" /></td>
    <td><img src="docs/assets/screenshots/account.png" alt="Account" width="480" /></td>
  </tr>
</table>

## Features

- **Full-history indexing** — dual ingester pattern: live head-tracking + historical backfill running in parallel
- **Spork-aware** — routes RPC calls to the correct access node for each Flow spork (including legacy candidate sporks)
- **Flow-EVM support** — detects and indexes EVM transactions, extracts EVM hashes, addresses, and gas data
- **12 async workers** — token transfers, NFT ownership, staking events, DeFi positions, account keys, contract metadata, and more
- **Atomic batch processing** — complete block data inserted in a single PostgreSQL transaction, no partial states
- **Script de-duplication** — transaction scripts stored via `sha256` hash to reduce long-term storage growth
- **REST + WebSocket API** — cursor-paginated endpoints with live block/transaction streaming
- **OpenAPI spec** — full API documentation with Scalar UI via the developer portal
- **React frontend** — responsive UI built with React 19, TailwindCSS, Shadcn/UI, and Recharts

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Flow Access Nodes                   │
│   candidate7-9 / mainnet1-28 / archive node     │
└────────────────────┬────────────────────────────┘
                     │ gRPC
┌────────────────────▼────────────────────────────┐
│              Go Backend                          │
│                                                  │
│  ┌──────────────┐  ┌──────────────┐             │
│  │   Forward     │  │   Backward   │             │
│  │   Ingester    │  │   Ingester   │             │
│  │  (live head)  │  │  (backfill)  │             │
│  └──────┬───────┘  └──────┬───────┘             │
│         │                  │                     │
│  ┌──────▼──────────────────▼───────┐            │
│  │       Worker Pool (12 types)     │            │
│  │  token · evm · meta · staking   │            │
│  │  nft · defi · accounts · ...    │            │
│  └──────────────┬──────────────────┘            │
│                 │                                │
│  ┌──────────────▼──────────────────┐            │
│  │     REST API + WebSocket         │            │
│  └──────────────────────────────────┘            │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│           PostgreSQL (partitioned)                │
│  raw.blocks · raw.transactions · raw.events      │
│  app.token_transfers · app.staking_events · ...  │
└──────────────────────────────────────────────────┘
```

## Quick Start

### Docker Compose (recommended)

```bash
git clone https://github.com/Outblock/flowindex.git
cd flowindex
docker compose up -d --build
```

| Service    | URL                      |
|------------|--------------------------|
| Frontend   | http://localhost:5173     |
| Backend    | http://localhost:8080     |
| PostgreSQL | localhost:5432            |

### Manual Setup

**Prerequisites:** Go 1.24+, Node.js 20+ (or Bun), PostgreSQL 16+

```bash
# Backend
cd backend
export DB_URL="postgres://flowscan:secretpassword@localhost:5432/flowscan"
export FLOW_ACCESS_NODE="access-001.mainnet28.nodes.onflow.org:9000"
go run main.go

# Frontend (separate terminal)
cd frontend
bun install   # or npm install
bun run dev   # or npm run dev
```

The backend auto-runs schema migrations on first startup.

## Project Structure

```
backend/              Go indexer + REST/WebSocket API
  internal/
    api/              HTTP handlers, WebSocket, middleware
    flow/             Flow SDK client wrapper
    ingester/         Block ingestion pipeline + worker pool
    repository/       PostgreSQL repository layer
    market/           Price feed integration
  cmd/tools/          CLI tools (backfill, repair)
  schema_v2.sql       Database schema

frontend/             React (Vite) UI
  src/
    pages/            Route pages (Home, Block, Tx, Account)
    components/       UI components + Shadcn/UI
    hooks/            Custom hooks (WebSocket, etc.)
    api.js            API client

devportal/            Developer portal (Fumadocs + Scalar)
ai/chat/              AI chat assistant
docs/                 Architecture docs, operation guides
openapi-v1.json       OpenAPI v1 spec
openapi-v2.json       OpenAPI v2 spec
```

## Configuration

See [`backend/README.md`](backend/README.md) for the full environment variable reference.

Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_URL` | `postgres://flowscan:secretpassword@localhost:5432/flowscan` | PostgreSQL connection string |
| `FLOW_ACCESS_NODE` | `access-001.mainnet28.nodes.onflow.org:9000` | Flow gRPC endpoint |
| `FLOW_HISTORIC_ACCESS_NODES` | — | Comma-separated historic spork nodes for backfill |
| `PORT` | `8080` | API server port |
| `LATEST_WORKER_COUNT` | `2` | Live ingester concurrency |
| `HISTORY_WORKER_COUNT` | `5` | History backfill concurrency |
| `ENABLE_HISTORY_INGESTER` | `true` | Enable/disable historical backfill |

## Deployment

A GitHub Actions workflow template is included at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) for deploying to GCP (Compute Engine + Artifact Registry + Cloud Run). Update the placeholder values at the top of the file to match your infrastructure.

The application can also be deployed to any Docker-capable platform (Railway, Fly.io, AWS ECS, etc.) using the Dockerfiles in `backend/` and `frontend/`.

## API

The backend serves a REST API with cursor-based pagination. Key endpoints:

- `GET /blocks` — list blocks
- `GET /blocks/:id` — block detail
- `GET /transactions` — list transactions
- `GET /transactions/:id` — transaction detail
- `GET /accounts/:address` — account overview
- `GET /accounts/:address/transactions` — account transaction history
- `GET /accounts/:address/tokens` — token balances
- `WS /ws` — live block and transaction stream

Full OpenAPI specs: [`openapi-v1.json`](openapi-v1.json), [`openapi-v2.json`](openapi-v2.json)

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run tests (`cd backend && go test ./...`)
5. Submit a pull request

## License

[MIT](LICENSE) &copy; [Outblock PTY LTD](https://github.com/Outblock)

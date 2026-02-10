# AGENTS.md

Instructions for coding agents (and humans) working in this repository.

## Repo Overview
- `backend/`: Go indexer + REST/WS API
- `frontend/`: React (Vite) UI
- `docs/`: architecture, operations, status docs

This project is a Flow blockchain explorer (Etherscan/Blockscout-like) optimized for:
- high-throughput ingest (live + history),
- resumable derived workers,
- long-term storage growth control.

## Quick Start

Local (recommended):
```bash
docker compose up -d --build
```

Dev ports:
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8080`

## Tooling
- Use `bun` for frontend dependency install, scripts, and generation (not `npm`).

## Conventions (Important)
- **Addresses** in DB are stored normalized as lowercase hex without `0x` (e.g. `18eb4ee6b3c026d2`).
- **EVM hashes** are stored lowercase without `0x` in `raw.tx_lookup.evm_hash`.
- **Partitioned tables**: do not introduce queries that force cross-partition scans by `id` unless a lookup table exists.

## Key Architecture Decisions

### Spork-Aware History Backfill
Flow access nodes only serve blocks for the current spork. For full history you must configure:
- `FLOW_ACCESS_NODES` for live ingestion
- `FLOW_HISTORIC_ACCESS_NODES` for history ingestion across sporks

The ingester pins all RPC calls for a height to a single node to keep `block -> collection -> tx/result` consistent.

### Account Keys State
`app.account_keys` models key state and supports revocations:
- Primary key: `(address, key_index)`
- Index: `(public_key)` and `(public_key) WHERE revoked=false`

`flow.AccountKeyRemoved` payloads often do not include full public key bytes, so revocations must be applied by `(address, key_index)`.

### Script Storage De-dup
To reduce long-term DB growth:
- `raw.transactions.script_hash` stores `sha256(script)`
- `raw.scripts` stores `script_hash -> script_text`
- `raw.transactions.script` is optional and can be capped with `TX_SCRIPT_INLINE_MAX_BYTES`

## Docs
- Architecture: `docs/architecture/ARCHITECTURE.md`
- Env var list: `docs/operations/deploy-env.md`
- Railway runbook: `docs/operations/railway-runbook.md`
- Status tracking: `docs/status/project-status.md`

## Security / Open Source Hygiene
- Do **not** commit secrets (DB URLs, API keys, Railway variables, whitelisted node lists tied to private infra).
- Use `docs/operations/railway.env.example` for templates and keep it placeholder-only.

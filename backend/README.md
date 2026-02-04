# FlowScan Backend

Indexer + API server for FlowScan. Includes live sync, history backfill, derived workers, and REST/WS API.

## Local Dev
```bash
go run ./main.go
```

By default it will:
- connect to `postgres://flowscan:secretpassword@localhost:5432/flowscan`
- use Flow access node `access-001.mainnet28.nodes.onflow.org:9000`
- auto-run `schema_v2.sql` migration on startup

## Environment Variables (Backend)
Core:
| Variable | Default | Purpose |
| --- | --- | --- |
| `DB_URL` | `postgres://flowscan:secretpassword@localhost:5432/flowscan` | Postgres connection string |
| `FLOW_ACCESS_NODE` | `access-001.mainnet28.nodes.onflow.org:9000` | Single Flow access node |
| `FLOW_ACCESS_NODES` | fallback to `FLOW_ACCESS_NODE` | Comma/space separated list of access nodes |
| `FLOW_HISTORIC_ACCESS_NODES` | unset | Optional comma/space separated historic spork nodes for history backfill |
| `FLOW_ARCHIVE_NODE` | `archive.mainnet.nodes.onflow.org:9000` | Default archive node appended to the historic pool (safety net across sporks) |
| `PORT` | `8080` | HTTP server port |
| `START_BLOCK` | `0` | History backfill start height |

Ingest / Worker:
| Variable | Default | Purpose |
| --- | --- | --- |
| `LATEST_WORKER_COUNT` | `2` | Live ingester workers |
| `HISTORY_WORKER_COUNT` | `5` | History ingester workers |
| `LATEST_BATCH_SIZE` | `1` | Live ingest batch size |
| `HISTORY_BATCH_SIZE` | `20` | History backfill batch size |
| `MAX_REORG_DEPTH` | `1000` | Reorg safety window |
| `ENABLE_HISTORY_INGESTER` | `true` | Enable history backfill |
| `ENABLE_TOKEN_WORKER` | `true` | Enable token worker |
| `TOKEN_WORKER_RANGE` | `50000` | Token worker lease range |
| `TOKEN_WORKER_CONCURRENCY` | `1` | Token worker concurrency |
| `ENABLE_META_WORKER` | `true` | Enable meta worker |
| `META_WORKER_RANGE` | `50000` | Meta worker lease range |
| `META_WORKER_CONCURRENCY` | `1` | Meta worker concurrency |
| `ENABLE_DERIVED_WRITES` | `false` | Enable app.* partition ensure during raw ingest |
| `TX_SCRIPT_INLINE_MAX_BYTES` | `0` | If >0, store `raw.transactions.script` inline only when <= this size (otherwise NULL + `raw.scripts`) |

Rate Limiting:
| Variable | Default | Purpose |
| --- | --- | --- |
| `FLOW_RPC_RPS_PER_NODE` | unset | RPS per access node |
| `FLOW_RPC_BURST_PER_NODE` | unset | Burst per access node |
| `FLOW_RPC_RPS` | `5` | Total RPS if per-node not set |
| `FLOW_RPC_BURST` | `FLOW_RPC_RPS` | Burst if per-node not set |

API Rate Limiting:
| Variable | Default | Purpose |
| --- | --- | --- |
| `API_RATE_LIMIT_RPS` | `10` | Per-IP API requests per second |
| `API_RATE_LIMIT_BURST` | `20` | Per-IP burst capacity |
| `API_RATE_LIMIT_TTL_MIN` | `15` | How long to keep inactive IP buckets in memory |

Maintenance / Jobs:
| Variable | Default | Purpose |
| --- | --- | --- |
| `ENABLE_DAILY_STATS` | `true` | Aggregate daily stats |
| `ENABLE_LOOKUP_REPAIR` | `false` | Repair block/tx lookup tables |
| `LOOKUP_REPAIR_LIMIT` | `1000` | Max rows per repair run |
| `LOOKUP_REPAIR_INTERVAL_MIN` | `10` | Repair interval in minutes |
| `ENABLE_PRICE_FEED` | `true` | Persist Flow price to DB |
| `PRICE_REFRESH_MIN` | `10` | Price refresh interval (minutes) |
| `ENABLE_LIVE_ADDRESS_BACKFILL` | `true` | One-shot backfill of `app.address_transactions` near the head on startup |
| `LIVE_ADDRESS_BACKFILL_BLOCKS` | `META_WORKER_RANGE` | How many recent blocks to backfill into `app.address_transactions` |
| `LIVE_ADDRESS_BACKFILL_CHUNK` | `5000` | Chunk size (blocks) for the one-shot backfill job |

DB Pool:
| Variable | Default | Purpose |
| --- | --- | --- |
| `DB_MAX_OPEN_CONNS` | pgx default | Max open connections |
| `DB_MAX_IDLE_CONNS` | pgx default | Min idle connections |

## Notes
- `app.market_prices` stores Flow price quotes and powers `/stats/network` to reduce external API calls.
- Daily stats aggregate by `raw.transactions.timestamp` (chain time), not by insert time.
- `app.account_keys` is keyed by `(address, key_index)` and is derived from `flow.AccountKeyAdded`/`flow.AccountKeyRemoved`.

## OpenAPI
- Spec: `backend/docs/openapi.yaml`
- Served by backend:
  - `GET /openapi.yaml`
  - `GET /openapi.json`

## Account Storage (Cadence v1)
The backend executes Cadence v1 scripts (JSON-CDC) via the Flow Access API to expose account storage paths and best-effort inspection:
- `GET /accounts/{address}/storage`
- `GET /accounts/{address}/storage/links?domain=public`
- `GET /accounts/{address}/storage/item?path=<identifier>`

Notes:
- Cadence v1 removed the legacy `private` path domain; only `storage` and `public` remain.

## Tools

### Backfill Account Keys (from existing `raw.events`)
If `app.account_keys` is empty or you changed the parsing/schema, you can backfill from already-ingested events:

```bash
cd backend
export DB_URL="postgres://..."
go run ./cmd/tools/backfill_account_keys --start <min_height> --end <max_height>
```

# Railway Runbook (FlowScan)

**Goal:** validate raw ingestion on Railway first, then enable derived workers.

## 1) Raw-Only Validation
1. Set Railway env vars from `docs/operations/railway.env.example`.
2. Deploy (preferred: Railway CLI from repo root):
   - `railway up --service backend --detach`
   - `railway up --service frontend --detach`
   - `railway up --service docs --detach`
3. Generate a domain for the docs service and wire it into the frontend footer:
   - `railway domain --service docs --port 8080`
   - `railway variable set --service frontend DOCS_URL=https://<docs-domain>`
   - `railway service redeploy --service frontend --yes`
4. Verify:
   - `GET /health` returns `{"status":"ok"}`
   - `GET /status` shows `indexed_height` moving upward
5. Let it run 10-30 minutes. Confirm no error loops.

## 2) Enable Derived Workers (Incrementally)
Turn on in this order, one at a time:
1. `ENABLE_META_WORKER=true`
2. `ENABLE_TOKEN_WORKER=true`
3. (Optional) `ENABLE_DAILY_STATS=true`
4. (Optional) `ENABLE_LOOKUP_REPAIR=true`

After each step:
- Watch logs for errors.
- Check `/accounts/:address/transactions` and `/accounts/:address/stats` once MetaWorker is on.
- Check `/accounts/:address/token-transfers` once TokenWorker is on.

## 3) Scale Up
When stable:
- Increase `LATEST_WORKER_COUNT` and `LATEST_BATCH_SIZE`.
- Consider enabling `ENABLE_HISTORY_INGESTER=true` for backfill.
- Increase DB/RAM as needed.

## 4) Common Troubleshooting
- **No partition for height**: ensure you are using `schema_v2.sql` and new partition manager is in place.
- **RPC rate limits**: reduce `FLOW_RPC_RPS` / `FLOW_RPC_BURST`.
- **Derived lag**: reduce worker `RANGE_SIZE` or scale workers horizontally.
- **History stuck at spork root**: set `FLOW_HISTORIC_ACCESS_NODES` to include older spork endpoints and redeploy.
- **`app.account_keys` empty after schema/parsing changes**: run `go run ./cmd/tools/backfill_account_keys` against your DB once.

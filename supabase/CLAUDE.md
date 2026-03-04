# Supabase — Self-Hosted Auth Stack

> Part of the [FlowIndex](../CLAUDE.md) monorepo. See root CLAUDE.md for full architecture and deployment details.

## Overview

Self-hosted Supabase stack providing auth (GoTrue), REST API (PostgREST), and edge functions. Runs as Docker containers on the backend VM.

## Structure

```
supabase/
├── functions/
│   ├── passkey-auth/       # WebAuthn/passkey authentication (port 8101)
│   ├── flow-keys/          # Flow key management (port 8102)
│   ├── runner-projects/    # Runner project management (port 8103)
│   └── Dockerfile          # Edge function container
├── gateway/                # nginx gateway config (port 54321)
├── migrations/             # SQL migrations
└── run-migrations.sh       # Migration runner (tracks in public.edge_migrations)
```

## Deployment

- **Gateway**: nginx on backend VM port 54321 (supabase-gateway container, `--network=host`)
- **Edge functions**: Each runs as a separate container on `--network=host`
- **Caddy routing**: `run.flowindex.io` routes `/functions/v1/*`, `/auth/v1/*`, `/rest/v1/*` to gateway

## Gotchas

- Migrations tracked in `public.edge_migrations` table
- `run-migrations.sh` must be executed with `bash` (COS doesn't preserve execute bits via scp)
- `VITE_SUPABASE_URL` is baked into runner image at build time

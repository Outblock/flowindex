# Sim Workflow Integration

This project now deploys Sim Studio from in-repo source (`sim-workflow/`) with in-app auth integration.

## Goals

- Use team-maintained Sim Studio images built from repository source instead of `ghcr.io/simstudioai/simstudio:latest`.
- Trust FlowIndex Supabase auth (`fi_auth` JWT) inside Sim Studio app code.
- Remove `DISABLE_AUTH=true` and remove external `sim-studio-auth` nginx proxy.
- Seed workspace/MCP/default workflow at startup from SQL.
- Ship Flow/Cadence onchain event nodes as versioned seeded custom tools.

## Source layout

Sim Studio source now lives in-repo at `sim-workflow/`.

CI builds images directly from that directory (no runtime upstream clone or patch apply).

## Required source changes

The deployment is ready for these app-side env vars:

- `FLOWINDEX_AUTH_MODE=supabase_cookie`
- `SUPABASE_URL`
- `SUPABASE_JWT_SECRET`

`sim-workflow` should read `fi_auth` cookie, verify JWT with `SUPABASE_JWT_SECRET`, and map user identity to Sim session.

## Deploy configuration

Set these in `/mnt/stateful_partition/pgdata/sim-studio.env` on `flowindex-backend`:

- `SIM_STUDIO_IMAGE` (default: `us-central1-docker.pkg.dev/flowindex-mainnet/flowindex/simstudio-fork:latest`)
- `SIM_STUDIO_REALTIME_IMAGE` (default: `us-central1-docker.pkg.dev/flowindex-mainnet/flowindex/simstudio-fork-realtime:latest`)
- `SIM_STUDIO_MIGRATIONS_IMAGE` (default: `us-central1-docker.pkg.dev/flowindex-mainnet/flowindex/simstudio-fork-migrations:latest`)
- `FLOWINDEX_AUTH_MODE` (default: `supabase_cookie`)

Deploy flow now does:

1. Build/push Sim Studio images from `sim-workflow/`.
2. Upload/apply [`studio/seed/simstudio_seed.sql`](./seed/simstudio_seed.sql) (idempotent).
3. Deploy app + realtime containers from repository-built images.

## Notes

- Caddy now routes `studio.flowindex.io` directly to backend `:3200`.
- Legacy `sim-studio-auth` container is removed during deploy.

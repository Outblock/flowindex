# Simulate — Transaction Simulation Service

## Structure

```
simulate/
├── api/          # Standalone Go simulator-api service (port 9090)
│   ├── main.go     # HTTP server, CORS, health check
│   ├── client.go   # Flow Emulator REST API client
│   ├── handler.go  # Simulate handler, warmup, balance parsing
│   ├── Dockerfile
│   └── go.mod
├── frontend/     # TanStack Start landing page + playground UI
│   ├── app/      # React components, routes, lib
│   ├── server/   # Nitro server routes (proxies to simulator-api)
│   └── Dockerfile
└── emulator/     # Flow Emulator in mainnet-fork mode
    ├── Dockerfile  # Builds emulator v1.16.3 from source
    └── start.sh    # GCE VM startup script
```

## Simulator API (`simulate/api/`)

Standalone Go HTTP service that wraps the Flow Emulator. Deployed on `flowindex-simulator` GCE VM alongside the emulator.

- **Port**: 9090
- **Endpoints**: `POST /api/simulate`, `GET /health`
- **Warmup**: On startup, pre-caches common mainnet contracts and signer storage
- **Serialization**: Mutex ensures one tx at a time (emulator limitation)
- **Payer override**: Always uses emulator service account as payer to avoid slow state fetches

## Frontend

Interactive Cadence transaction simulator with dark retro theme. Includes 5 templates (transfer, mint NFT, swap, deploy, stake) and a Monaco editor playground.

```bash
cd simulate/frontend
bun install
bun run dev      # Port 5174
bun run build    # Outputs to .output/
```

**Env:** `SIMULATOR_BACKEND_URL` (default: `http://localhost:9090`) — proxied via `/api/simulate`

## Emulator

Flow Emulator Docker image that forks mainnet state. Deployed to `flowindex-simulator` GCE VM.

- REST API: port 8888
- gRPC: port 3569
- Admin API: port 8080 (snapshots)
- **Important**: Uses `--block-time 0` (automine mode). Do NOT use `--block-time 1s` — timed auto-blocks fetch mainnet state and get stuck.

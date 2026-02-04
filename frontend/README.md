# FlowScan Frontend

Frontend UI for FlowScan. Built with Vite + React.

## Local Dev
```bash
bun install
bun run dev
```

Default dev server: `http://localhost:5173`

The UI expects the backend on the same origin by default (`/api`, `/ws`).

## Environment Variables (Frontend)
| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | `/api` | Base URL for REST API (example: `http://localhost:8080/api`) |
| `VITE_WS_URL` | derived from `VITE_API_URL` or window host | Base URL for WebSocket (example: `ws://localhost:8080`) |

## Docker / Railway
The frontend container uses Nginx to proxy `/api` and `/ws` to the backend. These env vars are used by `frontend/entrypoint.sh` and `frontend/nginx.conf`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `BACKEND_API` | auto-detected | Backend REST base (example: `http://backend.railway.internal:8080`) |
| `BACKEND_WS` | `BACKEND_API` | Backend WS base |

If `BACKEND_API` is not set, the entrypoint will try to detect Railway and fallback to `http://backend:8080`.


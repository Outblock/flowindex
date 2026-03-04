# Frontend — FlowIndex Explorer UI

> Part of the [FlowIndex](../CLAUDE.md) monorepo. See root CLAUDE.md for full architecture and deployment details.

## Overview

TanStack Start SSR app (NOT a plain React SPA). React 19, TypeScript, TailwindCSS, Shadcn/UI. Source code is in `app/`, NOT `src/`.

## Structure

```
frontend/
├── app/                    # Main source directory
│   ├── routes/             # File-based routing (TanStack Router)
│   ├── components/ui/      # Shadcn/UI components
│   ├── api.ts              # Axios-based API client
│   └── api/gen/            # Generated API clients from OpenAPI specs
├── server/                 # Custom Nitro server routes (OG images, etc.)
├── cadence/                # Flow integration + Cadence codegen
├── hooks/                  # Custom React hooks
├── eslint.config.js
└── Dockerfile
```

## Commands

```bash
# Use bun, not npm
bun install
bun run dev          # Dev server
bun run build        # Production build (outputs to .output/)
bun .output/server/index.mjs  # Run production server
bun run lint         # ESLint
bun run gen:api      # Regenerate API client from OpenAPI specs
```

## Key Routes

`/blocks`, `/transactions` (`/tx`, `/txs`), `/account/:address`, `/tokens`, `/nfts`, `/contracts`, `/nodes`, `/analytics`, `/stats`, `/developer`, `/playground`, `/admin`, `/api-docs`

## Tech Stack

- **Routing**: TanStack Router (file-based in `app/routes/`)
- **Styling**: TailwindCSS + Shadcn/UI (Radix primitives)
- **Animation**: Framer Motion
- **Icons**: Lucide React
- **Charts**: Recharts
- **Flow**: `@onflow/fcl` for Flow Client Library
- **Auth**: Supabase auth via `@supabase/supabase-js`

## Environment Variables

- `VITE_API_URL` — Backend API base URL (default: `http://localhost:8080`)
- `VITE_SUPABASE_URL` — Supabase gateway URL

## Gotchas

- Source is in `app/` not `src/` — TanStack Start migration moved everything
- Build may require `NODE_OPTIONS="--max-old-space-size=8192"` to avoid OOM
- Always run `bun run lint` before committing

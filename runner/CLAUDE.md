# Runner — Cadence Runner Service

> Part of the [FlowIndex](../CLAUDE.md) monorepo. See root CLAUDE.md for full architecture and deployment details.

## Overview

Interactive Cadence script/transaction runner with Monaco editor, AI assistance, and Flow wallet integration. Built with Vite + React, served via nginx in production with a Node.js backend for AI chat.

## Structure

```
runner/
├── server/                 # Node.js backend (AI chat, API proxy)
├── src/                    # Vite React frontend
├── packages/flowtoken/     # Local package for Flow token utilities
├── nginx.conf              # Production nginx config
├── Dockerfile
└── package.json
```

## Commands

```bash
bun install
bun run dev      # Vite dev server
bun run build    # Production build
```

## Key Dependencies

- `@onflow/fcl` — Flow Client Library
- `@onflow/cadence-language-server` — In-browser Cadence LSP
- `@monaco-editor/react` — Code editor
- `@supabase/supabase-js` — Auth
- `ai` / `@ai-sdk/react` — AI chat integration

# AI Chat Widget Design

## Overview
Floating chat widget in FlowScan frontend that connects to the vanna-sql AI service at ai.flowindex.dev. Fumadocs-style: FAB button in bottom-right, click to open 400x600 chat panel.

## Architecture
- Frontend-only change in this repo
- Chat widget calls `https://ai.flowindex.dev/api/chat` (Vercel AI SDK SSE format)
- Widget is a global component mounted in `__root.tsx`
- `VITE_AI_CHAT_URL` env var for the service URL

## Components
1. `AIChatWidget` - FAB button + panel container (open/close state)
2. `AIChatPanel` - Header, message list, input box
3. `AIChatMessage` - Renders user/assistant messages with markdown + tool outputs
4. `SqlResultTable` - Compact table for SQL results inside chat
5. `useAIChat` hook - Manages conversation state, SSE streaming

## Data Flow
```
User types question → POST /api/chat (SSE) → stream tokens back
  → Claude calls run_sql tool → result streamed back
  → render: markdown text + SQL code block + result table
```

## Service URL
- Production: `https://ai.flowindex.dev`
- Configurable via `VITE_AI_CHAT_URL` env var

# AI Chat Capabilities: Web Search, Image Upload, API Call

**Date**: 2026-02-28

## Overview

Add three new capabilities to the Flow AI chat: web search, image upload (with drag-drop/paste), and curated API calls.

## 1. Web Search

Use `@ai-sdk/anthropic`'s built-in `anthropic.tools.webSearch()` in `route.ts`. Single line addition — Anthropic handles search infra.

## 2. Image Upload

**Frontend** (`AIChatWidget.tsx`):
- Image attachment state (`File[]`)
- Paperclip button next to send
- Drag & drop on chat panel + clipboard paste
- Thumbnail preview chips above textarea
- Convert to base64 data URLs, send via `experimental_attachments`

**Backend**: No changes needed — `convertToModelMessages()` passes image parts to Claude vision.

## 3. API Call (Curated Whitelist)

TypeScript tool in `route.ts`:

```ts
fetch_api(url: string, method: "GET" | "POST", body?: string)
```

Whitelist:
- `https://rest-mainnet.onflow.org/*` — Flow Access API
- `https://evm.flowindex.io/api/*` — Blockscout EVM API
- `https://flowindex.io/flow/v1/*` — FlowIndex API
- `https://api.coingecko.com/*` — Token prices
- `https://api.increment.fi/*` — DeFi data

Constraints: GET/POST only, 30s timeout, 1MB response cap.

## 4. UI Changes

Input area: add image preview row + paperclip button. Drag-drop overlay on chat panel.

## Implementation Steps

1. Add web search tool + fetch_api tool to `ai/chat/web/app/api/chat/route.ts`
2. Add image upload UI to `frontend/app/components/chat/AIChatWidget.tsx` (drag-drop, paste, file picker, previews, send with attachments)

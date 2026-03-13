# Chat Session Persistence & Sharing

**Date:** 2026-03-14
**Status:** Draft
**Scope:** Frontend widget + AI Chat Web (`ai.flowindex.io`)
**Out of scope:** Runner AI (stays ephemeral — editor/wallet context too transient)

## Problem

The frontend AI widget and `ai.flowindex.io` chat have no conversation persistence (widget is ephemeral, web app uses localStorage for anonymous users). Users can't revisit past conversations or share them.

## Goals

1. Logged-in users can persist chat sessions (including tool outputs) across the frontend widget and AI Chat Web
2. Users can generate public share links for any conversation
3. All session history is viewable at `ai.flowindex.io`
4. Minimal changes to existing widget UI

## Decision: Approach C — API Layer on ai.flowindex.io

Keep the existing Supabase `chat_sessions` / `chat_messages` tables. Add REST endpoints on the AI chat backend (`ai.flowindex.io/api/sessions/*`). Frontend widget and AI chat web both call these endpoints. Share links served as pages from the AI chat app.

**Why:** Least disruptive. AI chat web already has the tables, auth, and UI. No migration, no new DB. Widget just POSTs to the API and links out for full history.

---

## 1. Data Model

### Existing Tables (Supabase)

Current schema in `ai/chat/web/supabase/migration.sql`:

```sql
-- chat_sessions: id, user_id, title, created_at, updated_at
-- chat_messages: id, session_id, role, content, sql, result, error, created_at
```

### Schema Changes

```sql
-- Extend chat_sessions
ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS share_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS shared_at timestamptz;

-- Extend chat_messages — replace narrow sql/result/error columns with generic tool storage
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS tool_calls jsonb,
  ADD COLUMN IF NOT EXISTS tool_results jsonb,
  ADD COLUMN IF NOT EXISTS attachments jsonb;

-- Widen role constraint to support tool/system messages from AI SDK
ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_role_check;
ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_role_check
  CHECK (role IN ('user', 'assistant', 'tool', 'system'));

-- Index for share lookups
CREATE INDEX IF NOT EXISTS idx_chat_sessions_share_id ON public.chat_sessions(share_id) WHERE share_id IS NOT NULL;

-- Index for user session listing
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_updated ON public.chat_sessions(user_id, updated_at DESC);

-- NO public RLS policies for shared sessions.
-- The public share endpoint (GET /api/share/:shareId) uses a service-role
-- Supabase client server-side to fetch shared data and returns only safe
-- fields (title, source, shared_at, messages). Anonymous users never
-- query Supabase directly — they only access the Next.js API route.
```

### Column Details

| Column | Table | Type | Description |
|--------|-------|------|-------------|
| `source` | chat_sessions | `text` | `'web'` or `'widget'` — where session originated |
| `share_id` | chat_sessions | `text` | Short random ID (8 chars, alphanumeric) for public links. Null = private |
| `shared_at` | chat_sessions | `timestamptz` | When sharing was enabled. Null = never shared |
| `tool_calls` | chat_messages | `jsonb` | Tool invocations: `[{name, args}]` |
| `tool_results` | chat_messages | `jsonb` | Tool outputs: `[{name, result, error?}]` — SQL tables, chart data, Cadence results |
| `attachments` | chat_messages | `jsonb` | File attachment metadata: `[{name, type, size, url?}]` |

### Message Format

Messages from the AI SDK (`useChat`) come as `UIMessage` objects with `parts` array. Each part has a `type`:

- `text` → stored in `content`
- `tool-invocation` → stored in `tool_calls` (includes `toolName`, `args`, `result`, `state`)

The save endpoint will extract and split these into the appropriate columns.

---

## 2. API Layer

All endpoints served from `ai.flowindex.io`. Auth via Supabase JWT in `Authorization: Bearer {token}` header.

### Session CRUD (auth required)

```
GET    /api/sessions
  → Returns: { sessions: [{ id, title, source, shared_at, updated_at }] }
  → Sorted by updated_at DESC
  → Max 50 per user

POST   /api/sessions
  → Body: { id?: uuid, title: string, source: 'web' | 'widget' }
  → Returns: { session: { id, title, source, created_at } }
  → Fails with 409 if user has 50 sessions

GET    /api/sessions/:id
  → Returns: { session: {...}, messages: [{ id, role, content, tool_calls, tool_results, attachments, created_at }] }
  → Only accessible by session owner

DELETE /api/sessions/:id
  → Deletes session + all messages
  → Only accessible by session owner
```

### Message Append (auth required)

```
POST   /api/sessions/:id/messages
  → Body: { messages: [{ role, content, tool_calls?, tool_results?, attachments? }] }
  → Appends messages to session, updates updated_at
  → Checks `SELECT count(*) FROM chat_messages WHERE session_id = $1` — fails with 409 if 200+ messages
  → If session doesn't exist, auto-creates it (upsert) — also enforces 50-session limit on auto-create
  → Title for auto-created sessions: first user message, truncated to 80 chars
```

### Sharing (auth required)

```
POST   /api/sessions/:id/share
  → Generates share_id (8-char alphanumeric), sets shared_at
  → On UNIQUE conflict, retry with new random ID (up to 3 attempts)
  → Returns: { share_url: "https://ai.flowindex.io/s/{share_id}" }
  → Fails with 409 if user has 10 active share links
  → Idempotent: if already shared, returns existing share_url

DELETE /api/sessions/:id/share
  → Clears share_id and shared_at
  → Shared link becomes 404
```

### Public View (no auth)

```
GET    /api/share/:shareId
  → Returns: { session: { title, source, shared_at }, messages: [...] }
  → 404 if share_id not found
```

### Session Rename (auth required)

```
PATCH  /api/sessions/:id
  → Body: { title: string }
  → Updates session title
  → Only accessible by session owner
```

### CORS

`ai.flowindex.io` session API routes (`/api/sessions/*`, `/api/share/*`) need explicit CORS config:

- `Access-Control-Allow-Origin`: `https://flowindex.io`, `https://www.flowindex.io` (not `*`, since we send credentials)
- `Access-Control-Allow-Methods`: `GET, POST, PATCH, DELETE, OPTIONS`
- `Access-Control-Allow-Headers`: `Content-Type, Authorization`
- `Access-Control-Allow-Credentials`: `true`

This can be handled via Next.js middleware scoped to `/api/sessions` and `/api/share` routes. The existing `/api/chat` CORS config (`*`) remains unchanged.

---

## 3. UI Changes

### 3a. Frontend Widget (minimal changes)

**Current UI preserved.** Two additions:

1. **Session dropdown** — hamburger icon (☰) in the header toggles a compact session list:
   - Shows last 5 recent sessions (title + relative time)
   - "View all at ai.flowindex.io →" link at bottom
   - Click a session → loads it into the chat
   - "+ New" button to start fresh conversation
   - Only visible when logged in

2. **Share button** — small share icon in header (next to mode selector):
   - Only visible when logged in and session has messages
   - Opens a small popover with the share link + copy button
   - If not yet shared, clicking generates the link

**No layout changes, no restyling, no structural modifications.**

### 3b. AI Chat Web (`ai.flowindex.io`)

**Existing sidebar** — already lists sessions. Changes:

1. **Source badge** — show `widget` or `web` tag next to session title
2. **Share button** — in chat header, opens share dialog:
   - Shows share URL with copy button
   - "Revoke link" option to disable sharing
   - Info text: "Anyone with the link can view this conversation (read-only)"

**Existing session management** — migrate from direct Supabase client calls (`chat-store.ts`) to the new `/api/sessions/*` endpoints. This centralizes all session logic server-side.

### 3c. Public Share Page (`ai.flowindex.io/s/:shareId`)

New read-only page:

- Top banner: "FlowIndex AI — Shared conversation" + "Try FlowIndex AI →" CTA
- Renders all messages with tool outputs (SQL queries, results tables, charts, Cadence outputs)
- No input box, no interactivity
- Responsive layout, same dark theme as main chat
- SEO-friendly: server-rendered title + description from session

---

## 4. Save/Load Flow

### Auto-Save (logged-in users only)

```
User sends message
  → Client generates session UUID if new conversation
  → /api/chat streams response as usual (NO changes to streaming)
  → After stream completes:
      → Client extracts user message + assistant response (with tool parts)
      → POST /api/sessions/:id/messages with both messages
      → If first exchange: session auto-created via upsert
      → Session title = first user message, truncated to 80 chars
```

### Load Session

```
Widget:
  → User clicks session in dropdown
  → GET /api/sessions/:id
  → Populate useChat() with loaded messages
  → Continue conversation from where it left off

AI Chat Web:
  → Same as current sidebar behavior
  → Switch from direct Supabase calls to /api/sessions/:id
```

### Anonymous Users

No change:
- Widget: ephemeral (in-memory), no session UI shown
- AI Chat Web: localStorage fallback (existing behavior in chat-store.ts)

---

## 5. Auth Flow

**No new auth system.** Reuse existing Supabase JWT:

1. Frontend app already has Supabase auth (`@supabase/supabase-js`)
2. Widget reads token from `supabase.auth.getSession()` in the frontend app
3. Widget passes `Authorization: Bearer {token}` to `ai.flowindex.io/api/sessions/*`
4. AI chat backend validates JWT using shared `SUPABASE_JWT_SECRET` (already configured)
5. Extract `user_id` from JWT claims for RLS / ownership checks

**Cross-origin:** Widget on `flowindex.io` calls API on `ai.flowindex.io`. CORS headers required (see API section).

**Token refresh:** The frontend app handles token refresh via Supabase SDK. Widget uses the current valid token for each API call.

**Widget auth integration (new work):** The widget (`AIChatWidget.tsx`) currently has no Supabase imports. It will need to accept a Supabase client or auth token as a prop from the parent app, which already has Supabase auth configured. This is new integration work — the widget does not independently manage auth.

---

## 6. Limits

| Limit | Value | Enforcement |
|-------|-------|-------------|
| Sessions per user | 50 | `POST /api/sessions` returns 409 |
| Messages per session | 200 | `POST /api/sessions/:id/messages` returns 409 |
| Active share links per user | 10 | `POST /api/sessions/:id/share` returns 409 |

**No auto-deletion.** Users manage their own sessions via delete. A "Delete all" bulk action can be added later if needed.

---

## 7. Implementation Scope

### Files to Modify

**AI Chat Web (`ai/chat/web/`):**
- `supabase/migration.sql` — schema changes
- `app/api/sessions/` — new API route handlers (CRUD + messages + share)
- `app/api/share/` — public share endpoint
- `app/s/[shareId]/page.tsx` — new public share page (SSR)
- `lib/chat-store.ts` — migrate from direct Supabase calls to `/api/sessions/*`
- `components/chat.tsx` — add share button + dialog
- `components/sidebar.tsx` — add source badge

**Frontend (`frontend/`):**
- `app/components/chat/AIChatWidget.tsx` — add session dropdown, share button, auto-save logic, auth token passing

### Files NOT Modified

- `ai/chat/web/app/api/chat/route.ts` — streaming endpoint unchanged
- `ai/chat/web/app/api/runner-chat/route.ts` — runner endpoint unchanged
- `runner/src/components/AIPanel.tsx` — runner stays ephemeral
- No backend (Go) changes needed

---

## 8. Open Questions

None at this time. All decisions made during brainstorming.

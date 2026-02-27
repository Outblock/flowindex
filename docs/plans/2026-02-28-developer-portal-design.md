# Developer Portal Design

**Date:** 2026-02-28
**Status:** Approved

## Overview

Add a Developer Portal to the existing FlowScan frontend (`frontend/`). Developers can sign up via Email Magic Link, manage API keys, webhook endpoints, subscriptions, and view delivery logs — all within the Nothing Phone aesthetic.

## Architecture

Integrated into `frontend/` using TanStack Router + Shadcn/UI. New routes under `/developer/*`. Auth state managed via `AuthContext` with JWT in localStorage.

```
frontend/
  app/
    routes/
      developer/
        login.tsx          — Magic Link login (email input → send link)
        callback.tsx       — Magic Link callback (extract token from URL)
        index.tsx          — Dashboard overview
        keys.tsx           — API Key management
        endpoints.tsx      — Webhook endpoint management
        subscriptions.tsx  — Subscription management
        logs.tsx           — Delivery log viewer
    contexts/
      AuthContext.tsx       — JWT state, login/logout, auto-refresh
    lib/
      webhookApi.ts        — All webhook + GoTrue API calls
    components/
      developer/
        ProtectedRoute.tsx — Redirect to login if unauthenticated
        DeveloperLayout.tsx— Sidebar nav + user header
```

## Pages

### /developer/login
- Email input field + "Send Magic Link" button
- On submit: POST to GoTrue `/magiclink` endpoint
- Show "Check your email" confirmation message
- Fallback: email + password form (while SMTP not configured)

### /developer/callback
- Extracts `access_token` and `refresh_token` from URL hash fragment
- Stores in localStorage via AuthContext
- Redirects to `/developer`

### /developer (Dashboard)
- Overview cards: API Keys count, Endpoints count, Active Subscriptions count
- Recent delivery logs (last 5)
- Quick actions: "Create API Key", "Add Endpoint", "New Subscription"

### /developer/keys
- Table: key_prefix, name, created_at, last_used, status
- "Create Key" button → modal with name input → shows plaintext key once
- Delete with confirmation

### /developer/endpoints
- Table: URL, description, status, created_at
- "Add Endpoint" button → form with URL + description
- Edit/delete actions

### /developer/subscriptions
- Table: event_type, endpoint URL, conditions (JSON), enabled status
- "New Subscription" button → form:
  - Select event_type from dropdown (10 types)
  - Select endpoint from existing endpoints
  - Conditions editor (key-value pairs, type-specific)
- Toggle enable/disable
- Delete with confirmation

### /developer/logs
- Table: timestamp, event_type, endpoint, status_code, payload preview
- Pagination (50 per page)
- Filter by event_type and status_code range

## Auth Flow

```
Email input → POST GoTrue /magiclink
  → User receives email with link
  → Link: https://flowindex.io/developer/callback#access_token=xxx&refresh_token=yyy
  → callback.tsx extracts tokens, stores in AuthContext
  → Redirects to /developer

Token refresh:
  → JWT expires (1hr) → AuthContext intercepts 401
  → POST GoTrue /token?grant_type=refresh_token
  → Updates stored tokens
```

## API Client (webhookApi.ts)

```typescript
// GoTrue endpoints (direct to GoTrue service)
signUp(email, password)
signIn(email, password)
sendMagicLink(email)
refreshToken(refreshToken)
signOut()

// Webhook API endpoints (backend /api/v1/*)
listEventTypes()
createAPIKey(name)
listAPIKeys()
deleteAPIKey(id)
createEndpoint(url, description)
listEndpoints()
updateEndpoint(id, data)
deleteEndpoint(id)
createSubscription(endpointId, eventType, conditions)
listSubscriptions()
updateSubscription(id, data)
deleteSubscription(id)
listDeliveryLogs(params)
```

## Auth Configuration

### GoTrue (when SMTP is ready)
```env
GOTRUE_SMTP_HOST=smtp.resend.com
GOTRUE_SMTP_PORT=465
GOTRUE_SMTP_USER=resend
GOTRUE_SMTP_PASS=re_xxxx  # TODO: Resend API Key
GOTRUE_SMTP_SENDER_NAME=FlowIndex
GOTRUE_MAILER_AUTOCONFIRM=false
GOTRUE_MAILER_URLPATHS_CONFIRMATION=/developer/callback
GOTRUE_SITE_URL=https://testnet.flowindex.io
```

### Fallback (current, no SMTP)
```env
GOTRUE_MAILER_AUTOCONFIRM=true
```
Email + password login works immediately. Magic Link requires SMTP.

## GoTrue URL Configuration

The frontend needs to know the GoTrue URL:
- **Railway:** `https://supabase-auth-production-073d.up.railway.app`
- **GCP:** Proxied through backend or exposed directly
- **Local:** `http://localhost:9999`

Environment variable: `VITE_GOTRUE_URL`

## UI Design

Nothing Phone aesthetic — dark-first, monochrome, geometric:
- Background: `#0a0a0a` (nothing-dark)
- Accent: `#00ef8b` (nothing-green / Flow green)
- Font: Geist Sans / Geist Mono
- Cards: Shadcn Card with subtle borders
- Tables: minimal, with hover states
- Forms: clean inputs with green focus rings
- Sidebar: compact, icon + label, green active indicator

## Event Types & Condition Fields

| Event Type | Condition Fields |
|---|---|
| `ft.transfer` | addresses[], direction, token_contract, min_amount |
| `ft.large_transfer` | token_contract, min_amount (required) |
| `nft.transfer` | addresses[], collection, token_ids[], direction |
| `contract.event` | contract_address, event_names[] |
| `address.activity` | addresses[], roles[] |
| `staking.event` | event_types[], node_id, min_amount |
| `defi.swap` | pair_id, min_amount, addresses[] |
| `defi.liquidity` | pair_id, event_type |
| `account.key_change` | addresses[] |
| `evm.transaction` | from, to, min_value |

## Dependencies

No new npm packages needed beyond what's already in the frontend:
- Shadcn/UI components (Card, Button, Dialog, etc.)
- TanStack Router (already configured)
- Tailwind CSS (already configured)

## References

- [Supabase GoTrue API](https://supabase.com/docs/reference/auth)
- [Resend SMTP](https://resend.com/docs/send-with-smtp)
- Webhook API: `backend/internal/webhooks/handlers.go`

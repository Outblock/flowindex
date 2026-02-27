# Webhook & Notification System Design

**Date:** 2026-02-27
**Status:** Approved

## Overview

Add a developer-facing webhook notification system to FlowScan. Developers register via Supabase auth, create subscriptions with conditions, and receive real-time webhook deliveries when matching blockchain events occur.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     FlowScan Backend                     │
│                                                          │
│  Ingester ──callback──► EventBus (Go chan) ──► Matcher   │
│                              │                    │      │
│                              │              ┌─────┘      │
│                              ▼              ▼            │
│                     ┌─────────────┐  ┌──────────┐       │
│                     │  Event Log  │  │  Svix    │       │
│                     │  (Postgres) │  │  (HTTP)  │       │
│                     └─────────────┘  └──────────┘       │
│                                                          │
│  API Server ◄── Supabase JWT / API Key ── Developers     │
│     │                                                    │
│     ├── POST /api/v1/subscriptions                       │
│     ├── GET  /api/v1/subscriptions                       │
│     ├── DELETE /api/v1/subscriptions/:id                 │
│     ├── POST /api/v1/endpoints                           │
│     └── GET  /api/v1/delivery-logs                       │
│                                                          │
│  Admin API ◄── ADMIN_TOKEN ── Admin Dashboard            │
│     ├── GET  /admin/v1/users                             │
│     ├── PATCH /admin/v1/users/:id/tier                   │
│     └── GET  /admin/v1/stats                             │
└─────────────────────────────────────────────────────────┘

┌──────────────┐     ┌──────────────┐
│   Supabase   │     │    Svix      │
│  (Auth +     │     │  (Webhook    │
│   User DB)   │     │   Delivery)  │
└──────────────┘     └──────────────┘
```

### Key Decisions

- **Auth:** Supabase self-hosted (GoTrue + Postgres). Separate DB from blockchain data.
- **Webhook delivery:** Svix open-source. Handles retry, signing, delivery logs.
- **Event bus:** In-process Go channels (MVP). Upgradeable to NATS/Redis Streams.
- **SDK:** TypeScript first. Other languages later.

### Data Flow

1. Developer registers via Supabase auth, gets JWT
2. Creates API key for programmatic access
3. Registers webhook endpoint URL
4. Creates subscription with event_type + conditions
5. Ingester processes block → data flows into EventBus
6. Matcher loads active subscriptions (cached, 30s TTL)
7. Matches conditions → sends to Svix for delivery
8. Svix delivers to endpoint with retry + HMAC signature

## Database Design (Supabase Postgres)

Separate from existing blockchain Postgres (`raw.*`, `app.*`, `analytics.*`).

```sql
-- Supabase manages auth.users automatically

-- Rate limit tiers (admin-managed)
CREATE TABLE public.rate_limit_tiers (
    id                  TEXT PRIMARY KEY,        -- "free", "pro", "enterprise"
    name                TEXT NOT NULL,
    max_subscriptions   INT DEFAULT 5,
    max_endpoints       INT DEFAULT 2,
    max_events_per_hour INT DEFAULT 1000,
    max_api_requests    INT DEFAULT 100,         -- per minute
    is_default          BOOLEAN DEFAULT false
);

INSERT INTO public.rate_limit_tiers VALUES
    ('free',       'Free',       5,   2,   1000,   100,  true),
    ('pro',        'Pro',        50,  10,  50000,  1000, false),
    ('enterprise', 'Enterprise', 500, 100, 500000, 10000, false);

-- User profiles (extends Supabase auth.users)
CREATE TABLE public.user_profiles (
    user_id      UUID REFERENCES auth.users(id) PRIMARY KEY,
    tier_id      TEXT REFERENCES public.rate_limit_tiers(id) DEFAULT 'free',
    is_suspended BOOLEAN DEFAULT false,
    notes        TEXT,
    created_at   TIMESTAMPTZ DEFAULT now()
);

-- Developer API keys
CREATE TABLE public.api_keys (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID REFERENCES auth.users(id) NOT NULL,
    key_hash    TEXT NOT NULL UNIQUE,
    key_prefix  TEXT NOT NULL,               -- "fs_live_abc..." for display
    name        TEXT NOT NULL,
    scopes      TEXT[] DEFAULT '{}',
    is_active   BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now(),
    last_used   TIMESTAMPTZ
);

-- Webhook endpoints (synced with Svix)
CREATE TABLE public.endpoints (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID REFERENCES auth.users(id) NOT NULL,
    svix_ep_id  TEXT NOT NULL,
    url         TEXT NOT NULL,
    description TEXT,
    is_active   BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Subscriptions (core: conditions → endpoints)
CREATE TABLE public.subscriptions (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID REFERENCES auth.users(id) NOT NULL,
    endpoint_id UUID REFERENCES public.endpoints(id) NOT NULL,
    event_type  TEXT NOT NULL,
    conditions  JSONB NOT NULL DEFAULT '{}',
    is_enabled  BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Delivery logs (mirrored from Svix)
CREATE TABLE public.delivery_logs (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    subscription_id UUID REFERENCES public.subscriptions(id),
    endpoint_id     UUID REFERENCES public.endpoints(id),
    event_type      TEXT NOT NULL,
    payload         JSONB NOT NULL,
    status_code     INT,
    delivered_at    TIMESTAMPTZ DEFAULT now(),
    svix_msg_id     TEXT
);

-- Indexes
CREATE INDEX idx_subscriptions_event_type ON public.subscriptions(event_type) WHERE is_enabled = true;
CREATE INDEX idx_subscriptions_user ON public.subscriptions(user_id);
CREATE INDEX idx_delivery_logs_sub ON public.delivery_logs(subscription_id, delivered_at DESC);
CREATE INDEX idx_api_keys_hash ON public.api_keys(key_hash);
```

## Event Types & Conditions

| Event Type | Data Source | Example Conditions |
|---|---|---|
| `address.activity` | `app.address_transactions` | `addresses[]`, `roles[]` (PROPOSER/PAYER/AUTHORIZER) |
| `ft.transfer` | `app.ft_transfers` | `addresses[]`, `direction`, `token_contract`, `min_amount` |
| `ft.large_transfer` | `app.ft_transfers` | `token_contract`, `min_amount` (required) |
| `nft.transfer` | `app.nft_transfers` | `addresses[]`, `collection`, `token_ids[]`, `direction` |
| `contract.event` | `raw.events` | `contract_address`, `event_names[]` |
| `staking.event` | `app.staking_events` | `event_types[]`, `node_id`, `min_amount` |
| `defi.swap` | `app.defi_events` | `pair_id`, `min_amount`, `addresses[]` |
| `defi.liquidity` | `app.defi_events` | `pair_id`, `event_type` (add/remove) |
| `account.key_change` | `app.account_keys` | `addresses[]` |
| `evm.transaction` | `app.evm_transactions` | `from`, `to`, `min_value` |

### Condition Matching

```go
type ConditionMatcher interface {
    EventType() string
    Match(event interface{}, conditions json.RawMessage) bool
}
```

Each event type has a dedicated matcher registered in a registry. Matchers are stateless; subscription data is cached in-memory with 30s TTL.

## API Design

### Developer API (JWT or API Key auth)

```
POST   /api/v1/auth/signup
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh

POST   /api/v1/keys
GET    /api/v1/keys
DELETE /api/v1/keys/:id

POST   /api/v1/endpoints
GET    /api/v1/endpoints
PATCH  /api/v1/endpoints/:id
DELETE /api/v1/endpoints/:id

POST   /api/v1/subscriptions
GET    /api/v1/subscriptions
GET    /api/v1/subscriptions/:id
PATCH  /api/v1/subscriptions/:id
DELETE /api/v1/subscriptions/:id

GET    /api/v1/logs
GET    /api/v1/logs/:id

GET    /api/v1/event-types          # public, no auth
```

### Admin API (ADMIN_TOKEN auth)

```
GET    /admin/v1/users
GET    /admin/v1/users/:id
PATCH  /admin/v1/users/:id/tier
POST   /admin/v1/users/:id/suspend
GET    /admin/v1/users/:id/subscriptions
GET    /admin/v1/users/:id/logs
GET    /admin/v1/stats
```

### Authentication

Two methods, checked in order:
1. `X-API-Key` header → lookup in `api_keys` table by hash
2. `Authorization: Bearer <JWT>` → verify Supabase JWT

## Webhook Payload Format

```json
{
  "id": "msg_2xY9kL...",
  "event_type": "ft.large_transfer",
  "timestamp": "2026-02-27T10:30:00Z",
  "data": {
    "block_height": 141000000,
    "transaction_id": "abc123...",
    "from_address": "0x1654653399040a61",
    "to_address": "0x631e88ae7f1d7c20",
    "amount": "50000.00000000",
    "token": {
      "contract": "A.1654653399040a61.FlowToken",
      "symbol": "FLOW",
      "name": "Flow Token"
    }
  },
  "subscription_id": "sub_xyz..."
}
```

Headers (Svix standard): `webhook-id`, `webhook-timestamp`, `webhook-signature`.

## Go Backend Integration

### EventBus

```go
type EventBus struct {
    subscribers map[string][]chan<- Event
    mu          sync.RWMutex
}

type Event struct {
    Type      string
    Height    uint64
    Timestamp time.Time
    Data      interface{}
}
```

### Integration Point (main.go)

```go
bus := eventbus.New()
subCache := notifications.NewSubscriptionCache(supabaseDB, 30*time.Second)
matcher := notifications.NewMatcher(subCache, svixClient, bus)

// Register all matchers
matcher.Register(&FTTransferMatcher{})
matcher.Register(&NFTTransferMatcher{})
matcher.Register(&AddressActivityMatcher{})
// ... all 10 matchers

// Hook into existing ingester callbacks
forwardIngester.OnNewTransactions = func(txs, events) {
    broadcastToWebSocket(txs, events)    // existing
    bus.PublishFromBlock(txs, events, transfers, ...)  // new
}
```

### Rate Limiting

- API requests: per-minute sliding window, keyed by user_id
- Event delivery: per-hour counter, checked before Svix send
- Subscription/endpoint counts: checked on creation
- Admin can change tier, takes effect within 30s (cache TTL)

## TypeScript SDK

```typescript
import { FlowScanWebhooks } from '@flowscan/webhooks-sdk';

const client = new FlowScanWebhooks({
  apiKey: 'fs_live_abc123...',
  baseUrl: 'https://api.flowscan.io'
});

// Register endpoint
const ep = await client.endpoints.create({
  url: 'https://my-app.com/webhooks/flow',
});

// Subscribe to large FLOW transfers
await client.subscriptions.create({
  endpointId: ep.id,
  eventType: 'ft.large_transfer',
  conditions: {
    token_contract: 'A.1654653399040a61.FlowToken',
    min_amount: '10000.0'
  }
});

// Verify webhook signature
import { verifyWebhookSignature } from '@flowscan/webhooks-sdk';
const isValid = verifyWebhookSignature(payload, signature, secret);
```

## External Dependencies

| Dependency | Purpose | Deployment |
|---|---|---|
| Supabase (self-hosted) | Auth + user DB | Docker Compose alongside existing services |
| Svix (open-source) | Webhook delivery, retry, signing | Docker container or Svix Cloud |

## References

- [Svix Open Source](https://www.svix.com/open-source-webhook-service/)
- [Hookdeck Outpost](https://hookdeck.com/outpost)
- [Convoy](https://www.getconvoy.io/)
- [Crypitor Blockchain Monitor](https://github.com/crypitor/blockchain-monitor)

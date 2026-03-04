-- FlowIndex API key storage for Sim Studio subscription bridge.
-- Stores encrypted per-user API keys used by subscription-bridge.ts
-- to register webhook subscriptions with the Go backend.

CREATE TABLE IF NOT EXISTS public.flowindex_api_key (
    id              TEXT PRIMARY KEY,
    user_id         UUID NOT NULL UNIQUE,
    encrypted_key   TEXT NOT NULL,
    key_prefix      TEXT NOT NULL,
    endpoint_id     TEXT,
    signing_secret  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS flowindex_api_key_user_idx ON public.flowindex_api_key(user_id);

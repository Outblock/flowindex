-- Webhook Notification System Schema
-- Runs against the Supabase Postgres instance (separate from blockchain DB)

-- Rate limit tiers (admin-managed)
CREATE TABLE IF NOT EXISTS public.rate_limit_tiers (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    max_subscriptions   INT NOT NULL DEFAULT 5,
    max_endpoints       INT NOT NULL DEFAULT 2,
    max_events_per_hour INT NOT NULL DEFAULT 1000,
    max_api_requests    INT NOT NULL DEFAULT 100,
    is_default          BOOLEAN NOT NULL DEFAULT false
);

INSERT INTO public.rate_limit_tiers (id, name, max_subscriptions, max_endpoints, max_events_per_hour, max_api_requests, is_default) VALUES
    ('free',       'Free',       10,  10,  5000,   300,  true),
    ('pro',        'Pro',        50,  50,  50000,  1000, false),
    ('enterprise', 'Enterprise', 500, 100, 500000, 10000, false),
    ('ultimate',   'Ultimate',   999999, 999999, 999999999, 999999999, false)
ON CONFLICT (id) DO UPDATE SET
    max_subscriptions = EXCLUDED.max_subscriptions,
    max_endpoints = EXCLUDED.max_endpoints,
    max_events_per_hour = EXCLUDED.max_events_per_hour,
    max_api_requests = EXCLUDED.max_api_requests;

-- User profiles (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.user_profiles (
    user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    tier_id      TEXT REFERENCES public.rate_limit_tiers(id) DEFAULT 'free',
    is_suspended BOOLEAN NOT NULL DEFAULT false,
    notes        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (user_id) VALUES (NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Developer API keys
CREATE TABLE IF NOT EXISTS public.api_keys (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    key_hash    TEXT NOT NULL UNIQUE,
    key_prefix  TEXT NOT NULL,
    name        TEXT NOT NULL,
    scopes      TEXT[] DEFAULT '{}',
    is_active   BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used   TIMESTAMPTZ
);

-- Webhook endpoints (synced with Svix)
CREATE TABLE IF NOT EXISTS public.endpoints (
    id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    svix_ep_id     TEXT NOT NULL,
    url            TEXT NOT NULL,
    description    TEXT,
    endpoint_type  TEXT NOT NULL DEFAULT 'webhook',  -- webhook, discord, slack, telegram, email
    metadata       JSONB NOT NULL DEFAULT '{}',       -- channel-specific config (e.g. telegram bot_token, chat_id)
    is_active      BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Subscriptions (conditions -> endpoints)
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    endpoint_id UUID REFERENCES public.endpoints(id) ON DELETE CASCADE NOT NULL,
    event_type  TEXT NOT NULL,
    conditions  JSONB NOT NULL DEFAULT '{}',
    is_enabled  BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Delivery logs (mirrored from Svix for quick access)
CREATE TABLE IF NOT EXISTS public.delivery_logs (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
    endpoint_id     UUID REFERENCES public.endpoints(id) ON DELETE SET NULL,
    event_type      TEXT NOT NULL,
    payload         JSONB NOT NULL,
    status_code     INT,
    delivered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    svix_msg_id     TEXT
);

-- Migration: add endpoint_type and metadata columns
ALTER TABLE public.endpoints ADD COLUMN IF NOT EXISTS endpoint_type TEXT NOT NULL DEFAULT 'webhook';
ALTER TABLE public.endpoints ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_subscriptions_event_type ON public.subscriptions(event_type) WHERE is_enabled = true;
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_delivery_logs_sub ON public.delivery_logs(subscription_id, delivered_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON public.api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON public.api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_endpoints_user ON public.endpoints(user_id);

-- Row Level Security
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_logs ENABLE ROW LEVEL SECURITY;

-- Users can only see/modify their own data
CREATE POLICY users_own_profile ON public.user_profiles FOR ALL USING (auth.uid() = user_id);
CREATE POLICY users_own_keys ON public.api_keys FOR ALL USING (auth.uid() = user_id);
CREATE POLICY users_own_endpoints ON public.endpoints FOR ALL USING (auth.uid() = user_id);
CREATE POLICY users_own_subscriptions ON public.subscriptions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY users_own_logs ON public.delivery_logs FOR ALL USING (
    endpoint_id IN (SELECT id FROM public.endpoints WHERE user_id = auth.uid())
);

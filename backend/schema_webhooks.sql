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

-- Team model (table-driven RBAC)
CREATE TABLE IF NOT EXISTS public.teams (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.team_memberships (
    team_id      UUID REFERENCES public.teams(id) ON DELETE CASCADE NOT NULL,
    user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role         TEXT NOT NULL DEFAULT 'team_member' CHECK (role IN ('team_admin', 'team_member')),
    status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'suspended')),
    invited_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_memberships_user ON public.team_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_team_memberships_team ON public.team_memberships(team_id);

CREATE TABLE IF NOT EXISTS public.user_platform_roles (
    user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role         TEXT NOT NULL CHECK (role IN ('platform_admin', 'ops_admin', 'admin')),
    assigned_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_user_platform_roles_role ON public.user_platform_roles(role);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    personal_team_id UUID;
    personal_slug TEXT;
    personal_name TEXT;
BEGIN
    INSERT INTO public.user_profiles (user_id) VALUES (NEW.id);

    personal_slug := 'u_' || substr(replace(NEW.id::text, '-', ''), 1, 12);
    personal_name := coalesce(split_part(NEW.email, '@', 1), 'User') || '''s Team';

    INSERT INTO public.teams (slug, name, created_by)
    VALUES (personal_slug, personal_name, NEW.id)
    ON CONFLICT (slug) DO UPDATE SET name = public.teams.name
    RETURNING id INTO personal_team_id;

    INSERT INTO public.team_memberships (team_id, user_id, role, status, invited_by)
    VALUES (personal_team_id, NEW.id, 'team_admin', 'active', NEW.id)
    ON CONFLICT (team_id, user_id) DO NOTHING;

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

-- Backfill: ensure every existing user has a personal team + active membership.
WITH users_without_active_team AS (
    SELECT u.id, u.email
    FROM auth.users u
    LEFT JOIN public.team_memberships tm
      ON tm.user_id = u.id AND tm.status = 'active'
    WHERE tm.user_id IS NULL
),
inserted_teams AS (
    INSERT INTO public.teams (slug, name, created_by)
    SELECT
        'u_' || substr(replace(u.id::text, '-', ''), 1, 12),
        coalesce(split_part(u.email, '@', 1), 'User') || '''s Team',
        u.id
    FROM users_without_active_team u
    ON CONFLICT (slug) DO NOTHING
    RETURNING id, slug
)
INSERT INTO public.team_memberships (team_id, user_id, role, status, invited_by)
SELECT t.id, u.id, 'team_admin', 'active', u.id
FROM users_without_active_team u
JOIN public.teams t
  ON t.slug = 'u_' || substr(replace(u.id::text, '-', ''), 1, 12)
ON CONFLICT (team_id, user_id) DO NOTHING;

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
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_platform_roles ENABLE ROW LEVEL SECURITY;

-- Users can only see/modify their own data
CREATE POLICY users_own_profile ON public.user_profiles FOR ALL USING (auth.uid() = user_id);
CREATE POLICY users_own_keys ON public.api_keys FOR ALL USING (auth.uid() = user_id);
CREATE POLICY users_own_endpoints ON public.endpoints FOR ALL USING (auth.uid() = user_id);
CREATE POLICY users_own_subscriptions ON public.subscriptions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY users_own_logs ON public.delivery_logs FOR ALL USING (
    endpoint_id IN (SELECT id FROM public.endpoints WHERE user_id = auth.uid())
);

CREATE POLICY users_own_teams ON public.teams FOR SELECT USING (
    id IN (
        SELECT tm.team_id FROM public.team_memberships tm
        WHERE tm.user_id = auth.uid() AND tm.status = 'active'
    )
);

CREATE POLICY users_own_team_memberships ON public.team_memberships FOR SELECT USING (
    user_id = auth.uid()
    OR team_id IN (
        SELECT tm.team_id FROM public.team_memberships tm
        WHERE tm.user_id = auth.uid() AND tm.status = 'active'
    )
);

CREATE POLICY users_own_platform_roles ON public.user_platform_roles FOR SELECT USING (
    user_id = auth.uid()
);

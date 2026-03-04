-- Fix webhook schema: add missing signing_secret column, clean up dropped table references

-- 1. Add signing_secret to endpoints (was in schema_webhooks.sql but not in migration)
ALTER TABLE public.endpoints ADD COLUMN IF NOT EXISTS signing_secret TEXT;

-- 2. Drop RLS policies that reference dropped tables (teams, team_memberships, user_platform_roles)
DROP POLICY IF EXISTS users_own_teams ON public.teams;
DROP POLICY IF EXISTS users_own_team_memberships ON public.team_memberships;
DROP POLICY IF EXISTS users_own_platform_roles ON public.user_platform_roles;

-- 3. Ensure RLS on teams/team_memberships/user_platform_roles is disabled
-- (tables were dropped in 20260305100000, but if they somehow still exist, disable RLS)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'teams') THEN
        EXECUTE 'ALTER TABLE public.teams DISABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'team_memberships') THEN
        EXECUTE 'ALTER TABLE public.team_memberships DISABLE ROW LEVEL SECURITY';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_platform_roles') THEN
        EXECUTE 'ALTER TABLE public.user_platform_roles DISABLE ROW LEVEL SECURITY';
    END IF;
END$$;

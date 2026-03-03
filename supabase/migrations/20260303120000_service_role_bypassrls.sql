-- Allow service_role to bypass RLS (standard Supabase behavior).
-- Fixes: "new row violates row-level security policy for table user_projects"
-- The edge functions use supabaseAdmin (service_role key) which needs to
-- bypass RLS to insert rows on behalf of authenticated users.

ALTER ROLE service_role BYPASSRLS;

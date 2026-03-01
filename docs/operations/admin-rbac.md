# Admin RBAC (FlowIndex)

This document defines role/team-based access for `https://flowindex.io/admin`.

## Model

FlowIndex uses two permission layers:

1. Team-level roles (for collaboration):
- `team_member`
- `team_admin`

2. Platform-level roles (for control plane / admin panel):
- `platform_admin`
- `ops_admin`

Only platform-level roles are allowed to access `/admin` by default.

Primary source of truth is now **table-driven RBAC** in Supabase:

- `public.user_platform_roles` (platform roles)
- `public.teams`
- `public.team_memberships`

JWT claims are only a compatibility fallback for users that do not yet have RBAC rows.

## Admin Panel Access Policy

Recommended production policy:

- `ADMIN_ALLOWED_ROLES=platform_admin,ops_admin`
- `ADMIN_ALLOWED_TEAMS=flowindex`

This means `/admin` requires:
- user has `platform_admin` or `ops_admin` in `public.user_platform_roles`
- and is a member of team `flowindex` (when team allowlist is configured)

Legacy fallback:
- `ADMIN_TOKEN` is still supported as an emergency path.

## DB Tables

### Platform Roles

```sql
select user_id, role, created_at
from public.user_platform_roles
order by created_at desc;
```

### Teams + Memberships

```sql
select t.slug, tm.user_id, tm.role, tm.status
from public.team_memberships tm
join public.teams t on t.id = tm.team_id
order by t.slug, tm.created_at;
```

## Supabase SQL: Grant / Revoke

### 1) Grant FlowIndex admin access (table-driven)

```sql
with target_user as (
  select id from auth.users where email = 'you@example.com'
),
target_team as (
  select id from public.teams where slug = 'flowindex'
)
insert into public.user_platform_roles (user_id, role)
select id, 'platform_admin' from target_user
on conflict (user_id, role) do nothing;

insert into public.team_memberships (team_id, user_id, role, status)
select tt.id, tu.id, 'team_admin', 'active'
from target_team tt, target_user tu
on conflict (team_id, user_id) do update
set role = excluded.role, status = 'active', updated_at = now();
```

### 2) Grant ops admin access

```sql
with target_user as (
  select id from auth.users where email = 'ops@example.com'
)
insert into public.user_platform_roles (user_id, role)
select id, 'ops_admin' from target_user
on conflict (user_id, role) do nothing;
```

### 3) Revoke admin access (keep team membership)

```sql
delete from public.user_platform_roles upr
using auth.users u
where upr.user_id = u.id
  and u.email = 'you@example.com';
```

### 4) Revoke all team access for a user

```sql
delete from public.team_memberships tm
using auth.users u
where tm.user_id = u.id
  and u.email = 'you@example.com';
```

Users should sign out/sign in again if frontend still shows stale auth state.

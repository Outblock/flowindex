# Runner Cloud Projects & Account Creation — Design

## Goal

Enable logged-in Runner users to save multiple named projects to the cloud (Supabase DB), share them via URL, and create Flow accounts using the Lilico account creation API.

## Scope

1. **Cloud project saving** — multiple named projects per user, stored in Supabase
2. **Shareable project links** — public projects viewable/forkable via URL
3. **Account creation** — integrate Lilico API into the existing `flow-keys` Edge Function
4. **Graceful fallback** — anonymous users keep localStorage-only behavior unchanged

## Database Schema

### `user_projects`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | gen_random_uuid() |
| user_id | uuid (FK auth.users) | owner |
| name | text | display name |
| slug | text (unique) | URL-friendly, auto-generated |
| network | text | 'mainnet' or 'testnet' |
| is_public | boolean | default false |
| active_file | text | currently active file path |
| open_files | text[] | open tab paths |
| folders | text[] | folder structure |
| created_at | timestamptz | |
| updated_at | timestamptz | auto-updated |

### `project_files`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid (PK) | |
| project_id | uuid (FK user_projects, CASCADE) | |
| path | text | e.g. "main.cdc" |
| content | text | file source |
| UNIQUE | (project_id, path) | |

### RLS

- **user_projects**: owner full CRUD; anyone can SELECT where `is_public = true`
- **project_files**: mirrors parent project access (join on project_id)

Dependency files (`deps/`) are transient (LSP-resolved), never stored in cloud.

## Edge Function: `runner-projects`

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/projects/list` | GET | Required | List user's projects (metadata only) |
| `/projects/get?slug=X` | GET | Optional | Full project by slug. Public readable by all. |
| `/projects/save` | POST | Required | Upsert: create or update project with all files |
| `/projects/delete` | DELETE | Required | Delete by id (owner only) |
| `/projects/fork` | POST | Required | Fork public project into user's account |

**Save strategy:** Client sends full project state. Edge Function does transactional upsert (delete removed files, upsert changed files, update metadata).

**Slug generation:** kebab-case from name + random suffix on collision. Immutable once created.

## Account Creation (Lilico API)

Update existing `flow-keys` Edge Function `/keys/create`:

1. Generate ECDSA_P256 keypair (existing)
2. Call Lilico: `POST https://openapi.lilico.app/v1/address` (mainnet) or `/v1/address/testnet`
3. Body: `{ publicKey, signatureAlgorithm: "ECDSA_P256", hashAlgorithm: "SHA3_256", weight: 1000 }`
4. Receive `txId`
5. Poll Flow Access Node REST API until tx sealed
6. Parse `flow.AccountCreated` event for address
7. Store encrypted key + address in `user_keys`
8. Return key info to client

**Env vars:** `LILICO_API_KEY`, `FLOW_ACCESS_NODE_REST` (for tx polling).

**Network:** Client passes network param; Edge Function routes to correct Lilico endpoint + Access Node.

## Frontend UI

### Project Selector (sidebar)

- Logged-in: project selector dropdown in sidebar header (current project name + chevron)
- Dropdown: project list sorted by updated_at desc, "New Project" button
- Each item: name, network badge, last updated
- Actions: rename (inline), share toggle (copy link), delete (confirm)

### Anonymous Users

No changes. Single localStorage project, exactly as today.

### URL Routing

- `run.flowindex.io` — loads last active project or localStorage
- `run.flowindex.io?project=<slug>` — loads public project (read-only if not owner, fork button)
- `run.flowindex.io?code=<base64>` — existing behavior, unchanged

### Sync Behavior

- Auto-save debounced 2s to Supabase when logged in
- Save indicator in sidebar footer (saved/saving/offline)
- On login with unsaved localStorage work: offer to save as new cloud project
- On logout: current project cached in localStorage
- Conflict resolution: last-write-wins

## Non-Goals

- Real-time collaboration / multi-user editing
- Version history / git integration
- Mobile-responsive layout (separate effort)
- File-level sharing (whole project only)

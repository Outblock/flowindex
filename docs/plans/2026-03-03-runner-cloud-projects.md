# Runner Cloud Projects & Account Creation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable logged-in Runner users to save multiple named projects to Supabase DB with shareable links, and create Flow accounts via the Lilico API.

**Architecture:** Two new Supabase tables (`user_projects`, `project_files`) with RLS. A new `runner-projects` Edge Function handles project CRUD and fork. The existing `flow-keys` Edge Function gets updated to call the Lilico account creation API. The Runner frontend adds a project selector dropdown in the sidebar and auto-syncs project state to the cloud.

**Tech Stack:** Supabase (Postgres + Edge Functions/Deno), React, TypeScript, Tailwind CSS

---

### Task 1: Database Migration — Project Tables

**Files:**
- Create: `supabase/migrations/20260303100000_user_projects.sql`

**Step 1: Write the migration SQL**

```sql
-- Cloud-saved Runner projects
CREATE TABLE IF NOT EXISTS public.user_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled',
  slug TEXT NOT NULL UNIQUE,
  network TEXT NOT NULL DEFAULT 'mainnet' CHECK (network IN ('mainnet', 'testnet')),
  is_public BOOLEAN NOT NULL DEFAULT false,
  active_file TEXT NOT NULL DEFAULT 'main.cdc',
  open_files TEXT[] NOT NULL DEFAULT ARRAY['main.cdc'],
  folders TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_projects ENABLE ROW LEVEL SECURITY;

-- Owner can do everything
CREATE POLICY "Users can manage own projects"
  ON public.user_projects FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Anyone can read public projects
CREATE POLICY "Public projects are readable"
  ON public.user_projects FOR SELECT
  USING (is_public = true);

CREATE INDEX idx_user_projects_user_id ON public.user_projects(user_id);
CREATE INDEX idx_user_projects_slug ON public.user_projects(slug);

-- Project files (content stored per-file)
CREATE TABLE IF NOT EXISTS public.project_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.user_projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  UNIQUE (project_id, path)
);

ALTER TABLE public.project_files ENABLE ROW LEVEL SECURITY;

-- Owner can manage files of their projects
CREATE POLICY "Users can manage own project files"
  ON public.project_files FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_projects p
      WHERE p.id = project_files.project_id AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_projects p
      WHERE p.id = project_files.project_id AND p.user_id = auth.uid()
    )
  );

-- Anyone can read files of public projects
CREATE POLICY "Public project files are readable"
  ON public.project_files FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_projects p
      WHERE p.id = project_files.project_id AND p.is_public = true
    )
  );

CREATE INDEX idx_project_files_project_id ON public.project_files(project_id);
```

**Step 2: Commit**

```bash
git add supabase/migrations/20260303100000_user_projects.sql
git commit -m "feat: add user_projects and project_files tables with RLS"
```

---

### Task 2: Edge Function — `runner-projects`

**Files:**
- Create: `supabase/functions/runner-projects/index.ts`

**Context:** Follow the same pattern as `supabase/functions/flow-keys/index.ts` — same CORS handling, same `RequestBody` / `ApiResponse` types, same auth helper. The Edge Function uses the Supabase service role client for DB operations.

**Step 1: Create the Edge Function**

The function handles 5 endpoints via a `switch (endpoint)`:

**`/projects/list`** — Returns user's projects (metadata only, no file content):
```typescript
const { data: projects, error: listError } = await supabaseAdmin
  .from('user_projects')
  .select('id, name, slug, network, is_public, active_file, updated_at')
  .eq('user_id', user.id)
  .order('updated_at', { ascending: false });
```

**`/projects/get`** — Returns full project by slug. Auth optional (public projects readable by anyone):
```typescript
const { slug } = data as { slug: string };
// Fetch project
const { data: project } = await supabaseAdmin
  .from('user_projects')
  .select('*')
  .eq('slug', slug)
  .single();
// Check access: owner or public
if (!project) → NOT_FOUND
if (!project.is_public && (!user || project.user_id !== user.id)) → FORBIDDEN
// Fetch files
const { data: files } = await supabaseAdmin
  .from('project_files')
  .select('path, content')
  .eq('project_id', project.id);
// Return project + files
return success({ project, files: files || [] });
```

**`/projects/save`** — Upsert project. If `id` provided, update; otherwise create new:
```typescript
const { id, name, slug, network, is_public, active_file, open_files, folders, files } = data;

if (id) {
  // Update existing — verify ownership
  const { data: existing } = await supabaseAdmin
    .from('user_projects')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();
  if (!existing) → NOT_FOUND

  // Update metadata
  await supabaseAdmin.from('user_projects').update({
    name, network, is_public, active_file, open_files, folders,
    updated_at: new Date().toISOString(),
  }).eq('id', id);

  // Sync files: delete removed, upsert changed
  // 1. Get current file paths
  const { data: currentFiles } = await supabaseAdmin
    .from('project_files')
    .select('path')
    .eq('project_id', id);
  const currentPaths = new Set((currentFiles || []).map(f => f.path));
  const newPaths = new Set(files.map(f => f.path));

  // 2. Delete files no longer present
  const toDelete = [...currentPaths].filter(p => !newPaths.has(p));
  if (toDelete.length > 0) {
    await supabaseAdmin
      .from('project_files')
      .delete()
      .eq('project_id', id)
      .in('path', toDelete);
  }

  // 3. Upsert all current files
  if (files.length > 0) {
    await supabaseAdmin
      .from('project_files')
      .upsert(
        files.map(f => ({ project_id: id, path: f.path, content: f.content })),
        { onConflict: 'project_id,path' }
      );
  }

  return success({ id, slug: existing.slug || slug });
} else {
  // Create new project
  const newSlug = slug || generateSlug(name);
  const { data: created, error: createError } = await supabaseAdmin
    .from('user_projects')
    .insert({
      user_id: user.id, name, slug: newSlug, network: network || 'mainnet',
      is_public: is_public || false, active_file: active_file || 'main.cdc',
      open_files: open_files || ['main.cdc'], folders: folders || [],
    })
    .select('id, slug')
    .single();
  if (createError) → DB_ERROR

  // Insert files
  if (files && files.length > 0) {
    await supabaseAdmin
      .from('project_files')
      .insert(files.map(f => ({ project_id: created.id, path: f.path, content: f.content })));
  }

  return success({ id: created.id, slug: created.slug });
}
```

Slug generation helper:
```typescript
function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'project';
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}
```

**`/projects/delete`** — Delete by id (owner only):
```typescript
const { id } = data as { id: string };
await supabaseAdmin.from('user_projects')
  .delete()
  .eq('id', id)
  .eq('user_id', user.id)
  .select('id')
  .single();
```

**`/projects/fork`** — Fork a public project:
```typescript
const { slug } = data as { slug: string };
// Fetch original project + files
// Verify it's public
// Create new project with user_id = current user, new slug, name = "Fork of <original>"
// Copy all files
// Return new project id + slug
```

**Important:** For `/projects/get`, auth is **optional** — allow unauthenticated requests for public projects. Check `user` before requiring auth; only require auth if project is private.

**Step 2: Commit**

```bash
git add supabase/functions/runner-projects/index.ts
git commit -m "feat: add runner-projects Edge Function for cloud project CRUD"
```

---

### Task 3: Update `flow-keys` Edge Function — Lilico Account Creation

**Files:**
- Modify: `supabase/functions/flow-keys/index.ts` (the `/keys/create` case, lines ~141-178 and ~247-298)

**Context:** The current `createFlowAccount()` function calls a generic API. Replace it with the Lilico API at `https://openapi.lilico.app/v1/address`. The Lilico API returns `{ txId }`, NOT an address directly. The Edge Function must poll a Flow Access Node to get the sealed transaction result, then extract the `flow.AccountCreated` event to get the address.

**Step 1: Replace `createFlowAccount` function**

Replace the existing `createFlowAccount` function (lines 141-179) with:

```typescript
async function createFlowAccount(
  publicKeyHex: string,
  network: 'mainnet' | 'testnet' = 'mainnet',
): Promise<{ address: string }> {
  const lilicoBase = 'https://openapi.lilico.app';
  const endpoint = network === 'testnet'
    ? `${lilicoBase}/v1/address/testnet`
    : `${lilicoBase}/v1/address`;

  // 1. Call Lilico to create account
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: publicKeyHex,
      signatureAlgorithm: 'ECDSA_P256',
      hashAlgorithm: 'SHA3_256',
      weight: 1000,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Lilico API error (${res.status}): ${body}`);
  }

  const json = await res.json();

  // Lilico returns { txId } — need to poll for sealed result
  const txId = json.txId || json.data?.txId;
  if (!txId) {
    // Some endpoints may return address directly
    const address = json.address || json.data?.address;
    if (address) return { address };
    throw new Error(`Lilico API: no txId or address in response: ${JSON.stringify(json)}`);
  }

  // 2. Poll Flow Access Node REST API for sealed transaction
  const accessNode = network === 'testnet'
    ? 'https://rest-testnet.onflow.org'
    : 'https://rest-mainnet.onflow.org';

  const maxAttempts = 30; // 30 * 2s = 60s max
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 2000));

    const txRes = await fetch(`${accessNode}/v1/transaction_results/${txId}`);
    if (!txRes.ok) continue;

    const txResult = await txRes.json();
    if (txResult.status !== 'SEALED') continue;

    if (txResult.error_message) {
      throw new Error(`Account creation tx failed: ${txResult.error_message}`);
    }

    // 3. Extract address from flow.AccountCreated event
    for (const event of txResult.events || []) {
      if (event.type === 'flow.AccountCreated') {
        // Event payload is base64-encoded JSON-CDC
        // The address field is in the event value
        try {
          const payload = JSON.parse(atob(event.payload));
          const address = payload?.value?.fields?.find(
            (f: { name: string }) => f.name === 'address',
          )?.value?.value;
          if (address) return { address: address.replace(/^0x/, '') };
        } catch {
          // Try alternate parsing
        }
      }
    }

    throw new Error('Account created but could not extract address from events');
  }

  throw new Error('Account creation timed out — transaction not sealed within 60s');
}
```

**Step 2: Update the `/keys/create` case to pass `network`**

Change line ~259 from:
```typescript
const account = await createFlowAccount(publicKeyHex);
```
to:
```typescript
const account = await createFlowAccount(publicKeyHex, network || 'mainnet');
```

**Step 3: Remove unused env var references**

Remove `FLOW_ACCOUNT_CREATION_API_URL` and `FLOW_ACCOUNT_CREATION_API_KEY` references since we're now using the Lilico public API directly.

**Step 4: Commit**

```bash
git add supabase/functions/flow-keys/index.ts
git commit -m "feat: integrate Lilico API for Flow account creation in flow-keys"
```

---

### Task 4: Frontend — `useProjects` Hook

**Files:**
- Create: `runner/src/auth/useProjects.ts`

**Context:** This hook provides cloud project CRUD. It calls the `runner-projects` Edge Function via the Supabase client, following the same pattern as `runner/src/auth/useKeys.ts`.

**Step 1: Create the hook**

```typescript
import { useState, useCallback, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from './supabaseClient';
import type { ProjectState, FileEntry } from '../fs/fileSystem';

export interface CloudProject {
  id: string;
  name: string;
  slug: string;
  network: string;
  is_public: boolean;
  active_file: string;
  open_files: string[];
  folders: string[];
  updated_at: string;
}

export interface CloudProjectFull extends CloudProject {
  files: { path: string; content: string }[];
}

export function useProjects() {
  const { accessToken, user } = useAuth();
  const [projects, setProjects] = useState<CloudProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const callEdgeFunction = useCallback(
    async <T = unknown>(
      endpoint: string,
      data: Record<string, unknown> = {},
    ): Promise<T> => {
      if (!supabase) throw new Error('Supabase not configured');
      const headers: Record<string, string> = {};
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      const { data: result, error } = await supabase.functions.invoke(
        'runner-projects',
        { body: { endpoint, data }, headers },
      );
      if (error) throw new Error(error.message || 'Edge function error');
      if (!result.success) throw new Error(result.error?.message || 'Unknown error');
      return result.data as T;
    },
    [accessToken],
  );

  const fetchProjects = useCallback(async () => {
    if (!user || !accessToken) return;
    setLoading(true);
    try {
      const result = await callEdgeFunction<{ projects: CloudProject[] }>('/projects/list');
      setProjects(result.projects);
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [user, accessToken, callEdgeFunction]);

  const getProject = useCallback(async (slug: string): Promise<CloudProjectFull | null> => {
    try {
      const result = await callEdgeFunction<{ project: CloudProject; files: { path: string; content: string }[] }>('/projects/get', { slug });
      return { ...result.project, files: result.files };
    } catch {
      return null;
    }
  }, [callEdgeFunction]);

  const saveProject = useCallback(async (
    project: ProjectState,
    meta: { id?: string; name?: string; slug?: string; network?: string; is_public?: boolean },
  ): Promise<{ id: string; slug: string }> => {
    setSaving(true);
    try {
      const userFiles = project.files.filter(f => !f.readOnly && !f.path.startsWith('deps/'));
      const result = await callEdgeFunction<{ id: string; slug: string }>('/projects/save', {
        id: meta.id,
        name: meta.name || 'Untitled',
        slug: meta.slug,
        network: meta.network || 'mainnet',
        is_public: meta.is_public || false,
        active_file: project.activeFile,
        open_files: project.openFiles,
        folders: project.folders,
        files: userFiles.map(f => ({ path: f.path, content: f.content })),
      });
      setLastSaved(new Date());
      return result;
    } finally {
      setSaving(false);
    }
  }, [callEdgeFunction]);

  const deleteProject = useCallback(async (id: string) => {
    await callEdgeFunction('/projects/delete', { id });
    await fetchProjects();
  }, [callEdgeFunction, fetchProjects]);

  const forkProject = useCallback(async (slug: string): Promise<{ id: string; slug: string }> => {
    const result = await callEdgeFunction<{ id: string; slug: string }>('/projects/fork', { slug });
    await fetchProjects();
    return result;
  }, [callEdgeFunction, fetchProjects]);

  // Auto-fetch projects when user is authenticated
  useEffect(() => {
    if (user) fetchProjects();
  }, [user, fetchProjects]);

  return {
    projects, loading, saving, lastSaved,
    fetchProjects, getProject, saveProject, deleteProject, forkProject,
  };
}
```

**Step 2: Commit**

```bash
git add runner/src/auth/useProjects.ts
git commit -m "feat: add useProjects hook for cloud project CRUD"
```

---

### Task 5: Frontend — Project Selector Component

**Files:**
- Create: `runner/src/components/ProjectSelector.tsx`

**Context:** A dropdown component placed in the sidebar header (above FileExplorer). Shows the current project name, and a dropdown list of all user's cloud projects. Includes "New Project" button, share toggle, rename, and delete.

**Step 1: Create the component**

```typescript
import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Plus, Globe, Lock, Trash2, Pencil, Copy, Check } from 'lucide-react';
import type { CloudProject } from '../auth/useProjects';

interface ProjectSelectorProps {
  projects: CloudProject[];
  currentProject: { id?: string; name: string; slug?: string; is_public?: boolean } | null;
  onSelectProject: (slug: string) => void;
  onNewProject: () => void;
  onRename: (id: string, name: string) => void;
  onTogglePublic: (id: string, isPublic: boolean) => void;
  onDelete: (id: string) => void;
  saving: boolean;
  lastSaved: Date | null;
}

export default function ProjectSelector({
  projects,
  currentProject,
  onSelectProject,
  onNewProject,
  onRename,
  onTogglePublic,
  onDelete,
  saving,
  lastSaved,
}: ProjectSelectorProps) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleCopyLink = () => {
    if (!currentProject?.slug) return;
    navigator.clipboard.writeText(`${window.location.origin}?project=${currentProject.slug}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRenameSubmit = () => {
    if (currentProject?.id && editName.trim()) {
      onRename(currentProject.id, editName.trim());
    }
    setEditing(false);
  };

  return (
    <div ref={dropdownRef} className="relative">
      {/* Current project button */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors"
      >
        <span className="truncate flex-1 text-left font-medium">
          {currentProject?.name || 'Local Project'}
        </span>
        {/* Save indicator */}
        {saving && <span className="text-[9px] text-amber-400">Saving...</span>}
        {!saving && lastSaved && <span className="text-[9px] text-zinc-600">Saved</span>}
        <ChevronDown className={`w-3 h-3 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 top-full w-64 mt-0.5 bg-zinc-800 border border-zinc-700 shadow-xl z-50 max-h-80 overflow-y-auto">
          {/* Current project actions */}
          {currentProject?.id && (
            <div className="px-2 py-1.5 border-b border-zinc-700 flex items-center gap-1">
              {editing ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameSubmit();
                    if (e.key === 'Escape') setEditing(false);
                  }}
                  onBlur={handleRenameSubmit}
                  className="flex-1 bg-zinc-900 text-xs text-zinc-200 px-1.5 py-0.5 border border-zinc-600 focus:outline-none"
                />
              ) : (
                <>
                  <button
                    onClick={() => { setEditing(true); setEditName(currentProject.name); }}
                    className="text-zinc-500 hover:text-zinc-300 p-0.5"
                    title="Rename"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => currentProject.id && onTogglePublic(currentProject.id, !currentProject.is_public)}
                    className="text-zinc-500 hover:text-zinc-300 p-0.5"
                    title={currentProject.is_public ? 'Make private' : 'Make public'}
                  >
                    {currentProject.is_public ? <Globe className="w-3 h-3 text-emerald-500" /> : <Lock className="w-3 h-3" />}
                  </button>
                  {currentProject.is_public && (
                    <button
                      onClick={handleCopyLink}
                      className="text-zinc-500 hover:text-zinc-300 p-0.5"
                      title="Copy share link"
                    >
                      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  )}
                  <div className="flex-1" />
                  <button
                    onClick={() => {
                      if (currentProject.id && confirm('Delete this project?')) {
                        onDelete(currentProject.id);
                        setOpen(false);
                      }
                    }}
                    className="text-zinc-500 hover:text-red-400 p-0.5"
                    title="Delete project"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
          )}

          {/* New project */}
          <button
            onClick={() => { onNewProject(); setOpen(false); }}
            className="flex items-center gap-1.5 w-full px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50 transition-colors"
          >
            <Plus className="w-3 h-3" />
            New Project
          </button>

          {/* Divider */}
          {projects.length > 0 && <div className="border-t border-zinc-700" />}

          {/* Project list */}
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => { onSelectProject(p.slug); setOpen(false); }}
              className={`flex items-center gap-2 w-full px-3 py-2 text-xs transition-colors ${
                p.id === currentProject?.id
                  ? 'bg-zinc-700/50 text-zinc-200'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/30'
              }`}
            >
              <span className="truncate flex-1 text-left">{p.name}</span>
              <span className="text-[9px] text-zinc-600 shrink-0">{p.network}</span>
              {p.is_public && <Globe className="w-2.5 h-2.5 text-zinc-600 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add runner/src/components/ProjectSelector.tsx
git commit -m "feat: add ProjectSelector dropdown component"
```

---

### Task 6: Frontend — Integrate Cloud Projects into App.tsx

**Files:**
- Modify: `runner/src/App.tsx`
- Modify: `runner/src/fs/fileSystem.ts`

**Context:** This is the main integration task. We need to:
1. Add `useProjects` hook to `App`
2. Track current cloud project metadata (`cloudProjectId`, `cloudProjectName`, `cloudProjectSlug`, etc.)
3. Add auto-save debounce to cloud when logged in
4. Handle URL `?project=<slug>` to load shared projects
5. Add `ProjectSelector` to sidebar above FileExplorer
6. Handle new project, select project, rename, delete, share toggle

**Step 1: Add a `saveProject` overload to `fileSystem.ts`**

Add a new export to `runner/src/fs/fileSystem.ts` that returns the saveable data without writing to localStorage, so the cloud sync can use it:

```typescript
/** Extract saveable project data (excludes deps, readOnly files) */
export function getSaveableProject(state: ProjectState): ProjectState {
  return {
    ...state,
    files: state.files.filter((f) => !f.readOnly && !f.path.startsWith('deps/')),
    folders: (state.folders || [])
      .map((folder) => normalizeFolderPath(folder))
      .filter((folder): folder is string => !!folder),
  };
}
```

**Step 2: Update App.tsx**

Add imports:
```typescript
import { useProjects, type CloudProject } from './auth/useProjects';
import ProjectSelector from './components/ProjectSelector';
```

Add state for cloud project tracking (after existing state declarations):
```typescript
const {
  projects: cloudProjects, loading: projectsLoading,
  saving: projectSaving, lastSaved, getProject, saveProject: cloudSave,
  deleteProject: cloudDelete, fetchProjects,
} = useProjects();

const [cloudMeta, setCloudMeta] = useState<{
  id?: string; name: string; slug?: string; is_public?: boolean;
}>({ name: 'Untitled' });
```

Add cloud auto-save effect (alongside existing localStorage save):
```typescript
// Cloud auto-save (debounced 2s)
useEffect(() => {
  if (!user || !cloudMeta.id) return;
  const timer = setTimeout(async () => {
    try {
      await cloudSave(project, {
        id: cloudMeta.id,
        name: cloudMeta.name,
        slug: cloudMeta.slug,
        network,
        is_public: cloudMeta.is_public,
      });
    } catch {
      // Silently fail — localStorage is the fallback
    }
  }, 2000);
  return () => clearTimeout(timer);
}, [project, network, user, cloudMeta, cloudSave]);
```

Handle URL `?project=<slug>` on mount:
```typescript
// Load shared project from URL
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const projectSlug = params.get('project');
  if (!projectSlug) return;

  (async () => {
    const full = await getProject(projectSlug);
    if (!full) return;
    const files = full.files.map(f => ({ path: f.path, content: f.content }));
    if (files.length === 0) return;
    setProject({
      files,
      activeFile: full.active_file || files[0].path,
      openFiles: full.open_files || [files[0].path],
      folders: full.folders || [],
    });
    setCloudMeta({
      id: full.id,
      name: full.name,
      slug: full.slug,
      is_public: full.is_public,
    });
    setNetwork(full.network as FlowNetwork);
  })();
}, [getProject]);
```

Add project selector in sidebar (inside the `showExplorer` block, before `<FileExplorer>`):
```typescript
{/* Project selector (cloud) */}
{user && (
  <ProjectSelector
    projects={cloudProjects}
    currentProject={cloudMeta.id ? cloudMeta : null}
    onSelectProject={async (slug) => {
      const full = await getProject(slug);
      if (!full) return;
      const files = full.files.map(f => ({ path: f.path, content: f.content }));
      setProject({
        files: files.length > 0 ? files : [{ path: 'main.cdc', content: '' }],
        activeFile: full.active_file || files[0]?.path || 'main.cdc',
        openFiles: full.open_files || [files[0]?.path || 'main.cdc'],
        folders: full.folders || [],
      });
      setCloudMeta({
        id: full.id, name: full.name, slug: full.slug, is_public: full.is_public,
      });
      setNetwork(full.network as FlowNetwork);
    }}
    onNewProject={async () => {
      const result = await cloudSave(
        { files: [{ path: 'main.cdc', content: DEFAULT_CODE }], activeFile: 'main.cdc', openFiles: ['main.cdc'], folders: [] },
        { name: 'Untitled', network },
      );
      setProject({ files: [{ path: 'main.cdc', content: DEFAULT_CODE }], activeFile: 'main.cdc', openFiles: ['main.cdc'], folders: [] });
      setCloudMeta({ id: result.id, name: 'Untitled', slug: result.slug });
      await fetchProjects();
    }}
    onRename={async (id, name) => {
      setCloudMeta(prev => ({ ...prev, name }));
      await cloudSave(project, { ...cloudMeta, id, name });
      await fetchProjects();
    }}
    onTogglePublic={async (id, isPublic) => {
      setCloudMeta(prev => ({ ...prev, is_public: isPublic }));
      await cloudSave(project, { ...cloudMeta, id, is_public: isPublic });
      await fetchProjects();
    }}
    onDelete={async (id) => {
      await cloudDelete(id);
      // Reset to localStorage default
      setCloudMeta({ name: 'Untitled' });
      setProject(loadProject());
    }}
    saving={projectSaving}
    lastSaved={lastSaved}
  />
)}
```

Import `DEFAULT_CODE` from `fileSystem.ts` (you'll need to export it):
```typescript
// In fileSystem.ts, change:
const DEFAULT_CODE = `...`
// to:
export const DEFAULT_CODE = `...`
```

Also import `loadProject` in the callback (already imported at top).

**Step 3: Handle "Save to cloud" prompt on login with unsaved localStorage work**

When user logs in and has localStorage project data but no cloud project ID, show a subtle banner:
```typescript
{user && !cloudMeta.id && project.files.some(f => f.content.trim() && f.content !== DEFAULT_CODE) && (
  <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border-b border-emerald-500/20 text-[11px] text-emerald-300">
    <span>Save your current project to the cloud?</span>
    <button
      onClick={async () => {
        const result = await cloudSave(project, { name: 'My Project', network });
        setCloudMeta({ id: result.id, name: 'My Project', slug: result.slug });
        await fetchProjects();
      }}
      className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded transition-colors"
    >
      Save
    </button>
    <button
      onClick={() => setCloudMeta(prev => ({ ...prev, id: 'dismissed' }))}
      className="text-zinc-500 hover:text-zinc-400"
    >
      Dismiss
    </button>
  </div>
)}
```

**Step 4: Build and verify**

```bash
cd runner && NODE_OPTIONS="--max-old-space-size=8192" bun run build
```

**Step 5: Commit**

```bash
git add runner/src/App.tsx runner/src/fs/fileSystem.ts
git commit -m "feat: integrate cloud project saving into Runner App"
```

---

### Task 7: Update `.env.example` and Cleanup

**Files:**
- Modify: `runner/.env.example`

**Step 1: Update .env.example**

Add a comment noting the cloud projects functionality:

```env
# Supabase Auth (required for custodial key management + cloud projects)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_GOTRUE_URL=
```

No new env vars needed for the runner — the Edge Functions use server-side env vars configured in Supabase.

**Step 2: Build verify everything**

```bash
cd runner && NODE_OPTIONS="--max-old-space-size=8192" bun run build
cd ../frontend && bun run build
```

**Step 3: Commit**

```bash
git add runner/.env.example
git commit -m "chore: update .env.example comments for cloud projects"
```

---

### Task 8: Final Build Verification & Push

**Step 1: Full build of both frontend and runner**

```bash
cd frontend && bun run build
cd ../runner && NODE_OPTIONS="--max-old-space-size=8192" bun run build
```

Both must exit 0 with no TypeScript errors.

**Step 2: Push to main**

```bash
git pull --rebase origin main
git push origin HEAD:main
```

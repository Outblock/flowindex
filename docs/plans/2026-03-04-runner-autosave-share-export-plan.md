# Runner Auto-Save, Share & Export — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make cloud save automatic for logged-in users, add read-only + fork for shared projects, and add ZIP export.

**Architecture:** Modify App.tsx auto-save effect to create projects silently, add ownership detection to shared project loading, add fork banner UI, add client-side ZIP export via jszip.

**Tech Stack:** React 19, Supabase Edge Functions, jszip, Vite

---

### Task 1: Add jszip dependency

**Files:**
- Modify: `runner/package.json`

**Step 1: Install jszip**

Run: `cd runner && bun add jszip && bun add -d @types/jszip`

**Step 2: Verify install**

Run: `cd runner && bun run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add runner/package.json runner/bun.lockb
git commit -m "chore: add jszip dependency for project export"
```

---

### Task 2: Silent auto-create cloud project

**Files:**
- Modify: `runner/src/App.tsx`

**Step 1: Add auto-creating ref guard**

Add after `cloudMeta` state declaration (~line 206):

```tsx
const autoCreatingRef = useRef(false);
```

**Step 2: Replace cloud auto-save effect**

Replace the existing effect at lines 242-259 with:

```tsx
// Cloud auto-save (debounced 2s) — auto-creates if no cloud project yet
useEffect(() => {
  if (!user) return;
  // Skip if viewing someone else's shared project (no cloudMeta.id and viewingShared)
  if (viewingShared) return;
  // Skip the special '_dismissed' value (will be removed, but guard anyway)
  if (cloudMeta.id === '_dismissed') return;

  const timer = setTimeout(async () => {
    if (autoCreatingRef.current) return;
    try {
      if (cloudMeta.id) {
        // Update existing project
        await cloudSave(project, {
          id: cloudMeta.id,
          name: cloudMeta.name,
          slug: cloudMeta.slug,
          network,
          is_public: cloudMeta.is_public,
        });
      } else {
        // Auto-create new cloud project
        autoCreatingRef.current = true;
        const result = await cloudSave(project, { name: 'Untitled', network });
        setCloudMeta({ id: result.id, name: 'Untitled', slug: result.slug });
        await fetchProjects();
        autoCreatingRef.current = false;
      }
    } catch {
      autoCreatingRef.current = false;
    }
  }, 2000);
  return () => clearTimeout(timer);
}, [project, network, user, cloudMeta, cloudSave, viewingShared, fetchProjects]);
```

**Step 3: Remove the "Save to Cloud?" banner**

Delete lines 635-655 (the entire banner `<div>` block starting with `{user && !cloudMeta.id && project.files.some(...)`).

**Step 4: Verify build**

Run: `cd runner && bun run build`
Expected: Build succeeds (will fail until Task 3 adds `viewingShared` state — that's fine, commit together)

---

### Task 3: Read-only shared projects + fork banner

**Files:**
- Modify: `runner/src/App.tsx`
- Modify: `runner/src/auth/useProjects.ts`

**Step 1: Export user_id from CloudProjectFull**

In `useProjects.ts`, the `CloudProjectFull` interface doesn't include `user_id`. The edge function already returns it via `select('*')`. Add it:

```tsx
export interface CloudProjectFull extends CloudProject {
  user_id: string;
  files: { path: string; content: string }[];
}
```

**Step 2: Add viewingShared state to App.tsx**

Add after `cloudMeta` state (~line 206):

```tsx
const [viewingShared, setViewingShared] = useState<string | null>(null); // slug of non-owned shared project
```

**Step 3: Update shared project loader effect**

Replace the effect at lines 261-287 with:

```tsx
// Load shared project from URL ?project=slug
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const projectSlug = params.get('project');
  if (!projectSlug) return;

  (async () => {
    const full = await getProject(projectSlug);
    if (!full) return;
    const isOwner = user && full.user_id === user.id;
    const files = full.files.map((f: { path: string; content: string }) => ({
      path: f.path,
      content: f.content,
      ...(isOwner ? {} : { readOnly: true }),
    }));
    if (files.length === 0) return;
    setProject({
      files,
      activeFile: full.active_file || files[0].path,
      openFiles: full.open_files || [files[0].path],
      folders: full.folders || [],
    });
    if (isOwner) {
      setCloudMeta({
        id: full.id, name: full.name, slug: full.slug, is_public: full.is_public,
      });
      setViewingShared(null);
    } else {
      // Non-owner: don't set cloudMeta.id (prevents auto-save)
      setCloudMeta({ name: full.name });
      setViewingShared(projectSlug);
    }
    setNetwork(full.network as FlowNetwork);
  })();
// eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

**Step 4: Add fork banner UI**

Add after the `pendingAiRevert` banner block (~line 633, where the old save banner was):

```tsx
{viewingShared && (
  <div className="flex items-center gap-2 px-4 py-2 border-b border-blue-500/20 bg-blue-500/10 shrink-0">
    <span className="text-[11px] text-blue-300 flex-1">
      Viewing a shared project (read-only).
    </span>
    {user ? (
      <button
        onClick={async () => {
          try {
            const result = await forkProject(viewingShared);
            // Load the forked project
            const full = await getProject(result.slug);
            if (!full) return;
            const files = full.files.map((f: { path: string; content: string }) => ({
              path: f.path, content: f.content,
            }));
            setProject({
              files: files.length > 0 ? files : [{ path: 'main.cdc', content: '' }],
              activeFile: full.active_file || files[0]?.path || 'main.cdc',
              openFiles: full.open_files || [files[0]?.path || 'main.cdc'],
              folders: full.folders || [],
            });
            setCloudMeta({ id: full.id, name: full.name, slug: full.slug, is_public: full.is_public });
            setViewingShared(null);
            history.replaceState(null, '', `?project=${result.slug}`);
          } catch {
            // fork failed
          }
        }}
        className="px-2 py-0.5 bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium transition-colors"
      >
        Fork
      </button>
    ) : (
      <a
        href={`https://flowindex.io/developer/login?redirect=${encodeURIComponent(window.location.href)}`}
        className="px-2 py-0.5 bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium transition-colors"
      >
        Sign in to fork
      </a>
    )}
  </div>
)}
```

**Step 5: Destructure forkProject from useProjects**

Update the destructuring (~line 194):

```tsx
const {
  projects: cloudProjects,
  saving: projectSaving,
  lastSaved,
  getProject,
  saveProject: cloudSave,
  deleteProject: cloudDelete,
  forkProject,
  fetchProjects,
} = useProjects();
```

**Step 6: Verify build**

Run: `cd runner && bun run build`
Expected: Build succeeds

**Step 7: Commit**

```bash
git add runner/src/App.tsx runner/src/auth/useProjects.ts
git commit -m "feat: auto-create cloud projects, read-only shared views with fork"
```

---

### Task 4: Export project as ZIP

**Files:**
- Modify: `runner/src/components/ProjectSelector.tsx`
- Modify: `runner/src/App.tsx` (pass handler to ProjectSelector)

**Step 1: Add export handler to ProjectSelector**

Add to `ProjectSelectorProps` interface:

```tsx
onExport: () => void;
```

Add import and the Download icon:

```tsx
import { ChevronDown, Plus, Globe, Lock, Trash2, Pencil, Copy, Check, Download } from 'lucide-react';
```

Add the export button in the current project actions area (after the copy/share button, before the flex spacer `<div className="flex-1" />`):

```tsx
<button
  onClick={() => { onExport(); setOpen(false); }}
  className="text-zinc-500 hover:text-zinc-300 p-0.5"
  title="Export as ZIP"
>
  <Download className="w-3 h-3" />
</button>
```

Also add the prop to the destructured params.

**Step 2: Add export handler in App.tsx**

Add import at top of App.tsx:

```tsx
import JSZip from 'jszip';
```

Add handler before the return statement:

```tsx
const handleExportZip = useCallback(async () => {
  const zip = new JSZip();
  const userFiles = project.files.filter(f => !f.readOnly && !f.path.startsWith('deps/'));
  for (const f of userFiles) {
    zip.file(f.path, f.content);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const name = (cloudMeta.name || 'project').replace(/[^a-zA-Z0-9_-]/g, '_');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}, [project, cloudMeta.name]);
```

Pass to ProjectSelector:

```tsx
<ProjectSelector
  ...existing props...
  onExport={handleExportZip}
/>
```

**Step 3: Also add export for non-cloud projects**

The export should work even without a cloud project. Add an export button outside the ProjectSelector for when user is not logged in or viewing local project. Actually — simpler approach: also make the export button available in the file explorer header or keep it only in ProjectSelector (which only shows for logged-in users).

For now, export is available in ProjectSelector dropdown only (logged-in users with cloud projects). This is sufficient.

**Step 4: Verify build**

Run: `cd runner && bun run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add runner/src/App.tsx runner/src/components/ProjectSelector.tsx
git commit -m "feat: add ZIP export for projects"
```

---

### Task 5: Final build verification and push

**Step 1: Full build check**

Run: `cd runner && bun run build`
Expected: Build succeeds with no errors

**Step 2: Push to main**

```bash
git pull --rebase origin main
git push origin HEAD:main
```

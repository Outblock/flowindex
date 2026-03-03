# Runner: Auto-Save, Share & Export Improvements

**Date**: 2026-03-04

## Problem

Cloud save, share, and project management features exist in code but have UX gaps:
1. Auto-save requires manual "Save to Cloud" click first; banner is dismissable and never returns
2. Shared project URLs (`?project=slug`) set cloudMeta to owner's project, causing silent save failures for non-owners
3. No fork UI for non-owner viewers of shared projects
4. No way to export/download project files

## Design

### 1. Silent Auto-Create Cloud Project

**Behavior**: When a logged-in user has a local project with no `cloudMeta.id`, the first debounced cloud save (2s) auto-creates a cloud project silently.

**Changes to App.tsx**:
- Remove the "Save to Cloud?" banner (lines 635-655)
- Remove `_dismissed` state handling
- Modify cloud auto-save effect (lines 242-259): if `user` exists but `cloudMeta.id` is missing, call `cloudSave()` without an `id` to create a new project, then set `cloudMeta` with the returned `id`/`slug`
- On app init with logged-in user (no `?project=`/`?code=` params): auto-create triggers naturally via the debounced effect

### 2. Read-Only Shared Projects + Fork Button

**Behavior**: Non-owners viewing `?project=slug` see read-only code with a fork banner.

**Changes**:
- `runner-projects` edge function `/projects/get`: already returns `user_id` in the full project response (it does `select('*')`)
- App.tsx shared project loader (lines 261-287):
  - Compare `full.user_id` with `user?.id`
  - **Owner**: load normally, set cloudMeta (existing behavior)
  - **Non-owner/anonymous**: set files with `readOnly: true`, do NOT set `cloudMeta.id` (prevents auto-save)
  - Store a `viewingShared` state: `{ slug, ownerProject: true/false }`
- New fork banner (shown when viewing non-owned shared project):
  - Logged-in: "Viewing a shared project. **Fork** to make your own copy."
  - Anonymous: "Viewing a shared project. **Sign in** to fork it."
  - Fork button calls `forkProject(slug)`, loads the forked project into editor, updates URL

### 3. Export as ZIP

**Behavior**: Download all user files as a ZIP archive.

**Implementation**:
- Add `jszip` dependency (`bun add jszip`)
- Export button in ProjectSelector dropdown (Download icon) or as a standalone action
- Collects all non-readOnly, non-deps files from project state
- Creates ZIP with folder structure preserved
- Triggers browser download as `{project-name}.zip`
- Works for both cloud and local projects (purely client-side)

## Files to Modify

| File | Change |
|------|--------|
| `runner/src/App.tsx` | Auto-create logic, fork banner, remove save banner |
| `runner/src/components/ProjectSelector.tsx` | Add export button |
| `runner/src/auth/useProjects.ts` | No changes needed (fork already exists) |
| `runner/package.json` | Add `jszip` dependency |

## Edge Cases

- **Race condition on auto-create**: Use a ref to prevent double-creation while the first save is in flight
- **URL cleanup after fork**: Replace `?project=original-slug` with `?project=forked-slug` via `history.replaceState`
- **Anonymous user with `?code=` param**: No auto-create (no user), works as before
- **Iframe mode**: Auto-create should still work if user is logged in

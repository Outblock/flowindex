# Editor Diff Mode — Cursor-Style Inline Diff for AI Edits

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current "blind overwrite" AI edit flow with an inline diff view where users see exactly what changed and can Accept/Reject per-hunk or all-at-once, while eliminating unnecessary re-renders during streaming.

**Architecture:** AI edits no longer write directly to `project` state. Instead they accumulate in a `pendingDiff` map (`{ [filePath]: { original, modified } }`). When pending diffs exist for the active file, CadenceEditor switches from `<Editor>` to `<DiffEditor>` in inline mode. A floating toolbar provides Accept All / Reject All, and Monaco zone widgets provide per-hunk Accept/Reject buttons. Streaming tokens update `pendingDiff.modified` without touching the editor (no re-render until diff mode activates).

**Tech Stack:** Monaco DiffEditor (`@monaco-editor/react` DiffEditor component — already bundled), Monaco zone widgets API for per-hunk controls, React state for pending diff tracking.

---

## Task 1: Add `pendingDiff` State to App.tsx

**Files:**
- Modify: `runner/src/App.tsx`

**Step 1: Define the PendingDiff type and state**

Add above the `App` component:

```typescript
interface PendingDiffEntry {
  original: string;
  modified: string;
  assistantId?: string;
}

type PendingDiffMap = Record<string, PendingDiffEntry>;
```

Inside `App()`, add state:

```typescript
const [pendingDiffs, setPendingDiffs] = useState<PendingDiffMap>({});
```

**Step 2: Derive whether the active file has a pending diff**

```typescript
const activePendingDiff = pendingDiffs[project.activeFile] ?? null;
```

**Step 3: Commit**

```bash
git add runner/src/App.tsx
git commit -m "feat(runner): add pendingDiff state for diff mode"
```

---

## Task 2: Redirect AI Auto-Apply to pendingDiff Instead of project

**Files:**
- Modify: `runner/src/App.tsx`

**Step 1: Rewrite `handleAutoApplyEdits` to write into `pendingDiffs` instead of `setProject`**

The key change: instead of mutating project state, we compute what the modified code *would* look like and store it in `pendingDiffs`.

```typescript
const handleAutoApplyEdits = useCallback((
  edits: { path?: string; code: string; patches?: { search: string; replace: string }[] }[],
  meta?: { assistantId?: string; streaming?: boolean },
) => {
  if (!Array.isArray(edits) || edits.length === 0) return;

  const sanitized = edits.filter((e) => {
    if (e?.patches && e.patches.length > 0) return true;
    return typeof e?.code === 'string' && e.code.trim().length > 0;
  });
  if (sanitized.length === 0) return;

  setPendingDiffs((prev) => {
    const next = { ...prev };

    for (const edit of sanitized) {
      const targetPath = edit.path || project.activeFile;
      const currentContent = getFileContent(project, targetPath) || '';
      const original = next[targetPath]?.original ?? currentContent;

      let modified: string;
      if (edit.patches && edit.patches.length > 0) {
        // Apply patches to the latest modified version (or original if first edit)
        modified = next[targetPath]?.modified ?? currentContent;
        for (const { search, replace } of edit.patches) {
          const idx = modified.indexOf(search);
          if (idx >= 0) {
            modified = modified.slice(0, idx) + replace + modified.slice(idx + search.length);
          }
        }
      } else {
        modified = edit.code;
      }

      next[targetPath] = { original, modified, assistantId: meta?.assistantId };
    }

    return next;
  });
}, [project]);
```

**Step 2: Update `handleKeepAiEdits` to apply all pending diffs to project**

```typescript
const handleAcceptAllDiffs = useCallback(() => {
  setProject((prev) => {
    let next = prev;
    for (const [path, entry] of Object.entries(pendingDiffs)) {
      next = updateFileContent(next, path, entry.modified);
    }
    return next;
  });
  setPendingDiffs({});
}, [pendingDiffs]);
```

**Step 3: Update `handleRevertAiEdits` to just clear pending diffs**

```typescript
const handleRejectAllDiffs = useCallback(() => {
  setPendingDiffs({});
}, []);
```

**Step 4: Add per-hunk accept handler**

```typescript
const handleAcceptHunk = useCallback((filePath: string, hunkOriginal: string, hunkModified: string) => {
  const entry = pendingDiffs[filePath];
  if (!entry) return;

  // Apply this specific hunk to the project
  setProject((prev) => {
    const current = getFileContent(prev, filePath) || '';
    const idx = current.indexOf(hunkOriginal);
    if (idx < 0) return prev;
    const updated = current.slice(0, idx) + hunkModified + current.slice(idx + hunkOriginal.length);
    return updateFileContent(prev, filePath, updated);
  });

  // Recompute remaining diff
  setPendingDiffs((prev) => {
    const entry = prev[filePath];
    if (!entry) return prev;

    // Update original to reflect the accepted hunk
    const newOriginal = getFileContent(project, filePath) || '';
    // Check if there are still differences
    // We need to re-derive this after the project update, so we'll use a simpler approach:
    // Remove the entry and let React re-derive if needed
    const next = { ...prev };
    delete next[filePath];
    return next;
  });
}, [pendingDiffs, project]);

const handleRejectHunk = useCallback((filePath: string, hunkOriginal: string, _hunkModified: string) => {
  const entry = pendingDiffs[filePath];
  if (!entry) return;

  // Remove this hunk from the modified version (revert to original for this section)
  setPendingDiffs((prev) => {
    const entry = prev[filePath];
    if (!entry) return prev;

    const modified = entry.modified;
    // Replace the hunkModified text back to hunkOriginal in the modified version
    // This effectively "rejects" just this hunk
    const idx = modified.indexOf(_hunkModified);
    if (idx < 0) {
      // Hunk not found in modified — might already be rejected
      return prev;
    }
    const newModified = modified.slice(0, idx) + hunkOriginal + modified.slice(idx + _hunkModified.length);

    // If newModified equals original, remove the entry entirely
    if (newModified === entry.original) {
      const next = { ...prev };
      delete next[filePath];
      return next;
    }

    return { ...prev, [filePath]: { ...entry, modified: newModified } };
  });
}, [pendingDiffs]);
```

**Step 5: Remove the old `pendingAiRevert` state and its revert bar**

Delete `pendingAiRevert`, `setPendingAiRevert`, `handleKeepAiEdits`, `handleRevertAiEdits`, and the amber revert bar JSX.

**Step 6: Commit**

```bash
git add runner/src/App.tsx
git commit -m "feat(runner): redirect AI edits to pendingDiff instead of project state"
```

---

## Task 3: Create CadenceDiffEditor Component

**Files:**
- Create: `runner/src/editor/CadenceDiffEditor.tsx`

**Step 1: Create the diff editor component**

This component wraps Monaco's `DiffEditor` in inline mode with Cadence language support.

```tsx
import { useRef, useCallback, useEffect, useState } from 'react';
import { DiffEditor, type DiffOnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { registerCadenceLanguage, CADENCE_LANGUAGE_ID } from './cadenceLanguage';
import { registerCadenceThemes, CADENCE_DARK_THEME } from './cadenceTheme';
import { Check, X, CheckCheck, XCircle } from 'lucide-react';

interface HunkInfo {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
  originalText: string;
  modifiedText: string;
}

interface CadenceDiffEditorProps {
  original: string;
  modified: string;
  path?: string;
  darkMode?: boolean;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onAcceptHunk: (hunkOriginal: string, hunkModified: string) => void;
  onRejectHunk: (hunkOriginal: string, hunkModified: string) => void;
}

export default function CadenceDiffEditor({
  original,
  modified,
  path,
  darkMode = true,
  onAcceptAll,
  onRejectAll,
  onAcceptHunk,
  onRejectHunk,
}: CadenceDiffEditorProps) {
  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
  const [hunks, setHunks] = useState<HunkInfo[]>([]);
  const zoneIdsRef = useRef<string[]>([]);

  const handleBeforeMount = useCallback((monaco: typeof import('monaco-editor')) => {
    registerCadenceLanguage(monaco);
    registerCadenceThemes(monaco);
  }, []);

  const handleMount: DiffOnMount = useCallback((editor) => {
    diffEditorRef.current = editor;

    // Extract hunks once diff is computed
    const updateHunks = () => {
      const changes = editor.getLineChanges();
      if (!changes) return;

      const origModel = editor.getOriginalEditor().getModel();
      const modModel = editor.getModifiedEditor().getModel();
      if (!origModel || !modModel) return;

      const newHunks: HunkInfo[] = changes.map((change) => {
        const origStart = change.originalStartLineNumber;
        const origEnd = change.originalEndLineNumber || change.originalStartLineNumber;
        const modStart = change.modifiedStartLineNumber;
        const modEnd = change.modifiedEndLineNumber || change.modifiedStartLineNumber;

        const origLines: string[] = [];
        if (change.originalEndLineNumber > 0) {
          for (let i = origStart; i <= origEnd; i++) {
            origLines.push(origModel.getLineContent(i));
          }
        }

        const modLines: string[] = [];
        if (change.modifiedEndLineNumber > 0) {
          for (let i = modStart; i <= modEnd; i++) {
            modLines.push(modModel.getLineContent(i));
          }
        }

        return {
          originalStartLineNumber: origStart,
          originalEndLineNumber: origEnd,
          modifiedStartLineNumber: modStart,
          modifiedEndLineNumber: modEnd,
          originalText: origLines.join('\n'),
          modifiedText: modLines.join('\n'),
        };
      });

      setHunks(newHunks);
    };

    // Monaco computes diff asynchronously, so wait a tick
    setTimeout(updateHunks, 100);
    editor.onDidUpdateDiff(updateHunks);
  }, []);

  // Add zone widgets for per-hunk buttons
  useEffect(() => {
    const editor = diffEditorRef.current;
    if (!editor || hunks.length === 0) return;

    const modEditor = editor.getModifiedEditor();

    // Clean up old zones
    for (const id of zoneIdsRef.current) {
      modEditor.changeViewZones((accessor) => {
        accessor.removeZone(id);
      });
    }
    zoneIdsRef.current = [];

    // Add new zones after each hunk
    modEditor.changeViewZones((accessor) => {
      for (const hunk of hunks) {
        const afterLine = hunk.modifiedEndLineNumber || hunk.modifiedStartLineNumber;

        const domNode = document.createElement('div');
        domNode.className = 'diff-hunk-actions';
        domNode.style.cssText = 'display:flex;gap:4px;padding:2px 0 2px 48px;align-items:center;';

        const acceptBtn = document.createElement('button');
        acceptBtn.textContent = 'Accept';
        acceptBtn.className = 'diff-hunk-btn diff-hunk-accept';
        acceptBtn.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:1px 8px;font-size:11px;border-radius:3px;border:1px solid rgba(52,211,153,0.4);color:rgb(110,231,183);background:rgba(16,185,129,0.1);cursor:pointer;';
        acceptBtn.onmouseenter = () => { acceptBtn.style.background = 'rgba(16,185,129,0.2)'; };
        acceptBtn.onmouseleave = () => { acceptBtn.style.background = 'rgba(16,185,129,0.1)'; };
        acceptBtn.onclick = () => onAcceptHunk(hunk.originalText, hunk.modifiedText);

        const rejectBtn = document.createElement('button');
        rejectBtn.textContent = 'Reject';
        rejectBtn.className = 'diff-hunk-btn diff-hunk-reject';
        rejectBtn.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:1px 8px;font-size:11px;border-radius:3px;border:1px solid rgba(239,68,68,0.4);color:rgb(252,165,165);background:rgba(239,68,68,0.1);cursor:pointer;';
        rejectBtn.onmouseenter = () => { rejectBtn.style.background = 'rgba(239,68,68,0.2)'; };
        rejectBtn.onmouseleave = () => { rejectBtn.style.background = 'rgba(239,68,68,0.1)'; };
        rejectBtn.onclick = () => onRejectHunk(hunk.originalText, hunk.modifiedText);

        domNode.appendChild(acceptBtn);
        domNode.appendChild(rejectBtn);

        const id = accessor.addZone({
          afterLineNumber: afterLine,
          heightInLines: 1,
          domNode,
        });
        zoneIdsRef.current.push(id);
      }
    });

    return () => {
      const mod = diffEditorRef.current?.getModifiedEditor();
      if (!mod) return;
      mod.changeViewZones((accessor) => {
        for (const id of zoneIdsRef.current) {
          accessor.removeZone(id);
        }
      });
      zoneIdsRef.current = [];
    };
  }, [hunks, onAcceptHunk, onRejectHunk]);

  return (
    <div className="flex flex-col h-full">
      {/* Diff toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800/80 border-b border-zinc-700 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-amber-300 font-medium">
            {hunks.length} change{hunks.length !== 1 ? 's' : ''} suggested
          </span>
          <span className="text-[10px] text-zinc-500">{path}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRejectAll}
            className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border border-red-500/40 text-red-300 hover:bg-red-500/10 transition-colors"
          >
            <XCircle className="w-3 h-3" />
            Reject All
          </button>
          <button
            onClick={onAcceptAll}
            className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 transition-colors"
          >
            <CheckCheck className="w-3 h-3" />
            Accept All
          </button>
        </div>
      </div>

      {/* Diff editor */}
      <div className="flex-1 min-h-0">
        <DiffEditor
          original={original}
          modified={modified}
          language={CADENCE_LANGUAGE_ID}
          theme={darkMode ? CADENCE_DARK_THEME : 'vs'}
          beforeMount={handleBeforeMount}
          onMount={handleMount}
          options={{
            renderSideBySide: false, // inline diff mode
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: "'GeistMono', 'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
            automaticLayout: true,
            wordWrap: 'on',
            smoothScrolling: true,
            scrollBeyondLastLine: false,
            padding: { top: 12, bottom: 12 },
            lineNumbers: 'on',
            renderLineHighlight: 'line',
            bracketPairColorization: { enabled: true },
            tabSize: 2,
            readOnly: true,
            originalEditable: false,
          }}
        />
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add runner/src/editor/CadenceDiffEditor.tsx
git commit -m "feat(runner): add CadenceDiffEditor component with inline diff and per-hunk controls"
```

---

## Task 4: Integrate Diff Editor into App.tsx

**Files:**
- Modify: `runner/src/App.tsx`

**Step 1: Import CadenceDiffEditor**

```typescript
import CadenceDiffEditor from './editor/CadenceDiffEditor';
```

**Step 2: Replace the editor area to conditionally render diff mode**

Find the editor rendering section (around line 852-863):

```tsx
<div className="flex-1 min-h-0">
  <CadenceEditor
    code={activeCode}
    onChange={handleCodeChange}
    ...
  />
</div>
```

Replace with:

```tsx
<div className="flex-1 min-h-0">
  {activePendingDiff ? (
    <CadenceDiffEditor
      original={activePendingDiff.original}
      modified={activePendingDiff.modified}
      path={project.activeFile}
      darkMode={true}
      onAcceptAll={handleAcceptAllDiffs}
      onRejectAll={handleRejectAllDiffs}
      onAcceptHunk={(hunkOrig, hunkMod) =>
        handleAcceptHunk(project.activeFile, hunkOrig, hunkMod)
      }
      onRejectHunk={(hunkOrig, hunkMod) =>
        handleRejectHunk(project.activeFile, hunkOrig, hunkMod)
      }
    />
  ) : (
    <CadenceEditor
      code={activeCode}
      onChange={handleCodeChange}
      onRun={handleRun}
      darkMode={true}
      path={project.activeFile}
      readOnly={activeFileEntry?.readOnly}
      externalEditorRef={editorRef}
      onMonacoReady={handleMonacoReady}
      onGoToDefinition={handleGoToDefinition}
    />
  )}
</div>
```

**Step 3: Remove the old amber revert bar JSX**

Delete the `{pendingAiRevert && (...)}` block (around lines 665-685).

**Step 4: Commit**

```bash
git add runner/src/App.tsx
git commit -m "feat(runner): integrate diff editor — switch between normal and diff mode"
```

---

## Task 5: Fix Per-Hunk Accept/Reject Logic

**Files:**
- Modify: `runner/src/App.tsx`

The naive text-search approach for per-hunk operations can fail with duplicate text. Use a more robust approach: track hunks by line numbers and use line-based splicing.

**Step 1: Refine handleAcceptHunk**

Replace with a version that applies the modified text to the project, then recomputes the remaining diff:

```typescript
const handleAcceptHunk = useCallback((filePath: string, hunkOriginal: string, hunkModified: string) => {
  setPendingDiffs((prev) => {
    const entry = prev[filePath];
    if (!entry) return prev;

    // Apply this hunk: replace hunkOriginal in the original with hunkModified,
    // then update both original and modified to reflect this acceptance
    const origLines = entry.original.split('\n');
    const modLines = entry.modified.split('\n');
    const hunkOrigLines = hunkOriginal.split('\n');
    const hunkModLines = hunkModified.split('\n');

    // Find the hunk in original
    const origIdx = findSubarray(origLines, hunkOrigLines);
    if (origIdx < 0) return prev;

    // Replace in original with the modified version (accept the change)
    const newOrigLines = [
      ...origLines.slice(0, origIdx),
      ...hunkModLines,
      ...origLines.slice(origIdx + hunkOrigLines.length),
    ];

    // Also update modified to match (since this hunk is now accepted)
    // Find the hunk in modified and ensure it stays
    const newOriginal = newOrigLines.join('\n');
    const newModified = entry.modified; // modified already has this change

    // If original now equals modified, remove the entry
    if (newOriginal === newModified) {
      const next = { ...prev };
      delete next[filePath];
      // Apply to project
      return next;
    }

    return { ...prev, [filePath]: { ...entry, original: newOriginal } };
  });

  // Also apply to the actual project state
  setProject((prev) => {
    const current = getFileContent(prev, filePath) || '';
    const lines = current.split('\n');
    const hunkLines = hunkOriginal.split('\n');
    const idx = findSubarray(lines, hunkLines);
    if (idx < 0) return prev;
    const newLines = [
      ...lines.slice(0, idx),
      ...hunkModified.split('\n'),
      ...lines.slice(idx + hunkLines.length),
    ];
    return updateFileContent(prev, filePath, newLines.join('\n'));
  });
}, []);

const handleRejectHunk = useCallback((filePath: string, hunkOriginal: string, hunkModified: string) => {
  setPendingDiffs((prev) => {
    const entry = prev[filePath];
    if (!entry) return prev;

    // Remove this hunk from modified (revert to original for this section)
    const modLines = entry.modified.split('\n');
    const hunkModLines = hunkModified.split('\n');
    const modIdx = findSubarray(modLines, hunkModLines);
    if (modIdx < 0) return prev;

    const newModLines = [
      ...modLines.slice(0, modIdx),
      ...hunkOriginal.split('\n'),
      ...modLines.slice(modIdx + hunkModLines.length),
    ];
    const newModified = newModLines.join('\n');

    if (newModified === entry.original) {
      const next = { ...prev };
      delete next[filePath];
      return next;
    }

    return { ...prev, [filePath]: { ...entry, modified: newModified } };
  });
}, []);
```

**Step 2: Add `findSubarray` helper above the App component**

```typescript
function findSubarray(lines: string[], sub: string[]): number {
  if (sub.length === 0) return -1;
  outer:
  for (let i = 0; i <= lines.length - sub.length; i++) {
    for (let j = 0; j < sub.length; j++) {
      if (lines[i + j] !== sub[j]) continue outer;
    }
    return i;
  }
  return -1;
}
```

**Step 3: Commit**

```bash
git add runner/src/App.tsx
git commit -m "feat(runner): robust per-hunk accept/reject with line-based matching"
```

---

## Task 6: Keyboard Shortcuts for Diff Mode

**Files:**
- Modify: `runner/src/editor/CadenceDiffEditor.tsx`

**Step 1: Add keyboard shortcuts**

In the `handleMount` callback, add shortcuts on the modified editor:

```typescript
const modEditor = editor.getModifiedEditor();

// Cmd/Ctrl+Shift+Enter = Accept All
modEditor.addAction({
  id: 'diff-accept-all',
  label: 'Accept All Changes',
  keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
  run: () => onAcceptAll(),
});

// Escape = Reject All
modEditor.addAction({
  id: 'diff-reject-all',
  label: 'Reject All Changes',
  keybindings: [monaco.KeyCode.Escape],
  run: () => onRejectAll(),
});
```

Note: Need to pass `monaco` into `handleMount`. Update the component to use `beforeMount` to capture the monaco instance in a ref.

**Step 2: Commit**

```bash
git add runner/src/editor/CadenceDiffEditor.tsx
git commit -m "feat(runner): keyboard shortcuts for diff accept/reject"
```

---

## Task 7: Handle Multi-File Diffs

**Files:**
- Modify: `runner/src/App.tsx`

**Step 1: Show diff indicator on tabs**

Update the `TabBar` to receive `pendingDiffs` and show a dot/badge on tabs that have pending diffs.

In the TabBar rendering:

```tsx
<TabBar
  project={project}
  onSelectFile={handleSelectTab}
  onCloseFile={handleCloseTab}
  pendingDiffPaths={Object.keys(pendingDiffs)}
/>
```

**Step 2: Modify TabBar to show diff indicators**

In `runner/src/components/TabBar.tsx`, add a visual indicator (small colored dot) next to file names that have pending diffs.

**Step 3: Accept All should apply diffs for ALL files, not just active**

The `handleAcceptAllDiffs` already iterates over all entries in `pendingDiffs`, so this works out of the box.

**Step 4: Commit**

```bash
git add runner/src/App.tsx runner/src/components/TabBar.tsx
git commit -m "feat(runner): multi-file diff indicators on tab bar"
```

---

## Task 8: Build Verification

**Step 1: Run the build**

```bash
cd runner && bun run build
```

Fix any TypeScript or build errors.

**Step 2: Manual test checklist**

1. Open runner, type some Cadence code
2. Ask AI to modify the code
3. Verify: editor does NOT flicker during streaming
4. Verify: after streaming completes, editor switches to inline diff mode
5. Verify: red/green highlighting shows changes correctly
6. Verify: per-hunk Accept/Reject buttons appear after each change
7. Verify: Accept All applies all changes and returns to normal editor
8. Verify: Reject All discards all changes and returns to normal editor
9. Verify: per-hunk Accept applies only that change
10. Verify: per-hunk Reject removes only that change from the diff
11. Verify: Cmd+Shift+Enter and Escape shortcuts work
12. Verify: multi-file edits show indicators on tabs

**Step 3: Final commit**

```bash
git add -A
git commit -m "fix(runner): build fixes for diff mode integration"
```

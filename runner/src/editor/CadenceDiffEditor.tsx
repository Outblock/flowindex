import { useRef, useCallback, useEffect, useState } from 'react';
import { DiffEditor, type BeforeMount, type DiffOnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { registerCadenceLanguage, CADENCE_LANGUAGE_ID } from './cadenceLanguage';
import { registerCadenceThemes, CADENCE_DARK_THEME, CADENCE_LIGHT_THEME } from './cadenceTheme';
import { Check, X } from 'lucide-react';

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

interface HunkInfo {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
  originalText: string;
  modifiedText: string;
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
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);
  const zoneIdsRef = useRef<string[]>([]);
  const [hunks, setHunks] = useState<HunkInfo[]>([]);

  // Stable refs for callbacks so zone widget buttons always call latest
  const onAcceptHunkRef = useRef(onAcceptHunk);
  const onRejectHunkRef = useRef(onRejectHunk);
  useEffect(() => { onAcceptHunkRef.current = onAcceptHunk; }, [onAcceptHunk]);
  useEffect(() => { onRejectHunkRef.current = onRejectHunk; }, [onRejectHunk]);

  const extractHunks = useCallback((diffEditor: editor.IStandaloneDiffEditor): HunkInfo[] => {
    const changes = diffEditor.getLineChanges();
    if (!changes) return [];

    const origModel = diffEditor.getOriginalEditor().getModel();
    const modModel = diffEditor.getModifiedEditor().getModel();
    if (!origModel || !modModel) return [];

    return changes.map((change) => {
      let originalText = '';
      let modifiedText = '';

      // originalEndLineNumber === 0 means pure insertion (no original lines)
      if (change.originalEndLineNumber > 0) {
        const lines: string[] = [];
        for (let i = change.originalStartLineNumber; i <= change.originalEndLineNumber; i++) {
          lines.push(origModel.getLineContent(i));
        }
        originalText = lines.join('\n');
      }

      // modifiedEndLineNumber === 0 means pure deletion (no modified lines)
      if (change.modifiedEndLineNumber > 0) {
        const lines: string[] = [];
        for (let i = change.modifiedStartLineNumber; i <= change.modifiedEndLineNumber; i++) {
          lines.push(modModel.getLineContent(i));
        }
        modifiedText = lines.join('\n');
      }

      return {
        originalStartLineNumber: change.originalStartLineNumber,
        originalEndLineNumber: change.originalEndLineNumber,
        modifiedStartLineNumber: change.modifiedStartLineNumber,
        modifiedEndLineNumber: change.modifiedEndLineNumber,
        originalText,
        modifiedText,
      };
    });
  }, []);

  const updateHunks = useCallback(() => {
    const diffEditor = diffEditorRef.current;
    if (!diffEditor) return;

    const newHunks = extractHunks(diffEditor);
    setHunks(newHunks);

    // Inject zone widgets into the modified editor
    const modifiedEditor = diffEditor.getModifiedEditor();

    modifiedEditor.changeViewZones((accessor) => {
      // Clean up previous zone widgets
      for (const id of zoneIdsRef.current) {
        accessor.removeZone(id);
      }
      zoneIdsRef.current = [];

      for (const hunk of newHunks) {
        // Place the widget after the last modified line of the hunk
        // For deletions (modifiedEndLineNumber === 0), place after modifiedStartLineNumber
        const afterLine = hunk.modifiedEndLineNumber > 0
          ? hunk.modifiedEndLineNumber
          : hunk.modifiedStartLineNumber;

        const domNode = document.createElement('div');
        domNode.style.cssText = `
          display: flex; align-items: center; gap: 16px;
          padding: 4px 16px 4px 52px;
          position: relative; z-index: 10; pointer-events: auto;
        `;

        // Capture hunk values at creation time
        const hunkOrig = hunk.originalText;
        const hunkMod = hunk.modifiedText;

        const acceptBtn = document.createElement('button');
        acceptBtn.textContent = 'Accept';
        acceptBtn.style.cssText = `
          font-size: 11px; padding: 2px 10px; border-radius: 4px;
          border: none; color: rgba(134, 239, 172, 0.9); background: rgba(22, 163, 74, 0.15);
          cursor: pointer; font-family: system-ui, sans-serif;
          font-weight: 500; line-height: 18px;
          transition: all 0.15s ease; pointer-events: auto;
        `;
        acceptBtn.onmouseenter = () => {
          acceptBtn.style.background = 'rgba(22, 163, 74, 0.3)';
          acceptBtn.style.color = '#86efac';
        };
        acceptBtn.onmouseleave = () => {
          acceptBtn.style.background = 'rgba(22, 163, 74, 0.15)';
          acceptBtn.style.color = 'rgba(134, 239, 172, 0.9)';
        };
        acceptBtn.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
        acceptBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          onAcceptHunkRef.current(hunkOrig, hunkMod);
        };

        const rejectBtn = document.createElement('button');
        rejectBtn.textContent = 'Reject';
        rejectBtn.style.cssText = `
          font-size: 11px; padding: 2px 10px; border-radius: 4px;
          border: none; color: rgba(161, 161, 170, 0.6); background: transparent;
          cursor: pointer; font-family: system-ui, sans-serif;
          font-weight: 500; line-height: 18px;
          transition: all 0.15s ease; pointer-events: auto;
        `;
        rejectBtn.onmouseenter = () => {
          rejectBtn.style.color = 'rgba(252, 165, 165, 0.8)';
          rejectBtn.style.background = 'rgba(239, 68, 68, 0.08)';
        };
        rejectBtn.onmouseleave = () => {
          rejectBtn.style.color = 'rgba(161, 161, 170, 0.6)';
          rejectBtn.style.background = 'transparent';
        };
        rejectBtn.onmousedown = (e) => { e.preventDefault(); e.stopPropagation(); };
        rejectBtn.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          onRejectHunkRef.current(hunkOrig, hunkMod);
        };

        domNode.appendChild(acceptBtn);
        domNode.appendChild(rejectBtn);

        const id = accessor.addZone({
          afterLineNumber: afterLine,
          heightInLines: 1.2,
          domNode,
        });
        zoneIdsRef.current.push(id);
      }
    });
  }, [extractHunks, darkMode]);

  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    registerCadenceLanguage(monaco);
    registerCadenceThemes(monaco);
    monacoRef.current = monaco;
  }, []);

  const handleMount: DiffOnMount = useCallback(
    (editor, monaco) => {
      diffEditorRef.current = editor;

      // Keyboard shortcuts on the modified editor (the one that's focused)
      const modifiedEditor = editor.getModifiedEditor();

      modifiedEditor.addAction({
        id: 'diff-accept-all',
        label: 'Accept All Changes',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
        run: () => {
          onAcceptAll();
        },
      });

      modifiedEditor.addAction({
        id: 'diff-reject-all',
        label: 'Reject All Changes',
        keybindings: [monaco.KeyCode.Escape],
        run: () => {
          onRejectAll();
        },
      });

      // Also add shortcuts to the original editor side
      const originalEditor = editor.getOriginalEditor();

      originalEditor.addAction({
        id: 'diff-accept-all',
        label: 'Accept All Changes',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
        run: () => {
          onAcceptAll();
        },
      });

      originalEditor.addAction({
        id: 'diff-reject-all',
        label: 'Reject All Changes',
        keybindings: [monaco.KeyCode.Escape],
        run: () => {
          onRejectAll();
        },
      });

      // Listen for diff computation updates
      editor.onDidUpdateDiff(() => {
        updateHunks();
      });

      // Initial hunk extraction after a short delay (Monaco computes diffs async)
      setTimeout(updateHunks, 100);

      modifiedEditor.focus();
    },
    [onAcceptAll, onRejectAll, updateHunks],
  );

  // Clean up zone widgets and dispose editor on unmount
  useEffect(() => {
    return () => {
      const diffEditor = diffEditorRef.current;
      if (diffEditor) {
        try {
          const modifiedEditor = diffEditor.getModifiedEditor();
          modifiedEditor.changeViewZones((accessor) => {
            for (const id of zoneIdsRef.current) {
              accessor.removeZone(id);
            }
          });
        } catch {
          // Editor may already be disposed
        }
        zoneIdsRef.current = [];
        diffEditorRef.current = null;
      }
    };
  }, []);

  const changeCount = hunks.length;

  return (
    <div className="flex flex-col h-full w-full">
      {/* Diff toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-800/90 border-b border-zinc-700 shrink-0">
        <div className="flex items-center gap-3 text-[13px] text-zinc-200">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
            <span className="font-semibold">
              {changeCount} {changeCount === 1 ? 'change' : 'changes'}
            </span>
          </div>
          {path && (
            <span className="text-zinc-500 text-xs truncate max-w-[300px]">{path}</span>
          )}
          <span className="text-zinc-600 text-[11px]">
            Esc to reject · ⌘⇧↵ to accept
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onRejectAll}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-zinc-400 border border-zinc-600 rounded-md hover:text-red-300 hover:border-red-500/50 hover:bg-red-500/10 transition-all"
          >
            <X className="w-3.5 h-3.5" />
            Reject All
          </button>
          <button
            onClick={onAcceptAll}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-md hover:bg-emerald-500 transition-all"
          >
            <Check className="w-3.5 h-3.5" />
            Accept All
          </button>
        </div>
      </div>

      {/* Monaco Diff Editor */}
      <div className="flex-1 min-h-0">
        <DiffEditor
          language={CADENCE_LANGUAGE_ID}
          theme={darkMode ? CADENCE_DARK_THEME : CADENCE_LIGHT_THEME}
          original={original}
          modified={modified}
          originalModelPath={path ? `inmemory://diff-original/${path}` : undefined}
          modifiedModelPath={path ? `inmemory://diff-modified/${path}` : undefined}
          beforeMount={handleBeforeMount}
          onMount={handleMount}
          options={{
            renderSideBySide: false,
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
            readOnly: true,
            originalEditable: false,
          }}
        />
      </div>
    </div>
  );
}

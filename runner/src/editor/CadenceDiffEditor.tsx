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
        domNode.style.display = 'flex';
        domNode.style.alignItems = 'center';
        domNode.style.gap = '4px';
        domNode.style.padding = '2px 8px';
        domNode.style.background = darkMode ? 'rgba(39, 39, 42, 0.6)' : 'rgba(244, 244, 245, 0.8)';
        domNode.style.borderTop = `1px solid ${darkMode ? '#3f3f46' : '#e4e4e7'}`;
        domNode.style.borderBottom = `1px solid ${darkMode ? '#3f3f46' : '#e4e4e7'}`;

        const acceptBtn = document.createElement('button');
        acceptBtn.textContent = 'Accept';
        acceptBtn.style.fontSize = '11px';
        acceptBtn.style.padding = '1px 8px';
        acceptBtn.style.borderRadius = '4px';
        acceptBtn.style.border = '1px solid #22c55e';
        acceptBtn.style.color = '#22c55e';
        acceptBtn.style.background = 'transparent';
        acceptBtn.style.cursor = 'pointer';
        acceptBtn.style.fontFamily = 'inherit';
        acceptBtn.style.lineHeight = '18px';
        acceptBtn.onmouseenter = () => { acceptBtn.style.background = 'rgba(34, 197, 94, 0.15)'; };
        acceptBtn.onmouseleave = () => { acceptBtn.style.background = 'transparent'; };
        // Capture hunk values at creation time
        const hunkOrig = hunk.originalText;
        const hunkMod = hunk.modifiedText;
        acceptBtn.onclick = (e) => {
          e.stopPropagation();
          onAcceptHunkRef.current(hunkOrig, hunkMod);
        };

        const rejectBtn = document.createElement('button');
        rejectBtn.textContent = 'Reject';
        rejectBtn.style.fontSize = '11px';
        rejectBtn.style.padding = '1px 8px';
        rejectBtn.style.borderRadius = '4px';
        rejectBtn.style.border = '1px solid #ef4444';
        rejectBtn.style.color = '#ef4444';
        rejectBtn.style.background = 'transparent';
        rejectBtn.style.cursor = 'pointer';
        rejectBtn.style.fontFamily = 'inherit';
        rejectBtn.style.lineHeight = '18px';
        rejectBtn.onmouseenter = () => { rejectBtn.style.background = 'rgba(239, 68, 68, 0.15)'; };
        rejectBtn.onmouseleave = () => { rejectBtn.style.background = 'transparent'; };
        rejectBtn.onclick = (e) => {
          e.stopPropagation();
          onRejectHunkRef.current(hunkOrig, hunkMod);
        };

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

  // Clean up zone widgets on unmount
  useEffect(() => {
    return () => {
      const diffEditor = diffEditorRef.current;
      if (diffEditor) {
        const modifiedEditor = diffEditor.getModifiedEditor();
        modifiedEditor.changeViewZones((accessor) => {
          for (const id of zoneIdsRef.current) {
            accessor.removeZone(id);
          }
          zoneIdsRef.current = [];
        });
      }
    };
  }, []);

  const changeCount = hunks.length;

  return (
    <div className="flex flex-col h-full w-full">
      {/* Diff toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800/80 border-b border-zinc-700 shrink-0">
        <div className="flex items-center gap-2 text-xs text-zinc-300">
          <span className="font-medium">
            {changeCount} {changeCount === 1 ? 'change' : 'changes'} suggested
          </span>
          {path && (
            <span className="text-zinc-500 truncate max-w-[300px]">{path}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onRejectAll}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-400 border border-red-500/50 rounded hover:bg-red-500/10 transition-colors"
          >
            <X className="w-3 h-3" />
            Reject All
          </button>
          <button
            onClick={onAcceptAll}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-green-400 border border-green-500/50 rounded hover:bg-green-500/10 transition-colors"
          >
            <Check className="w-3 h-3" />
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
          originalModelPath={path ? `original://${path}` : undefined}
          modifiedModelPath={path ? `modified://${path}` : undefined}
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

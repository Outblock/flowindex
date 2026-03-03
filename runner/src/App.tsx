import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type * as MonacoNS from 'monaco-editor';
import CadenceEditor from './editor/CadenceEditor';
import { useLsp } from './editor/useLsp';
import ResultPanel from './components/ResultPanel';
import ParamPanel from './components/ParamPanel';
import WalletButton from './components/WalletButton';
import AIPanel from './components/AIPanel';
import FileExplorer from './components/FileExplorer';
import TabBar from './components/TabBar';
import { configureFcl } from './flow/fclConfig';
import { parseMainParams } from './flow/cadenceParams';
import { detectCodeType, executeScript, executeTransaction, executeCustodialTransaction } from './flow/execute';
import type { ExecutionResult } from './flow/execute';
import type { FlowNetwork } from './flow/networks';
import { useAuth } from './auth/AuthContext';
import { useKeys } from './auth/useKeys';
import KeyManager from './components/KeyManager';
import SignerSelector, { type SignerOption } from './components/SignerSelector';
import {
  loadProject, saveProject, updateFileContent, createFile, createFolder, deleteFile,
  openFile, closeFile, getFileContent, addDependencyFile, getUserFiles,
  TEMPLATES, DEFAULT_CODE,
  type ProjectState, type Template,
} from './fs/fileSystem';
import { useProjects, type CloudProject, type CloudProjectFull } from './auth/useProjects';
import ProjectSelector from './components/ProjectSelector';
import { Play, Loader2, PanelLeftOpen, PanelLeftClose, Bot, ChevronLeft, Key as KeyIcon, LogIn } from 'lucide-react';

/* ── Detect if we're in an iframe ── */
let isIframe = false;
try { isIframe = window.self !== window.top; } catch { isIframe = true; }

/* ── Draggable resize handle (horizontal) ── */

function useHorizontalResize(initialWidth: number, minWidth: number, maxWidth: number, side: 'left' | 'right') {
  const [width, setWidth] = useState(initialWidth);
  const dragging = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      let w: number;
      if (side === 'left') {
        w = ev.clientX;
      } else {
        w = window.innerWidth - ev.clientX;
      }
      setWidth(Math.min(maxWidth, Math.max(minWidth, w)));
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [minWidth, maxWidth, side]);

  return { width, onMouseDown };
}

/* ── Draggable resize handle (vertical) ── */

function useVerticalResize(containerRef: React.RefObject<HTMLDivElement | null>, initialFraction: number, minPx: number) {
  const [fraction, setFraction] = useState(initialFraction);
  const dragging = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const y = ev.clientY - rect.top;
      const f = Math.min(0.85, Math.max(minPx / rect.height, y / rect.height));
      setFraction(f);
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [containerRef, minPx]);

  return { fraction, onMouseDown };
}

/* ── Resize bar component ── */

function DragBar({ direction, onMouseDown }: { direction: 'horizontal' | 'vertical'; onMouseDown: (e: React.MouseEvent) => void }) {
  const isH = direction === 'horizontal';
  return (
    <div
      onMouseDown={onMouseDown}
      className={`group relative flex items-center justify-center shrink-0 ${
        isH ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize'
      } bg-zinc-800 hover:bg-emerald-500/30 active:bg-emerald-500/50 transition-colors`}
    >
      <div
        className={`${
          isH ? 'w-px h-8' : 'h-px w-8'
        } bg-zinc-600 group-hover:bg-emerald-400 group-active:bg-emerald-400 transition-colors rounded-full`}
      />
    </div>
  );
}

function normalizeEditablePath(path: string): string | null {
  const normalized = path
    .trim()
    .replace(/^['"`]/, '')
    .replace(/['"`]$/, '')
    .replace(/^\.\//, '')
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/');

  if (!normalized) return null;
  if (normalized.startsWith('/')) return null;
  if (normalized.includes('..')) return null;
  if (normalized.startsWith('deps/')) return null;

  return normalized;
}

function applyCodeToPath(state: ProjectState, path: string, newCode: string): ProjectState {
  const normalizedPath = normalizeEditablePath(path);
  if (!normalizedPath) return state;

  const existing = state.files.find((f) => f.path === normalizedPath);
  if (existing) {
    if (existing.readOnly) return state;
    const updated = updateFileContent(state, normalizedPath, newCode);
    return openFile(updated, normalizedPath);
  }

  const created = createFile(state, normalizedPath, newCode);
  return openFile(created, normalizedPath);
}

export default function App() {
  const [project, setProject] = useState<ProjectState>(() => {
    const params = new URLSearchParams(window.location.search);
    const codeParam = params.get('code');
    if (codeParam) {
      let code: string;
      try { code = atob(codeParam); } catch { code = codeParam; }
      return {
        files: [{ path: 'main.cdc', content: code }],
        activeFile: 'main.cdc',
        openFiles: ['main.cdc'],
        folders: [],
      };
    }
    return loadProject();
  });

  const [network, setNetwork] = useState<FlowNetwork>(() => {
    const params = new URLSearchParams(window.location.search);
    const n = params.get('network');
    if (n === 'mainnet' || n === 'testnet') return n;
    return (localStorage.getItem('runner:network') as FlowNetwork) || 'mainnet';
  });

  const [results, setResults] = useState<ExecutionResult[]>([]);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [showExplorer, setShowExplorer] = useState(!isIframe);
  const [showAI, setShowAI] = useState(true);
  const [pendingAiRevert, setPendingAiRevert] = useState<{
    previous: ProjectState;
    editCount: number;
    assistantId?: string;
  } | null>(null);
  const { user, loading: authLoading, signOut } = useAuth();
  const { keys, signMessage } = useKeys();
  const [showKeyManager, setShowKeyManager] = useState(false);
  const [selectedSigner, setSelectedSigner] = useState<SignerOption>({ type: 'fcl' });

  const {
    projects: cloudProjects,
    saving: projectSaving,
    lastSaved,
    getProject,
    saveProject: cloudSave,
    deleteProject: cloudDelete,
    fetchProjects,
  } = useProjects();

  const [cloudMeta, setCloudMeta] = useState<{
    id?: string; name: string; slug?: string; is_public?: boolean;
  }>({ name: 'Untitled' });

  const [monacoInstance, setMonacoInstance] = useState<typeof MonacoNS | null>(null);
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const pendingDefinitionRef = useRef<{ path: string; line: number; column: number } | null>(null);

  // Resize hooks
  const explorer = useHorizontalResize(220, 150, 400, 'left');
  const aiPanel = useHorizontalResize(360, 260, 600, 'right');
  const vertSplit = useVerticalResize(editorContainerRef, 0.7, 80);

  // Current active file content
  const activeCode = useMemo(
    () => getFileContent(project, project.activeFile) || '',
    [project]
  );
  const activeFileEntry = useMemo(
    () => project.files.find((f) => f.path === project.activeFile),
    [project]
  );

  // Configure FCL when network changes
  useEffect(() => {
    configureFcl(network);
  }, [network]);

  // Persist project to localStorage (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      saveProject(project);
      localStorage.setItem('runner:network', network);
    }, 1000);
    return () => clearTimeout(timer);
  }, [project, network]);

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

  // Load shared project from URL ?project=slug
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const projectSlug = params.get('project');
    if (!projectSlug) return;

    (async () => {
      const full = await getProject(projectSlug);
      if (!full) return;
      const files = full.files.map((f: { path: string; content: string }) => ({ path: f.path, content: f.content }));
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // LSP integration
  const handleDependency = useCallback((address: string, contractName: string, code: string) => {
    setProject((prev) => addDependencyFile(prev, address, contractName, code));
  }, []);

  const { notifyChange, goToDefinition, loadingDeps } = useLsp(monacoInstance, project, network, handleDependency);

  const scriptParams = useMemo(() => parseMainParams(activeCode), [activeCode]);
  const codeType = useMemo(() => detectCodeType(activeCode), [activeCode]);

  const handleCodeChange = useCallback((value: string) => {
    setProject((prev) => updateFileContent(prev, prev.activeFile, value));
    notifyChange(project.activeFile, value);
  }, [project.activeFile, notifyChange]);

  const handleRun = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setResults([]);

    if (codeType === 'script') {
      const result = await executeScript(activeCode, paramValues);
      setResults([result]);
    } else if (selectedSigner.type === 'fcl') {
      await executeTransaction(activeCode, paramValues, (result) => {
        setResults((prev) => [...prev, result]);
      });
    } else {
      // Custodial signer
      const key = selectedSigner.key;
      await executeCustodialTransaction(
        activeCode,
        paramValues,
        key.flow_address,
        key.key_index,
        (message) => signMessage(key.id, message),
        (result) => {
          setResults((prev) => [...prev, result]);
        },
      );
    }

    setLoading(false);
  }, [activeCode, codeType, paramValues, loading, selectedSigner, signMessage]);

  const handleInsertCode = useCallback((newCode: string) => {
    setProject((prev) => updateFileContent(prev, prev.activeFile, newCode));
  }, []);

  const handleApplyCodeToFile = useCallback((path: string, newCode: string) => {
    setProject((prev) => applyCodeToPath(prev, path, newCode));
  }, []);

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

    setProject((base) => {
      let next = base;

      for (const edit of sanitized) {
        if (edit.patches && edit.patches.length > 0) {
          // Apply search/replace patches to existing file
          const targetPath = edit.path || next.activeFile;
          const existing = next.files.find((f) => f.path === targetPath);
          if (existing && !existing.readOnly) {
            let patched = existing.content;
            for (const { search, replace } of edit.patches) {
              const idx = patched.indexOf(search);
              if (idx >= 0) {
                patched = patched.slice(0, idx) + replace + patched.slice(idx + search.length);
              }
            }
            next = updateFileContent(next, targetPath, patched);
          }
        } else if (edit.path) {
          next = applyCodeToPath(next, edit.path, edit.code);
        } else {
          next = updateFileContent(next, next.activeFile, edit.code);
        }
      }

      if (next === base) return base;

      setPendingAiRevert((prev) => {
        if (meta?.assistantId && prev?.assistantId === meta.assistantId) {
          return { ...prev, editCount: prev.editCount + sanitized.length };
        }
        return {
          previous: base,
          editCount: sanitized.length,
          assistantId: meta?.assistantId,
        };
      });

      return next;
    });
  }, []);

  const handleKeepAiEdits = useCallback(() => {
    setPendingAiRevert(null);
  }, []);

  const handleRevertAiEdits = useCallback(() => {
    if (!pendingAiRevert) return;
    setProject(pendingAiRevert.previous);
    setPendingAiRevert(null);
  }, [pendingAiRevert]);

  const handleLoadTemplate = useCallback((template: Template) => {
    setProject({
      files: template.files,
      activeFile: template.activeFile,
      openFiles: [template.activeFile],
      folders: template.folders || [],
    });
  }, []);

  const handleOpenFile = useCallback((path: string) => {
    setProject((prev) => openFile(prev, path));
  }, []);

  const handleCreateFile = useCallback((path: string) => {
    setProject((prev) => createFile(prev, path));
  }, []);

  const handleCreateFolder = useCallback((path: string) => {
    setProject((prev) => createFolder(prev, path));
  }, []);

  const handleDeleteFile = useCallback((path: string) => {
    if (project.files.filter((f) => !f.readOnly).length <= 1) return;
    setProject((prev) => deleteFile(prev, path));
  }, [project.files]);

  const handleCloseTab = useCallback((path: string) => {
    setProject((prev) => closeFile(prev, path));
  }, []);

  const handleSelectTab = useCallback((path: string) => {
    setProject((prev) => ({ ...prev, activeFile: path }));
  }, []);

  const handleMonacoReady = useCallback((monaco: typeof MonacoNS) => {
    setMonacoInstance(monaco);
  }, []);

  const handleOpenCodeEditor = useCallback(async (
    uri: string,
    selection?: {
      startLineNumber: number;
      startColumn: number;
      endLineNumber: number;
      endColumn: number;
    }
  ) => {
    if (!uri.startsWith('file://')) return false;
    let targetPath = '';
    try {
      targetPath = decodeURIComponent(new URL(uri).pathname.replace(/^\/+/, ''));
    } catch {
      return false;
    }
    if (!project.files.some((file) => file.path === targetPath)) {
      const depsIndex = targetPath.indexOf('deps/');
      if (depsIndex >= 0) {
        targetPath = targetPath.slice(depsIndex);
      }
    }
    if (!project.files.some((file) => file.path === targetPath)) {
      return false;
    }
    if (!targetPath) return false;

    const targetLine = selection?.startLineNumber ?? 1;
    const targetColumn = selection?.startColumn ?? 1;

    if (project.activeFile === targetPath) {
      editorRef.current?.setPosition({ lineNumber: targetLine, column: targetColumn });
      editorRef.current?.revealPositionInCenter({ lineNumber: targetLine, column: targetColumn });
      editorRef.current?.focus();
      return true;
    }

    pendingDefinitionRef.current = { path: targetPath, line: targetLine, column: targetColumn };
    setProject((prev) => openFile(prev, targetPath));
    return true;
  }, [project.activeFile, project.files]);

  const handleGoToDefinition = useCallback(async (path: string, line: number, column: number) => {
    const target = await goToDefinition(path, line, column);
    if (!target) return false;
    return handleOpenCodeEditor(target.uri, {
      startLineNumber: target.line + 1,
      startColumn: target.character + 1,
      endLineNumber: target.line + 1,
      endColumn: target.character + 1,
    });
  }, [goToDefinition, handleOpenCodeEditor]);

  useEffect(() => {
    if (!monacoInstance) return;

    const disposable = monacoInstance.editor.registerEditorOpener({
      openCodeEditor: async (_source, resource, selectionOrPosition) => {
        let selection:
          | {
              startLineNumber: number;
              startColumn: number;
              endLineNumber: number;
              endColumn: number;
            }
          | undefined;

        if (selectionOrPosition && 'startLineNumber' in selectionOrPosition) {
          selection = {
            startLineNumber: selectionOrPosition.startLineNumber,
            startColumn: selectionOrPosition.startColumn,
            endLineNumber: selectionOrPosition.endLineNumber,
            endColumn: selectionOrPosition.endColumn,
          };
        } else if (selectionOrPosition && 'lineNumber' in selectionOrPosition) {
          selection = {
            startLineNumber: selectionOrPosition.lineNumber,
            startColumn: selectionOrPosition.column,
            endLineNumber: selectionOrPosition.lineNumber,
            endColumn: selectionOrPosition.column,
          };
        }

        return await handleOpenCodeEditor(resource.toString(), selection);
      },
    });

    return () => disposable.dispose();
  }, [monacoInstance, handleOpenCodeEditor]);

  useEffect(() => {
    const pending = pendingDefinitionRef.current;
    if (!pending || pending.path !== project.activeFile) return;

    const raf = requestAnimationFrame(() => {
      if (!editorRef.current) return;
      editorRef.current.setPosition({ lineNumber: pending.line, column: pending.column });
      editorRef.current.revealPositionInCenter({ lineNumber: pending.line, column: pending.column });
      editorRef.current.focus();
    });

    pendingDefinitionRef.current = null;
    return () => cancelAnimationFrame(raf);
  }, [project.activeFile, activeCode]);

  const hasBottomPanel = scriptParams.length > 0 || results.length > 0 || loading;

  return (
    <div className="flex flex-col h-full bg-zinc-900 text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-zinc-700 bg-zinc-900/80 backdrop-blur shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowExplorer(!showExplorer)}
            className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            title={showExplorer ? 'Hide explorer' : 'Show explorer'}
          >
            {showExplorer ? (
              <PanelLeftClose className="w-4 h-4" />
            ) : (
              <PanelLeftOpen className="w-4 h-4" />
            )}
          </button>
          <h1 className="text-sm font-semibold tracking-tight">Cadence Runner</h1>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={network}
            onChange={(e) => setNetwork(e.target.value as FlowNetwork)}
            className="bg-zinc-800 text-zinc-300 text-xs px-2 py-1 rounded border border-zinc-700 focus:outline-none focus:border-zinc-500"
          >
            <option value="mainnet">Mainnet</option>
            <option value="testnet">Testnet</option>
          </select>

          {/* Signer selector - show when there are custodial keys and code is transaction */}
          {codeType === 'transaction' && keys.length > 0 && (
            <SignerSelector
              keys={keys}
              selected={selectedSigner}
              onSelect={setSelectedSigner}
            />
          )}

          <WalletButton />

          <button
            onClick={handleRun}
            disabled={loading || activeFileEntry?.readOnly}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:text-emerald-500 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {codeType === 'script' ? 'Run Script' : 'Send Transaction'}
            <span className="ml-1.5 flex items-center gap-0.5 opacity-60">
              <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-mono leading-none bg-white/15 border border-white/20 rounded shadow-[0_1px_0_rgba(0,0,0,0.3)]">
                {navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}
              </kbd>
              <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-mono leading-none bg-white/15 border border-white/20 rounded shadow-[0_1px_0_rgba(0,0,0,0.3)]">
                ↵
              </kbd>
            </span>
          </button>
        </div>
      </header>

      {pendingAiRevert && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-amber-500/30 bg-amber-500/10">
          <span className="text-[11px] text-amber-200">
            AI 已自动应用 {pendingAiRevert.editCount} 处修改。确认保留还是回滚？
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRevertAiEdits}
              className="px-2.5 py-1 text-[11px] rounded border border-red-500/40 text-red-300 hover:bg-red-500/10 transition-colors"
            >
              Revert
            </button>
            <button
              onClick={handleKeepAiEdits}
              className="px-2.5 py-1 text-[11px] rounded border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 transition-colors"
            >
              Keep
            </button>
          </div>
        </div>
      )}

      {user && !cloudMeta.id && project.files.some(f => !f.readOnly && f.content.trim() && f.content !== DEFAULT_CODE) && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-emerald-500/20 bg-emerald-500/10 shrink-0">
          <span className="text-[11px] text-emerald-300 flex-1">Save your project to the cloud?</span>
          <button
            onClick={async () => {
              const result = await cloudSave(project, { name: 'My Project', network });
              setCloudMeta({ id: result.id, name: 'My Project', slug: result.slug });
              await fetchProjects();
            }}
            className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-medium transition-colors"
          >
            Save
          </button>
          <button
            onClick={() => setCloudMeta({ name: 'Untitled', id: '_dismissed' })}
            className="text-[11px] text-zinc-500 hover:text-zinc-400"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main layout */}
      <div className="flex flex-1 min-h-0">
        {/* File Explorer */}
        {showExplorer && (
          <>
            <div className="shrink-0 overflow-hidden bg-zinc-900 flex flex-col" style={{ width: explorer.width }}>
              {/* Cloud project selector */}
              {user && (
                <div className="shrink-0 border-b border-zinc-700">
                  <ProjectSelector
                    projects={cloudProjects}
                    currentProject={cloudMeta.id ? cloudMeta : null}
                    onSelectProject={async (slug) => {
                      const full = await getProject(slug);
                      if (!full) return;
                      const files = full.files.map((f: { path: string; content: string }) => ({ path: f.path, content: f.content }));
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
                      const defaultFiles = [{ path: 'main.cdc', content: DEFAULT_CODE }];
                      const defaultState = { files: defaultFiles, activeFile: 'main.cdc', openFiles: ['main.cdc'], folders: [] as string[] };
                      const result = await cloudSave(defaultState, { name: 'Untitled', network });
                      setProject(defaultState);
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
                      setCloudMeta({ name: 'Untitled' });
                      setProject(loadProject());
                    }}
                    saving={projectSaving}
                    lastSaved={lastSaved}
                  />
                </div>
              )}
              <div className="flex-1 overflow-y-auto">
                <FileExplorer
                  project={project}
                  onOpenFile={handleOpenFile}
                  onCreateFile={handleCreateFile}
                  onCreateFolder={handleCreateFolder}
                  onDeleteFile={handleDeleteFile}
                  activeFile={project.activeFile}
                />
              </div>
              {/* Sign in / user info at sidebar bottom */}
              {!authLoading && (
                <div className="shrink-0 border-t border-zinc-700">
                  {user ? (
                    <div className="group">
                      <div className="flex items-center justify-between px-3 py-2">
                        <span className="text-[10px] text-zinc-500 truncate">{user.email}</span>
                        <button
                          onClick={() => signOut()}
                          className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                        >
                          Sign out
                        </button>
                      </div>
                      {/* Key management - appears on hover */}
                      <div className="max-h-0 overflow-hidden group-hover:max-h-10 transition-all duration-200 ease-in-out">
                        <button
                          onClick={() => setShowKeyManager(!showKeyManager)}
                          className={`flex items-center gap-1.5 w-full px-3 py-1.5 text-[11px] transition-colors ${
                            showKeyManager ? 'text-emerald-400 bg-emerald-600/10' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                          }`}
                        >
                          <KeyIcon className="w-3 h-3" />
                          <span>Manage Keys</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <a
                      href={`https://flowindex.io/developer/login?redirect=${encodeURIComponent(window.location.origin)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 text-[11px] transition-colors px-3 py-2"
                    >
                      <LogIn className="w-3 h-3" />
                      <span>Sign in</span>
                    </a>
                  )}
                </div>
              )}
            </div>
            <DragBar direction="horizontal" onMouseDown={explorer.onMouseDown} />
          </>
        )}

        {/* Editor + Results (center) */}
        <div ref={editorContainerRef} className="flex flex-col flex-1 min-w-0 min-h-0">
          {/* Editor area */}
          <div className="flex flex-col min-h-0" style={{ height: hasBottomPanel ? `${vertSplit.fraction * 100}%` : '100%' }}>
            <TabBar
              project={project}
              onSelectFile={handleSelectTab}
              onCloseFile={handleCloseTab}
            />
            {loadingDeps && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-400 shrink-0">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="text-[11px] font-medium">Resolving imports...</span>
              </div>
            )}
            <div className="flex-1 min-h-0">
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
            </div>
          </div>

          {/* Results area */}
          {hasBottomPanel && (
            <>
              <DragBar direction="vertical" onMouseDown={vertSplit.onMouseDown} />
              <div className="flex flex-col min-h-0 bg-zinc-900" style={{ height: `${(1 - vertSplit.fraction) * 100}%` }}>
                <div className="shrink-0 overflow-y-auto">
                  <ParamPanel
                    params={scriptParams}
                    values={paramValues}
                    onChange={setParamValues}
                  />
                </div>
                <div className="flex-1 min-h-0">
                  <ResultPanel results={results} loading={loading} />
                </div>
              </div>
            </>
          )}
        </div>

        {/* AI Panel */}
        {showAI ? (
          <>
            <DragBar direction="horizontal" onMouseDown={aiPanel.onMouseDown} />
            <div className="shrink-0 overflow-hidden" style={{ width: aiPanel.width }}>
              <AIPanel
                onInsertCode={handleInsertCode}
                onApplyCodeToFile={handleApplyCodeToFile}
                onAutoApplyEdits={handleAutoApplyEdits}
                onLoadTemplate={handleLoadTemplate}
                editorCode={activeCode}
                projectFiles={getUserFiles(project)}
                activeFile={project.activeFile}
                network={network}
                onClose={() => setShowAI(false)}
              />
            </div>
          </>
        ) : (
          <button
            onClick={() => setShowAI(true)}
            className="flex flex-col items-center justify-center w-10 shrink-0 bg-zinc-900 border-l border-zinc-700 hover:bg-zinc-800 transition-colors group"
            title="Open AI Assistant"
          >
            <Bot className="w-5 h-5 text-emerald-500 group-hover:text-emerald-400" />
            <span className="text-[9px] text-zinc-500 group-hover:text-zinc-400 mt-1 font-medium">AI</span>
            <ChevronLeft className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 mt-0.5" />
          </button>
        )}
      </div>

      {/* Key Manager Panel (overlay) */}
      {showKeyManager && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="bg-black/50 flex-1" onClick={() => setShowKeyManager(false)} />
          <div className="w-80 bg-zinc-900 border-l border-zinc-700 overflow-y-auto">
            <KeyManager onClose={() => setShowKeyManager(false)} network={network} />
          </div>
        </div>
      )}
    </div>
  );
}

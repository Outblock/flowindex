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
import { detectCodeType, executeScript, executeTransaction } from './flow/execute';
import type { ExecutionResult } from './flow/execute';
import type { FlowNetwork } from './flow/networks';
import {
  loadProject, saveProject, updateFileContent, createFile, deleteFile,
  openFile, closeFile, getFileContent, addDependencyFile,
  TEMPLATES,
  type ProjectState, type Template,
} from './fs/fileSystem';
import { Play, Loader2, PanelLeftOpen, PanelLeftClose, Bot, ChevronLeft } from 'lucide-react';

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
  const [monacoInstance, setMonacoInstance] = useState<typeof MonacoNS | null>(null);
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

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

  // LSP integration
  const handleDependency = useCallback((address: string, contractName: string, code: string) => {
    setProject((prev) => addDependencyFile(prev, address, contractName, code));
  }, []);

  const { notifyChange, loadingDeps } = useLsp(monacoInstance, project, network, handleDependency);

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
    } else {
      await executeTransaction(activeCode, paramValues, (result) => {
        setResults((prev) => [...prev, result]);
      });
    }

    setLoading(false);
  }, [activeCode, codeType, paramValues, loading]);

  const handleInsertCode = useCallback((newCode: string) => {
    setProject((prev) => updateFileContent(prev, prev.activeFile, newCode));
  }, []);

  const handleLoadTemplate = useCallback((template: Template) => {
    setProject({
      files: template.files,
      activeFile: template.activeFile,
      openFiles: [template.activeFile],
    });
  }, []);

  const handleOpenFile = useCallback((path: string) => {
    setProject((prev) => openFile(prev, path));
  }, []);

  const handleCreateFile = useCallback((path: string) => {
    setProject((prev) => createFile(prev, path));
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
          </button>
        </div>
      </header>

      {/* Main layout */}
      <div className="flex flex-1 min-h-0">
        {/* File Explorer */}
        {showExplorer && (
          <>
            <div className="shrink-0 overflow-hidden bg-zinc-900" style={{ width: explorer.width }}>
              <FileExplorer
                project={project}
                onOpenFile={handleOpenFile}
                onCreateFile={handleCreateFile}
                onDeleteFile={handleDeleteFile}
                activeFile={project.activeFile}
              />
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
              />
            </div>
          </div>

          {/* Results area */}
          {hasBottomPanel && (
            <>
              <DragBar direction="vertical" onMouseDown={vertSplit.onMouseDown} />
              <div className="overflow-y-auto bg-zinc-900" style={{ height: `${(1 - vertSplit.fraction) * 100}%` }}>
                <ParamPanel
                  params={scriptParams}
                  values={paramValues}
                  onChange={setParamValues}
                />
                <ResultPanel results={results} loading={loading} />
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
                onLoadTemplate={handleLoadTemplate}
                editorCode={activeCode}
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
    </div>
  );
}

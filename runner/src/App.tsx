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
  type ProjectState,
} from './fs/fileSystem';
import { Play, Loader2, PanelLeftOpen, PanelLeftClose } from 'lucide-react';

export default function App() {
  const [project, setProject] = useState<ProjectState>(() => {
    // Check URL params for code injection
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
  const [showExplorer, setShowExplorer] = useState(true);
  const [monacoInstance, setMonacoInstance] = useState<typeof MonacoNS | null>(null);
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);

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

  const { notifyChange } = useLsp(monacoInstance, project, network, handleDependency);

  const scriptParams = useMemo(() => parseMainParams(activeCode), [activeCode]);
  const codeType = useMemo(() => detectCodeType(activeCode), [activeCode]);

  // Handle code changes
  const handleCodeChange = useCallback((value: string) => {
    setProject((prev) => updateFileContent(prev, prev.activeFile, value));
    notifyChange(project.activeFile, value);
  }, [project.activeFile, notifyChange]);

  // Handle run
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

  // AI code insertion
  const handleInsertCode = useCallback((newCode: string) => {
    setProject((prev) => updateFileContent(prev, prev.activeFile, newCode));
  }, []);

  // File explorer actions
  const handleOpenFile = useCallback((path: string) => {
    setProject((prev) => openFile(prev, path));
  }, []);

  const handleCreateFile = useCallback((path: string) => {
    setProject((prev) => createFile(prev, path));
  }, []);

  const handleDeleteFile = useCallback((path: string) => {
    if (project.files.filter((f) => !f.readOnly).length <= 1) return; // Keep at least one file
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

  return (
    <div className="flex h-full bg-zinc-900 text-zinc-100">
      {/* AI Panel (collapsible left sidebar) */}
      <AIPanel onInsertCode={handleInsertCode} />

      {/* File Explorer (collapsible) */}
      {showExplorer && (
        <div className="w-52 shrink-0 border-r border-zinc-700 bg-zinc-900">
          <FileExplorer
            project={project}
            onOpenFile={handleOpenFile}
            onCreateFile={handleCreateFile}
            onDeleteFile={handleDeleteFile}
            activeFile={project.activeFile}
          />
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0">
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

        {/* Tab Bar */}
        <TabBar
          project={project}
          onSelectFile={handleSelectTab}
          onCloseFile={handleCloseTab}
        />

        {/* Editor */}
        <main className="flex-1 min-h-0">
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
        </main>

        {/* Parameters */}
        <ParamPanel
          params={scriptParams}
          values={paramValues}
          onChange={setParamValues}
        />

        {/* Results */}
        <ResultPanel results={results} loading={loading} />
      </div>
    </div>
  );
}

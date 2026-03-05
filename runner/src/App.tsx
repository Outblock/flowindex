import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import type * as MonacoNS from 'monaco-editor';
import JSZip from 'jszip';
import axios from 'axios';
import CadenceEditor from './editor/CadenceEditor';
import CadenceDiffEditor from './editor/CadenceDiffEditor';
import { useLsp } from './editor/useLsp';
import ResultPanel from './components/ResultPanel';
import ParamPanel from './components/ParamPanel';
import WalletButton from './components/WalletButton';
import FileExplorer from './components/FileExplorer';
import TabBar from './components/TabBar';
import { configureFcl } from './flow/fclConfig';
import { parseMainParams } from './flow/cadenceParams';
import { detectCodeType, executeScript, executeTransaction, executeCustodialTransaction, deployContract } from './flow/execute';
import type { ExecutionResult } from './flow/execute';
import { parseExecutionError, setErrorDecorations, type ParsedArgError } from './editor/errorDecorations';
import type { FlowNetwork } from './flow/networks';
import { useAuth } from './auth/AuthContext';
import { useKeys } from './auth/useKeys';
import { useLocalKeys } from './auth/useLocalKeys';
import { PasswordPrompt } from './components/PasswordPrompt';
import SignerSelector, { type SignerOption } from './components/SignerSelector';
import ConnectModal from './components/ConnectModal';
import {
  loadProject, saveProject, updateFileContent, createFile, createFolder, deleteFile,
  openFile, closeFile, getFileContent, addDependencyFile, getUserFiles,
  TEMPLATES, DEFAULT_CODE, getTemplates, replaceContractAddresses,
  type ProjectState, type Template,
} from './fs/fileSystem';
import { useProjects, type CloudProject, type CloudProjectFull } from './auth/useProjects';
import ProjectSelector from './components/ProjectSelector';
import ShareModal from './components/ShareModal';
import { Play, Loader2, PanelLeftOpen, PanelLeftClose, Bot, ChevronLeft, Key as KeyIcon, LogIn, Share2, X, MessageSquare, Settings, Cpu, Server, ChevronDown, Globe, Sparkles } from 'lucide-react';
import type { LspMode } from './editor/useLsp';

const AIPanel = lazy(() => import('./components/AIPanel'));
const KeyManager = lazy(() => import('./components/KeyManager'));
const AccountPanel = lazy(() => import('./components/AccountPanel'));

/* ── Detect if we're in an iframe ── */
let isIframe = false;
try { isIframe = window.self !== window.top; } catch { isIframe = true; }

/* ── Mobile detection hook ── */
function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);
  return isMobile;
}

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

interface PendingDiffEntry {
  original: string;
  modified: string;
  assistantId?: string;
}

type PendingDiffMap = Record<string, PendingDiffEntry>;

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
    // If loading from a tx, start with empty editor (will be filled by fetch)
    if (params.get('tx')) {
      return {
        files: [{ path: 'main.cdc', content: '// Loading transaction...' }],
        activeFile: 'main.cdc',
        openFiles: ['main.cdc'],
        folders: [],
      };
    }
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

  // Pre-fill args from URL ?args=base64 or ?tx= fetch
  const [initialArgsApplied, setInitialArgsApplied] = useState(false);
  const pendingTxArgsRef = useRef<unknown[] | null>(null);
  const [txArgsReady, setTxArgsReady] = useState(() => !new URLSearchParams(window.location.search).get('tx'));

  // LSP mode: 'auto' (default), 'wasm' (local), or 'server' (WebSocket)
  const [lspMode, setLspMode] = useState<LspMode>(() => {
    try { return (localStorage.getItem('runner-lsp-mode') as LspMode) || 'auto'; } catch { return 'auto'; }
  });
  const [showLspMenu, setShowLspMenu] = useState(false);
  useEffect(() => {
    try { localStorage.setItem('runner-lsp-mode', lspMode); } catch { /* noop */ }
  }, [lspMode]);

  // Load transaction from API when ?tx= param is present
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const txId = params.get('tx');
    if (!txId) return;

    // Use the main site's API proxy (works cross-origin with CORS)
    const API_BASE = 'https://flowindex.io/api';
    (async () => {
      try {
        const { data } = await axios.get(`${API_BASE}/flow/transaction/${txId}`);
        // API returns { data: [tx] }
        const tx = Array.isArray(data.data) ? data.data[0] : (data.data || data);
        if (tx?.script) {
          setProject({
            files: [{ path: 'main.cdc', content: tx.script }],
            activeFile: 'main.cdc',
            openFiles: ['main.cdc'],
            folders: [],
          });
        }
        if (tx?.arguments) {
          const args = typeof tx.arguments === 'string' ? JSON.parse(tx.arguments) : tx.arguments;
          if (Array.isArray(args) && args.length > 0) {
            pendingTxArgsRef.current = args;
          }
        }
      } catch { /* tx fetch failed, ignore */ }
      setTxArgsReady(true);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [network, setNetwork] = useState<FlowNetwork>(() => {
    const params = new URLSearchParams(window.location.search);
    const n = params.get('network');
    if (n === 'mainnet' || n === 'testnet') return n;
    return (localStorage.getItem('runner:network') as FlowNetwork) || 'mainnet';
  });

  const [results, setResults] = useState<ExecutionResult[]>([]);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const isMobile = useIsMobile();
  const [showExplorer, setShowExplorer] = useState(!isIframe);
  const [showAI, setShowAI] = useState(() => {
    try {
      const stored = localStorage.getItem('runner:show-ai');
      if (stored === null) return true;
      return stored === 'true';
    } catch {
      return true;
    }
  });
  const [showMobileAI, setShowMobileAI] = useState(false);
  const [aiPendingMessage, setAiPendingMessage] = useState<string | undefined>();
  const [pendingDiffs, setPendingDiffs] = useState<PendingDiffMap>({});
  const { user, loading: authLoading, signOut } = useAuth();
  useKeys();
  const {
    localKeys, accountsMap, wasmReady, ensureWasmReady,
    generateNewKey, importMnemonic, importPrivateKey: importLocalPrivateKey,
    importKeystore, deleteLocalKey, exportKeystore,
    signWithLocalKey, refreshAccounts, createAccount, getPrivateKey, revealSecret,
  } = useLocalKeys();
  const [showKeyManager, setShowKeyManager] = useState(false);
  const [showNetworkMenu, setShowNetworkMenu] = useState(false);
  const networkMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      localStorage.setItem('runner:show-ai', String(showAI));
    } catch {
      // ignore localStorage write errors
    }
  }, [showAI]);
  useEffect(() => {
    if (!showKeyManager) return;
    ensureWasmReady().catch(() => {});
  }, [showKeyManager, ensureWasmReady]);
  // Close network menu on outside click
  useEffect(() => {
    if (!showNetworkMenu) return;
    const handler = (e: MouseEvent) => {
      if (networkMenuRef.current && !networkMenuRef.current.contains(e.target as Node)) {
        setShowNetworkMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showNetworkMenu]);

  const [autoSign, setAutoSign] = useState(() => {
    try { return localStorage.getItem('runner-auto-sign') !== 'false'; } catch { return true; }
  });
  const handleToggleAutoSign = useCallback((value: boolean) => {
    setAutoSign(value);
    try { localStorage.setItem('runner-auto-sign', String(value)); } catch { /* ignore */ }
  }, []);

  const [accountPanelAddress, setAccountPanelAddress] = useState<string | null>(null);
  const handleViewAccount = useCallback((address: string) => setAccountPanelAddress(address), []);
  const [selectedSigner, setSelectedSigner] = useState<SignerOption>({ type: 'none' });
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const pendingRunRef = useRef(false);
  const [passwordPrompt, setPasswordPrompt] = useState<{
    keyLabel: string;
    resolve: (password: string) => void;
    reject: () => void;
  } | null>(null);

  // Persist signer selection to localStorage
  const persistSigner = useCallback((signer: SignerOption) => {
    setSelectedSigner(signer);
    try {
      if (signer.type === 'local') {
        localStorage.setItem('flow-selected-signer', JSON.stringify({
          type: 'local',
          keyId: signer.key.id,
          address: signer.account.flowAddress,
          keyIndex: signer.account.keyIndex,
        }));
      } else if (signer.type === 'fcl') {
        localStorage.setItem('flow-selected-signer', JSON.stringify({ type: 'fcl' }));
      } else {
        localStorage.removeItem('flow-selected-signer');
      }
    } catch {}
  }, []);

  // Handle wallet selected from ConnectModal — persist and auto-retry pending run
  const handleModalSelect = useCallback((signer: SignerOption) => {
    persistSigner(signer);
    setConnectModalOpen(false);
    // Mark for pending run retry — the effect below will pick it up
  }, [persistSigner]);

  const promptForPassword = useCallback((keyLabel: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      setPasswordPrompt({ keyLabel, resolve, reject });
    });
  }, []);

  // Auto-discover accounts for all local keys on mount (or when keys/network change)
  const discoveredKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const key of localKeys) {
      const cacheKey = `${key.id}:${network}`;
      if (!discoveredKeysRef.current.has(cacheKey)) {
        discoveredKeysRef.current.add(cacheKey);
        refreshAccounts(key.id, network).catch(() => {});
      }
    }
  }, [localKeys, network, refreshAccounts]);

  // Restore saved signer from localStorage, or auto-select first local account.
  // localKeys are loaded from localStorage (public keys are plaintext, no WASM needed).
  // We just need accounts to be discovered before we can restore.
  const hasRestoredSigner = useRef(false);
  useEffect(() => {
    if (hasRestoredSigner.current) return;

    // Check if we expect local keys to load (saved signer is local type)
    // If so, wait until localKeys are populated
    try {
      const saved = localStorage.getItem('flow-selected-signer');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.type === 'local' && localKeys.length === 0) return; // keys not loaded yet
      }
    } catch {}

    // If keys exist but no accounts discovered yet, wait
    const hasLocalAccounts = localKeys.some(k => (accountsMap[k.id] || []).length > 0);
    if (localKeys.length > 0 && !hasLocalAccounts) return;

    hasRestoredSigner.current = true;
    const saved = localStorage.getItem('flow-selected-signer');
    try {
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.type === 'local') {
          const key = localKeys.find(k => k.id === parsed.keyId);
          const accounts = key ? (accountsMap[key.id] || []) : [];
          const account = accounts.find(a => a.flowAddress === parsed.address && a.keyIndex === parsed.keyIndex);
          if (key && account) {
            setSelectedSigner({ type: 'local', key, account });
            return;
          }
        } else if (parsed.type === 'fcl') {
          setSelectedSigner({ type: 'fcl' });
          return;
        }
      }
    } catch {}
    // Auto-select first local account only if no prior preference was saved
    // (i.e. first-time user). If saved was explicitly cleared (disconnect), stay as 'none'.
    if (!saved) {
      for (const key of localKeys) {
        const accounts = accountsMap[key.id];
        if (accounts && accounts.length > 0) {
          setSelectedSigner({ type: 'local', key, account: accounts[0] });
          return;
        }
      }
    }
  }, [localKeys, accountsMap]);

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

  const [cloudMeta, setCloudMeta] = useState<{
    id?: string; name: string; slug?: string; is_public?: boolean;
  }>({ name: 'Untitled' });
  const autoCreatingRef = useRef(false);
  const [viewingShared, setViewingShared] = useState<string | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);

  const [monacoInstance, setMonacoInstance] = useState<typeof MonacoNS | null>(null);
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const pendingDefinitionRef = useRef<{ path: string; line: number; column: number } | null>(null);
  const errorDecoCleanupRef = useRef<(() => void) | null>(null);
  const [argErrors, setArgErrors] = useState<ParsedArgError[]>([]);

  // Resize hooks
  const explorer = useHorizontalResize(220, 150, 400, 'left');
  const aiPanel = useHorizontalResize(500, 260, 700, 'right');
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

  const activePendingDiff = pendingDiffs[project.activeFile] ?? null;

  // Configure FCL when network changes
  useEffect(() => {
    configureFcl(network);
  }, [network]);

  // Re-select signer when accountsMap updates and current address is stale.
  // After a network switch, refreshAccounts replaces accountsMap entries with
  // the new network's accounts.  If the selected address no longer appears in
  // accountsMap we pick the first available account for the same key.
  useEffect(() => {
    if (selectedSigner.type !== 'local') return;

    const accounts = accountsMap[selectedSigner.key.id] || [];
    if (accounts.length === 0) return; // still loading

    // Check if current selection is still valid in accountsMap
    const stillValid = accounts.some(
      a => a.flowAddress === selectedSigner.account.flowAddress &&
           a.keyIndex === selectedSigner.account.keyIndex,
    );
    if (stillValid) return;

    // Current address not found — pick best replacement
    const sameIndex = accounts.find(a => a.keyIndex === selectedSigner.account.keyIndex);
    const newAccount = sameIndex || accounts[0];
    setSelectedSigner({ type: 'local', key: selectedSigner.key, account: newAccount });
  }, [accountsMap, selectedSigner]);

  // Persist project to localStorage (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      saveProject(project);
      localStorage.setItem('runner:network', network);
    }, 1000);
    return () => clearTimeout(timer);
  }, [project, network]);

  // Cloud auto-save (debounced 2s) — auto-creates if no cloud project yet
  const isTxMode = useMemo(() => !!new URLSearchParams(window.location.search).get('tx'), []);
  useEffect(() => {
    if (!user) return;
    if (viewingShared) return;
    if (isTxMode) return; // Don't auto-save when viewing a transaction
    if (cloudMeta.id === '_dismissed') return;

    const timer = setTimeout(async () => {
      if (autoCreatingRef.current) return;
      try {
        if (cloudMeta.id) {
          await cloudSave(project, {
            id: cloudMeta.id,
            name: cloudMeta.name,
            slug: cloudMeta.slug,
            network,
            is_public: cloudMeta.is_public,
          });
        } else {
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
        setCloudMeta({ name: full.name });
        setViewingShared(projectSlug);
      }
      setNetwork(full.network as FlowNetwork);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // LSP integration
  const handleDependency = useCallback((address: string, contractName: string, code: string) => {
    setProject((prev) => addDependencyFile(prev, address, contractName, code));
  }, []);

  const { notifyChange, goToDefinition, loadingDeps, activeMode, lspError, wasmProgress } = useLsp(monacoInstance, project, network, lspMode, handleDependency);

  const scriptParams = useMemo(() => parseMainParams(activeCode), [activeCode]);
  const codeType = useMemo(() => detectCodeType(activeCode), [activeCode]);

  // Apply args from URL (?args= or ?tx= fetch) once params are available
  useEffect(() => {
    if (initialArgsApplied || scriptParams.length === 0) return;
    // If tx fetch is still pending, wait for it
    if (!txArgsReady) return;

    // Determine the args source: URL ?args= param or fetched tx args
    let parsed: unknown[] | null = null;
    const params = new URLSearchParams(window.location.search);
    const argsParam = params.get('args');
    if (argsParam) {
      try {
        let argsStr: string;
        try { argsStr = atob(argsParam); } catch { argsStr = argsParam; }
        const p = JSON.parse(argsStr);
        if (Array.isArray(p)) parsed = p;
      } catch { /* ignore */ }
    } else if (pendingTxArgsRef.current) {
      parsed = pendingTxArgsRef.current;
      pendingTxArgsRef.current = null;
    }

    if (!parsed) { setInitialArgsApplied(true); return; }

    const vals: Record<string, string> = {};
    for (let i = 0; i < scriptParams.length && i < parsed.length; i++) {
      const item = parsed[i];
      // Support Cadence JSON ({type, value}) or plain values
      if (item !== null && typeof item === 'object' && 'type' in item && 'value' in item) {
        const v = (item as { value: unknown }).value;
        vals[scriptParams[i].name] = typeof v === 'string' ? v : JSON.stringify(v);
      } else {
        vals[scriptParams[i].name] = typeof item === 'string' ? item : JSON.stringify(item);
      }
    }
    setParamValues(vals);
    setInitialArgsApplied(true);
  }, [scriptParams, initialArgsApplied, txArgsReady]);

  const handleCodeChange = useCallback((value: string) => {
    setProject((prev) => updateFileContent(prev, prev.activeFile, value));
    notifyChange(project.activeFile, value);
  }, [project.activeFile, notifyChange]);

  const handleRun = useCallback(async () => {
    if (loading) return;

    // If no signer and this requires signing, open connect modal
    if (selectedSigner.type === 'none' && codeType !== 'script') {
      pendingRunRef.current = true;
      setConnectModalOpen(true);
      return;
    }

    // If auto-sign is off and this is a transaction/contract, confirm first
    if (!autoSign && codeType !== 'script') {
      const action = codeType === 'contract' ? 'deploy this contract' : 'send this transaction';
      const confirmed = window.confirm(`Are you sure you want to ${action}?\n\nThis will sign and submit on-chain.`);
      if (!confirmed) return;
    }

    // Clear previous error decorations
    errorDecoCleanupRef.current?.();
    errorDecoCleanupRef.current = null;
    setArgErrors([]);

    setLoading(true);
    setResults([]);

    // Helper: build sign function for local key signer
    const buildLocalSignFn = (key: any, account: any) => async (message: string) => {
      try {
        return await signWithLocalKey(key.id, message, account.hashAlgo, undefined, account.sigAlgo);
      } catch (e: any) {
        if (e.message === 'PASSWORD_REQUIRED') {
          const password = await promptForPassword(key.label);
          return signWithLocalKey(key.id, message, account.hashAlgo, password, account.sigAlgo);
        }
        throw e;
      }
    };

    const onResult = (result: any) => setResults((prev: any) => [...prev, result]);

    if (codeType === 'script') {
      const result = await executeScript(activeCode, paramValues);
      setResults([result]);
    } else if (codeType === 'contract') {
      // Deploy contract — requires a signer
      if (selectedSigner.type === 'local') {
        const { key, account } = selectedSigner;
        await deployContract(activeCode, account.flowAddress, account.keyIndex, buildLocalSignFn(key, account), onResult, account.sigAlgo, account.hashAlgo);
      } else {
        setResults([{ type: 'error', data: 'Deploy requires a local key signer. Please select one.' }]);
      }
    } else if (selectedSigner.type === 'fcl' || selectedSigner.type === 'none') {
      await executeTransaction(activeCode, paramValues, onResult);
    } else if (selectedSigner.type === 'local') {
      const { key, account } = selectedSigner;
      await executeCustodialTransaction(activeCode, paramValues, account.flowAddress, account.keyIndex, buildLocalSignFn(key, account), onResult, account.sigAlgo, account.hashAlgo);
    }

    setLoading(false);
  }, [activeCode, codeType, paramValues, loading, selectedSigner, signWithLocalKey, promptForPassword, autoSign]);

  // Auto-retry run after connecting wallet from the modal
  useEffect(() => {
    if (pendingRunRef.current && selectedSigner.type !== 'none') {
      pendingRunRef.current = false;
      handleRun();
    }
  }, [selectedSigner, handleRun]);

  // Apply error decorations when execution results contain errors
  useEffect(() => {
    const lastError = [...results].reverse().find((r: ExecutionResult) => r.type === 'error');
    if (!lastError || typeof lastError.data !== 'string') return;

    const parsed = parseExecutionError(lastError.data);

    // Line error → Monaco decorations
    if (parsed.lineError && editorRef.current && monacoInstance) {
      errorDecoCleanupRef.current?.();
      errorDecoCleanupRef.current = setErrorDecorations(editorRef.current, monacoInstance, parsed.lineError);
    }

    // Argument errors → highlight param inputs
    if (parsed.argErrors.length > 0) {
      setArgErrors(parsed.argErrors);
    }
  }, [results, monacoInstance]);

  // Clear error decorations when code changes
  useEffect(() => {
    errorDecoCleanupRef.current?.();
    errorDecoCleanupRef.current = null;
    setArgErrors([]);
  }, [activeCode]);

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

    setPendingDiffs((prev) => {
      const next = { ...prev };

      for (const edit of sanitized) {
        const targetPath = edit.path || project.activeFile;
        const currentContent = getFileContent(project, targetPath) || '';
        const original = next[targetPath]?.original ?? currentContent;

        let modified: string;
        if (edit.patches && edit.patches.length > 0) {
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

  const handleRejectAllDiffs = useCallback(() => {
    setPendingDiffs({});
  }, []);

  const handleAcceptHunk = useCallback((filePath: string, hunkOriginal: string, hunkModified: string) => {
    setPendingDiffs((prev) => {
      const entry = prev[filePath];
      if (!entry) return prev;

      const origLines = entry.original.split('\n');
      const hunkOrigLines = hunkOriginal.split('\n');
      const hunkModLines = hunkModified.split('\n');

      const origIdx = findSubarray(origLines, hunkOrigLines);
      if (origIdx < 0) return prev;

      const newOrigLines = [
        ...origLines.slice(0, origIdx),
        ...hunkModLines,
        ...origLines.slice(origIdx + hunkOrigLines.length),
      ];

      const newOriginal = newOrigLines.join('\n');
      const newModified = entry.modified;

      if (newOriginal === newModified) {
        const next = { ...prev };
        delete next[filePath];
        return next;
      }

      return { ...prev, [filePath]: { ...entry, original: newOriginal } };
    });

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

  const handleAICreateFile = useCallback((path: string, content: string) => {
    setProject((prev) => {
      let next = createFile(prev, path, content);
      next = updateFileContent(next, path, content);
      return openFile(next, path);
    });
  }, []);

  const handleAIDeleteFile = useCallback((path: string) => {
    setProject((prev) => deleteFile(prev, path));
  }, []);

  const handleAISetActiveFile = useCallback((path: string) => {
    setProject((prev) => openFile(prev, path));
  }, []);

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

  const handleFixWithAI = useCallback((errorMessage: string) => {
    setShowAI(true);
    setAiPendingMessage(`The codegen tool returned this error when trying to generate code from my Cadence:\n\n\`\`\`\n${errorMessage}\n\`\`\`\n\nPlease help me fix my Cadence code.`);
  }, []);

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

  const hasBottomPanel = scriptParams.length > 0 || results.length > 0 || loading;

  return (
    <div className="flex flex-col h-full bg-zinc-900 text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between px-3 md:px-4 py-2 border-b border-zinc-700 bg-zinc-900/80 backdrop-blur shrink-0 overflow-visible relative z-20">
        <div className="flex items-center gap-2">
          {!isMobile && (
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
          )}
          <h1 className="text-sm font-semibold tracking-tight">{isMobile ? 'Runner' : 'Cadence Runner'}</h1>
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          {!isMobile && (
            user && cloudMeta.id && cloudMeta.id !== '_dismissed' ? (
              <button
                onClick={() => setShowShareModal(true)}
                className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs px-2 py-1 rounded border border-zinc-700 transition-colors"
                title="Share project"
              >
                <Share2 className="w-3 h-3" />
                <span>Share</span>
              </button>
            ) : (
              <a
                href={`https://flowindex.io/developer/login?redirect=${encodeURIComponent(window.location.href)}`}
                className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs px-2 py-1 rounded border border-zinc-700 transition-colors"
                title="Log in to share"
              >
                <Share2 className="w-3 h-3" />
                <span>Share</span>
              </a>
            )
          )}
          {/* Network selector */}
          <div ref={networkMenuRef} className="relative">
            <button
              onClick={() => setShowNetworkMenu(!showNetworkMenu)}
              className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs px-2 py-1 rounded border border-zinc-700 transition-colors"
            >
              <Globe className="w-3 h-3 text-zinc-400" />
              <span>{network === 'testnet' ? 'Testnet' : 'Mainnet'}</span>
              <ChevronDown className="w-3 h-3 text-zinc-400" />
            </button>
            {showNetworkMenu && (
              <div className="absolute top-full right-0 mt-1 w-32 bg-zinc-800 border border-zinc-700 rounded shadow-xl z-50 py-1">
                {(['mainnet', 'testnet'] as const).map((n) => (
                  <button
                    key={n}
                    onClick={() => { setNetwork(n); setShowNetworkMenu(false); }}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                      network === n
                        ? 'text-emerald-400 bg-emerald-600/10'
                        : 'text-zinc-300 hover:bg-zinc-700'
                    }`}
                  >
                    {n === 'testnet' ? 'Testnet' : 'Mainnet'}
                  </button>
                ))}
              </div>
            )}
          </div>


          {/* LSP status indicator */}
          <div className="relative group/lsp">
            <button
              onClick={() => {
                if (lspError) { setShowExplorer(true); setShowLspMenu(true); }
              }}
              className={`flex items-center gap-1 px-1.5 py-1 rounded transition-colors ${
                lspError ? 'hover:bg-zinc-700 cursor-pointer' : 'cursor-default'
              }`}
              title={
                lspError ? 'LSP connection failed — click Settings to switch mode'
                : activeMode ? `LSP: ${activeMode}${lspMode === 'auto' ? ' (auto)' : ''}`
                : 'LSP connecting...'
              }
            >
              {!activeMode && !lspError ? (
                <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
              ) : (
                <span className={`inline-block w-2 h-2 rounded-full ${
                  lspError ? 'bg-red-500' : 'bg-emerald-500'
                }`} />
              )}
              {lspError && (
                <span className="text-[10px] text-red-400">LSP</span>
              )}
            </button>
            {/* Tooltip on hover for non-error states */}
            {!lspError && activeMode && (
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-[10px] text-zinc-300 whitespace-nowrap opacity-0 pointer-events-none group-hover/lsp:opacity-100 transition-opacity z-50">
                LSP: {activeMode}{lspMode === 'auto' ? ' (auto)' : ''}
              </div>
            )}
          </div>

          {/* Signer selector — always shown */}
          <SignerSelector
            selected={selectedSigner}
            onSelect={persistSigner}
            localKeys={localKeys}
            accountsMap={accountsMap}
            onViewAccount={handleViewAccount}
            onOpenKeyManager={() => setShowKeyManager(true)}
            onOpenConnectModal={() => setConnectModalOpen(true)}
            autoSign={autoSign}
            onToggleAutoSign={handleToggleAutoSign}
            network={network}
          />

          {/* Desktop run button */}
          {!isMobile && (
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
              {codeType === 'script' ? 'Run Script' : codeType === 'contract' ? 'Deploy' : 'Send Transaction'}
              <span className="ml-1.5 flex items-center gap-0.5 opacity-60">
                <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-mono leading-none bg-white/15 border border-white/20 rounded shadow-[0_1px_0_rgba(0,0,0,0.3)]">
                  {navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}
                </kbd>
                <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-mono leading-none bg-white/15 border border-white/20 rounded shadow-[0_1px_0_rgba(0,0,0,0.3)]">
                  ↵
                </kbd>
              </span>
            </button>
          )}
        </div>
      </header>

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

      {/* Main layout */}
      <div className="flex flex-1 min-h-0">
        {/* File Explorer (hidden on mobile) */}
        {showExplorer && !isMobile && (
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
                    onShare={() => setShowShareModal(true)}
                    onDelete={async (id) => {
                      await cloudDelete(id);
                      setCloudMeta({ name: 'Untitled' });
                      setProject(loadProject());
                    }}
                    saving={projectSaving}
                    lastSaved={lastSaved}
                    onExport={handleExportZip}
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
                    <div>
                      <a
                        href={`https://flowindex.io/developer/login?redirect=${encodeURIComponent(window.location.origin)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 text-[11px] transition-colors px-3 py-2"
                      >
                        <LogIn className="w-3 h-3" />
                        <span>Sign in</span>
                      </a>
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
                  )}
                </div>
              )}
              {/* Settings */}
              <div className="shrink-0 border-t border-zinc-700">
                <button
                  onClick={() => setShowLspMenu((v) => !v)}
                  className="flex items-center gap-1.5 w-full px-3 py-2 text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  <Settings className="w-3 h-3" />
                  <span>Settings</span>
                </button>
                {showLspMenu && (
                  <div className="px-3 pb-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">LSP Mode</span>
                      {!activeMode && <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />}
                      {activeMode && lspMode === 'auto' && (
                        <span className="text-[10px] text-zinc-500">→ {activeMode}</span>
                      )}
                    </div>
                    <div className="flex rounded-md overflow-hidden border border-zinc-700 bg-zinc-900">
                      <div className="relative flex-1 group/auto">
                        <button
                          onClick={() => setLspMode('auto')}
                          className={`flex items-center justify-center gap-1 w-full px-2 py-1.5 text-[11px] font-medium transition-colors ${
                            lspMode === 'auto'
                              ? 'bg-violet-500/15 text-violet-400 border-r border-violet-500/30'
                              : 'text-zinc-500 hover:text-zinc-300 border-r border-zinc-700'
                          }`}
                        >
                          <Sparkles className="w-3 h-3" />
                          Auto
                        </button>
                        <div className="absolute bottom-full left-0 mb-2 w-52 p-2.5 bg-zinc-800 border border-zinc-600 rounded-lg shadow-xl text-[10px] leading-relaxed opacity-0 pointer-events-none group-hover/auto:opacity-100 transition-opacity z-50">
                          <div className="text-violet-400 font-semibold mb-1">Auto (Recommended)</div>
                          <div className="text-zinc-400 mb-1.5">Best of both worlds</div>
                          <div className="text-zinc-500 space-y-0.5">
                            <div>+ Uses WASM if cached</div>
                            <div>+ Falls back to Server</div>
                            <div>+ Background downloads WASM</div>
                            <div>+ No waiting on first visit</div>
                          </div>
                        </div>
                      </div>
                      <div className="relative flex-1 group/wasm">
                        <button
                          onClick={() => setLspMode('wasm')}
                          className={`flex items-center justify-center gap-1 w-full px-2 py-1.5 text-[11px] font-medium transition-colors ${
                            lspMode === 'wasm'
                              ? 'bg-emerald-500/15 text-emerald-400 border-r border-emerald-500/30'
                              : 'text-zinc-500 hover:text-zinc-300 border-r border-zinc-700'
                          }`}
                        >
                          <Cpu className="w-3 h-3" />
                          WASM
                        </button>
                        <div className="absolute bottom-full left-0 mb-2 w-52 p-2.5 bg-zinc-800 border border-zinc-600 rounded-lg shadow-xl text-[10px] leading-relaxed opacity-0 pointer-events-none group-hover/wasm:opacity-100 transition-opacity z-50">
                          <div className="text-emerald-400 font-semibold mb-1">WASM (Local)</div>
                          <div className="text-zinc-400 mb-1.5">Runs in browser Web Worker</div>
                          <div className="text-zinc-500 space-y-0.5">
                            <div>+ Zero latency</div>
                            <div>+ Works offline</div>
                            <div>+ No server needed</div>
                            <div className="text-amber-500/80">- 47MB initial download</div>
                          </div>
                        </div>
                      </div>
                      <div className="relative flex-1 group/server">
                        <button
                          onClick={() => setLspMode('server')}
                          className={`flex items-center justify-center gap-1 w-full px-2 py-1.5 text-[11px] font-medium transition-colors ${
                            lspMode === 'server'
                              ? 'bg-blue-500/15 text-blue-400'
                              : 'text-zinc-500 hover:text-zinc-300'
                          }`}
                        >
                          <Server className="w-3 h-3" />
                          Server
                        </button>
                        <div className="absolute bottom-full right-0 mb-2 w-52 p-2.5 bg-zinc-800 border border-zinc-600 rounded-lg shadow-xl text-[10px] leading-relaxed opacity-0 pointer-events-none group-hover/server:opacity-100 transition-opacity z-50">
                          <div className="text-blue-400 font-semibold mb-1">Server (WebSocket)</div>
                          <div className="text-zinc-400 mb-1.5">Remote LSP via WebSocket</div>
                          <div className="text-zinc-500 space-y-0.5">
                            <div>+ Full Go runtime</div>
                            <div>+ Faster import resolution</div>
                            <div>+ No WASM download</div>
                            <div className="text-amber-500/80">- Requires server</div>
                            <div className="text-amber-500/80">- Network latency</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
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
              pendingDiffPaths={Object.keys(pendingDiffs)}
            />
            {loadingDeps && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-400 shrink-0">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="text-[11px] font-medium">Resolving imports...</span>
              </div>
            )}
            <div className="flex-1 min-h-0">
              {activePendingDiff ? (
                <CadenceDiffEditor
                  key={`diff-${project.activeFile}`}
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
                    argErrors={argErrors}
                  />
                </div>
                <div className="flex-1 min-h-0">
                  <ResultPanel results={results} loading={loading} network={network} code={activeCode} filename={project.activeFile} codeType={codeType} onFixWithAI={handleFixWithAI} />
                </div>
              </div>
            </>
          )}
        </div>

        {/* AI Panel — desktop sidebar */}
        {!isMobile && (
          showAI ? (
            <>
              <DragBar direction="horizontal" onMouseDown={aiPanel.onMouseDown} />
              <div className="shrink-0 overflow-hidden" style={{ width: aiPanel.width }}>
                <Suspense
                  fallback={
                    <div className="h-full flex items-center justify-center text-xs text-zinc-500 bg-zinc-900 border-l border-zinc-700">
                      Loading AI...
                    </div>
                  }
                >
                  <AIPanel
                    onInsertCode={handleInsertCode}
                    onApplyCodeToFile={handleApplyCodeToFile}
                    onAutoApplyEdits={handleAutoApplyEdits}
                    onLoadTemplate={handleLoadTemplate}
                    onCreateFile={handleAICreateFile}
                    onDeleteFile={handleAIDeleteFile}
                    onSetActiveFile={handleAISetActiveFile}
                    editorCode={activeCode}
                    projectFiles={getUserFiles(project)}
                    activeFile={project.activeFile}
                    network={network}
                    onClose={() => setShowAI(false)}
                    selectedSigner={selectedSigner}
                    signWithLocalKey={signWithLocalKey}
                    promptForPassword={promptForPassword}
                    localKeys={localKeys}
                    accountsMap={accountsMap}
                    onCreateAccount={createAccount}
                    onRefreshAccounts={refreshAccounts}
                    onSwitchNetwork={(n) => setNetwork(n as FlowNetwork)}
                    onViewAccount={handleViewAccount}
                    pendingMessage={aiPendingMessage}
                    onPendingMessageConsumed={() => setAiPendingMessage(undefined)}
                  />
                </Suspense>
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
          )
        )}
      </div>

      {/* Mobile: Floating Run button */}
      {isMobile && (
        <button
          onClick={handleRun}
          disabled={loading || activeFileEntry?.readOnly}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:bg-emerald-800 disabled:text-emerald-500 text-white font-semibold pl-4 pr-5 py-3.5 rounded-full shadow-lg shadow-emerald-900/40 transition-colors"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Play className="w-5 h-5" fill="currentColor" />
          )}
          <span className="text-sm">{codeType === 'script' ? 'Run' : codeType === 'contract' ? 'Deploy' : 'Send'}</span>
        </button>
      )}

      {/* Mobile: Floating AI button */}
      {isMobile && !showMobileAI && (
        <button
          onClick={() => setShowMobileAI(true)}
          className="fixed bottom-5 left-5 z-40 flex items-center justify-center w-12 h-12 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 border border-zinc-600 text-emerald-400 rounded-full shadow-lg shadow-black/40 transition-colors"
          title="AI Assistant"
        >
          <MessageSquare className="w-5 h-5" />
        </button>
      )}

      {/* Mobile: AI panel fullscreen overlay */}
      {isMobile && showMobileAI && (
        <div className="fixed inset-0 z-50 flex flex-col bg-zinc-900">
          <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700 shrink-0">
            <span className="text-sm font-semibold text-white">AI Assistant</span>
            <button
              onClick={() => setShowMobileAI(false)}
              className="p-2 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 min-h-0">
            <Suspense
              fallback={
                <div className="h-full flex items-center justify-center text-xs text-zinc-500">
                  Loading AI...
                </div>
              }
            >
              <AIPanel
                onInsertCode={(code) => { handleInsertCode(code); setShowMobileAI(false); }}
                onApplyCodeToFile={(path, code) => { handleApplyCodeToFile(path, code); setShowMobileAI(false); }}
                onAutoApplyEdits={handleAutoApplyEdits}
                onLoadTemplate={(t) => { handleLoadTemplate(t); setShowMobileAI(false); }}
                onCreateFile={handleAICreateFile}
                onDeleteFile={handleAIDeleteFile}
                onSetActiveFile={handleAISetActiveFile}
                editorCode={activeCode}
                projectFiles={getUserFiles(project)}
                activeFile={project.activeFile}
                network={network}
                onClose={() => setShowMobileAI(false)}
                selectedSigner={selectedSigner}
                signWithLocalKey={signWithLocalKey}
                promptForPassword={promptForPassword}
                localKeys={localKeys}
                accountsMap={accountsMap}
                onCreateAccount={createAccount}
                onRefreshAccounts={refreshAccounts}
                onSwitchNetwork={(n) => setNetwork(n as FlowNetwork)}
                onViewAccount={handleViewAccount}
                pendingMessage={aiPendingMessage}
                onPendingMessageConsumed={() => setAiPendingMessage(undefined)}
              />
            </Suspense>
          </div>
        </div>
      )}

      {/* Share Modal */}
      {showShareModal && cloudMeta.id && cloudMeta.slug && (
        <ShareModal
          projectName={cloudMeta.name}
          projectId={cloudMeta.id}
          slug={cloudMeta.slug}
          isPublic={cloudMeta.is_public ?? false}
          onTogglePublic={async (id, isPublic) => {
            setCloudMeta(prev => ({ ...prev, is_public: isPublic }));
            await cloudSave(project, { ...cloudMeta, id, is_public: isPublic });
            await fetchProjects();
          }}
          onClose={() => setShowShareModal(false)}
        />
      )}

      {/* Key Manager Panel (overlay) */}
      {showKeyManager && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowKeyManager(false)} />
          <div className="relative w-[480px] max-w-[90vw] max-h-[80vh] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-y-auto">
            <Suspense
              fallback={
                <div className="p-6 text-center text-xs text-zinc-500">Loading wallet...</div>
              }
            >
              <KeyManager
                onClose={() => setShowKeyManager(false)}
                network={network}
                localKeys={localKeys}
                accountsMap={accountsMap}
                wasmReady={wasmReady}
                onGenerateKey={generateNewKey}
                onImportMnemonic={importMnemonic}
                onImportPrivateKey={importLocalPrivateKey}
                onImportKeystore={importKeystore}
                onDeleteLocalKey={deleteLocalKey}
                onExportKeystore={exportKeystore}
                onRefreshAccounts={refreshAccounts}
                onCreateAccount={createAccount}
                onRevealSecret={revealSecret}
                onViewAccount={handleViewAccount}
                selectedAccount={selectedSigner.type === 'local' ? { keyId: selectedSigner.key.id, address: selectedSigner.account.flowAddress, keyIndex: selectedSigner.account.keyIndex } : null}
                onSelectAccount={(key, account) => { persistSigner({ type: 'local', key, account }); setShowKeyManager(false); }}
              />
            </Suspense>
          </div>
        </div>
      )}

      {/* Account Side Panel */}
      {accountPanelAddress && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1" onClick={() => setAccountPanelAddress(null)} />
          <div className="w-[480px] max-w-full shrink-0 shadow-2xl">
            <Suspense
              fallback={
                <div className="h-full flex items-center justify-center bg-zinc-900 text-xs text-zinc-500">
                  Loading account...
                </div>
              }
            >
              <AccountPanel
                address={accountPanelAddress}
                network={network}
                onClose={() => setAccountPanelAddress(null)}
                onDisconnect={() => {
                  if (selectedSigner.type === 'local') persistSigner({ type: 'none' });
                }}
              />
            </Suspense>
          </div>
        </div>
      )}

      {passwordPrompt && (
        <PasswordPrompt
          keyLabel={passwordPrompt.keyLabel}
          onSubmit={(pw) => { passwordPrompt.resolve(pw); setPasswordPrompt(null); }}
          onCancel={() => { passwordPrompt.reject(); setPasswordPrompt(null); }}
        />
      )}

      <ConnectModal
        open={connectModalOpen}
        onClose={() => { setConnectModalOpen(false); pendingRunRef.current = false; }}
        onSelect={handleModalSelect}
        localKeys={localKeys}
        accountsMap={accountsMap}
        autoSign={autoSign}
        onToggleAutoSign={handleToggleAutoSign}
        network={network}
        onOpenKeyManager={() => { setConnectModalOpen(false); setShowKeyManager(true); }}
      />
    </div>
  );
}

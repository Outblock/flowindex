import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from 'react';
import type * as MonacoNS from 'monaco-editor';
import JSZip from 'jszip';
import axios from 'axios';
import CadenceEditor from './editor/CadenceEditor';
import CadenceDiffEditor from './editor/CadenceDiffEditor';
import { useLsp } from './editor/useLsp';
import { useSolidityLsp } from './editor/useSolidityLsp';
import { compileSolidity, compileSolidityMultiFile, deploySolidity, detectPragmaVersion } from './flow/evmExecute';
import { useSolImports } from './flow/useSolImports';
import type { DeployedContract } from './flow/evmContract';
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi';
import { flowEvmMainnet, flowEvmTestnet } from './flow/evmChains';
import ResultPanel from './components/ResultPanel';
import ParamPanel from './components/ParamPanel';
import WalletButton from './components/WalletButton';
import FileExplorer from './components/FileExplorer';
import TabBar from './components/TabBar';
import { configureFcl } from './flow/fclConfig';
import { parseMainParams, toCadenceJsonCdc, validateCadenceParams } from './flow/cadenceParams';
import { detectCodeType, executeScript, executeTransaction, executeCustodialTransaction, deployContract } from './flow/execute';
import type { ExecutionResult } from './flow/execute';
import { simulateTransaction } from './flow/simulate';
import type { SimulateResponse } from './flow/simulate';
import TransactionPreview from './components/TransactionPreview';
import { parseExecutionError, setErrorDecorations, type ParsedArgError } from './editor/errorDecorations';
import type { FlowNetwork } from './flow/networks';
import { useEmulatorStatus } from './flow/useEmulatorStatus';
import { EMULATOR_SERVICE_ADDRESS, EMULATOR_SERVICE_KEY } from './flow/emulatorSigner';
import { bootstrapEmulatorContracts } from './flow/emulatorBootstrap';
import { useAuth } from './auth/AuthContext';
import { useKeys } from './auth/useKeys';
import { useLocalKeys } from './auth/useLocalKeys';
import { usePasskeyWallet } from './auth/usePasskeyWallet';
import { PasswordPrompt } from './components/PasswordPrompt';
import SignerSelector, { type SignerOption } from './components/SignerSelector';
import ConnectModal from './components/ConnectModal';
import ConfirmDialog from './components/ConfirmDialog';
import {
  loadProject, saveProject, updateFileContent, createFile, createFolder, deleteFile,
  openFile, closeFile, getFileContent, addDependencyFile, getUserFiles,
  renameFile, moveFile,
  TEMPLATES, DEFAULT_CODE, getTemplates, replaceContractAddresses,
  generateLocalId, listLocalProjects, saveLocalProject, loadLocalProject,
  deleteLocalProject, renameLocalProject, loadCloudMeta, saveCloudMeta, clearCloudMeta,
  type ProjectState, type Template, type LocalProjectMeta,
} from './fs/fileSystem';
import { useProjects, type CloudProject, type CloudProjectFull } from './auth/useProjects';
import ProjectManagerModal from './components/ProjectManagerModal';
import SearchPanel from './components/SearchPanel';
import ImportFromAddressDialog from './components/ImportFromAddressDialog';
import ShareModal from './components/ShareModal';
import { useGitHub } from './github/useGitHub';
import GitHubConnect from './components/GitHubConnect';
import ActivityBar, { type SidebarTab } from './components/ActivityBar';
import GitHubPanel from './components/GitHubPanel';
import SettingsPanel from './components/SettingsPanel';
import { githubApi } from './github/api';
import { useDeployEvents } from './github/useDeployEvents';
import { Play, Loader2, PanelLeftOpen, PanelLeftClose, Bot, ChevronLeft, Key as KeyIcon, LogIn, Share2, X, MessageSquare, ChevronDown, Globe, Terminal, Import, Download, Plus, FilePlus, FolderOpen } from 'lucide-react';
import type { LspMode } from './editor/useLsp';

const AIPanel = lazy(() => import('./components/AIPanel'));
const KeyManager = lazy(() => import('./components/KeyManager'));
const AccountPanel = lazy(() => import('./components/AccountPanel'));
const LoginModal = lazy(() => import('./components/LoginModal'));
const PasskeyOnboardingModal = lazy(() => import('./components/PasskeyOnboardingModal'));

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
    // Load from local project store if ?local=id
    const localId = params.get('local');
    if (localId) {
      const local = loadLocalProject(localId);
      if (local) return local;
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

  const { status: emulatorStatus, recheck: recheckEmulator } = useEmulatorStatus(network);

  const [results, setResults] = useState<ExecutionResult[]>([]);

  // Auto-deploy standard contracts when emulator connects
  const emulatorBootstrapped = useRef(false);
  useEffect(() => {
    if (network !== 'emulator' || emulatorStatus !== 'connected') {
      emulatorBootstrapped.current = false;
      return;
    }
    if (emulatorBootstrapped.current) return;
    emulatorBootstrapped.current = true;

    bootstrapEmulatorContracts((result) => {
      setResults((prev) => [...prev, result]);
    });
  }, [network, emulatorStatus]);

  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const isMobile = useIsMobile();
  const [showExplorer, setShowExplorer] = useState(!isIframe);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('files');
  const [gitDiffFile, setGitDiffFile] = useState<string | null>(null);
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
  const openLogin = useCallback(() => setShowLoginModal(true), []);
  useKeys();
  const {
    localKeys, accountsMap, wasmReady, ensureWasmReady,
    generateNewKey, importMnemonic, importPrivateKey: importLocalPrivateKey,
    importKeystore, deleteLocalKey, exportKeystore,
    signWithLocalKey, refreshAccounts, createAccount, getPrivateKey, revealSecret,
  } = useLocalKeys();
  const {
    register: passkeyRegister,
    createPasskey,
    provisionAccounts,
    pollProvisionTx,
    saveProvisionedAddress,
    login: passkeyLogin,
    sign: passkeySign,
    accounts: passkeyAccounts,
    passkeys: passkeyList,
    refreshPasskeyState,
    hasPasskeySupport,
  } = usePasskeyWallet();
  const [showKeyManager, setShowKeyManager] = useState(false);
  const [keyManagerInitialMode, setKeyManagerInitialMode] = useState<'create' | 'import' | undefined>();
  const [showNetworkMenu, setShowNetworkMenu] = useState(false);
  const [showFileMenu, setShowFileMenu] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showPasskeyOnboarding, setShowPasskeyOnboarding] = useState(false);
  const networkMenuRef = useRef<HTMLDivElement>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      localStorage.setItem('runner:show-ai', String(showAI));
    } catch {
      // ignore localStorage write errors
    }
  }, [showAI]);
  // Preload wallet-core WASM on mount so key generation is instant
  useEffect(() => {
    ensureWasmReady().catch(() => {});
  }, [ensureWasmReady]);
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
  // Close file menu on outside click
  useEffect(() => {
    if (!showFileMenu) return;
    const handler = (e: MouseEvent) => {
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) {
        setShowFileMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showFileMenu]);

  const [autoSign, setAutoSign] = useState(() => {
    try { return localStorage.getItem('runner-auto-sign') !== 'false'; } catch { return true; }
  });
  const handleToggleAutoSign = useCallback((value: boolean) => {
    setAutoSign(value);
    try { localStorage.setItem('runner-auto-sign', String(value)); } catch { /* ignore */ }
  }, []);

  const [simulateBeforeSend, setSimulateBeforeSend] = useState<boolean>(() => {
    try { return localStorage.getItem('runner:simulate-before-send') !== 'false'; } catch { return true; }
  });
  const handleToggleSimulate = useCallback((value: boolean) => {
    setSimulateBeforeSend(value);
    try { localStorage.setItem('runner:simulate-before-send', String(value)); } catch { /* ignore */ }
  }, []);
  const [simResult, setSimResult] = useState<SimulateResponse | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [pendingExecution, setPendingExecution] = useState<(() => void) | null>(null);
  const [txPreviewOpen, setTxPreviewOpen] = useState(false);
  const [txPreviewSimEnabled, setTxPreviewSimEnabled] = useState(false);

  const [accountPanelAddress, setAccountPanelAddress] = useState<string | null>(null);
  const handleViewAccount = useCallback((address: string) => setAccountPanelAddress(address), []);
  const [selectedSigner, setSelectedSigner] = useState<SignerOption>({ type: 'none' });
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const pendingRunRef = useRef(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel?: string;
    variant?: 'danger' | 'default';
    resolve: (v: boolean) => void;
  } | null>(null);
  const showConfirm = useCallback((opts: { title: string; message: string; confirmLabel?: string; variant?: 'danger' | 'default' }) => {
    return new Promise<boolean>((resolve) => {
      setConfirmDialog({ ...opts, resolve });
    });
  }, []);
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
      } else if (signer.type === 'eoa') {
        localStorage.setItem('flow-selected-signer', JSON.stringify({
          type: 'eoa',
          keyId: signer.key.id,
          evmAddress: signer.evmAddress,
        }));
      } else if (signer.type === 'passkey') {
        localStorage.setItem('flow-selected-signer', JSON.stringify({
          type: 'passkey',
          credentialId: signer.credentialId,
          flowAddress: signer.flowAddress,
          publicKeySec1Hex: signer.publicKeySec1Hex,
        }));
      } else {
        localStorage.removeItem('flow-selected-signer');
      }
    } catch {}
  }, []);

  const skipPasskeyOnboarding = useCallback(() => {
    try { sessionStorage.setItem('runner:passkey-onboarding-skipped', '1'); } catch {}
    setShowPasskeyOnboarding(false);
  }, []);

  const permanentlyDismissPasskey = useCallback(() => {
    if (user) {
      try {
        localStorage.setItem(`runner:passkey-onboarding-dismissed:${user.id}`, '1');
      } catch {}
    }
    setShowPasskeyOnboarding(false);
  }, [user]);

  const handlePasskeyOnboardingDone = useCallback(() => {
    setShowPasskeyOnboarding(false);
    refreshPasskeyState().catch(() => {});
  }, [refreshPasskeyState]);

  const passkeyOnboardingCheckedRef = useRef<string | null>(null);
  useEffect(() => {
    if (authLoading || !user || !hasPasskeySupport) {
      passkeyOnboardingCheckedRef.current = null;
      setShowPasskeyOnboarding(false);
      return;
    }
    // Only check once per user session
    if (passkeyOnboardingCheckedRef.current === user.id) return;
    passkeyOnboardingCheckedRef.current = user.id;

    let cancelled = false;
    (async () => {
      try {
        await refreshPasskeyState();
        if (cancelled) return;
        const hasExistingPasskey = passkeyList.length > 0;
        const dismissed = localStorage.getItem(`runner:passkey-onboarding-dismissed:${user.id}`) === '1';
        const skippedThisSession = sessionStorage.getItem('runner:passkey-onboarding-skipped') === '1';
        setShowPasskeyOnboarding(!hasExistingPasskey && !dismissed && !skippedThisSession);
      } catch {
        if (!cancelled) setShowPasskeyOnboarding(false);
      }
    })();

    return () => { cancelled = true; };
  }, [authLoading, user, hasPasskeySupport, refreshPasskeyState, passkeyList]);

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

    // Check if we expect local keys to load (saved signer is local/eoa type)
    // If so, wait until localKeys are populated
    try {
      const saved = localStorage.getItem('flow-selected-signer');
      if (saved) {
        const parsed = JSON.parse(saved);
        if ((parsed.type === 'local' || parsed.type === 'eoa') && localKeys.length === 0) return;
      }
    } catch {}

    // If keys exist but no accounts discovered yet, wait (skip for eoa — doesn't need chain accounts)
    try {
      const saved = localStorage.getItem('flow-selected-signer');
      const parsedType = saved ? JSON.parse(saved).type : null;
      if (parsedType !== 'eoa') {
        const hasLocalAccounts = localKeys.some(k => (accountsMap[k.id] || []).length > 0);
        if (localKeys.length > 0 && !hasLocalAccounts) return;
      }
    } catch {}

    hasRestoredSigner.current = true;
    const saved = localStorage.getItem('flow-selected-signer');
    try {
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.type === 'eoa') {
          const key = localKeys.find(k => k.id === parsed.keyId);
          if (key && key.evmAddress) {
            setSelectedSigner({ type: 'eoa', key, evmAddress: key.evmAddress });
            return;
          }
        } else if (parsed.type === 'local') {
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
        } else if (parsed.type === 'passkey' && parsed.credentialId && parsed.flowAddress) {
          setSelectedSigner({
            type: 'passkey',
            credentialId: parsed.credentialId,
            flowAddress: parsed.flowAddress,
            publicKeySec1Hex: parsed.publicKeySec1Hex || '',
          });
          return;
        }
      }
    } catch {}
    // Auto-select first local account only if no prior preference was saved
    // (i.e. first-time user). If saved was explicitly cleared (disconnect), stay as 'none'.
    if (!saved) {
      // Try auto-selecting first local Cadence account
      for (const key of localKeys) {
        const accounts = accountsMap[key.id];
        if (accounts && accounts.length > 0) {
          setSelectedSigner({ type: 'local', key, account: accounts[0] });
          return;
        }
      }
      // Fallback: auto-select first EOA if no Cadence accounts
      for (const key of localKeys) {
        if (key.evmAddress) {
          setSelectedSigner({ type: 'eoa', key, evmAddress: key.evmAddress });
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
  }>(() => {
    const params = new URLSearchParams(window.location.search);
    // Don't restore if URL has explicit params
    if (params.get('project') || params.get('tx') || params.get('code') || params.get('local')) {
      return { name: 'Untitled' };
    }
    // Restore from localStorage so refresh reconnects to the same project
    const saved = loadCloudMeta();
    if (saved?.slug) {
      // Put slug back in URL so the existing ?project= load effect picks it up
      const url = new URL(window.location.href);
      url.searchParams.set('project', saved.slug);
      window.history.replaceState({}, '', url.toString());
    }
    return saved || { name: 'Untitled' };
  });
  const autoCreatingRef = useRef(false);
  const [viewingShared, setViewingShared] = useState<string | null>(null);

  // Local project identity for anonymous users
  const [localMeta, setLocalMeta] = useState<{ id: string; name: string } | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const localId = params.get('local');
    if (localId) {
      const projects = listLocalProjects();
      const found = projects.find(p => p.id === localId);
      return { id: localId, name: found?.name || 'Untitled' };
    }
    return null;
  });
  const [localProjects, setLocalProjects] = useState<LocalProjectMeta[]>(() => listLocalProjects());
  const [showShareModal, setShowShareModal] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showProjectManager, setShowProjectManager] = useState(false);

  // GitHub integration state
  const [ghInstallationId, setGhInstallationId] = useState<number | undefined>(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('github_installation_id');
    if (id) {
      localStorage.setItem('github_installation_id', id);
      // Clean the URL param so refresh doesn't re-trigger
      const url = new URL(window.location.href);
      url.searchParams.delete('github_installation_id');
      window.history.replaceState({}, '', url.toString());
      return Number(id);
    }
    return undefined;
  });
  const [showGitHubConnect, setShowGitHubConnect] = useState(false);
  const [gitPushing, setGitPushing] = useState(false);
  const [lastPulledFiles, setLastPulledFiles] = useState<Map<string, string>>(new Map());
  const [hasPulled, setHasPulled] = useState(false);

  const github = useGitHub(cloudMeta.id);
  useDeployEvents(cloudMeta.id, () => {
    github.fetchDeployments();
    github.fetchRuns();
  });

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

  // Persist project to localStorage (debounced) + local project store for anonymous
  useEffect(() => {
    const timer = setTimeout(() => {
      saveProject(project); // always save to runner:project as fallback
      localStorage.setItem('runner:network', network);
      // Also save to local project store for anonymous users
      if (!user && !viewingShared) {
        if (localMeta) {
          saveLocalProject(localMeta.id, project, localMeta.name);
        } else {
          const id = generateLocalId();
          setLocalMeta({ id, name: 'Untitled' });
          saveLocalProject(id, project, 'Untitled');
        }
        setLocalProjects(listLocalProjects());
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [project, network, user, localMeta, viewingShared]);

  // Sync project identity to URL (so refresh reconnects to same project)
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('tx') || url.searchParams.has('code')) return;
    url.searchParams.delete('project');
    url.searchParams.delete('local');
    if (cloudMeta.slug) {
      url.searchParams.set('project', cloudMeta.slug);
    } else if (localMeta?.id) {
      url.searchParams.set('local', localMeta.id);
    }
    window.history.replaceState({}, '', url.toString());
  }, [cloudMeta.slug, localMeta?.id]);

  // Persist cloudMeta to localStorage (so refresh without URL still works)
  useEffect(() => {
    if (cloudMeta.id) {
      saveCloudMeta(cloudMeta);
    } else {
      clearCloudMeta();
    }
  }, [cloudMeta]);

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

  // Solidity LSP — only activated when .sol files exist
  const hasSolFiles = project.files.some(f => f.path.endsWith('.sol'));
  const {
    notifyChange: notifySolChange,
    goToDefinition: goToSolDefinition,
    isReady: solLspReady,
  } = useSolidityLsp(monacoInstance, project, hasSolFiles);

  // Solidity npm import resolver — pre-fetches dependencies while editing
  const solSources = useMemo(() => {
    if (!hasSolFiles) return {};
    const s: Record<string, string> = {};
    for (const f of project.files) {
      if (f.path.endsWith('.sol')) s[f.path] = f.content;
    }
    return s;
  }, [hasSolFiles, project.files]);
  const { loading: solImportsLoading, resolved: solResolvedDeps } = useSolImports(solSources, hasSolFiles);

  // File language detection
  const isSolidityFile = project.activeFile.endsWith('.sol');
  const activeFileLanguage = isSolidityFile ? 'sol' as const : 'cadence' as const;

  // EVM wallet state (wagmi)
  const { address: evmAddress, isConnected: evmConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChain } = useSwitchChain();
  const [deployedContract, setDeployedContract] = useState<DeployedContract | null>(null);

  // Active EVM chain based on network selection
  const evmChain = network === 'mainnet' ? flowEvmMainnet : flowEvmTestnet;

  // Auto-switch EVM chain when Flow network changes
  useEffect(() => {
    if (!evmConnected) return;
    const targetChainId = network === 'mainnet' ? flowEvmMainnet.id : flowEvmTestnet.id;
    switchChain({ chainId: targetChainId });
  }, [network, evmConnected, switchChain]);

  const scriptParams = useMemo(() => parseMainParams(activeCode), [activeCode]);
  const validateCurrentParams = useCallback(() => {
    const errors = validateCadenceParams(scriptParams, paramValues);
    if (errors.length === 0) {
      setArgErrors([]);
      return true;
    }

    setArgErrors(errors.map(({ index, message }) => ({ index, message })));
    setResults([{
      type: 'error',
      data: `Invalid parameter input:\n${errors.map((err) => `- ${err.name}: ${err.message}`).join('\n')}`,
    }]);
    return false;
  }, [scriptParams, paramValues]);
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
    // Route LSP notifications by file type
    if (project.activeFile.endsWith('.sol')) {
      notifySolChange(project.activeFile, value);
    } else {
      notifyChange(project.activeFile, value);
    }
  }, [project.activeFile, notifyChange, notifySolChange]);

  /** Execute the transaction/script directly (no simulation gate). */
  const handleRunDirect = useCallback(async () => {
    if (!validateCurrentParams()) return;

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
    } else if (network === 'emulator' && codeType !== 'script') {
      // Emulator: always use service account
      const emulatorSignFn = async (message: string) => {
        const { signMessage } = await import('./auth/localKeyManager');
        return signMessage(EMULATOR_SERVICE_KEY, message, 'ECDSA_P256', 'SHA3_256');
      };
      if (codeType === 'contract') {
        await deployContract(activeCode, EMULATOR_SERVICE_ADDRESS, 0, emulatorSignFn, onResult, 'ECDSA_P256', 'SHA3_256');
      } else {
        await executeCustodialTransaction(activeCode, paramValues, EMULATOR_SERVICE_ADDRESS, 0, emulatorSignFn, onResult, 'ECDSA_P256', 'SHA3_256');
      }
      setLoading(false);
      return;
    } else if (codeType === 'contract') {
      // Deploy contract — requires a signer
      if (selectedSigner.type === 'local') {
        const { key, account } = selectedSigner;
        await deployContract(activeCode, account.flowAddress, account.keyIndex, buildLocalSignFn(key, account), onResult, account.sigAlgo, account.hashAlgo);
      } else if (selectedSigner.type === 'passkey') {
        const passkeySignFn = async (message: string) => await passkeySign(message);
        await deployContract(activeCode, selectedSigner.flowAddress, 0, passkeySignFn, onResult, 'ECDSA_P256', 'SHA2_256');
      } else {
        setResults([{ type: 'error', data: 'Deploy requires a local key signer. Please select one.' }]);
      }
    } else if (selectedSigner.type === 'fcl' || selectedSigner.type === 'none') {
      await executeTransaction(activeCode, paramValues, onResult);
    } else if (selectedSigner.type === 'local') {
      const { key, account } = selectedSigner;
      await executeCustodialTransaction(activeCode, paramValues, account.flowAddress, account.keyIndex, buildLocalSignFn(key, account), onResult, account.sigAlgo, account.hashAlgo);
    } else if (selectedSigner.type === 'passkey') {
      const passkeySignFn = async (message: string) => {
        return await passkeySign(message);
      };
      if (codeType === 'contract') {
        await deployContract(activeCode, selectedSigner.flowAddress, 0, passkeySignFn, onResult, 'ECDSA_P256', 'SHA2_256');
      } else {
        await executeCustodialTransaction(activeCode, paramValues, selectedSigner.flowAddress, 0, passkeySignFn, onResult, 'ECDSA_P256', 'SHA2_256');
      }
    }

    setLoading(false);
  }, [activeCode, codeType, paramValues, selectedSigner, signWithLocalKey, promptForPassword, passkeySign, network, validateCurrentParams]);

  /** Compile Solidity source and display results. */
  const handleRunSolidity = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setResults([]);
    setDeployedContract(null);

    try {
      // Auto-detect solc version from pragma (for display only; bundled compiler handles 0.8.x)
      const pragmaVersion = detectPragmaVersion(activeCode);

      // Collect all .sol files + pre-resolved npm deps for compilation
      const allSolSources: Record<string, string> = {};
      for (const f of project.files) {
        if (f.path.endsWith('.sol')) allSolSources[f.path] = f.content;
      }
      // Merge pre-fetched npm dependencies (won't re-download in worker)
      for (const [path, content] of Object.entries(solResolvedDeps)) {
        if (!allSolSources[path]) allSolSources[path] = content;
      }
      let compilation;
      if (Object.keys(allSolSources).length > 1) {
        compilation = await compileSolidityMultiFile(project.activeFile, allSolSources);
      } else {
        compilation = await compileSolidity(activeCode, project.activeFile);
      }

      if (!compilation.success) {
        setResults([{
          type: 'error',
          data: compilation.errors.join('\n'),
        }]);
        return;
      }

      if (compilation.warnings.length > 0) {
        console.warn('[Solidity]', compilation.warnings.join('\n'));
      }

      // Prefer contract from the active file, fallback to first
      const contract = compilation.contracts.find(c => c.sourceFile === project.activeFile) || compilation.contracts[0];
      if (!contract) {
        setResults([{ type: 'error', data: 'No contracts found in source' }]);
        return;
      }

      const compileResult: ExecutionResult = {
        type: 'script_result',
        data: JSON.stringify({
          compiled: true,
          contractName: contract.name,
          abi: contract.abi,
          bytecodeSize: Math.floor(contract.bytecode.length / 2) + ' bytes',
          ...(pragmaVersion ? { solcVersion: pragmaVersion } : {}),
          ...(compilation.contracts.length > 1 ? { totalContracts: compilation.contracts.length } : {}),
        }, null, 2),
      };

      // Deploy if wallet connected (external wagmi or local EOA)
      let deployClient = walletClient as import('viem').WalletClient | undefined;
      if (!deployClient && selectedSigner.type === 'eoa') {
        try {
          const { createWalletClient, http } = await import('viem');
          const { privateKeyToAccount } = await import('viem/accounts');
          const privHex = await getPrivateKey(selectedSigner.key.id, undefined, 'ECDSA_secp256k1');
          const account = privateKeyToAccount(`0x${privHex}` as `0x${string}`);
          deployClient = createWalletClient({ account, chain: evmChain, transport: http() });
        } catch (err: any) {
          setResults([compileResult, { type: 'error', data: `Failed to create EOA wallet: ${err.message}` }]);
          return;
        }
      }

      if (deployClient) {
        setResults([compileResult, { type: 'log', data: 'Deploying to Flow EVM...' }]);
        try {
          const result = await deploySolidity(deployClient, contract.abi, contract.bytecode, contract.name);
          const chainId = deployClient.chain?.id ?? evmChain.id;
          setDeployedContract({
            address: result.contractAddress,
            name: result.contractName,
            abi: contract.abi,
            deployTxHash: result.transactionHash,
            chainId,
          });
          setResults([compileResult, {
            type: 'tx_sealed',
            data: JSON.stringify({
              deployed: true,
              contractName: result.contractName,
              contractAddress: result.contractAddress,
              transactionHash: result.transactionHash,
            }, null, 2),
            txId: result.transactionHash,
          }]);
        } catch (deployErr: any) {
          setResults([compileResult, { type: 'error', data: `Deploy failed: ${deployErr.message}` }]);
        }
      } else {
        setResults([compileResult]);
      }
    } catch (err: any) {
      setResults([{ type: 'error', data: err.message }]);
    } finally {
      setLoading(false);
    }
  }, [activeCode, loading, project.activeFile, project.files, evmConnected, walletClient, evmChain, selectedSigner, getPrivateKey, solResolvedDeps]);

  const handleRun = useCallback(async () => {
    if (loading) return;

    // Solidity files: compile instead of running Cadence
    if (isSolidityFile) {
      handleRunSolidity();
      return;
    }

    if (!validateCurrentParams()) return;

    // If no signer and this requires signing, open connect modal (skip for emulator)
    if (selectedSigner.type === 'none' && codeType !== 'script' && network !== 'emulator') {
      pendingRunRef.current = true;
      setConnectModalOpen(true);
      return;
    }

    // For transactions/contracts (non-script, non-emulator): show unified preview dialog
    if (!autoSign && codeType !== 'script' && network !== 'emulator') {
      // Determine if simulation should run
      const shouldSimulate = codeType === 'transaction' && simulateBeforeSend && network === 'mainnet';
      let signerAddr = '';
      if (selectedSigner.type === 'local') signerAddr = selectedSigner.account.flowAddress;
      else if (selectedSigner.type === 'passkey') signerAddr = selectedSigner.flowAddress;

      // Open the preview dialog
      setSimResult(null);
      setSimLoading(false);
      setTxPreviewSimEnabled(shouldSimulate && !!signerAddr);
      setTxPreviewOpen(true);

      // Store execution callback
      setPendingExecution(() => () => {
        setTxPreviewOpen(false);
        setSimResult(null);
        setSimLoading(false);
        setPendingExecution(null);
        handleRunDirect();
      });

      // Start simulation if enabled
      if (shouldSimulate && signerAddr) {
        setSimLoading(true);
        try {
          const simResp = await simulateTransaction({
            cadence: activeCode,
            arguments: scriptParams.map((p) =>
              toCadenceJsonCdc(paramValues[p.name] || '', p.type),
            ),
            authorizers: [signerAddr],
            payer: signerAddr,
          });
          setSimLoading(false);
          setSimResult(simResp);
        } catch (err) {
          // Simulation service unreachable — still show dialog without sim results
          console.warn('Simulation service unavailable:', err);
          setSimLoading(false);
          setTxPreviewSimEnabled(false);
        }
      }

      return; // Wait for user to confirm or cancel via TransactionPreview
    }

    handleRunDirect();
  }, [activeCode, codeType, paramValues, loading, selectedSigner, autoSign, network, simulateBeforeSend, handleRunDirect, scriptParams, validateCurrentParams, isSolidityFile, handleRunSolidity]);

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

  const handleLoadTemplate = useCallback(async (template: Template) => {
    const templateState = {
      files: template.files,
      activeFile: template.activeFile,
      openFiles: [template.activeFile],
      folders: template.folders || [],
    };
    setProject(templateState);
    // Immediately create a named project to avoid duplicate "Untitled" entries
    if (user) {
      try {
        autoCreatingRef.current = true;
        const result = await cloudSave(templateState, { name: template.label, network });
        setCloudMeta({ id: result.id, name: template.label, slug: result.slug });
        await fetchProjects();
      } catch { /* ignore */ } finally {
        autoCreatingRef.current = false;
      }
    } else {
      const id = generateLocalId();
      setLocalMeta({ id, name: template.label });
      saveLocalProject(id, templateState, template.label);
      setLocalProjects(listLocalProjects());
    }
  }, [user, cloudSave, network, fetchProjects]);

  const handleImportFromAddress = useCallback(async (
    files: { path: string; content: string }[],
    projectName: string,
  ) => {
    const importedState: ProjectState = {
      files: files.map((f) => ({ path: f.path, content: f.content })),
      activeFile: files[0]?.path || '',
      openFiles: [files[0]?.path || ''],
      folders: ['contracts'],
    };
    setProject(importedState);
    if (user) {
      try {
        autoCreatingRef.current = true;
        const result = await cloudSave(importedState, { name: projectName, network });
        setCloudMeta({ id: result.id, name: projectName, slug: result.slug });
        await fetchProjects();
      } catch { /* ignore */ } finally {
        autoCreatingRef.current = false;
      }
    } else {
      const id = generateLocalId();
      setLocalMeta({ id, name: projectName });
      saveLocalProject(id, importedState, projectName);
      setLocalProjects(listLocalProjects());
    }
  }, [user, cloudSave, network, fetchProjects]);

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

  const handleRenameFile = useCallback((oldPath: string, newPath: string) => {
    setProject((prev) => renameFile(prev, oldPath, newPath));
  }, []);

  const handleMoveFile = useCallback((filePath: string, targetFolder: string) => {
    setProject((prev) => moveFile(prev, filePath, targetFolder));
  }, []);

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

  const handleImportLocalFiles = useCallback((fileList: FileList) => {
    const allowedExts = ['.cdc', '.sol', '.json', '.txt', '.toml', '.md', '.js', '.ts'];
    const files = Array.from(fileList).filter((f) => {
      // Skip hidden files/dirs and node_modules
      const relPath = f.webkitRelativePath || f.name;
      if (relPath.split('/').some((seg) => seg.startsWith('.') || seg === 'node_modules')) return false;
      return allowedExts.some((ext) => f.name.endsWith(ext));
    });
    const readPromises = files.map((file) => {
      // For folder imports, strip the top-level folder name from path
      let path = file.webkitRelativePath || file.name;
      if (path.includes('/')) {
        // Remove top-level dir (e.g., "myproject/contracts/Foo.cdc" → "contracts/Foo.cdc")
        path = path.split('/').slice(1).join('/');
      }
      return file.text().then((content) => ({ path, content }));
    });
    Promise.all(readPromises).then((imported) => {
      if (imported.length === 0) return;
      // Collect folder paths for the project state
      const folderSet = new Set<string>();
      for (const f of imported) {
        const parts = f.path.split('/');
        for (let i = 1; i < parts.length; i++) {
          folderSet.add(parts.slice(0, i).join('/'));
        }
      }
      setProject((prev) => {
        let updated = prev;
        for (const f of imported) {
          const existing = updated.files.find((e) => e.path === f.path);
          if (existing) {
            updated = updateFileContent(updated, f.path, f.content);
          } else {
            updated = createFile(updated, f.path);
            updated = updateFileContent(updated, f.path, f.content);
          }
        }
        return {
          ...updated,
          activeFile: imported[0].path,
          openFiles: [...new Set([...updated.openFiles, ...imported.map((f) => f.path)])],
          folders: [...new Set([...updated.folders, ...folderSet])],
        };
      });
    });
  }, []);

  // Auto-open GitHub connect modal when returning from GitHub app install
  useEffect(() => {
    if (ghInstallationId && !github.connection && !github.loading) {
      setShowGitHubConnect(true);
    }
    // Clear installation ID once connection is established
    if (github.connection && ghInstallationId) {
      localStorage.removeItem('github_installation_id');
      setGhInstallationId(undefined);
    }
  }, [ghInstallationId, github.connection, github.loading]);

  // Auto-pull files when connection exists on page load
  useEffect(() => {
    if (github.connection && !hasPulled) {
      github.pullFiles().then(files => {
        const pulled = new Map<string, string>();
        files.forEach(f => pulled.set(f.path, f.content));
        setLastPulledFiles(pulled);
        setHasPulled(true);
      }).catch(() => {
        // If pull fails (e.g. empty repo), still mark as pulled
        setHasPulled(true);
      });
    }
  }, [github.connection, hasPulled]);

  // Compute changed files for the Git commit panel
  const gitChangedFiles = useMemo(() => {
    if (!github.connection || !hasPulled) return [];
    const changes: { path: string; status: 'modified' | 'new' | 'deleted' }[] = [];
    const userFiles = getUserFiles(project);

    for (const file of userFiles) {
      const pulled = lastPulledFiles.get(file.path);
      if (pulled === undefined) {
        changes.push({ path: file.path, status: 'new' });
      } else if (pulled !== file.content) {
        changes.push({ path: file.path, status: 'modified' });
      }
    }

    for (const [path] of lastPulledFiles) {
      if (!userFiles.some(f => f.path === path)) {
        changes.push({ path, status: 'deleted' });
      }
    }

    return changes;
  }, [project, lastPulledFiles, hasPulled, github.connection]);

  // Handle GitHub connect: link repo and pull files
  const handleGitHubConnect = async (installationId: number, owner: string, repo: string, path: string, branch: string) => {
    const conn = await github.connect(installationId, owner, repo, path, branch);
    // Persist installation ID for future sessions
    localStorage.setItem('github_installation_id', String(installationId));
    const files = await github.pullFiles(conn);
    const pulled = new Map<string, string>();
    const newProjectFiles = files.map(f => {
      pulled.set(f.path, f.content);
      return { path: f.path, content: f.content };
    });
    if (newProjectFiles.length > 0) {
      setProject({
        files: newProjectFiles,
        activeFile: newProjectFiles[0].path,
        openFiles: [newProjectFiles[0].path],
        folders: [],
      });
    }
    setLastPulledFiles(pulled);
    setHasPulled(true);
    setShowGitHubConnect(false);
    setGhInstallationId(installationId);
    // Clean URL params
    const url = new URL(window.location.href);
    url.searchParams.delete('github_installation_id');
    url.searchParams.delete('setup_action');
    window.history.replaceState({}, '', url.toString());
  };

  // Handle commit & push to GitHub
  const handleGitCommit = async (message: string) => {
    setGitPushing(true);
    try {
      const files = gitChangedFiles.map(change => {
        if (change.status === 'deleted') {
          return { path: change.path, content: '', action: 'delete' as const };
        }
        const content = getFileContent(project, change.path) || '';
        return { path: change.path, content, action: change.status === 'new' ? 'create' as const : 'update' as const };
      });
      await github.commitAndPush(message, files);
      // Update lastPulledFiles to match current state
      const newPulled = new Map(lastPulledFiles);
      for (const change of gitChangedFiles) {
        if (change.status === 'deleted') {
          newPulled.delete(change.path);
        } else {
          newPulled.set(change.path, getFileContent(project, change.path) || '');
        }
      }
      setLastPulledFiles(newPulled);
    } finally {
      setGitPushing(false);
    }
  };

  const handleGitDiffFile = useCallback(async (path: string) => {
    if (!github.connection) return;
    setGitDiffFile(path);
    const localContent = getFileContent(project, path) || '';

    try {
      const { installation_id, repo_owner, repo_name, repo_path, branch } = github.connection;
      const prefix = (!repo_path || repo_path === '/') ? '' : repo_path;
      const fullPath = prefix ? `${prefix}/${path}` : path;
      const { content: remoteContent } = await githubApi.getFile(
        installation_id, repo_owner, repo_name, fullPath, branch,
      );
      setPendingDiffs(prev => ({
        ...prev,
        [path]: { original: remoteContent, modified: localContent },
      }));
      setProject(prev => openFile(prev, path));
    } catch {
      setPendingDiffs(prev => ({
        ...prev,
        [path]: { original: '', modified: localContent },
      }));
      setProject(prev => openFile(prev, path));
    }
  }, [github.connection, project]);

  const hasBottomPanel = scriptParams.length > 0 || results.length > 0 || loading;

  return (
    <div className="flex flex-col h-full bg-zinc-900 text-zinc-100 relative">
      {/* Transaction confirm + simulation preview overlay */}
      {txPreviewOpen && (
        <TransactionPreview
          codeType={codeType as 'transaction' | 'contract'}
          simLoading={simLoading}
          simResult={simResult}
          simulateEnabled={txPreviewSimEnabled}
          onConfirm={() => {
            if (pendingExecution) pendingExecution();
          }}
          onCancel={() => {
            setTxPreviewOpen(false);
            setSimResult(null);
            setSimLoading(false);
            setPendingExecution(null);
          }}
        />
      )}
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
          <h1 className="text-sm font-semibold tracking-tight">{isMobile ? 'Runner' : 'Flow Runner'}</h1>
          <nav className="flex items-center gap-1 ml-3">
            {/* File menu */}
            <div ref={fileMenuRef} className="relative">
              <button
                onClick={() => setShowFileMenu(!showFileMenu)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  showFileMenu ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                File
              </button>
              {showFileMenu && (
                <div className="absolute left-0 top-full mt-1 w-52 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 py-1">
                  <button
                    onClick={() => {
                      setShowFileMenu(false);
                      const defaultFiles = [{ path: 'main.cdc', content: DEFAULT_CODE }];
                      const defaultState = { files: defaultFiles, activeFile: 'main.cdc', openFiles: ['main.cdc'], folders: [] as string[] };
                      if (user) {
                        cloudSave(defaultState, { name: 'Untitled', network }).then(async (result) => {
                          setProject(defaultState);
                          setCloudMeta({ id: result.id, name: 'Untitled', slug: result.slug });
                          await fetchProjects();
                        });
                      } else {
                        const id = generateLocalId();
                        setProject(defaultState);
                        setLocalMeta({ id, name: 'Untitled' });
                        saveLocalProject(id, defaultState, 'Untitled');
                        setLocalProjects(listLocalProjects());
                      }
                    }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5 text-zinc-500" />
                    New Project
                  </button>
                  <button
                    onClick={() => { setShowFileMenu(false); setShowProjectManager(true); }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-zinc-500" />
                    Projects...
                  </button>
                  <div className="border-t border-zinc-700 my-1" />
                  <button
                    onClick={() => { setShowFileMenu(false); document.getElementById('file-import-input')?.click(); }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
                  >
                    <FilePlus className="w-3.5 h-3.5 text-zinc-500" />
                    Open File...
                  </button>
                  <button
                    onClick={() => { setShowFileMenu(false); document.getElementById('folder-import-input')?.click(); }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
                  >
                    <FilePlus className="w-3.5 h-3.5 text-zinc-500" />
                    Open Folder...
                  </button>
                  <button
                    onClick={() => { setShowFileMenu(false); setShowImportDialog(true); }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
                  >
                    <Import className="w-3.5 h-3.5 text-zinc-500" />
                    Import from Address
                  </button>
                  <div className="border-t border-zinc-700 my-1" />
                  <button
                    onClick={() => { setShowFileMenu(false); handleExportZip(); }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5 text-zinc-500" />
                    Export as ZIP
                  </button>
                  <button
                    onClick={() => { setShowFileMenu(false); setShowShareModal(true); }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
                  >
                    <Share2 className="w-3.5 h-3.5 text-zinc-500" />
                    Share
                  </button>
                </div>
              )}
            </div>
          </nav>

          {/* LSP status indicator */}
          <div className="relative group/lsp">
            <button
              onClick={() => {
                if (lspError) { setShowExplorer(true); setSidebarTab('settings'); }
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
            {/* Tooltip below on hover */}
            {!lspError && activeMode && (
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 bg-zinc-800 border border-zinc-600 rounded text-[10px] text-zinc-300 whitespace-nowrap opacity-0 pointer-events-none group-hover/lsp:opacity-100 transition-opacity z-50">
                LSP: {activeMode}{lspMode === 'auto' ? ' (auto)' : ''}
              </div>
            )}
          </div>
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
              <button
                onClick={openLogin}
                className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs px-2 py-1 rounded border border-zinc-700 transition-colors"
                title="Log in to share"
              >
                <Share2 className="w-3 h-3" />
                <span>Share</span>
              </button>
            )
          )}
          {/* Network selector */}
          <div ref={networkMenuRef} className="relative">
            <button
              onClick={() => setShowNetworkMenu(!showNetworkMenu)}
              className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs px-2 py-1 rounded border border-zinc-700 transition-colors"
            >
              <Globe className="w-3 h-3 text-zinc-400" />
              {network === 'emulator' && (
                <span className={`w-1.5 h-1.5 rounded-full ${emulatorStatus === 'connected' ? 'bg-emerald-400' : emulatorStatus === 'disconnected' ? 'bg-red-400' : 'bg-yellow-400'}`} />
              )}
              <span>{network === 'emulator' ? 'Emulator' : network === 'testnet' ? 'Testnet' : 'Mainnet'}</span>
              <ChevronDown className="w-3 h-3 text-zinc-400" />
            </button>
            {showNetworkMenu && (
              <div className="absolute top-full right-0 mt-1 w-32 bg-zinc-800 border border-zinc-700 rounded shadow-xl z-50 py-1">
                {(['mainnet', 'testnet', 'emulator'] as const).map((n) => (
                  <button
                    key={n}
                    onClick={() => { setNetwork(n); setShowNetworkMenu(false); }}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-1.5 ${
                      network === n
                        ? 'text-emerald-400 bg-emerald-600/10'
                        : 'text-zinc-300 hover:bg-zinc-700'
                    }`}
                  >
                    {n === 'emulator' && <Terminal className="w-3 h-3" />}
                    {n === 'emulator' ? 'Emulator' : n === 'testnet' ? 'Testnet' : 'Mainnet'}
                  </button>
                ))}
              </div>
            )}
          </div>


          {/* Signer selector — always shown */}
          <SignerSelector
            selected={selectedSigner}
            onSelect={persistSigner}
            localKeys={localKeys}
            accountsMap={accountsMap}
            passkeyAccounts={passkeyAccounts}
            onViewAccount={handleViewAccount}
            onOpenKeyManager={() => setShowKeyManager(true)}
            onOpenConnectModal={() => setConnectModalOpen(true)}
            autoSign={autoSign}
            onToggleAutoSign={handleToggleAutoSign}
            simulateBeforeSend={simulateBeforeSend}
            onToggleSimulate={handleToggleSimulate}
            network={network}
          />

          {/* Desktop run button */}
          {!isMobile && (
            <button
              onClick={handleRun}
              disabled={loading || activeFileEntry?.readOnly}
              className={`flex items-center gap-1.5 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors ${
                isSolidityFile
                  ? 'bg-violet-600 hover:bg-violet-500 disabled:bg-violet-800 disabled:text-violet-400'
                  : 'bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:text-emerald-500'
              }`}
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              {isSolidityFile
                ? (evmConnected || selectedSigner.type === 'eoa' ? 'Compile & Deploy' : 'Compile')
                : codeType === 'script' ? 'Run Script' : codeType === 'contract' ? 'Deploy' : 'Send Transaction'}
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
            <button
              onClick={openLogin}
              className="px-2 py-0.5 bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium transition-colors"
            >
              Sign in to fork
            </button>
          )}
        </div>
      )}

      {/* Main layout */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar (hidden on mobile) */}
        {showExplorer && !isMobile && (
          <>
            <ActivityBar
              activeTab={sidebarTab}
              onTabChange={(tab) => {
                if (tab === 'deploy') { window.location.href = '/deploy'; return; }
                if (tab === 'interact') { window.location.href = '/interact'; return; }
                setSidebarTab(tab);
              }}
              hasGitHub={!!github.connection}
              gitChangesCount={gitChangedFiles.length}
            />
            <div className="shrink-0 overflow-hidden bg-zinc-900 flex flex-col" style={{ width: explorer.width }}>
              {/* Files tab */}
              {sidebarTab === 'files' && (
                <>
                  <button
                    onClick={() => setShowProjectManager(true)}
                    className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors border-b border-zinc-700 shrink-0"
                  >
                    <FolderOpen className="w-3 h-3 text-zinc-500" />
                    <span className="truncate flex-1 text-left font-medium">
                      {user ? (cloudMeta.name || 'Untitled') : (localMeta?.name || 'Untitled')}
                    </span>
                    {projectSaving && <span className="text-[9px] text-amber-400">Saving...</span>}
                    {!projectSaving && lastSaved && <span className="text-[9px] text-zinc-600">Saved</span>}
                  </button>
                  <div className="flex-1 overflow-y-auto">
                    <FileExplorer
                      project={project}
                      onOpenFile={handleOpenFile}
                      onCreateFile={handleCreateFile}
                      onCreateFolder={handleCreateFolder}
                      onDeleteFile={handleDeleteFile}
                      onRenameFile={handleRenameFile}
                      onMoveFile={handleMoveFile}
                      activeFile={project.activeFile}
                    />
                  </div>
                  {!authLoading && (
                    <div className="shrink-0 border-t border-zinc-700">
                      {user ? (
                        <div className="flex items-center justify-between px-3 py-2">
                          <span className="text-[10px] text-zinc-500 truncate">{user.email}</span>
                          <button
                            onClick={() => signOut()}
                            className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                          >
                            Sign out
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={openLogin}
                          className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 text-[11px] transition-colors px-3 py-2 w-full text-left"
                        >
                          <LogIn className="w-3 h-3" />
                          <span>Sign in</span>
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Search tab */}
              {sidebarTab === 'search' && (
                <SearchPanel
                  files={project.files}
                  onOpenFileAtLine={(path, line, column) => {
                    setProject((prev) => openFile(prev, path));
                    // Defer cursor jump until editor loads the file
                    setTimeout(() => {
                      editorRef.current?.setPosition({ lineNumber: line, column });
                      editorRef.current?.revealPositionInCenter({ lineNumber: line, column });
                      editorRef.current?.focus();
                    }, 50);
                  }}
                  onReplaceInFile={(path, search, replace, line) => {
                    setProject((prev) => {
                      const file = prev.files.find((f) => f.path === path);
                      if (!file) return prev;
                      const lines = file.content.split('\n');
                      if (line >= 1 && line <= lines.length) {
                        lines[line - 1] = lines[line - 1].replace(search, replace);
                      }
                      return updateFileContent(prev, path, lines.join('\n'));
                    });
                  }}
                  onReplaceAll={(search, replace) => {
                    setProject((prev) => {
                      let updated = prev;
                      for (const file of prev.files) {
                        if (file.readOnly) continue;
                        if (file.content.includes(search)) {
                          updated = updateFileContent(updated, file.path, file.content.replaceAll(search, replace));
                        }
                      }
                      return updated;
                    });
                  }}
                />
              )}

              {/* GitHub tab */}
              {sidebarTab === 'github' && (
                <GitHubPanel
                  connected={!!github.connection}
                  repoOwner={github.connection?.repo_owner}
                  repoName={github.connection?.repo_name}
                  branch={github.connection?.branch}
                  onConnect={() => setShowGitHubConnect(true)}
                  onLogin={openLogin}
                  isLoggedIn={!!user}
                  hasProject={!!cloudMeta.id}
                  changedFiles={gitChangedFiles}
                  onFileClick={handleGitDiffFile}
                  selectedFile={gitDiffFile ?? undefined}
                  onCommit={handleGitCommit}
                  pushing={gitPushing}
                  lastCommitSha={github.connection?.last_commit_sha}
                  commits={github.commits}
                  loadingCommits={github.loading}
                  onRefreshCommits={github.fetchCommits}
                />
              )}

              {/* Settings tab */}
              {sidebarTab === 'settings' && (
                <SettingsPanel
                  lspMode={lspMode}
                  onLspModeChange={setLspMode}
                  activeMode={activeMode}
                  onOpenKeyManager={() => setShowKeyManager(true)}
                  showKeyManager={showKeyManager}
                  autoSign={autoSign}
                  onToggleAutoSign={handleToggleAutoSign}
                  simulateBeforeSend={simulateBeforeSend}
                  onToggleSimulate={handleToggleSimulate}
                />
              )}
            </div>
            <DragBar direction="horizontal" onMouseDown={explorer.onMouseDown} />
          </>
        )}

        {/* Editor + Results (center) */}
        <div ref={editorContainerRef} className="flex flex-col flex-1 min-w-0 min-h-0">
          {/* Editor area */}
          <div className={`flex flex-col min-h-0 ${hasBottomPanel ? '' : 'flex-1'}`} style={hasBottomPanel ? { height: `${vertSplit.fraction * 100}%` } : undefined}>
            <TabBar
              project={project}
              onSelectFile={handleSelectTab}
              onCloseFile={handleCloseTab}
              pendingDiffPaths={Object.keys(pendingDiffs)}
            />
            {network === 'emulator' && emulatorStatus === 'disconnected' && (
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-900/30 border-b border-amber-700/50 text-amber-300 text-xs">
                <Terminal className="w-3.5 h-3.5 shrink-0" />
                <span>Emulator not running.</span>
                <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-amber-200 font-mono">flow emulator</code>
                <button onClick={recheckEmulator} className="ml-auto text-amber-400 hover:text-amber-200 underline">
                  Retry
                </button>
              </div>
            )}
            {(loadingDeps || solImportsLoading) && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-amber-400 shrink-0">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span className="text-[11px] font-medium">Resolving imports...</span>
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-hidden">
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
                  <ResultPanel results={results} loading={loading} network={network} code={activeCode} filename={project.activeFile} codeType={codeType} onFixWithAI={handleFixWithAI} deployedContract={deployedContract ?? undefined} chain={isSolidityFile ? evmChain : undefined} />
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
                    onImportFromAddress={() => setShowImportDialog(true)}
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
          className={`fixed bottom-5 right-5 z-40 flex items-center gap-2 text-white font-semibold pl-4 pr-5 py-3.5 rounded-full shadow-lg transition-colors ${
            isSolidityFile
              ? 'bg-purple-600 hover:bg-purple-500 active:bg-violet-700 disabled:bg-purple-800 disabled:text-purple-400 shadow-violet-900/40'
              : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:bg-emerald-800 disabled:text-emerald-500 shadow-emerald-900/40'
          }`}
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Play className="w-5 h-5" fill="currentColor" />
          )}
          <span className="text-sm">
            {isSolidityFile
              ? 'Compile'
              : codeType === 'script' ? 'Run' : codeType === 'contract' ? 'Deploy' : 'Send'}
          </span>
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
                onImportFromAddress={() => { setShowImportDialog(true); setShowMobileAI(false); }}
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

      {/* Hidden file inputs for Open File / Open Folder */}
      <input
        id="file-import-input"
        type="file"
        multiple
        accept=".cdc,.sol,.json,.txt"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleImportLocalFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        id="folder-import-input"
        type="file"
        // @ts-expect-error webkitdirectory is non-standard but widely supported
        webkitdirectory=""
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleImportLocalFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Import from Address Dialog */}
      <ImportFromAddressDialog
        open={showImportDialog}
        onClose={() => setShowImportDialog(false)}
        onImport={handleImportFromAddress}
        network={network}
      />

      <ProjectManagerModal
        open={showProjectManager}
        onClose={() => setShowProjectManager(false)}
        cloudProjects={cloudProjects}
        localProjects={localProjects}
        currentProjectId={user ? cloudMeta.id : localMeta?.id}
        isLoggedIn={!!user}
        currentNetwork={network}
        onSelectProject={async (slugOrId, isLocal) => {
          if (isLocal) {
            const loaded = loadLocalProject(slugOrId);
            if (!loaded) return;
            const meta = localProjects.find(p => p.id === slugOrId);
            setProject(loaded);
            setLocalMeta({ id: slugOrId, name: meta?.name || 'Untitled' });
          } else {
            const full = await getProject(slugOrId);
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
          }
        }}
        onNewProject={async () => {
          const defaultFiles = [{ path: 'main.cdc', content: DEFAULT_CODE }];
          const defaultState = { files: defaultFiles, activeFile: 'main.cdc', openFiles: ['main.cdc'], folders: [] as string[] };
          if (user) {
            const result = await cloudSave(defaultState, { name: 'Untitled', network });
            setProject(defaultState);
            setCloudMeta({ id: result.id, name: 'Untitled', slug: result.slug });
            await fetchProjects();
          } else {
            const id = generateLocalId();
            setProject(defaultState);
            setLocalMeta({ id, name: 'Untitled' });
            saveLocalProject(id, defaultState, 'Untitled');
            setLocalProjects(listLocalProjects());
          }
        }}
        onRename={async (id, name, isLocal) => {
          if (isLocal) {
            renameLocalProject(id, name);
            setLocalMeta(prev => prev?.id === id ? { ...prev, name } : prev);
            setLocalProjects(listLocalProjects());
          } else {
            setCloudMeta(prev => ({ ...prev, name }));
            await cloudSave(project, { ...cloudMeta, id, name });
            await fetchProjects();
          }
        }}
        onDelete={async (id, isLocal) => {
          if (isLocal) {
            deleteLocalProject(id);
            setLocalProjects(listLocalProjects());
            if (localMeta?.id === id) {
              const remaining = listLocalProjects();
              if (remaining.length > 0) {
                const next = loadLocalProject(remaining[0].id);
                if (next) { setProject(next); setLocalMeta({ id: remaining[0].id, name: remaining[0].name }); return; }
              }
              setLocalMeta(null);
              setProject(loadProject());
            }
          } else {
            await cloudDelete(id);
            if (cloudMeta.id === id) {
              setCloudMeta({ name: 'Untitled' });
              setProject(loadProject());
            }
            await fetchProjects();
          }
        }}
      />

      {/* GitHub Connect Modal */}
      {showGitHubConnect && (
        <GitHubConnect
          installationId={ghInstallationId ?? github.connection?.installation_id}
          onConnect={handleGitHubConnect}
          onClose={() => { setShowGitHubConnect(false); }}
        />
      )}


      {/* Key Manager Panel (overlay) */}
      {showKeyManager && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => { setShowKeyManager(false); setKeyManagerInitialMode(undefined); }} />
          <div className="relative w-[480px] max-w-[90vw] max-h-[80vh] bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-y-auto">
            <Suspense
              fallback={
                <div className="p-6 text-center text-xs text-zinc-500">Loading wallet...</div>
              }
            >
              <KeyManager
                onClose={() => { setShowKeyManager(false); setKeyManagerInitialMode(undefined); }}
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
                selectedAccount={
                  selectedSigner.type === 'local' ? { keyId: selectedSigner.key.id, address: selectedSigner.account.flowAddress, keyIndex: selectedSigner.account.keyIndex }
                  : selectedSigner.type === 'eoa' ? { keyId: selectedSigner.key.id, address: selectedSigner.evmAddress, keyIndex: -1 }
                  : null
                }
                onSelectAccount={(key, account) => { persistSigner({ type: 'local', key, account }); setShowKeyManager(false); }}
                onSelectEoa={(key) => { persistSigner({ type: 'eoa', key, evmAddress: key.evmAddress! }); setShowKeyManager(false); }}
                initialMode={keyManagerInitialMode}
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

      <ConfirmDialog
        open={!!confirmDialog}
        title={confirmDialog?.title || ''}
        message={confirmDialog?.message || ''}
        confirmLabel={confirmDialog?.confirmLabel}
        variant={confirmDialog?.variant}
        onConfirm={() => { confirmDialog?.resolve(true); setConfirmDialog(null); }}
        onCancel={() => { confirmDialog?.resolve(false); setConfirmDialog(null); }}
      />
      <ConnectModal
        open={connectModalOpen}
        onClose={() => { setConnectModalOpen(false); pendingRunRef.current = false; }}
        onSelect={handleModalSelect}
        localKeys={localKeys}
        accountsMap={accountsMap}
        autoSign={autoSign}
        onToggleAutoSign={handleToggleAutoSign}
        network={network}
        onOpenKeyManager={(mode) => { setConnectModalOpen(false); setKeyManagerInitialMode(mode); setShowKeyManager(true); }}
        onGenerateKey={generateNewKey}
        onCreateAccount={createAccount}
        onRefreshAccounts={refreshAccounts}
      />
      <Suspense fallback={null}>
        <LoginModal open={showLoginModal} onClose={() => setShowLoginModal(false)} />
      </Suspense>
      <Suspense fallback={null}>
        <PasskeyOnboardingModal
          open={showPasskeyOnboarding}
          email={user?.email}
          onCreatePasskey={createPasskey}
          onProvisionAccounts={provisionAccounts}
          onPollTx={pollProvisionTx}
          onSaveAddress={saveProvisionedAddress}
          onDone={handlePasskeyOnboardingDone}
          onSkip={skipPasskeyOnboarding}
          onDontShowAgain={permanentlyDismissPasskey}
        />
      </Suspense>
    </div>
  );
}

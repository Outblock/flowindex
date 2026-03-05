import { useState, useRef, useEffect } from 'react';
import {
  X,
  Plus,
  Download,
  Upload,
  Trash2,
  Key,
  Loader2,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  FileKey,
  RefreshCw,
  ExternalLink,
  Eye,
  EyeOff,
  Settings2,
} from 'lucide-react';
import Avatar from 'boring-avatars';
import type { LocalKey, KeyAccount } from '../auth/localKeyManager';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface KeyManagerProps {
  onClose: () => void;
  network: 'mainnet' | 'testnet';
  localKeys: LocalKey[];
  accountsMap: Record<string, KeyAccount[]>;
  wasmReady: boolean;
  onGenerateKey: (
    label: string,
    wordCount?: 12 | 24,
    password?: string,
  ) => Promise<{ mnemonic: string; key: LocalKey }>;
  onImportMnemonic: (
    mnemonic: string,
    label: string,
    passphrase?: string,
    path?: string,
    password?: string,
  ) => Promise<LocalKey>;
  onImportPrivateKey: (
    hex: string,
    label: string,
    password?: string,
  ) => Promise<LocalKey>;
  onImportKeystore: (
    json: string,
    keystorePassword: string,
    label: string,
    newPassword?: string,
  ) => Promise<LocalKey>;
  onDeleteLocalKey: (id: string) => void;
  onExportKeystore: (id: string, password?: string) => Promise<string>;
  onRefreshAccounts: (
    keyId: string,
    network: 'mainnet' | 'testnet',
  ) => Promise<KeyAccount[]>;
  onCreateAccount: (
    keyId: string,
    sigAlgo: 'ECDSA_P256' | 'ECDSA_secp256k1',
    hashAlgo: 'SHA2_256' | 'SHA3_256',
    network: 'mainnet' | 'testnet',
  ) => Promise<{ txId: string }>;
  onGetPrivateKey?: (keyId: string, password?: string) => Promise<string>;
  onViewAccount?: (address: string) => void;
  selectedAccount?: { keyId: string; address: string; keyIndex: number } | null;
  onSelectAccount?: (key: LocalKey, account: KeyAccount) => void;
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const inputClass =
  'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 rounded px-2 py-1.5 text-xs placeholder:text-zinc-500 focus:outline-none focus:border-zinc-500';
const inputMonoClass = `${inputClass} font-mono`;
const btnPrimary =
  'bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-3 py-1.5 rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5';
const btnSecondary =
  'bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-xs px-3 py-1.5 rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function truncateKey(key: string): string {
  if (key.length <= 16) return key;
  return `${key.slice(0, 8)}...${key.slice(-8)}`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function flowIndexUrl(address: string, network: 'mainnet' | 'testnet'): string {
  const base = network === 'testnet' ? 'https://testnet.flowindex.io' : 'https://flowindex.io';
  const addr = address.startsWith('0x') ? address : `0x${address}`;
  return `${base}/account/${addr}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LocalSourceBadge({ source }: { source: LocalKey['source'] }) {
  const colors: Record<LocalKey['source'], string> = {
    mnemonic: 'bg-purple-500/10 text-purple-400',
    privateKey: 'bg-amber-500/10 text-amber-400',
    keystore: 'bg-cyan-500/10 text-cyan-400',
  };
  return (
    <span className={`${colors[source]} text-[10px] px-1.5 py-0.5 rounded`}>
      {source}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={handleCopy} className="text-zinc-500 hover:text-zinc-300 p-0.5" title="Copy">
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Import mode type
// ---------------------------------------------------------------------------

type ImportType = 'mnemonic' | 'privateKey' | 'keystore';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function KeyManager({
  onClose,
  network,
  localKeys,
  accountsMap,
  wasmReady,
  onGenerateKey,
  onImportMnemonic,
  onImportPrivateKey,
  onImportKeystore,
  onDeleteLocalKey,
  onExportKeystore,
  onRefreshAccounts,
  onCreateAccount,
  onGetPrivateKey,
  onViewAccount,
  selectedAccount,
  onSelectAccount,
}: KeyManagerProps) {
  const [tab, setTab] = useState<'accounts' | 'keys'>('accounts');
  const [mode, setMode] = useState<'idle' | 'create' | 'import'>('idle');
  const [importType, setImportType] = useState<ImportType>('mnemonic');
  const [importDropdownOpen, setImportDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [autoCreate, setAutoCreate] = useState(() => {
    try {
      return localStorage.getItem('flow-auto-create-account') !== 'false';
    } catch {
      return true;
    }
  });

  const toggleAutoCreate = () => {
    setAutoCreate((prev) => {
      const next = !prev;
      try { localStorage.setItem('flow-auto-create-account', String(next)); } catch {}
      return next;
    });
  };

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setImportDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Auto-refresh accounts for all keys on mount (discover addresses without manual click)
  const hasAutoRefreshed = useRef(false);
  useEffect(() => {
    if (hasAutoRefreshed.current || localKeys.length === 0) return;
    hasAutoRefreshed.current = true;
    for (const key of localKeys) {
      const existing = accountsMap[key.id];
      if (!existing || existing.length === 0) {
        onRefreshAccounts(key.id, network).catch(() => {});
      }
    }
  }, [localKeys, accountsMap, network, onRefreshAccounts]);

  /** After key creation, auto-create accounts on selected networks + auto-refresh after delay. */
  const autoCreateAccounts = async (keyId: string, sigAlgo: 'ECDSA_P256' | 'ECDSA_secp256k1', hashAlgo: 'SHA2_256' | 'SHA3_256', networks: ('mainnet' | 'testnet')[]) => {
    if (!autoCreate || networks.length === 0) return;
    await Promise.allSettled(
      networks.map(net => onCreateAccount(keyId, sigAlgo, hashAlgo, net)),
    );
    // Wait a bit for the chain to process, then refresh
    setTimeout(async () => {
      await Promise.allSettled(
        networks.map(net => onRefreshAccounts(keyId, net)),
      );
    }, 5000);
  };

  /** After import, auto-refresh accounts on both networks. */
  const autoRefreshAfterImport = async (keyId: string) => {
    await Promise.allSettled([
      onRefreshAccounts(keyId, 'testnet'),
      onRefreshAccounts(keyId, 'mainnet'),
    ]);
  };

  // Build flat account list for Accounts tab
  const allAccounts: { key: LocalKey; account: KeyAccount }[] = [];
  for (const key of localKeys) {
    for (const acc of accountsMap[key.id] || []) {
      allAccounts.push({ key, account: acc });
    }
  }

  return (
    <div className="flex flex-col h-full bg-zinc-900 border-l border-zinc-700">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-100">Wallet</span>
        </div>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 p-0.5">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-700 shrink-0">
        <button
          onClick={() => setTab('accounts')}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            tab === 'accounts'
              ? 'text-emerald-400 border-b-2 border-emerald-400'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Accounts ({allAccounts.length})
        </button>
        <button
          onClick={() => setTab('keys')}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            tab === 'keys'
              ? 'text-emerald-400 border-b-2 border-emerald-400'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Keys ({localKeys.length})
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {!wasmReady && (
          <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 rounded px-2.5 py-2 border border-amber-500/20">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Loading WASM crypto module...
          </div>
        )}

        {/* ── Accounts Tab ── */}
        {tab === 'accounts' && (
          <div className="space-y-1.5">
            {allAccounts.length === 0 ? (
              <div className="text-center py-8 space-y-2">
                <p className="text-zinc-500 text-xs">No accounts yet.</p>
                <button onClick={() => setTab('keys')} className={btnSecondary}>
                  <Plus className="w-3.5 h-3.5" />
                  Create or Import Key
                </button>
              </div>
            ) : (
              allAccounts.map(({ key, account }) => {
                const isSelected =
                  selectedAccount?.keyId === key.id &&
                  selectedAccount?.address === account.flowAddress &&
                  selectedAccount?.keyIndex === account.keyIndex;
                return (
                  <div
                    key={`${key.id}-${account.flowAddress}-${account.keyIndex}`}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-500/10 border border-emerald-500/30'
                        : 'bg-zinc-800 border border-zinc-700 hover:border-zinc-600'
                    }`}
                    onClick={() => onSelectAccount?.(key, account)}
                  >
                    <Avatar
                      size={28}
                      name={account.flowAddress}
                      variant="beam"
                      colors={['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444']}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs font-mono ${isSelected ? 'text-emerald-300' : 'text-zinc-200'}`}>
                          0x{account.flowAddress}
                        </span>
                        <CopyButton text={`0x${account.flowAddress}`} />
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-zinc-500">{key.label}</span>
                        <span className="text-[10px] text-zinc-600">key #{account.keyIndex}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isSelected && (
                        <span className="text-[10px] text-emerald-400 font-medium">Active</span>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); onViewAccount?.(account.flowAddress); }}
                        className="text-zinc-600 hover:text-zinc-300 p-1 transition-colors"
                        title="View account details"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── Keys Tab ── */}
        {tab === 'keys' && (
          <>
            {/* Action buttons: Create + Import */}
            <div className="flex gap-2">
              <button
                onClick={() => setMode(mode === 'create' ? 'idle' : 'create')}
                className={mode === 'create' ? btnPrimary : btnSecondary}
              >
                <Plus className="w-3.5 h-3.5" />
                Create
              </button>

              <div ref={dropdownRef} className="relative">
                <button
                  onClick={() => {
                    if (mode === 'import') {
                      setMode('idle');
                    } else {
                      setImportDropdownOpen(!importDropdownOpen);
                    }
                  }}
                  className={mode === 'import' ? btnPrimary : btnSecondary}
                >
                  <Download className="w-3.5 h-3.5" />
                  Import
                  <ChevronDown className="w-3 h-3" />
                </button>
                {importDropdownOpen && (
                  <div className="absolute left-0 top-full mt-1 w-40 bg-zinc-800 border border-zinc-700 rounded shadow-lg z-50">
                    {([
                      ['mnemonic', 'Mnemonic'],
                      ['privateKey', 'Private Key'],
                      ['keystore', 'Keystore'],
                    ] as [ImportType, string][]).map(([type, label]) => (
                      <button
                        key={type}
                        onClick={() => {
                          setImportType(type);
                          setMode('import');
                          setImportDropdownOpen(false);
                        }}
                        className="w-full text-left px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Create form */}
            {mode === 'create' && (
              <GenerateForm
                wasmReady={wasmReady}
                onGenerateKey={onGenerateKey}
                onAutoCreate={autoCreateAccounts}
                autoCreate={autoCreate}
                onToggleAutoCreate={toggleAutoCreate}
              />
            )}

            {/* Import forms */}
            {mode === 'import' && importType === 'mnemonic' && (
              <ImportMnemonicForm
                wasmReady={wasmReady}
                onImportMnemonic={onImportMnemonic}
                onAutoRefresh={autoRefreshAfterImport}
              />
            )}
            {mode === 'import' && importType === 'privateKey' && (
              <ImportPrivateKeyForm
                wasmReady={wasmReady}
                onImportPrivateKey={onImportPrivateKey}
                onAutoRefresh={autoRefreshAfterImport}
              />
            )}
            {mode === 'import' && importType === 'keystore' && (
              <ImportKeystoreForm
                wasmReady={wasmReady}
                onImportKeystore={onImportKeystore}
                onAutoRefresh={autoRefreshAfterImport}
              />
            )}

            {/* Divider */}
            {(mode !== 'idle' || localKeys.length > 0) && (
              <div className="border-t border-zinc-700" />
            )}

            {/* Local keys list */}
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-zinc-300">
                Stored Keys ({localKeys.length})
              </h3>
              {localKeys.length === 0 ? (
                <p className="text-zinc-500 text-xs text-center py-6">
                  No local keys yet. Create or import one above.
                </p>
              ) : (
                localKeys.map((key) => (
                  <LocalKeyCard
                    key={key.id}
                    localKey={key}
                    accounts={accountsMap[key.id] || []}
                    network={network}
                    onDelete={onDeleteLocalKey}
                    onExportKeystore={onExportKeystore}
                    onRefreshAccounts={onRefreshAccounts}
                    onCreateAccount={onCreateAccount}
                    onGetPrivateKey={onGetPrivateKey}
                    onViewAccount={onViewAccount}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generate New Key Form
// ---------------------------------------------------------------------------

function GenerateForm({
  wasmReady,
  onGenerateKey,
  onAutoCreate,
  autoCreate,
  onToggleAutoCreate,
}: {
  wasmReady: boolean;
  onGenerateKey: KeyManagerProps['onGenerateKey'];
  onAutoCreate: (keyId: string, sigAlgo: 'ECDSA_P256' | 'ECDSA_secp256k1', hashAlgo: 'SHA2_256' | 'SHA3_256', networks: ('mainnet' | 'testnet')[]) => Promise<void>;
  autoCreate: boolean;
  onToggleAutoCreate: () => void;
}) {
  const [label, setLabel] = useState('');
  const [wordCount, setWordCount] = useState<12 | 24>(12);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [sigAlgo, setSigAlgo] = useState<'ECDSA_P256' | 'ECDSA_secp256k1'>('ECDSA_secp256k1');
  const [hashAlgo, setHashAlgo] = useState<'SHA2_256' | 'SHA3_256'>('SHA2_256');
  const [createMainnet, setCreateMainnet] = useState(true);
  const [createTestnet, setCreateTestnet] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [mnemonicCopied, setMnemonicCopied] = useState(false);
  const [autoStatus, setAutoStatus] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleGenerate = async () => {
    setError('');
    setGenerating(true);
    try {
      const result = await onGenerateKey(
        label || 'My Key',
        wordCount,
        password || undefined,
      );
      setMnemonic(result.mnemonic);
      setLabel('');
      setPassword('');
      const networks: ('mainnet' | 'testnet')[] = [];
      if (createMainnet) networks.push('mainnet');
      if (createTestnet) networks.push('testnet');
      if (autoCreate && networks.length > 0) {
        setAutoStatus('Creating accounts...');
        onAutoCreate(result.key.id, sigAlgo, hashAlgo, networks)
          .then(() => setAutoStatus('Accounts created'))
          .catch(() => setAutoStatus(''))
          .finally(() => setTimeout(() => setAutoStatus(''), 3000));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate key');
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyMnemonic = () => {
    if (mnemonic) {
      navigator.clipboard.writeText(mnemonic);
      setMnemonicCopied(true);
      setTimeout(() => setMnemonicCopied(false), 2000);
    }
  };

  if (mnemonic) {
    const words = mnemonic.split(' ');
    return (
      <div className="space-y-2">
        <div className="bg-amber-500/10 border border-amber-500/20 rounded px-2.5 py-2">
          <p className="text-amber-400 text-[11px] font-medium mb-2">
            Back up your recovery phrase! It will not be shown again.
          </p>
          <div className="grid grid-cols-3 gap-1">
            {words.map((word, i) => (
              <div key={i} className="bg-zinc-800 rounded px-1.5 py-1 text-[10px] font-mono text-zinc-200">
                <span className="text-zinc-500 mr-1">{i + 1}.</span>{word}
              </div>
            ))}
          </div>
          <button onClick={handleCopyMnemonic} className={`mt-2 ${btnSecondary}`}>
            {mnemonicCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {mnemonicCopied ? 'Copied!' : 'Copy Phrase'}
          </button>
        </div>
        {autoStatus && (
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            {autoStatus}
          </div>
        )}
        <button onClick={() => setMnemonic(null)} className={btnSecondary}>
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {/* Label + word count on same row */}
      <div className="flex gap-2">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Key label (optional)"
          className={`${inputClass} flex-1`}
        />
        <select
          value={wordCount}
          onChange={(e) => setWordCount(Number(e.target.value) as 12 | 24)}
          className={`${inputClass} w-auto shrink-0`}
        >
          <option value={12}>12 words</option>
          <option value={24}>24 words</option>
        </select>
      </div>

      {/* Auto-create toggle + network checkboxes */}
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <button
            type="button"
            role="switch"
            aria-checked={autoCreate}
            onClick={onToggleAutoCreate}
            className={`relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors ${
              autoCreate ? 'bg-emerald-600' : 'bg-zinc-600'
            }`}
          >
            <span
              className={`inline-block h-3 w-3 rounded-full bg-white transition-transform mt-0.5 ${
                autoCreate ? 'translate-x-3.5 ml-0' : 'translate-x-0.5'
              }`}
            />
          </button>
          <span className="text-[11px] text-zinc-300">Auto-create</span>
        </label>
        {autoCreate && (
          <>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={createMainnet}
                onChange={(e) => setCreateMainnet(e.target.checked)}
                className="w-3 h-3 rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-0 accent-emerald-500"
              />
              <span className="text-[10px] text-zinc-400">Mainnet</span>
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={createTestnet}
                onChange={(e) => setCreateTestnet(e.target.checked)}
                className="w-3 h-3 rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-0 accent-emerald-500"
              />
              <span className="text-[10px] text-zinc-400">Testnet</span>
            </label>
          </>
        )}
      </div>

      {/* Advanced toggle */}
      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        <Settings2 className="w-3 h-3" />
        Advanced
        <ChevronDown className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
      </button>

      {showAdvanced && (
        <div className="space-y-2 pl-1 border-l-2 border-zinc-700 ml-1">
          {/* Custom password */}
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Custom password (leave empty for auto)"
              className={inputClass}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            >
              {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </button>
          </div>
          {!password && (
            <p className="text-[10px] text-zinc-600 -mt-1">
              Auto-generated password — no prompt on sign
            </p>
          )}

          {/* Curve + Hash */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500">Curve:</span>
              <select
                value={sigAlgo}
                onChange={(e) => setSigAlgo(e.target.value as 'ECDSA_P256' | 'ECDSA_secp256k1')}
                className={`${inputClass} w-auto text-[11px]`}
              >
                <option value="ECDSA_secp256k1">secp256k1</option>
                <option value="ECDSA_P256">P256</option>
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-zinc-500">Hash:</span>
              <select
                value={hashAlgo}
                onChange={(e) => setHashAlgo(e.target.value as 'SHA2_256' | 'SHA3_256')}
                className={`${inputClass} w-auto text-[11px]`}
              >
                <option value="SHA2_256">SHA2_256</option>
                <option value="SHA3_256">SHA3_256</option>
              </select>
            </div>
          </div>
        </div>
      )}

      <button onClick={handleGenerate} disabled={generating || !wasmReady} className={`${btnPrimary} w-full justify-center`}>
        {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
        Generate Key
      </button>
      {error && <p className="text-red-400 text-[11px]">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import Mnemonic Form
// ---------------------------------------------------------------------------

function ImportMnemonicForm({
  wasmReady,
  onImportMnemonic,
  onAutoRefresh,
}: {
  wasmReady: boolean;
  onImportMnemonic: KeyManagerProps['onImportMnemonic'];
  onAutoRefresh: (keyId: string) => Promise<void>;
}) {
  const [mnemonic, setMnemonic] = useState('');
  const [label, setLabel] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [path, setPath] = useState("m/44'/539'/0'/0/0");
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleImport = async () => {
    setError('');
    setSuccess('');
    if (!mnemonic.trim()) { setError('Mnemonic is required'); return; }
    setImporting(true);
    try {
      const key = await onImportMnemonic(
        mnemonic.trim(),
        label || 'Imported Mnemonic',
        passphrase || undefined,
        path || undefined,
        password || undefined,
      );
      setMnemonic(''); setLabel(''); setPassphrase(''); setPassword('');
      setSuccess('Imported! Discovering accounts...');
      onAutoRefresh(key.id)
        .then(() => setSuccess('Key imported, accounts discovered'))
        .catch(() => {})
        .finally(() => setTimeout(() => setSuccess(''), 3000));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to import mnemonic');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-2">
      <textarea
        value={mnemonic}
        onChange={(e) => setMnemonic(e.target.value)}
        placeholder="Enter 12 or 24 word mnemonic phrase..."
        rows={3}
        className={`${inputMonoClass} resize-none`}
      />
      <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Key label (optional)" className={inputClass} />

      {/* Advanced toggle */}
      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        <Settings2 className="w-3 h-3" />
        Advanced
        <ChevronDown className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
      </button>

      {showAdvanced && (
        <div className="space-y-2 pl-1 border-l-2 border-zinc-700 ml-1">
          <input type="text" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="BIP39 passphrase (optional)" className={inputClass} />
          <input type="text" value={path} onChange={(e) => setPath(e.target.value)} placeholder="Derivation path" className={inputMonoClass} />
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Custom password (leave empty for auto)"
              className={inputClass}
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
              {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </button>
          </div>
        </div>
      )}

      <button onClick={handleImport} disabled={importing || !wasmReady} className={`${btnPrimary} w-full justify-center`}>
        {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        Import Mnemonic
      </button>
      {error && <p className="text-red-400 text-[11px]">{error}</p>}
      {success && <p className="text-emerald-400 text-[11px]">{success}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import Private Key Form
// ---------------------------------------------------------------------------

function ImportPrivateKeyForm({
  wasmReady,
  onImportPrivateKey,
  onAutoRefresh,
}: {
  wasmReady: boolean;
  onImportPrivateKey: KeyManagerProps['onImportPrivateKey'];
  onAutoRefresh: (keyId: string) => Promise<void>;
}) {
  const [hex, setHex] = useState('');
  const [label, setLabel] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleImport = async () => {
    setError('');
    setSuccess('');
    if (!hex.trim()) { setError('Private key is required'); return; }
    setImporting(true);
    try {
      const key = await onImportPrivateKey(hex.trim(), label || 'Imported Key', password || undefined);
      setHex(''); setLabel(''); setPassword('');
      setSuccess('Imported! Discovering accounts...');
      onAutoRefresh(key.id)
        .then(() => setSuccess('Key imported, accounts discovered'))
        .catch(() => {})
        .finally(() => setTimeout(() => setSuccess(''), 3000));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to import private key');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-2">
      <textarea value={hex} onChange={(e) => setHex(e.target.value)} placeholder="Enter private key hex..." rows={2} className={`${inputMonoClass} resize-none`} />
      <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Key label (optional)" className={inputClass} />

      {/* Advanced toggle */}
      <button
        type="button"
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        <Settings2 className="w-3 h-3" />
        Advanced
        <ChevronDown className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
      </button>

      {showAdvanced && (
        <div className="space-y-2 pl-1 border-l-2 border-zinc-700 ml-1">
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Custom password (leave empty for auto)"
              className={inputClass}
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
              {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </button>
          </div>
        </div>
      )}

      <button onClick={handleImport} disabled={importing || !wasmReady} className={`${btnPrimary} w-full justify-center`}>
        {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        Import Key
      </button>
      {error && <p className="text-red-400 text-[11px]">{error}</p>}
      {success && <p className="text-emerald-400 text-[11px]">{success}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import Keystore Form
// ---------------------------------------------------------------------------

function ImportKeystoreForm({
  wasmReady,
  onImportKeystore,
  onAutoRefresh,
}: {
  wasmReady: boolean;
  onImportKeystore: KeyManagerProps['onImportKeystore'];
  onAutoRefresh: (keyId: string) => Promise<void>;
}) {
  const [json, setJson] = useState('');
  const [keystorePassword, setKeystorePassword] = useState('');
  const [label, setLabel] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setJson(reader.result as string);
    reader.readAsText(file);
  };

  const handleImport = async () => {
    setError('');
    setSuccess('');
    if (!json.trim()) { setError('Keystore JSON is required'); return; }
    if (!keystorePassword) { setError('Keystore password is required to decrypt'); return; }
    setImporting(true);
    try {
      const key = await onImportKeystore(json.trim(), keystorePassword, label || 'Imported Keystore', newPassword || undefined);
      setJson(''); setKeystorePassword(''); setLabel(''); setNewPassword('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setSuccess('Imported! Discovering accounts...');
      onAutoRefresh(key.id)
        .then(() => setSuccess('Keystore imported, accounts discovered'))
        .catch(() => {})
        .finally(() => setTimeout(() => setSuccess(''), 3000));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to import keystore');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-2">
      <div>
        <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileSelect} className="hidden" />
        <button onClick={() => fileInputRef.current?.click()} className={btnSecondary}>
          <Upload className="w-3.5 h-3.5" />
          {json ? 'File loaded' : 'Choose JSON file'}
        </button>
        {json && <p className="text-zinc-500 text-[10px] mt-1 truncate">{json.slice(0, 60)}...</p>}
      </div>
      <div className="relative">
        <input
          type={showPassword ? 'text' : 'password'}
          value={keystorePassword}
          onChange={(e) => setKeystorePassword(e.target.value)}
          placeholder="Keystore password (required)"
          className={inputClass}
        />
        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300">
          {showPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
        </button>
      </div>
      <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Key label (optional)" className={inputClass} />
      <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New encryption password (optional)" className={inputClass} />
      <button onClick={handleImport} disabled={importing || !wasmReady} className={btnPrimary}>
        {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileKey className="w-3.5 h-3.5" />}
        Import Keystore
      </button>
      {error && <p className="text-red-400 text-[11px]">{error}</p>}
      {success && <p className="text-emerald-400 text-[11px]">{success}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local Key Card
// ---------------------------------------------------------------------------

function LocalKeyCard({
  localKey,
  accounts,
  network,
  onDelete,
  onExportKeystore,
  onRefreshAccounts,
  onCreateAccount,
  onGetPrivateKey,
  onViewAccount,
}: {
  localKey: LocalKey;
  accounts: KeyAccount[];
  network: 'mainnet' | 'testnet';
  onDelete: (id: string) => void;
  onExportKeystore: (id: string, password?: string) => Promise<string>;
  onRefreshAccounts: (keyId: string, network: 'mainnet' | 'testnet') => Promise<KeyAccount[]>;
  onCreateAccount: (
    keyId: string,
    sigAlgo: 'ECDSA_P256' | 'ECDSA_secp256k1',
    hashAlgo: 'SHA2_256' | 'SHA3_256',
    network: 'mainnet' | 'testnet',
  ) => Promise<{ txId: string }>;
  onGetPrivateKey?: (keyId: string, password?: string) => Promise<string>;
  onViewAccount?: (address: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [showExportInput, setShowExportInput] = useState(false);
  const [revealedPrivateKey, setRevealedPrivateKey] = useState<string | null>(null);
  const [revealingKey, setRevealingKey] = useState(false);
  const [pkCopied, setPkCopied] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  const handleRefresh = async () => {
    setActionError('');
    setRefreshing(true);
    try {
      await onRefreshAccounts(localKey.id, network);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to refresh accounts');
    } finally {
      setRefreshing(false);
    }
  };

  const handleExport = async () => {
    if (!showExportInput) {
      setShowExportInput(true);
      return;
    }
    setActionError('');
    setExporting(true);
    try {
      const json = await onExportKeystore(localKey.id, exportPassword || undefined);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${localKey.label.replace(/[^a-zA-Z0-9]/g, '_')}_keystore.json`;
      a.click();
      URL.revokeObjectURL(url);
      setShowExportInput(false);
      setExportPassword('');
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to export keystore');
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = () => {
    onDelete(localKey.id);
    setConfirmDelete(false);
  };

  return (
    <div className="bg-zinc-800 rounded border border-zinc-700">
      {/* Header row */}
      <div className="px-2.5 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-zinc-500 hover:text-zinc-300 p-0.5 shrink-0"
            >
              {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
            <span className="text-xs font-semibold text-zinc-100 truncate">{localKey.label}</span>
            <LocalSourceBadge source={localKey.source} />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <button onClick={handleDelete} className="text-red-400 hover:text-red-300 text-[10px] font-medium">Confirm</button>
                <button onClick={() => setConfirmDelete(false)} className="text-zinc-500 hover:text-zinc-300 text-[10px]">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="text-zinc-500 hover:text-red-400 p-0.5" title="Delete key">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 mt-1 ml-5">
          <span className="text-[10px] text-zinc-500">P256:</span>
          <span className="text-[10px] text-zinc-400 font-mono">{truncateKey(localKey.publicKeyP256)}</span>
          <CopyButton text={localKey.publicKeyP256} />
        </div>
        <div className="flex items-center gap-2 mt-0.5 ml-5">
          <span className="text-[10px] text-zinc-500">{formatDate(localKey.createdAt)}</span>
          {localKey.hasPassword && (
            <span className="text-[10px] text-zinc-500 flex items-center gap-0.5">
              <Key className="w-2.5 h-2.5" /> encrypted
            </span>
          )}
        </div>

        {/* Accounts shown right under header with avatars */}
        {accounts.length > 0 && (
          <div className="mt-2 ml-5 space-y-1">
            {accounts.map((acc, i) => (
              <button
                key={`${acc.flowAddress}-${acc.keyIndex}-${i}`}
                onClick={() => onViewAccount?.(acc.flowAddress)}
                className="w-full flex items-center gap-2 bg-zinc-900 rounded px-2 py-1.5 hover:bg-zinc-700/50 transition-colors group text-left"
              >
                <Avatar size={18} name={acc.flowAddress} variant="beam" colors={['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444']} />
                <span className="text-[11px] text-zinc-200 font-mono">{acc.flowAddress}</span>
                <span className="text-[10px] text-zinc-500">#{acc.keyIndex}</span>
                <ExternalLink className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 ml-auto" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-zinc-700 px-2.5 py-2 space-y-2">
          {/* Actions */}
          <div className="flex flex-wrap gap-1.5">
            <button onClick={handleRefresh} disabled={refreshing} className={btnSecondary} title="Find accounts using this key">
              {refreshing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Refresh
            </button>
            <button
              onClick={handleExport}
              disabled={exporting}
              className={btnSecondary}
              title="Download keystore JSON"
            >
              {exporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
              Export
            </button>
            {onGetPrivateKey && (
              <button
                onClick={async () => {
                  if (revealedPrivateKey) {
                    setRevealedPrivateKey(null);
                    return;
                  }
                  setRevealingKey(true);
                  setActionError('');
                  try {
                    const pk = await onGetPrivateKey(localKey.id);
                    setRevealedPrivateKey(pk);
                  } catch (err: unknown) {
                    setActionError(err instanceof Error ? err.message : 'Failed to decrypt key');
                  } finally {
                    setRevealingKey(false);
                  }
                }}
                disabled={revealingKey}
                className={btnSecondary}
                title={revealedPrivateKey ? 'Hide private key' : 'Reveal private key'}
              >
                {revealingKey ? <Loader2 className="w-3 h-3 animate-spin" /> : revealedPrivateKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                {revealedPrivateKey ? 'Hide' : 'Reveal'}
              </button>
            )}
          </div>

          {/* Revealed private key */}
          {revealedPrivateKey && (
            <div className="bg-red-500/5 border border-red-500/20 rounded px-2 py-1.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-red-400 font-medium">Private Key</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(revealedPrivateKey);
                    setPkCopied(true);
                    setTimeout(() => setPkCopied(false), 2000);
                  }}
                  className="text-zinc-500 hover:text-zinc-300 p-0.5"
                >
                  {pkCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
              <p className="text-[10px] text-zinc-300 font-mono break-all select-all leading-relaxed">
                {revealedPrivateKey}
              </p>
            </div>
          )}

          {/* Export password input */}
          {showExportInput && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-zinc-400">Create a password to protect your keystore:</p>
              <div className="flex gap-1.5 items-center">
                <input
                  type="password"
                  value={exportPassword}
                  onChange={(e) => setExportPassword(e.target.value)}
                  placeholder="Encryption password"
                  className={`${inputClass} flex-1`}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleExport(); }}
                  autoFocus
                />
                <button onClick={handleExport} disabled={exporting || !exportPassword} className={btnPrimary}>
                  {exporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                </button>
                <button onClick={() => { setShowExportInput(false); setExportPassword(''); }} className="text-zinc-500 hover:text-zinc-300 p-1">
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          {/* secp256k1 public key */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-zinc-500">secp256k1:</span>
            <span className="text-[10px] text-zinc-400 font-mono">{truncateKey(localKey.publicKeySecp256k1)}</span>
            <CopyButton text={localKey.publicKeySecp256k1} />
          </div>

          {actionError && <p className="text-red-400 text-[11px]">{actionError}</p>}
          {actionSuccess && <p className="text-emerald-400 text-[11px]">{actionSuccess}</p>}
        </div>
      )}
    </div>
  );
}

import { useState, useRef } from 'react';
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
  UserPlus,
  HardDrive,
  Cloud,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useKeys, type UserKey } from '../auth/useKeys';
import type { LocalKey, KeyAccount } from '../auth/localKeyManager';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface KeyManagerProps {
  onClose: () => void;
  network: 'mainnet' | 'testnet';
  // Local key props
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CloudSourceBadge({ source }: { source: UserKey['source'] }) {
  if (source === 'created') {
    return (
      <span className="bg-emerald-500/10 text-emerald-400 text-[10px] px-1.5 py-0.5 rounded">
        created
      </span>
    );
  }
  return (
    <span className="bg-blue-500/10 text-blue-400 text-[10px] px-1.5 py-0.5 rounded">
      imported
    </span>
  );
}

function LocalSourceBadge({ source }: { source: LocalKey['source'] }) {
  const colors: Record<LocalKey['source'], string> = {
    mnemonic: 'bg-purple-500/10 text-purple-400',
    privateKey: 'bg-amber-500/10 text-amber-400',
    keystore: 'bg-cyan-500/10 text-cyan-400',
  };
  return (
    <span
      className={`${colors[source]} text-[10px] px-1.5 py-0.5 rounded`}
    >
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
    <button
      onClick={handleCopy}
      className="text-zinc-500 hover:text-zinc-300 p-0.5"
      title="Copy"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-emerald-400" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tab type
// ---------------------------------------------------------------------------

type Tab = 'local' | 'cloud';
type LocalImportMode = 'generate' | 'mnemonic' | 'privateKey' | 'keystore';

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
}: KeyManagerProps) {
  const [activeTab, setActiveTab] = useState<Tab>('local');

  return (
    <div className="flex flex-col h-full bg-zinc-900 border-l border-zinc-700">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-100">My Keys</span>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 p-0.5"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-zinc-700">
        <button
          onClick={() => setActiveTab('local')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
            activeTab === 'local'
              ? 'text-emerald-400 border-b-2 border-emerald-400'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <HardDrive className="w-3.5 h-3.5" />
          Local Keys
        </button>
        <button
          onClick={() => setActiveTab('cloud')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
            activeTab === 'cloud'
              ? 'text-emerald-400 border-b-2 border-emerald-400'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Cloud className="w-3.5 h-3.5" />
          Cloud Keys
        </button>
      </div>

      {/* Content */}
      {activeTab === 'local' ? (
        <LocalKeysTab
          localKeys={localKeys}
          accountsMap={accountsMap}
          wasmReady={wasmReady}
          network={network}
          onGenerateKey={onGenerateKey}
          onImportMnemonic={onImportMnemonic}
          onImportPrivateKey={onImportPrivateKey}
          onImportKeystore={onImportKeystore}
          onDeleteLocalKey={onDeleteLocalKey}
          onExportKeystore={onExportKeystore}
          onRefreshAccounts={onRefreshAccounts}
          onCreateAccount={onCreateAccount}
        />
      ) : (
        <CloudKeysTab network={network} />
      )}
    </div>
  );
}

// ===========================================================================
// Local Keys Tab
// ===========================================================================

function LocalKeysTab({
  localKeys,
  accountsMap,
  wasmReady,
  network,
  onGenerateKey,
  onImportMnemonic,
  onImportPrivateKey,
  onImportKeystore,
  onDeleteLocalKey,
  onExportKeystore,
  onRefreshAccounts,
  onCreateAccount,
}: Omit<KeyManagerProps, 'onClose' | 'activeTab'>) {
  const [importMode, setImportMode] = useState<LocalImportMode>('generate');
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

  /** After key creation, auto-create accounts on both networks if toggle is on. */
  const autoCreateAccounts = async (keyId: string) => {
    if (!autoCreate) return;
    await Promise.allSettled([
      onCreateAccount(keyId, 'ECDSA_secp256k1', 'SHA3_256', 'testnet'),
      onCreateAccount(keyId, 'ECDSA_secp256k1', 'SHA3_256', 'mainnet'),
    ]);
  };

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-4">
      {!wasmReady && (
        <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 rounded px-2.5 py-2 border border-amber-500/20">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading WASM crypto module...
        </div>
      )}

      {/* Auto-create account toggle */}
      <label className="flex items-center gap-2 cursor-pointer select-none">
        <button
          type="button"
          role="switch"
          aria-checked={autoCreate}
          onClick={toggleAutoCreate}
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
        <span className="text-[11px] text-zinc-300">
          Auto-create account on testnet & mainnet
        </span>
      </label>

      {/* Import mode selector */}
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-1">
          {(
            [
              ['generate', 'Generate New'],
              ['mnemonic', 'Import Mnemonic'],
              ['privateKey', 'Import Key'],
              ['keystore', 'Import Keystore'],
            ] as [LocalImportMode, string][]
          ).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setImportMode(mode)}
              className={`text-[11px] px-2 py-1.5 rounded transition-colors ${
                importMode === mode
                  ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Form for selected mode */}
        {importMode === 'generate' && (
          <GenerateForm
            wasmReady={wasmReady}
            onGenerateKey={onGenerateKey}
            onAutoCreate={autoCreateAccounts}
          />
        )}
        {importMode === 'mnemonic' && (
          <ImportMnemonicForm
            wasmReady={wasmReady}
            onImportMnemonic={onImportMnemonic}
            onAutoCreate={autoCreateAccounts}
          />
        )}
        {importMode === 'privateKey' && (
          <ImportPrivateKeyForm
            wasmReady={wasmReady}
            onImportPrivateKey={onImportPrivateKey}
            onAutoCreate={autoCreateAccounts}
          />
        )}
        {importMode === 'keystore' && (
          <ImportKeystoreForm
            wasmReady={wasmReady}
            onImportKeystore={onImportKeystore}
            onAutoCreate={autoCreateAccounts}
          />
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-zinc-700" />

      {/* Local keys list */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-zinc-300">
          Stored Keys ({localKeys.length})
        </h3>
        {localKeys.length === 0 ? (
          <p className="text-zinc-500 text-xs text-center py-6">
            No local keys yet. Generate or import one above.
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
            />
          ))
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
}: {
  wasmReady: boolean;
  onGenerateKey: KeyManagerProps['onGenerateKey'];
  onAutoCreate: (keyId: string) => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [wordCount, setWordCount] = useState<12 | 24>(12);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [mnemonicCopied, setMnemonicCopied] = useState(false);

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
      onAutoCreate(result.key.id).catch(() => {});
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Failed to generate key',
      );
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
              <div
                key={i}
                className="bg-zinc-800 rounded px-1.5 py-1 text-[10px] font-mono text-zinc-200"
              >
                <span className="text-zinc-500 mr-1">{i + 1}.</span>
                {word}
              </div>
            ))}
          </div>
          <button
            onClick={handleCopyMnemonic}
            className={`mt-2 ${btnSecondary}`}
          >
            {mnemonicCopied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            {mnemonicCopied ? 'Copied!' : 'Copy Phrase'}
          </button>
        </div>
        <button
          onClick={() => setMnemonic(null)}
          className={btnSecondary}
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Key label (optional)"
        className={inputClass}
      />
      <div className="flex gap-2">
        <select
          value={wordCount}
          onChange={(e) => setWordCount(Number(e.target.value) as 12 | 24)}
          className={`${inputClass} w-auto`}
        >
          <option value={12}>12 words</option>
          <option value={24}>24 words</option>
        </select>
        <div className="relative flex-1">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (optional)"
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
          >
            {showPassword ? (
              <EyeOff className="w-3 h-3" />
            ) : (
              <Eye className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>
      <button
        onClick={handleGenerate}
        disabled={generating || !wasmReady}
        className={btnPrimary}
      >
        {generating ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Plus className="w-3.5 h-3.5" />
        )}
        Generate
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
  onAutoCreate,
}: {
  wasmReady: boolean;
  onImportMnemonic: KeyManagerProps['onImportMnemonic'];
  onAutoCreate: (keyId: string) => Promise<void>;
}) {
  const [mnemonic, setMnemonic] = useState('');
  const [label, setLabel] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [path, setPath] = useState("m/44'/539'/0'/0/0");
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleImport = async () => {
    setError('');
    setSuccess('');
    if (!mnemonic.trim()) {
      setError('Mnemonic is required');
      return;
    }
    setImporting(true);
    try {
      const key = await onImportMnemonic(
        mnemonic.trim(),
        label || 'Imported Mnemonic',
        passphrase || undefined,
        path || undefined,
        password || undefined,
      );
      setMnemonic('');
      setLabel('');
      setPassphrase('');
      setPassword('');
      setSuccess('Key imported successfully');
      setTimeout(() => setSuccess(''), 3000);
      onAutoCreate(key.id).catch(() => {});
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Failed to import mnemonic',
      );
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
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Key label (optional)"
        className={inputClass}
      />
      <input
        type="text"
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        placeholder="BIP39 passphrase (optional)"
        className={inputClass}
      />
      <input
        type="text"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="Derivation path"
        className={inputMonoClass}
      />
      <div className="relative">
        <input
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Encryption password (optional)"
          className={inputClass}
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
        >
          {showPassword ? (
            <EyeOff className="w-3 h-3" />
          ) : (
            <Eye className="w-3 h-3" />
          )}
        </button>
      </div>
      <button
        onClick={handleImport}
        disabled={importing || !wasmReady}
        className={btnPrimary}
      >
        {importing ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Download className="w-3.5 h-3.5" />
        )}
        Import
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
  onAutoCreate,
}: {
  wasmReady: boolean;
  onImportPrivateKey: KeyManagerProps['onImportPrivateKey'];
  onAutoCreate: (keyId: string) => Promise<void>;
}) {
  const [hex, setHex] = useState('');
  const [label, setLabel] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleImport = async () => {
    setError('');
    setSuccess('');
    if (!hex.trim()) {
      setError('Private key is required');
      return;
    }
    setImporting(true);
    try {
      const key = await onImportPrivateKey(
        hex.trim(),
        label || 'Imported Key',
        password || undefined,
      );
      setHex('');
      setLabel('');
      setPassword('');
      setSuccess('Key imported successfully');
      setTimeout(() => setSuccess(''), 3000);
      onAutoCreate(key.id).catch(() => {});
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Failed to import private key',
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-2">
      <textarea
        value={hex}
        onChange={(e) => setHex(e.target.value)}
        placeholder="Enter private key hex..."
        rows={2}
        className={`${inputMonoClass} resize-none`}
      />
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Key label (optional)"
        className={inputClass}
      />
      <div className="relative">
        <input
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Encryption password (optional)"
          className={inputClass}
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
        >
          {showPassword ? (
            <EyeOff className="w-3 h-3" />
          ) : (
            <Eye className="w-3 h-3" />
          )}
        </button>
      </div>
      <button
        onClick={handleImport}
        disabled={importing || !wasmReady}
        className={btnPrimary}
      >
        {importing ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Download className="w-3.5 h-3.5" />
        )}
        Import
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
  onAutoCreate,
}: {
  wasmReady: boolean;
  onImportKeystore: KeyManagerProps['onImportKeystore'];
  onAutoCreate: (keyId: string) => Promise<void>;
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
    reader.onload = () => {
      setJson(reader.result as string);
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    setError('');
    setSuccess('');
    if (!json.trim()) {
      setError('Keystore JSON is required');
      return;
    }
    if (!keystorePassword) {
      setError('Keystore password is required to decrypt');
      return;
    }
    setImporting(true);
    try {
      const key = await onImportKeystore(
        json.trim(),
        keystorePassword,
        label || 'Imported Keystore',
        newPassword || undefined,
      );
      setJson('');
      setKeystorePassword('');
      setLabel('');
      setNewPassword('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setSuccess('Keystore imported successfully');
      setTimeout(() => setSuccess(''), 3000);
      onAutoCreate(key.id).catch(() => {});
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Failed to import keystore',
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-2">
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileSelect}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className={btnSecondary}
        >
          <Upload className="w-3.5 h-3.5" />
          {json ? 'File loaded' : 'Choose JSON file'}
        </button>
        {json && (
          <p className="text-zinc-500 text-[10px] mt-1 truncate">
            {json.slice(0, 60)}...
          </p>
        )}
      </div>
      <div className="relative">
        <input
          type={showPassword ? 'text' : 'password'}
          value={keystorePassword}
          onChange={(e) => setKeystorePassword(e.target.value)}
          placeholder="Keystore password (required)"
          className={inputClass}
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
        >
          {showPassword ? (
            <EyeOff className="w-3 h-3" />
          ) : (
            <Eye className="w-3 h-3" />
          )}
        </button>
      </div>
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Key label (optional)"
        className={inputClass}
      />
      <input
        type="password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        placeholder="New encryption password (optional)"
        className={inputClass}
      />
      <button
        onClick={handleImport}
        disabled={importing || !wasmReady}
        className={btnPrimary}
      >
        {importing ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <FileKey className="w-3.5 h-3.5" />
        )}
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
}: {
  localKey: LocalKey;
  accounts: KeyAccount[];
  network: 'mainnet' | 'testnet';
  onDelete: (id: string) => void;
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
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  const handleRefresh = async () => {
    setActionError('');
    setRefreshing(true);
    try {
      await onRefreshAccounts(localKey.id, network);
    } catch (err: unknown) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to refresh accounts',
      );
    } finally {
      setRefreshing(false);
    }
  };

  const handleCreateAccount = async () => {
    setActionError('');
    setActionSuccess('');
    setCreatingAccount(true);
    try {
      const result = await onCreateAccount(
        localKey.id,
        'ECDSA_secp256k1',
        'SHA3_256',
        network,
      );
      setActionSuccess(`Account created! TX: ${result.txId.slice(0, 16)}...`);
      setTimeout(() => setActionSuccess(''), 5000);
    } catch (err: unknown) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to create account',
      );
    } finally {
      setCreatingAccount(false);
    }
  };

  const handleExport = async () => {
    setActionError('');
    setExporting(true);
    try {
      const json = await onExportKeystore(localKey.id);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${localKey.label.replace(/[^a-zA-Z0-9]/g, '_')}_keystore.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to export keystore',
      );
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
              {expanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </button>
            <span className="text-xs font-semibold text-zinc-100 truncate">
              {localKey.label}
            </span>
            <LocalSourceBadge source={localKey.source} />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleDelete}
                  className="text-red-400 hover:text-red-300 text-[10px] font-medium"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-zinc-500 hover:text-zinc-300 text-[10px]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-zinc-500 hover:text-red-400 p-0.5"
                title="Delete key"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 mt-1 ml-5">
          <span className="text-[10px] text-zinc-500">P256:</span>
          <span className="text-[10px] text-zinc-400 font-mono">
            {truncateKey(localKey.publicKeyP256)}
          </span>
          <CopyButton text={localKey.publicKeyP256} />
        </div>
        <div className="flex items-center gap-2 mt-0.5 ml-5">
          <span className="text-[10px] text-zinc-500">
            {formatDate(localKey.createdAt)}
          </span>
          {localKey.hasPassword && (
            <span className="text-[10px] text-zinc-500 flex items-center gap-0.5">
              <Key className="w-2.5 h-2.5" /> encrypted
            </span>
          )}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-zinc-700 px-2.5 py-2 space-y-2">
          {/* Actions */}
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className={btnSecondary}
              title="Find accounts using this key"
            >
              {refreshing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              Find Accounts
            </button>
            <button
              onClick={handleCreateAccount}
              disabled={creatingAccount}
              className={btnSecondary}
              title="Create a new Flow account with this key"
            >
              {creatingAccount ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <UserPlus className="w-3 h-3" />
              )}
              Create Account
            </button>
            <button
              onClick={handleExport}
              disabled={exporting}
              className={btnSecondary}
              title="Download keystore JSON"
            >
              {exporting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Download className="w-3 h-3" />
              )}
              Export
            </button>
          </div>

          {/* Accounts list */}
          {accounts.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] text-zinc-500 font-medium">
                Linked Accounts ({accounts.length})
              </span>
              {accounts.map((acc, i) => (
                <div
                  key={`${acc.flowAddress}-${acc.keyIndex}-${i}`}
                  className="bg-zinc-900 rounded px-2 py-1.5 flex items-center justify-between"
                >
                  <div>
                    <span className="text-[11px] text-zinc-200 font-mono">
                      {acc.flowAddress}
                    </span>
                    <span className="text-[10px] text-zinc-500 ml-1.5">
                      key#{acc.keyIndex}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] text-zinc-500">
                      {acc.sigAlgo} / {acc.hashAlgo}
                    </span>
                    <span className="text-[9px] text-zinc-600">
                      w:{acc.weight}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* secp256k1 public key */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-zinc-500">secp256k1:</span>
            <span className="text-[10px] text-zinc-400 font-mono">
              {truncateKey(localKey.publicKeySecp256k1)}
            </span>
            <CopyButton text={localKey.publicKeySecp256k1} />
          </div>

          {actionError && (
            <p className="text-red-400 text-[11px]">{actionError}</p>
          )}
          {actionSuccess && (
            <p className="text-emerald-400 text-[11px]">{actionSuccess}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Cloud Keys Tab (existing functionality)
// ===========================================================================

function CloudKeysTab({ network }: { network: 'mainnet' | 'testnet' }) {
  const { keys, loading, createKey, importKey, deleteKey } = useKeys();

  // Create form state
  const [createLabel, setCreateLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Import form state
  const [importPrivateKeyVal, setImportPrivateKeyVal] = useState('');
  const [importAddress, setImportAddress] = useState('');
  const [importLabel, setImportLabel] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');

  // Delete confirmation
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleCreate = async () => {
    setCreateError('');
    setCreating(true);
    try {
      await createKey(createLabel || 'My Key', network);
      setCreateLabel('');
    } catch (err: unknown) {
      setCreateError(
        err instanceof Error ? err.message : 'Failed to create key',
      );
    } finally {
      setCreating(false);
    }
  };

  const handleImport = async () => {
    setImportError('');
    if (!importPrivateKeyVal.trim()) {
      setImportError('Private key is required');
      return;
    }
    if (!importAddress.trim()) {
      setImportError('Flow address is required');
      return;
    }
    setImporting(true);
    try {
      await importKey(
        importPrivateKeyVal.trim(),
        importAddress.trim(),
        importLabel || undefined,
      );
      setImportPrivateKeyVal('');
      setImportAddress('');
      setImportLabel('');
    } catch (err: unknown) {
      setImportError(
        err instanceof Error ? err.message : 'Failed to import key',
      );
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      await deleteKey(id);
      setConfirmDeleteId(null);
    } catch {
      // Key list will refresh anyway
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-4">
      {/* Key list */}
      <div className="space-y-2">
        {loading && keys.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-zinc-500 text-xs">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            Loading keys...
          </div>
        ) : keys.length === 0 ? (
          <p className="text-zinc-500 text-xs text-center py-6">
            No keys yet. Create or import one below.
          </p>
        ) : (
          keys.map((key) => (
            <div
              key={key.id}
              className="bg-zinc-800 rounded px-2.5 py-2 border border-zinc-700"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-semibold text-zinc-100 truncate">
                    {key.label}
                  </span>
                  <CloudSourceBadge source={key.source} />
                </div>
                {confirmDeleteId === key.id ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleDelete(key.id)}
                      disabled={deleting}
                      className="text-red-400 hover:text-red-300 text-[10px] font-medium disabled:opacity-50"
                    >
                      {deleting ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        'Confirm'
                      )}
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-zinc-500 hover:text-zinc-300 text-[10px]"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(key.id)}
                    className="text-zinc-500 hover:text-red-400 p-0.5"
                    title={`Delete key for ${truncateAddress(key.flow_address)}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="text-[11px] text-zinc-400 mt-1 font-mono">
                {truncateAddress(key.flow_address)}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-zinc-700" />

      {/* Create section */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          Create New Address
        </h3>
        <input
          type="text"
          value={createLabel}
          onChange={(e) => setCreateLabel(e.target.value)}
          placeholder="My Key"
          className={inputClass}
        />
        <button
          onClick={handleCreate}
          disabled={creating}
          className={btnPrimary}
        >
          {creating ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Plus className="w-3.5 h-3.5" />
          )}
          Create
        </button>
        {createError && (
          <p className="text-red-400 text-[11px]">{createError}</p>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-zinc-700" />

      {/* Import section */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
          <Download className="w-3.5 h-3.5" />
          Import Existing Key
        </h3>
        <textarea
          value={importPrivateKeyVal}
          onChange={(e) => setImportPrivateKeyVal(e.target.value)}
          placeholder="Enter private key hex..."
          rows={3}
          className={`${inputMonoClass} resize-none`}
        />
        <input
          type="text"
          value={importAddress}
          onChange={(e) => setImportAddress(e.target.value)}
          placeholder="0x..."
          className={inputMonoClass}
        />
        <input
          type="text"
          value={importLabel}
          onChange={(e) => setImportLabel(e.target.value)}
          placeholder="Imported Key"
          className={inputClass}
        />
        <button
          onClick={handleImport}
          disabled={importing}
          className={btnPrimary}
        >
          {importing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
          Import
        </button>
        {importError && (
          <p className="text-red-400 text-[11px]">{importError}</p>
        )}
      </div>
    </div>
  );
}

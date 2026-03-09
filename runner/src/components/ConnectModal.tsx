import { useState, useEffect, useCallback, useRef } from 'react';
import { Wallet, Key, Zap, Droplets, X, ExternalLink, Plus, Download, Loader2, Check, Settings2 } from 'lucide-react';
import Avatar from 'boring-avatars';
import { fcl } from '../flow/fclConfig';
import type { LocalKey, KeyAccount } from '../auth/localKeyManager';
import type { SignerOption } from './SignerSelector';
import type { FlowNetwork } from '../flow/networks';

interface ConnectModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (option: SignerOption) => void;
  localKeys: LocalKey[];
  accountsMap: Record<string, KeyAccount[]>;
  autoSign: boolean;
  onToggleAutoSign: (value: boolean) => void;
  network: FlowNetwork;
  onOpenKeyManager?: (mode?: 'create' | 'import') => void;
  onGenerateKey?: (label: string) => Promise<{ mnemonic: string; key: LocalKey }>;
  onCreateAccount?: (
    keyId: string,
    sigAlgo: 'ECDSA_P256' | 'ECDSA_secp256k1',
    hashAlgo: 'SHA2_256' | 'SHA3_256',
    network: 'mainnet' | 'testnet',
  ) => Promise<{ txId: string }>;
  onRefreshAccounts?: (keyId: string, network: 'mainnet' | 'testnet') => Promise<KeyAccount[]>;
}

/** Flow logo image */
function FlowLogo({ size = 20 }: { size?: number }) {
  return <img src="/flow-logo.png" alt="Flow" width={size} height={size} className="rounded-full" />;
}

/** Derive 5 colors from an address (matches frontend AddressLink). */
function colorsFromAddress(addr: string): string[] {
  let hex = addr.replace(/^0x/, '');
  if (hex.length > 16) hex = hex.replace(/^0+/, '') || hex;
  hex = hex.padEnd(16, '0').slice(0, 16);
  const c1 = `#${hex.slice(0, 6)}`;
  const c2 = `#${hex.slice(5, 11)}`;
  const c3 = `#${hex.slice(10, 16)}`;
  const c4 = `#${hex[1]}${hex[3]}${hex[7]}${hex[9]}${hex[13]}${hex[15]}`;
  const c5 = `#${hex[0]}${hex[4]}${hex[8]}${hex[12]}${hex[2]}${hex[6]}`;
  return [c1, c2, c3, c4, c5];
}

function truncateAddress(addr: string) {
  if (addr.length <= 10) return addr;
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

/** Fetch FLOW balance for an address. */
function useFlowBalance(address: string | null) {
  const [balance, setBalance] = useState<string | null>(null);
  useEffect(() => {
    if (!address) { setBalance(null); return; }
    let cancelled = false;
    const addr = address.startsWith('0x') ? address : `0x${address}`;
    fcl.account(addr).then((acct: { balance: number }) => {
      if (!cancelled) setBalance((acct.balance / 1e8).toFixed(4));
    }).catch(() => {
      if (!cancelled) setBalance(null);
    });
    return () => { cancelled = true; };
  }, [address]);
  return balance;
}

type HoveredEntry = { key: LocalKey; account: KeyAccount } | 'local-wallet' | 'fcl' | null;

type CreateStep =
  | { status: 'generating-key' }
  | { status: 'key-created'; keyId: string }
  | { status: 'creating-account'; keyId: string; network: string }
  | { status: 'waiting-tx'; keyId: string; network: string; txId: string }
  | { status: 'fetching-accounts'; keyId: string }
  | { status: 'done'; key: LocalKey; account: KeyAccount }
  | { status: 'error'; message: string };

export default function ConnectModal({
  open, onClose, onSelect, localKeys, accountsMap,
  autoSign, onToggleAutoSign, network, onOpenKeyManager,
  onGenerateKey, onCreateAccount, onRefreshAccounts,
}: ConnectModalProps) {
  const [hovered, setHovered] = useState<HoveredEntry>(null);
  const [createStep, setCreateStep] = useState<CreateStep | null>(null);
  const createAbortRef = useRef(false);

  // Build flat list of local key+account entries
  const localEntries: { key: LocalKey; account: KeyAccount }[] = [];
  for (const key of localKeys) {
    const accounts = accountsMap[key.id] || [];
    for (const account of accounts) {
      localEntries.push({ key, account });
    }
  }

  const hasLocalKeys = localEntries.length > 0;

  // Get address for balance lookup
  const hoveredAddress = hovered && hovered !== 'fcl' && hovered !== 'local-wallet'
    ? hovered.account.flowAddress : null;
  const balance = useFlowBalance(hoveredAddress);

  // Reset create state when modal closes
  useEffect(() => {
    if (!open) {
      setCreateStep(null);
      createAbortRef.current = false;
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleSelect = useCallback((option: SignerOption) => {
    onSelect(option);
    onClose();
  }, [onSelect, onClose]);

  const handleFclConnect = useCallback(() => {
    fcl.authenticate();
    onSelect({ type: 'fcl' });
    onClose();
  }, [onSelect, onClose]);

  // Inline wallet creation flow
  const handleQuickCreate = useCallback(async () => {
    if (!onGenerateKey || !onCreateAccount || !onRefreshAccounts) return;
    if (network === 'emulator') return; // Account creation not supported on emulator

    createAbortRef.current = false;

    try {
      // Step 1: Generate key
      setCreateStep({ status: 'generating-key' });
      const { key } = await onGenerateKey('Wallet');
      if (createAbortRef.current) return;

      // Step 2: Create account on current network
      setCreateStep({ status: 'creating-account', keyId: key.id, network });
      const { txId } = await onCreateAccount(key.id, 'ECDSA_P256', 'SHA3_256', network as 'mainnet' | 'testnet');
      if (createAbortRef.current) return;

      setCreateStep({ status: 'waiting-tx', keyId: key.id, network, txId });

      // Step 3: Poll for account to appear (the createAccount call already does refreshAccounts internally,
      // but we may need a few extra tries for indexing delay)
      setCreateStep({ status: 'fetching-accounts', keyId: key.id });
      let account: KeyAccount | null = null;
      for (let i = 0; i < 10; i++) {
        if (createAbortRef.current) return;
        const accounts = await onRefreshAccounts(key.id, network as 'mainnet' | 'testnet');
        if (accounts.length > 0) {
          account = accounts[0];
          break;
        }
        await new Promise(r => setTimeout(r, 2000));
      }

      if (createAbortRef.current) return;

      if (account) {
        setCreateStep({ status: 'done', key, account });
      } else {
        // Account created but not yet indexed — still select the key
        setCreateStep({ status: 'error', message: 'Account created but not yet indexed. Try refreshing in Key Manager.' });
      }
    } catch (err) {
      if (createAbortRef.current) return;
      setCreateStep({ status: 'error', message: err instanceof Error ? err.message : 'Failed to create wallet' });
    }
  }, [onGenerateKey, onCreateAccount, onRefreshAccounts, network]);

  if (!open) return null;

  // Render the creation progress UI for the right panel
  const renderCreateProgress = () => {
    if (!createStep) return null;

    const steps: { label: string; done: boolean; active: boolean; error?: boolean }[] = [];
    const s = createStep.status;

    steps.push({
      label: 'Generating key',
      done: s !== 'generating-key',
      active: s === 'generating-key',
    });
    steps.push({
      label: `Creating ${network} account`,
      done: s === 'waiting-tx' || s === 'fetching-accounts' || s === 'done',
      active: s === 'creating-account',
    });
    steps.push({
      label: 'Waiting for transaction',
      done: s === 'fetching-accounts' || s === 'done',
      active: s === 'waiting-tx',
    });
    steps.push({
      label: 'Fetching account',
      done: s === 'done',
      active: s === 'fetching-accounts',
    });

    const isError = s === 'error';
    const isDone = s === 'done';

    return (
      <div className="flex flex-col items-center gap-5 max-w-[280px] animate-in fade-in duration-150">
        {/* Icon */}
        <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${
          isDone ? 'bg-emerald-500/10 border border-emerald-500/20' :
          isError ? 'bg-red-500/10 border border-red-500/20' :
          'bg-zinc-800 border border-zinc-700'
        }`}>
          {isDone ? (
            <Check className="w-7 h-7 text-emerald-400" />
          ) : isError ? (
            <X className="w-7 h-7 text-red-400" />
          ) : (
            <Loader2 className="w-7 h-7 text-zinc-400 animate-spin" />
          )}
        </div>

        <div className="text-center">
          <div className="text-sm font-medium text-zinc-200">
            {isDone ? 'Wallet Created' : isError ? 'Creation Failed' : 'Creating Wallet...'}
          </div>
        </div>

        {/* Step list */}
        <div className="w-full space-y-2">
          {steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2.5 text-xs">
              <div className="w-4 h-4 flex items-center justify-center flex-shrink-0">
                {step.done ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : step.active && !isError ? (
                  <Loader2 className="w-3.5 h-3.5 text-zinc-400 animate-spin" />
                ) : (
                  <div className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                )}
              </div>
              <span className={
                step.done ? 'text-emerald-400' :
                step.active && !isError ? 'text-zinc-300' :
                'text-zinc-600'
              }>
                {step.label}
              </span>
            </div>
          ))}

          {isError && (
            <div className="mt-2 text-[11px] text-red-400/80 bg-red-500/5 border border-red-500/10 rounded px-2.5 py-2">
              {createStep.message}
            </div>
          )}
        </div>

        {/* Done: auto-connect button */}
        {isDone && (
          <button
            onClick={() => handleSelect({ type: 'local', key: createStep.key, account: createStep.account })}
            className="w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-colors"
          >
            Connect Wallet
          </button>
        )}

        {/* Error: retry */}
        {isError && (
          <button
            onClick={handleQuickCreate}
            className="w-full px-4 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-xs font-medium rounded-lg transition-colors"
          >
            Retry
          </button>
        )}

        {/* Advanced link */}
        {onOpenKeyManager && (
          <button
            onClick={() => { onOpenKeyManager(); onClose(); }}
            className="text-[11px] text-zinc-500 hover:text-zinc-400 transition-colors flex items-center gap-1"
          >
            <Settings2 className="w-3 h-3" />
            Advanced
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative flex w-[540px] max-w-[95vw] max-h-[80vh] rounded-xl overflow-hidden border border-zinc-700/80 shadow-2xl shadow-black/50">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* -- Left Panel -- */}
        <div className="w-[220px] flex-shrink-0 bg-zinc-900 border-r border-zinc-700/80 flex flex-col overflow-y-auto">
          <div className="px-4 pt-4 pb-2">
            <h3 className="text-sm font-semibold text-zinc-200">Connect Wallet</h3>
            <p className="text-[10px] text-zinc-500 mt-0.5">Choose a wallet to sign transactions</p>
          </div>

          {/* Local Wallet group */}
          <div className="px-2 pb-1">
            <div className="px-2 py-1.5 text-[10px] text-zinc-500 uppercase tracking-wider font-medium">
              Local Wallet
            </div>
            {hasLocalKeys ? (
              // Show existing local key accounts
              localEntries.map((entry) => {
                const colors = colorsFromAddress(entry.account.flowAddress);
                const isHovered = hovered && hovered !== 'fcl' && hovered !== 'local-wallet' &&
                  hovered.key.id === entry.key.id &&
                  hovered.account.flowAddress === entry.account.flowAddress &&
                  hovered.account.keyIndex === entry.account.keyIndex;
                return (
                  <button
                    key={`${entry.key.id}-${entry.account.flowAddress}-${entry.account.keyIndex}`}
                    onClick={() => handleSelect({ type: 'local', key: entry.key, account: entry.account })}
                    onMouseEnter={() => setHovered(entry)}
                    className={`w-full flex items-center gap-2 px-2 py-2 text-xs rounded-lg transition-colors ${
                      isHovered ? 'bg-zinc-700/80 text-emerald-400' : 'text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    <Avatar size={20} name={`0x${entry.account.flowAddress}`} variant="beam" colors={colors} />
                    <div className="flex flex-col items-start min-w-0">
                      <span className="truncate text-xs">{entry.key.label || 'Key'}</span>
                      <span className="text-[10px] text-zinc-500 truncate">
                        {truncateAddress(entry.account.flowAddress)}
                      </span>
                    </div>
                  </button>
                );
              })
            ) : (
              // No local keys — show a single "Local Wallet" item
              <button
                onClick={() => setHovered('local-wallet')}
                onMouseEnter={() => setHovered('local-wallet')}
                className={`w-full flex items-center gap-2 px-2 py-2 text-xs rounded-lg transition-colors ${
                  hovered === 'local-wallet' ? 'bg-zinc-700/80 text-emerald-400' : 'text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                <div className="w-5 h-5 rounded-full bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                  <Key className="w-3 h-3 text-emerald-400" />
                </div>
                <span>Local Wallet</span>
              </button>
            )}
          </div>

          {/* FCL Wallet group */}
          <div className="px-2 pb-1">
            <div className="px-2 py-1.5 text-[10px] text-zinc-500 uppercase tracking-wider font-medium">
              External Wallet
            </div>
            <button
              onClick={handleFclConnect}
              onMouseEnter={() => setHovered('fcl')}
              className={`w-full flex items-center gap-2 px-2 py-2 text-xs rounded-lg transition-colors ${
                hovered === 'fcl' ? 'bg-zinc-700/80 text-emerald-400' : 'text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              <div className="w-5 h-5 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0">
                <FlowLogo size={20} />
              </div>
              <span>FCL Wallet</span>
            </button>
          </div>

          {/* Divider + actions */}
          <div className="mt-auto border-t border-zinc-700/80 px-2 py-2 space-y-0.5">
            {/* Auto Sign toggle */}
            <button
              onClick={() => onToggleAutoSign(!autoSign)}
              className="w-full flex items-center justify-between px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 rounded-lg transition-colors"
            >
              <div className="flex items-center gap-2">
                <Zap className={`w-3.5 h-3.5 ${autoSign ? 'text-amber-400' : ''}`} />
                <span>Auto Sign</span>
              </div>
              <div
                className={`relative w-7 h-4 rounded-full transition-colors ${
                  autoSign ? 'bg-amber-500' : 'bg-zinc-600'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                    autoSign ? 'translate-x-3' : ''
                  }`}
                />
              </div>
            </button>

            {/* Manage Keys */}
            {onOpenKeyManager && (
              <button
                onClick={() => { onOpenKeyManager(); onClose(); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 rounded-lg transition-colors"
              >
                <Key className="w-3.5 h-3.5" />
                Manage Keys
              </button>
            )}

            {/* Testnet faucet */}
            {network === 'testnet' && (
              <a
                href="https://faucet.flow.com/fund-account"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-blue-400 hover:bg-zinc-800 rounded-lg transition-colors"
                onClick={onClose}
              >
                <Droplets className="w-3.5 h-3.5" />
                Testnet Faucet
                <ExternalLink className="w-3 h-3 ml-auto opacity-50" />
              </a>
            )}
          </div>
        </div>

        {/* -- Right Panel -- */}
        <div className="flex-1 bg-[#1a1a1e] flex flex-col items-center justify-center p-6 min-h-[360px]">
          {/* Creating in progress — show progress steps */}
          {createStep ? renderCreateProgress() :

          hovered && hovered !== 'fcl' && hovered !== 'local-wallet' ? (
            // Show selected local key details
            <div className="flex flex-col items-center gap-4 animate-in fade-in duration-150">
              <Avatar
                size={64}
                name={`0x${hovered.account.flowAddress}`}
                variant="beam"
                colors={colorsFromAddress(hovered.account.flowAddress)}
              />
              <div className="text-center">
                <div className="text-sm font-medium text-zinc-200">
                  {hovered.key.label || 'Local Wallet'}
                </div>
                <div className="text-xs text-zinc-500 mt-1 font-mono">
                  0x{hovered.account.flowAddress}
                </div>
                <div className="text-[10px] text-zinc-600 mt-0.5">
                  Key Index: {hovered.account.keyIndex}
                </div>
              </div>
              {balance !== null ? (
                <div className="flex items-center gap-2 bg-zinc-800/80 px-3 py-1.5 rounded-full">
                  <span className="text-xs text-emerald-400 font-medium">{balance} FLOW</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-zinc-800/80 px-3 py-1.5 rounded-full">
                  <span className="text-xs text-zinc-500">Loading balance...</span>
                </div>
              )}
              <button
                onClick={() => handleSelect({ type: 'local', key: hovered.key, account: hovered.account })}
                className="mt-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-colors"
              >
                Connect
              </button>
            </div>
          ) : hovered === 'local-wallet' ? (
            // No local keys — show Create / Import options
            <div className="flex flex-col items-center gap-5 max-w-[260px] animate-in fade-in duration-150">
              <div className="w-14 h-14 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <Key className="w-7 h-7 text-emerald-400" />
              </div>
              <div className="text-center">
                <div className="text-sm font-medium text-zinc-200">Local Wallet</div>
                <div className="text-xs text-zinc-500 mt-1.5 leading-relaxed">
                  Browser-side keys. Auto-sign. Great for playing.
                </div>
              </div>
              <div className="w-full space-y-2">
                <button
                  onClick={handleQuickCreate}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create New Wallet
                </button>
                <button
                  onClick={() => { if (onOpenKeyManager) { onOpenKeyManager('import'); onClose(); } }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded-lg border border-zinc-700 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Import Existing Key
                </button>
              </div>
              {/* Advanced link */}
              {onOpenKeyManager && (
                <button
                  onClick={() => { onOpenKeyManager(); onClose(); }}
                  className="text-[11px] text-zinc-500 hover:text-zinc-400 transition-colors flex items-center gap-1"
                >
                  <Settings2 className="w-3 h-3" />
                  Advanced
                </button>
              )}
            </div>
          ) : hovered === 'fcl' ? (
            // Show FCL / FCL Wallet info
            <div className="flex flex-col items-center gap-4 animate-in fade-in duration-150">
              <div className="w-16 h-16 rounded-2xl overflow-hidden flex items-center justify-center">
                <FlowLogo size={64} />
              </div>
              <div className="text-center">
                <div className="text-sm font-medium text-zinc-200">FCL Wallet</div>
                <div className="text-xs text-zinc-500 mt-1 max-w-[220px] leading-relaxed">
                  Connect an external wallet like FCL Wallet, Lilico, or any FCL-compatible wallet.
                </div>
              </div>
              <button
                onClick={handleFclConnect}
                className="mt-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-colors"
              >
                Connect Wallet
              </button>
            </div>
          ) : (
            // Default welcome state
            <div className="flex flex-col items-center gap-5 max-w-[260px] text-center">
              <div className="w-12 h-12 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center">
                <Wallet className="w-6 h-6 text-zinc-400" />
              </div>
              <div>
                <h4 className="text-sm font-medium text-zinc-200">Get Started</h4>
                <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
                  Select a wallet on the left to sign and submit transactions on Flow.
                </p>
              </div>
              <div className="w-full space-y-3 text-left">
                <div className="flex items-start gap-2.5">
                  <Key className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="text-xs text-zinc-300 font-medium">Local Wallet</div>
                    <div className="text-[10px] text-zinc-500 leading-relaxed">
                      Browser-side keys. Auto-sign. Great for playing.
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="w-4 h-4 mt-0.5 flex-shrink-0"><FlowLogo size={16} /></div>
                  <div>
                    <div className="text-xs text-zinc-300 font-medium">FCL Wallet</div>
                    <div className="text-[10px] text-zinc-500 leading-relaxed">
                      External wallet like Lilico or FCL Wallet.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

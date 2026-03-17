import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  ShieldCheck,
  Wallet,
  KeyRound,
  Check,
  Copy,
  ExternalLink,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { randomWalletName } from './wallet-names';
import type { ProvisionState, ProvisionStatus } from './types';

/** Derive 5 colors from an address for the CSS avatar gradient. */
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

/** Simple CSS-based avatar — radial gradient derived from address colors. */
function AddressAvatar({ address, size = 20 }: { address: string; size?: number }) {
  const colors = colorsFromAddress(address);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle at 30% 30%, ${colors[0]}, ${colors[1]} 40%, ${colors[2]} 70%, ${colors[3]})`,
        boxShadow: `0 0 0 1px ${colors[4]}33`,
      }}
    />
  );
}

function truncateKey(hex: string) {
  if (hex.length <= 16) return hex;
  return `${hex.slice(0, 8)}...${hex.slice(-8)}`;
}

function truncateAddress(addr: string) {
  return `0x${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

type ModalState = 'pitch' | 'creating' | 'status';

export interface PasskeyOnboardingModalProps {
  open: boolean;
  email?: string;
  onCreatePasskey: (walletName: string) => Promise<{ credentialId: string; publicKeySec1Hex: string }>;
  onProvisionAccounts: (credentialId: string) => Promise<{
    networks: Record<string, { txId?: string; address?: string; error?: string }>;
    publicKeySec1Hex: string;
  }>;
  onPollTx: (txId: string, network: 'mainnet' | 'testnet') => Promise<string>;
  onSaveAddress: (credentialId: string, network: 'mainnet' | 'testnet', address: string) => Promise<void>;
  onDone: () => void;
  onSkip: () => void;
  onDontShowAgain: () => void;
}

export default function PasskeyOnboardingModal({
  open,
  email,
  onCreatePasskey,
  onProvisionAccounts,
  onPollTx,
  onSaveAddress,
  onDone,
  onSkip,
  onDontShowAgain,
}: PasskeyOnboardingModalProps) {
  const [dontShow, setDontShow] = useState(false);
  const [state, setState] = useState<ModalState>('pitch');
  const [error, setError] = useState<string | null>(null);
  const [credentialId, setCredentialId] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [provision, setProvision] = useState<ProvisionState>({
    mainnet: { status: 'idle' },
    testnet: { status: 'idle' },
  });
  const [copied, setCopied] = useState(false);
  const [walletName, setWalletName] = useState(randomWalletName);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setState('pitch');
      setError(null);
      setCredentialId(null);
      setPublicKey(null);
      setProvision({ mainnet: { status: 'idle' }, testnet: { status: 'idle' } });
      setCopied(false);
      setDontShow(false);
      setWalletName(randomWalletName());
    }
  }, [open]);

  const handleCreate = useCallback(async () => {
    setError(null);
    setState('creating');
    try {
      const result = await onCreatePasskey(walletName.trim() || 'Wallet');
      setCredentialId(result.credentialId);
      setPublicKey(result.publicKeySec1Hex);
      setState('status');

      // Auto-fire provisioning
      setProvision({
        mainnet: { status: 'pending' },
        testnet: { status: 'pending' },
      });

      try {
        const provResult = await onProvisionAccounts(result.credentialId);

        // Process each network
        for (const network of ['mainnet', 'testnet'] as const) {
          const net = provResult.networks[network];
          if (!net) {
            setProvision(p => ({ ...p, [network]: { status: 'error', error: 'No response' } }));
            continue;
          }
          if (net.address) {
            setProvision(p => ({ ...p, [network]: { status: 'sealed', address: net.address } }));
            continue;
          }
          if (net.error) {
            setProvision(p => ({ ...p, [network]: { status: 'error', error: net.error } }));
            continue;
          }
          if (net.txId) {
            setProvision(p => ({ ...p, [network]: { status: 'polling', txId: net.txId } }));
            // Start polling in background
            onPollTx(net.txId, network)
              .then(async (address) => {
                setProvision(p => ({ ...p, [network]: { status: 'sealed', txId: net.txId, address } }));
                await onSaveAddress(result.credentialId, network, address).catch(() => {});
              })
              .catch((e) => {
                setProvision(p => ({
                  ...p,
                  [network]: { status: 'error', txId: net.txId, error: e instanceof Error ? e.message : 'Polling failed' },
                }));
              });
          }
        }
      } catch (e) {
        setProvision({
          mainnet: { status: 'error', error: e instanceof Error ? e.message : 'Provision failed' },
          testnet: { status: 'error', error: e instanceof Error ? e.message : 'Provision failed' },
        });
      }
    } catch (err) {
      // Check for user cancellation
      if (err && typeof err === 'object' && 'code' in err) {
        const code = (err as { code: string }).code;
        if (code === 'USER_CANCELLED' || code === 'REQUEST_ABORTED') {
          setState('pitch');
          return;
        }
      }
      setError(err instanceof Error ? err.message : 'Failed to create passkey');
      setState('pitch');
    }
  }, [walletName, onCreatePasskey, onProvisionAccounts, onPollTx, onSaveAddress]);

  function handleSkip() {
    if (dontShow) {
      onDontShowAgain();
    } else {
      onSkip();
    }
  }

  function handleCopyKey() {
    if (!publicKey) return;
    navigator.clipboard.writeText(publicKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const allDone = provision.mainnet.status === 'sealed' && provision.testnet.status === 'sealed';
  const anyError = provision.mainnet.status === 'error' || provision.testnet.status === 'error';

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={state === 'pitch' ? handleSkip : undefined} />

      <div className="relative z-10 w-full max-w-[460px] mx-4 border border-zinc-700 bg-zinc-900 rounded-lg shadow-2xl overflow-hidden">
        <AnimatePresence mode="wait">
          {state === 'pitch' && (
            <motion.div
              key="pitch"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              <div className="px-6 pt-6 pb-5 border-b border-zinc-800">
                <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-mono">Recommended</div>
                <h2 className="mt-1.5 text-base font-semibold text-white">Create your Passkey Wallet</h2>
                <p className="mt-1 text-xs text-zinc-500">
                  {email ? `Bind passkey to ${email}` : 'Bind passkey to your account'} and use one touch to sign in and sign Flow transactions.
                </p>
              </div>

              <div className="px-6 py-5 space-y-3 text-xs">
                <div className="flex items-start gap-2.5 text-zinc-300">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium">Self-custody security</div>
                    <div className="text-zinc-500 mt-0.5">Your private key stays on your device/iCloud keychain.</div>
                  </div>
                </div>
                <div className="flex items-start gap-2.5 text-zinc-300">
                  <Wallet className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium">Automatic Flow wallet</div>
                    <div className="text-zinc-500 mt-0.5">Mainnet + testnet accounts created automatically.</div>
                  </div>
                </div>
                <div className="flex items-start gap-2.5 text-zinc-300">
                  <KeyRound className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium">Passwordless sign-in</div>
                    <div className="text-zinc-500 mt-0.5">Use passkey across devices and browsers where your keychain syncs.</div>
                  </div>
                </div>
              </div>

              {/* Wallet name input */}
              <div className="px-6 pb-4">
                <label className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider block mb-1.5">
                  Wallet Name
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={walletName}
                    onChange={(e) => setWalletName(e.target.value)}
                    placeholder="My Wallet"
                    className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-xs font-mono placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50 transition-colors"
                  />
                  <button
                    onClick={() => setWalletName(randomWalletName())}
                    className="p-2 text-zinc-500 hover:text-emerald-400 border border-zinc-700 rounded-lg transition-colors"
                    title="Random name"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {error && (
                <div className="mx-6 mb-4 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-[11px] font-mono">
                  {error}
                </div>
              )}

              <div className="px-6 pb-4 flex items-center gap-2">
                <button
                  onClick={handleSkip}
                  className="flex-1 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium border border-zinc-700 rounded-lg transition-colors"
                >
                  Not now
                </button>
                <button
                  onClick={handleCreate}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  Create Passkey Wallet
                </button>
              </div>

              <div className="px-6 pb-5">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={dontShow}
                    onChange={(e) => setDontShow(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500/20 focus:ring-offset-0 cursor-pointer"
                  />
                  <span className="text-[11px] text-zinc-500 group-hover:text-zinc-400 transition-colors select-none">
                    Don't show this again
                  </span>
                </label>
              </div>
            </motion.div>
          )}

          {state === 'creating' && (
            <motion.div
              key="creating"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="px-6 py-12 flex flex-col items-center gap-3"
            >
              <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
              <p className="text-sm text-zinc-300">Creating passkey...</p>
              <p className="text-[11px] text-zinc-500">Follow the prompt on your device</p>
            </motion.div>
          )}

          {state === 'status' && (
            <motion.div
              key="status"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25 }}
            >
              {/* Passkey success */}
              <div className="px-6 pt-6 pb-4 border-b border-zinc-800">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <Check className="w-3 h-3 text-emerald-400" />
                  </div>
                  <span className="text-xs font-semibold text-white">Passkey Created</span>
                </div>
                {publicKey && (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md font-mono text-[11px] text-zinc-400 truncate">
                      {truncateKey(publicKey)}
                    </div>
                    <button
                      onClick={handleCopyKey}
                      className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors"
                      title="Copy public key"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                )}
              </div>

              {/* Network provisioning status */}
              <div className="px-6 py-4 space-y-3">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono">Flow Accounts</div>

                <NetworkRow
                  label="Mainnet"
                  status={provision.mainnet}
                />
                <NetworkRow
                  label="Testnet"
                  status={provision.testnet}
                />
              </div>

              {/* Actions */}
              <div className="px-6 pb-6">
                {allDone ? (
                  <button
                    onClick={onDone}
                    className="w-full px-3 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors"
                  >
                    Done
                  </button>
                ) : anyError ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={onDone}
                      className="flex-1 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-medium border border-zinc-700 rounded-lg transition-colors"
                    >
                      Close
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2 text-zinc-500 text-[11px] font-mono">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Creating accounts...
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function NetworkRow({ label, status }: {
  label: string;
  status: ProvisionStatus;
}) {
  const explorerBase = label === 'Testnet'
    ? 'https://testnet.flowindex.io/account/'
    : 'https://flowindex.io/account/';

  return (
    <div className="flex items-center gap-3 py-2 px-3 bg-zinc-800/50 border border-zinc-700/50 rounded-lg">
      <div className="w-5 h-5 flex items-center justify-center shrink-0">
        {status.status === 'sealed' && status.address ? (
          <AddressAvatar address={status.address} size={20} />
        ) : status.status === 'error' ? (
          <AlertCircle className="w-4 h-4 text-red-400" />
        ) : (
          <Loader2 className="w-4 h-4 text-zinc-500 animate-spin" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium text-zinc-300">{label}</div>
        {status.status === 'sealed' && status.address ? (
          <a
            href={`${explorerBase}0x${status.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-mono text-emerald-400 hover:text-emerald-300 transition-colors inline-flex items-center gap-1"
          >
            {truncateAddress(status.address)}
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        ) : status.status === 'error' ? (
          <div className="text-[11px] text-red-400 font-mono truncate">{status.error}</div>
        ) : status.status === 'pending' ? (
          <div className="text-[11px] text-zinc-500 font-mono">Requesting...</div>
        ) : status.status === 'polling' ? (
          <div className="text-[11px] text-zinc-500 font-mono">Waiting for confirmation...</div>
        ) : (
          <div className="text-[11px] text-zinc-600 font-mono">Waiting...</div>
        )}
      </div>

      {status.status === 'sealed' && (
        <Check className="w-4 h-4 text-emerald-400 shrink-0" />
      )}
    </div>
  );
}

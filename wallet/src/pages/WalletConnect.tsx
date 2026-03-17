import { useCallback, useEffect, useRef, useState } from 'react';
import { Link2, Link2Off, Clipboard, Trash2, Loader2, CheckCircle2, XCircle, Wifi } from 'lucide-react';
import { cn } from '@flowindex/flow-ui';
import { useWallet } from '@/hooks/useWallet';
import { createWalletConnectManager, type WalletConnectManager } from '@flowindex/evm-wallet';

const WC_PROJECT_ID = import.meta.env.VITE_WC_PROJECT_ID || '39d7c0c723726953bc312950113463b4';

interface SessionInfo {
  topic: string;
  peerName: string;
  peerUrl: string;
  peerIcon?: string;
  chains: string[];
}

function parseSessions(raw: Record<string, any>): SessionInfo[] {
  return Object.entries(raw).map(([topic, s]) => ({
    topic,
    peerName: s.peer?.metadata?.name ?? 'Unknown dApp',
    peerUrl: s.peer?.metadata?.url ?? '',
    peerIcon: s.peer?.metadata?.icons?.[0],
    chains: Object.values(s.namespaces ?? {}).flatMap((ns: any) => ns.chains ?? []),
  }));
}

export default function WalletConnectPage() {
  const { evmAddress, evmProvider } = useWallet();

  const [uri, setUri] = useState('');
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [pairSuccess, setPairSuccess] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [initError, setInitError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(false);

  const managerRef = useRef<WalletConnectManager | null>(null);

  // Refresh sessions from the manager
  const refreshSessions = useCallback(() => {
    if (!managerRef.current) return;
    const raw = managerRef.current.getActiveSessions();
    setSessions(parseSessions(raw));
  }, []);

  // Initialize WalletConnect manager when EVM provider is ready
  useEffect(() => {
    if (!evmProvider || !evmAddress || managerRef.current) return;

    let cancelled = false;
    setInitializing(true);
    setInitError(null);

    createWalletConnectManager({
      projectId: WC_PROJECT_ID,
      provider: evmProvider,
      smartWalletAddress: evmAddress as `0x${string}`,
      chainId: 545, // Flow-EVM testnet
    })
      .then((mgr) => {
        if (cancelled) return;
        managerRef.current = mgr;
        setInitializing(false);
        // Refresh sessions after init
        const raw = mgr.getActiveSessions();
        setSessions(parseSessions(raw));
      })
      .catch((err) => {
        if (cancelled) return;
        setInitError(err.message ?? 'Failed to init WalletConnect');
        setInitializing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [evmProvider, evmAddress]);

  // Poll sessions every 3s while manager is alive
  useEffect(() => {
    if (!managerRef.current) return;
    const interval = setInterval(refreshSessions, 3000);
    return () => clearInterval(interval);
  }, [refreshSessions, initializing]);

  const handlePair = useCallback(async () => {
    const trimmed = uri.trim();
    if (!trimmed || !managerRef.current) return;

    setPairing(true);
    setPairError(null);
    setPairSuccess(false);

    try {
      await managerRef.current.pair(trimmed);
      setPairSuccess(true);
      setUri('');
      // Wait a moment for session to be established
      setTimeout(refreshSessions, 1500);
    } catch (err: any) {
      setPairError(err.message ?? 'Failed to pair');
    } finally {
      setPairing(false);
    }
  }, [uri, refreshSessions]);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.startsWith('wc:')) {
        setUri(text);
      } else {
        setUri(text);
      }
    } catch {
      // Clipboard API not available
    }
  }, []);

  const handleDisconnect = useCallback(async (topic: string) => {
    if (!managerRef.current) return;
    try {
      await managerRef.current.disconnect(topic);
      refreshSessions();
    } catch {
      // ignore
    }
  }, [refreshSessions]);

  // No EVM address yet
  if (!evmAddress) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="w-16 h-16 rounded-2xl bg-wallet-surface flex items-center justify-center mb-5">
          <Link2Off className="w-8 h-8 text-wallet-muted" />
        </div>
        <h2 className="text-xl font-semibold text-white mb-2">EVM Wallet Required</h2>
        <p className="text-sm text-wallet-muted max-w-xs">
          Your EVM smart wallet address must be computed first. Go back to the dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">WalletConnect</h1>
        <p className="text-sm text-wallet-muted mt-1">
          Connect to external dApps by pasting a WalletConnect URI
        </p>
      </div>

      {/* Init status */}
      {initializing && (
        <div className="flex items-center gap-2 text-sm text-wallet-muted">
          <Loader2 className="w-4 h-4 animate-spin" />
          Initializing WalletConnect...
        </div>
      )}
      {initError && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {initError}
        </div>
      )}

      {/* Pair input */}
      {!initializing && !initError && (
        <div className="space-y-3">
          <label className="text-sm font-medium text-wallet-muted">WalletConnect URI</label>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={uri}
                onChange={(e) => {
                  setUri(e.target.value);
                  setPairError(null);
                  setPairSuccess(false);
                }}
                placeholder="wc:a1b2c3d4..."
                className="w-full px-4 py-3 rounded-xl bg-wallet-surface border border-wallet-border text-white text-sm placeholder:text-wallet-muted/50 focus:outline-none focus:ring-2 focus:ring-wallet-accent/50 focus:border-wallet-accent/50"
              />
              <button
                onClick={handlePaste}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg hover:bg-wallet-surface-hover text-wallet-muted hover:text-white transition-colors"
                title="Paste from clipboard"
              >
                <Clipboard className="w-4 h-4" />
              </button>
            </div>
            <button
              onClick={handlePair}
              disabled={!uri.trim() || pairing || !managerRef.current}
              className={cn(
                'px-5 py-3 rounded-xl font-medium text-sm transition-all',
                uri.trim() && !pairing && managerRef.current
                  ? 'bg-wallet-accent text-black hover:bg-wallet-accent/90'
                  : 'bg-wallet-surface text-wallet-muted cursor-not-allowed',
              )}
            >
              {pairing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Link2 className="w-4 h-4" />
              )}
            </button>
          </div>

          {pairError && (
            <div className="flex items-center gap-2 text-sm text-red-400">
              <XCircle className="w-4 h-4 flex-shrink-0" />
              {pairError}
            </div>
          )}
          {pairSuccess && (
            <div className="flex items-center gap-2 text-sm text-green-400">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              Paired successfully! Session should appear below.
            </div>
          )}
        </div>
      )}

      {/* Connected wallet info */}
      <div className="p-3 rounded-xl bg-wallet-surface border border-wallet-border">
        <div className="flex items-center gap-2 text-xs text-wallet-muted mb-1">
          <Wifi className="w-3 h-3" />
          Connected as
        </div>
        <p className="text-sm font-mono text-white break-all">{evmAddress}</p>
        <p className="text-xs text-wallet-muted mt-1">Flow-EVM Testnet (chain 545)</p>
      </div>

      {/* Active Sessions */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-wallet-muted uppercase tracking-wider">
          Active Sessions ({sessions.length})
        </h2>

        {sessions.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center">
            <div className="w-12 h-12 rounded-xl bg-wallet-surface flex items-center justify-center mb-3">
              <Link2Off className="w-6 h-6 text-wallet-muted" />
            </div>
            <p className="text-sm text-wallet-muted">No active sessions</p>
            <p className="text-xs text-wallet-muted/70 mt-1">
              Paste a WC URI from a dApp to connect
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => (
              <div
                key={session.topic}
                className="flex items-center gap-3 p-3 rounded-xl bg-wallet-surface border border-wallet-border"
              >
                {session.peerIcon ? (
                  <img
                    src={session.peerIcon}
                    alt=""
                    className="w-10 h-10 rounded-xl bg-wallet-surface-hover"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-wallet-accent/15 flex items-center justify-center">
                    <Link2 className="w-5 h-5 text-wallet-accent" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{session.peerName}</p>
                  <p className="text-xs text-wallet-muted truncate">{session.peerUrl}</p>
                </div>
                <button
                  onClick={() => handleDisconnect(session.topic)}
                  className="p-2 rounded-lg hover:bg-red-500/15 text-wallet-muted hover:text-red-400 transition-colors"
                  title="Disconnect"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Capabilities note */}
      <div className="p-3 rounded-xl bg-yellow-500/5 border border-yellow-500/15 text-xs text-yellow-400/80 space-y-1">
        <p className="font-medium">Supported RPC methods:</p>
        <ul className="list-disc list-inside space-y-0.5 text-yellow-400/60">
          <li>eth_sendTransaction (via ERC-4337 UserOp)</li>
          <li>eth_accounts, eth_chainId</li>
          <li>Read-only methods (eth_call, eth_getBalance, etc.)</li>
        </ul>
        <p className="text-yellow-400/50 mt-1">
          personal_sign and eth_signTypedData_v4 require wallet deployment first (send a tx).
        </p>
      </div>
    </div>
  );
}

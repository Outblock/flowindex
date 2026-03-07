import { useEffect, useState, useCallback } from 'react';
import * as fcl from '@onflow/fcl';

// Configure FCL to use this wallet's authn endpoint
fcl.config()
  .put('flow.network', 'mainnet')
  .put('accessNode.api', 'https://rest-mainnet.onflow.org')
  .put('discovery.wallet', `${window.location.origin}/authn`)
  .put('discovery.wallet.method', 'POP/RPC');

interface UserSnapshot {
  addr: string | null;
  loggedIn: boolean | null;
}

interface TxStatus {
  txId: string;
  status: number;
  statusString: string;
  errorMessage: string;
}

const STATUS_LABELS: Record<number, string> = {
  0: 'Unknown',
  1: 'Pending',
  2: 'Finalized',
  3: 'Executed',
  4: 'Sealed',
  5: 'Expired',
};

export default function TestHost() {
  const [currentUser, setCurrentUser] = useState<UserSnapshot>({ addr: null, loggedIn: null });
  const [txStatus, setTxStatus] = useState<TxStatus | null>(null);
  const [txLoading, setTxLoading] = useState(false);
  const [signResult, setSignResult] = useState<string | null>(null);
  const [signLoading, setSignLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = fcl.currentUser.subscribe((user: UserSnapshot) => {
      setCurrentUser(user);
    });
    return () => { unsub(); };
  }, []);

  const handleConnect = useCallback(async () => {
    setError(null);
    try {
      await fcl.authenticate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    }
  }, []);

  const handleDisconnect = useCallback(() => {
    fcl.unauthenticate();
    setTxStatus(null);
    setSignResult(null);
    setError(null);
  }, []);

  const handleSendTx = useCallback(async () => {
    setError(null);
    setTxStatus(null);
    setTxLoading(true);
    try {
      const txId = await fcl.mutate({
        cadence: `
          transaction {
            prepare(acct: &Account) {
              log("FlowIndex wallet test transaction")
            }
          }
        `,
        limit: 100,
      });

      setTxStatus({ txId, status: 0, statusString: 'Submitted', errorMessage: '' });

      // Subscribe to transaction status updates
      fcl.tx(txId).subscribe((status: TxStatus) => {
        setTxStatus({
          txId,
          status: status.status,
          statusString: STATUS_LABELS[status.status] ?? `Status ${status.status}`,
          errorMessage: status.errorMessage ?? '',
        });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setTxLoading(false);
    }
  }, []);

  const handleSignMessage = useCallback(async () => {
    setError(null);
    setSignResult(null);
    setSignLoading(true);
    try {
      const MSG = Buffer.from('FlowIndex test message').toString('hex');
      const sigs = await fcl.currentUser.signUserMessage(MSG);
      setSignResult(JSON.stringify(sigs, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Message signing failed');
    } finally {
      setSignLoading(false);
    }
  }, []);

  const isConnected = currentUser.loggedIn === true && !!currentUser.addr;

  return (
    <div className="min-h-screen bg-nothing-dark text-white p-8">
      <div className="max-w-2xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold font-mono text-nothing-green">
            FCL Integration Test
          </h1>
          <p className="text-sm text-zinc-500 font-mono mt-1">
            Development-only page for testing the wallet FCL flow
          </p>
        </div>

        {/* Connection Section */}
        <section className="space-y-3 p-4 rounded-lg border border-zinc-800 bg-zinc-900/50">
          <h2 className="text-sm font-semibold font-mono text-zinc-400 uppercase tracking-wider">
            Connection
          </h2>

          {isConnected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-nothing-green" />
                <span className="text-sm font-mono text-zinc-300">Connected</span>
              </div>
              <div className="px-3 py-2 rounded bg-zinc-800 font-mono text-sm text-nothing-green break-all">
                {currentUser.addr}
              </div>
              <button
                onClick={handleDisconnect}
                className="px-4 py-2 text-sm font-mono rounded border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600 transition-colors"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-zinc-600" />
                <span className="text-sm font-mono text-zinc-500">Not connected</span>
              </div>
              <button
                onClick={handleConnect}
                className="px-4 py-2 text-sm font-mono font-semibold rounded bg-nothing-green text-black hover:bg-nothing-green/90 transition-colors"
              >
                Connect Wallet
              </button>
            </div>
          )}
        </section>

        {/* Transaction Section */}
        {isConnected && (
          <section className="space-y-3 p-4 rounded-lg border border-zinc-800 bg-zinc-900/50">
            <h2 className="text-sm font-semibold font-mono text-zinc-400 uppercase tracking-wider">
              Send Transaction
            </h2>
            <p className="text-xs text-zinc-500 font-mono">
              Sends a no-op transaction that logs a test message.
            </p>
            <button
              onClick={handleSendTx}
              disabled={txLoading}
              className="px-4 py-2 text-sm font-mono font-semibold rounded bg-nothing-green text-black hover:bg-nothing-green/90 transition-colors disabled:opacity-50"
            >
              {txLoading ? 'Submitting...' : 'Send Test Transaction'}
            </button>

            {txStatus && (
              <div className="space-y-2 mt-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-zinc-500">Status:</span>
                  <span className={`text-xs font-mono font-semibold ${
                    txStatus.status === 4 ? 'text-nothing-green' :
                    txStatus.status === 5 ? 'text-red-400' :
                    'text-yellow-400'
                  }`}>
                    {txStatus.statusString}
                  </span>
                </div>
                <div className="px-3 py-2 rounded bg-zinc-800 font-mono text-xs text-zinc-400 break-all">
                  TX: {txStatus.txId}
                </div>
                {txStatus.errorMessage && (
                  <div className="px-3 py-2 rounded bg-red-500/10 border border-red-500/20 font-mono text-xs text-red-400">
                    {txStatus.errorMessage}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* Sign Message Section */}
        {isConnected && (
          <section className="space-y-3 p-4 rounded-lg border border-zinc-800 bg-zinc-900/50">
            <h2 className="text-sm font-semibold font-mono text-zinc-400 uppercase tracking-wider">
              Sign Message
            </h2>
            <p className="text-xs text-zinc-500 font-mono">
              Signs the message "FlowIndex test message" with the connected account.
            </p>
            <button
              onClick={handleSignMessage}
              disabled={signLoading}
              className="px-4 py-2 text-sm font-mono font-semibold rounded bg-nothing-green text-black hover:bg-nothing-green/90 transition-colors disabled:opacity-50"
            >
              {signLoading ? 'Signing...' : 'Sign Message'}
            </button>

            {signResult && (
              <pre className="px-3 py-2 rounded bg-zinc-800 font-mono text-xs text-zinc-400 overflow-x-auto max-h-48 overflow-y-auto">
                {signResult}
              </pre>
            )}
          </section>
        )}

        {/* Error Display */}
        {error && (
          <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 font-mono text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Config Info */}
        <section className="space-y-2 p-4 rounded-lg border border-zinc-800/50 bg-zinc-900/30">
          <h2 className="text-xs font-semibold font-mono text-zinc-600 uppercase tracking-wider">
            FCL Config
          </h2>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs font-mono">
            <span className="text-zinc-600">Network</span>
            <span className="text-zinc-400">mainnet</span>
            <span className="text-zinc-600">Access Node</span>
            <span className="text-zinc-400">https://rest-mainnet.onflow.org</span>
            <span className="text-zinc-600">Discovery</span>
            <span className="text-zinc-400 break-all">{window.location.origin}/authn</span>
            <span className="text-zinc-600">Method</span>
            <span className="text-zinc-400">POP/RPC</span>
          </div>
        </section>
      </div>
    </div>
  );
}

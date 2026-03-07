import { useEffect, useState, useCallback, useMemo } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@flowindex/flow-ui';
import { Loader2, X, ShieldCheck, ChevronDown, ChevronUp, FileCode2 } from 'lucide-react';
import { sendReady, onReadyResponse, approve, decline } from '@/fcl/messaging';
import { useWallet } from '@/hooks/useWallet';
import { encodeMessageFromSignable, signFlowTransaction } from '@flowindex/flow-passkey';
import type { FclSignable, FclCompositeSignature } from '@/fcl/types';

const RP_ID = import.meta.env.VITE_RP_ID || 'flowindex.io';

function formatAddress(addr: string): string {
  if (!addr) return '';
  return addr.startsWith('0x') ? addr : '0x' + addr;
}

export default function Authz() {
  const { activeAccount, loading: walletLoading } = useWallet();

  const [signable, setSignable] = useState<FclSignable | null>(null);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scriptExpanded, setScriptExpanded] = useState(false);

  // On mount: send ready signal and listen for signable
  useEffect(() => {
    sendReady();
    const cleanup = onReadyResponse((data) => {
      const body = data.body as FclSignable | undefined;
      if (body) {
        setSignable(body);
      }
    });
    return cleanup;
  }, []);

  // Parse transaction details from signable
  const txDetails = useMemo(() => {
    if (!signable?.voucher) return null;
    const v = signable.voucher;
    const lines = (v.cadence || '').split('\n');
    return {
      cadence: v.cadence || '',
      cadencePreview: lines.slice(0, 10).join('\n'),
      cadenceLineCount: lines.length,
      hasMoreLines: lines.length > 10,
      payer: formatAddress(v.payer),
      proposer: formatAddress(v.proposalKey.address),
      authorizers: v.authorizers.map(formatAddress),
      computeLimit: v.computeLimit,
      argCount: v.arguments.length,
    };
  }, [signable]);

  const handleApprove = useCallback(async () => {
    if (!signable || !activeAccount) return;

    const address = activeAccount.flowAddress;
    if (!address) {
      setError('Active account has no Flow address');
      return;
    }

    setSigning(true);
    setError(null);

    try {
      // Encode the message based on signer role (payload vs envelope)
      const addrNoPrefix = address.replace(/^0x/, '');
      const messageHex = encodeMessageFromSignable(
        { voucher: signable.voucher },
        addrNoPrefix,
      );

      // Sign with passkey (triggers WebAuthn assertion)
      const result = await signFlowTransaction({
        messageHex,
        credentialId: activeAccount.credentialId,
        rpId: RP_ID,
      });

      // Build FCL composite signature
      const compositeSignature: FclCompositeSignature = {
        f_type: 'CompositeSignature',
        f_vsn: '1.0.0',
        addr: formatAddress(address),
        keyId: 0,
        signature: result.signature,
        extensionData: result.extensionData,
      };

      approve(compositeSignature);
      window.close();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Signing failed';
      // Don't show error for user cancellation — let them retry or decline
      if (message.includes('cancelled') || message.includes('canceled')) {
        setSigning(false);
        return;
      }
      setError(message);
      setSigning(false);
    }
  }, [signable, activeAccount]);

  const handleDecline = useCallback(() => {
    decline('User rejected');
    window.close();
  }, []);

  // Loading state
  if (walletLoading || !signable) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-nothing-dark">
        <Card className="w-full max-w-[440px] mx-4 bg-nothing-dark border-zinc-800">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-nothing-green mb-3" />
            <p className="text-sm text-zinc-500 font-mono">
              {walletLoading ? 'Loading wallet...' : 'Waiting for transaction...'}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // No active account
  if (!activeAccount || !activeAccount.flowAddress) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-nothing-dark">
        <Card className="w-full max-w-[440px] mx-4 bg-nothing-dark border-zinc-800">
          <CardContent className="flex flex-col items-center justify-center py-12 space-y-3">
            <p className="text-sm text-zinc-400 font-mono">No account available for signing</p>
            <Button
              variant="outline"
              onClick={handleDecline}
              className="border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600"
            >
              Close
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-nothing-dark">
      <Card className="w-full max-w-[440px] mx-4 bg-nothing-dark border-zinc-800">
        <CardHeader className="text-center pb-2">
          <div className="flex items-center justify-center gap-2 mb-2">
            <ShieldCheck className="w-5 h-5 text-nothing-green" />
            <CardTitle className="text-base font-semibold text-white">Review Transaction</CardTitle>
          </div>
          <p className="text-xs text-zinc-500 font-mono">
            Signing as {formatAddress(activeAccount.flowAddress)}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs font-mono">
              {error}
            </div>
          )}

          {/* Transaction details */}
          {txDetails && (
            <div className="space-y-2">
              {/* Cadence script */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setScriptExpanded(!scriptExpanded)}
                  className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-zinc-800/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <FileCode2 className="w-3.5 h-3.5 text-zinc-500" />
                    <span className="text-xs font-mono text-zinc-400">
                      Cadence Script ({txDetails.cadenceLineCount} lines)
                    </span>
                  </div>
                  {txDetails.hasMoreLines && (
                    scriptExpanded
                      ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" />
                      : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
                  )}
                </button>
                <div className="px-3 pb-2">
                  <pre className="text-[11px] font-mono text-zinc-300 whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto leading-relaxed">
                    {scriptExpanded ? txDetails.cadence : txDetails.cadencePreview}
                    {!scriptExpanded && txDetails.hasMoreLines && (
                      <span className="text-zinc-600">{'\n'}... ({txDetails.cadenceLineCount - 10} more lines)</span>
                    )}
                  </pre>
                </div>
              </div>

              {/* Details grid */}
              <div className="grid grid-cols-2 gap-2">
                <DetailItem label="Proposer" value={txDetails.proposer} />
                <DetailItem label="Payer" value={txDetails.payer} />
                <DetailItem label="Compute Limit" value={txDetails.computeLimit.toLocaleString()} />
                <DetailItem label="Arguments" value={String(txDetails.argCount)} />
              </div>

              {/* Authorizers */}
              {txDetails.authorizers.length > 0 && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                  <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Authorizers</span>
                  <div className="mt-1 space-y-0.5">
                    {txDetails.authorizers.map((addr, i) => (
                      <p key={i} className="text-xs font-mono text-zinc-300 truncate">{addr}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              onClick={handleDecline}
              disabled={signing}
              className="flex-1 border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600"
            >
              <X className="w-4 h-4 mr-1.5" />
              Decline
            </Button>
            <Button
              onClick={handleApprove}
              disabled={signing}
              className="flex-1 bg-nothing-green hover:bg-nothing-green/90 text-black font-semibold disabled:opacity-50"
            >
              {signing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Signing...
                </>
              ) : (
                'Approve Transaction'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
      <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">{label}</span>
      <p className="text-xs font-mono text-zinc-300 truncate mt-0.5">{value}</p>
    </div>
  );
}

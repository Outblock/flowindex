import { useEffect, useState, useCallback } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@flowindex/flow-ui';
import { Loader2, X, MessageSquare } from 'lucide-react';
import { sendReady, onReadyResponse, approve, decline } from '@/fcl/messaging';
import { useWallet } from '@/hooks/useWallet';
import { signFlowTransaction, bytesToHex } from '@flowindex/flow-passkey';
import type { FclCompositeSignature } from '@/fcl/types';

const RP_ID = import.meta.env.VITE_RP_ID || 'flowindex.io';

// "FLOW-V0.0-user" right-padded with zeros to 32 bytes
const USER_DOMAIN_TAG = (() => {
  const tag = new Uint8Array(32);
  const text = new TextEncoder().encode('FLOW-V0.0-user');
  tag.set(text);
  return bytesToHex(tag);
})();

function formatAddress(addr: string): string {
  if (!addr) return '';
  return addr.startsWith('0x') ? addr : '0x' + addr;
}

/** Try to decode a hex string as UTF-8 text; return null on failure. */
function tryDecodeHex(hex: string): string | null {
  try {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (clean.length === 0 || clean.length % 2 !== 0) return null;
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
      bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
    }
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    // Only show as text if it looks like printable content
    if (/[\x00-\x08\x0e-\x1f]/.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export default function SignMessage() {
  const { activeAccount, loading: walletLoading } = useWallet();

  const [messageHex, setMessageHex] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On mount: send ready signal and listen for message
  useEffect(() => {
    sendReady();
    const cleanup = onReadyResponse((data) => {
      const body = data.body as { message?: string } | undefined;
      if (body?.message) {
        setMessageHex(body.message);
      }
    });
    return cleanup;
  }, []);

  const decodedText = messageHex ? tryDecodeHex(messageHex) : null;

  const handleSign = useCallback(async () => {
    if (!messageHex || !activeAccount) return;

    const address = activeAccount.flowAddress;
    if (!address) {
      setError('Active account has no Flow address');
      return;
    }

    setSigning(true);
    setError(null);

    try {
      // Full message = user domain tag + original message hex
      const cleanHex = messageHex.startsWith('0x') ? messageHex.slice(2) : messageHex;
      const fullMessageHex = USER_DOMAIN_TAG + cleanHex;

      // Sign with passkey (SHA-256 hash + WebAuthn assertion + FLIP-264)
      const result = await signFlowTransaction({
        messageHex: fullMessageHex,
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
      if (message.includes('cancelled') || message.includes('canceled')) {
        setSigning(false);
        return;
      }
      setError(message);
      setSigning(false);
    }
  }, [messageHex, activeAccount]);

  const handleDecline = useCallback(() => {
    decline('User rejected');
    window.close();
  }, []);

  // Loading state
  if (walletLoading || !messageHex) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-nothing-dark">
        <Card className="w-full max-w-[440px] mx-4 bg-nothing-dark border-zinc-800">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-nothing-green mb-3" />
            <p className="text-sm text-zinc-500 font-mono">
              {walletLoading ? 'Loading wallet...' : 'Waiting for message...'}
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
            <MessageSquare className="w-5 h-5 text-nothing-green" />
            <CardTitle className="text-base font-semibold text-white">Sign Message</CardTitle>
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

          {/* Message content */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
            <div className="px-3 py-2">
              <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
                {decodedText ? 'Message' : 'Message (hex)'}
              </span>
              <pre className="mt-1 text-xs font-mono text-zinc-300 whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto leading-relaxed">
                {decodedText ?? messageHex}
              </pre>
            </div>
          </div>

          {/* Show raw hex if we decoded text */}
          {decodedText && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
              <div className="px-3 py-2">
                <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Raw Hex</span>
                <pre className="mt-1 text-[11px] font-mono text-zinc-500 whitespace-pre-wrap break-all max-h-[80px] overflow-y-auto leading-relaxed">
                  {messageHex}
                </pre>
              </div>
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
              onClick={handleSign}
              disabled={signing}
              className="flex-1 bg-nothing-green hover:bg-nothing-green/90 text-black font-semibold disabled:opacity-50"
            >
              {signing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Signing...
                </>
              ) : (
                'Sign Message'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

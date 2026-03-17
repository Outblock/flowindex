import { useCallback, useEffect, useState } from 'react';
import { useAuth, LoginModal } from '@flowindex/auth-ui';
import { cn, formatShort } from '@flowindex/flow-ui';
import { Check, Loader2, Wallet, X, Shield } from 'lucide-react';
import { useWallet } from '@/hooks/useWallet';
import type { PasskeyAccount } from '@flowindex/auth-core';

/**
 * Popup endpoint for external dApps.
 * Opened by @flowindex/wallet-sdk, communicates via postMessage.
 *
 * Protocol:
 *   Parent → Popup:  { type: 'flowindex_rpc_request', id, method, params }
 *   Popup → Parent:  { type: 'flowindex_rpc_response', id, result } | { ..., error }
 *   Popup → Parent:  { type: 'flowindex_connected', address, chainId }
 *   Popup → Parent:  { type: 'flowindex_disconnected' }
 */

const CHAIN_ID = 545; // Flow-EVM testnet

// Detect if opened by Chrome extension (no window.opener, has chrome.runtime)
const isExtension = !window.opener && typeof chrome !== 'undefined' && chrome.runtime?.id;

function sendToOpener(data: any) {
  if (window.opener) {
    // SDK popup mode
    window.opener.postMessage(data, '*');
  }
  if (isExtension) {
    // Chrome extension mode — send to background service worker
    chrome.runtime.sendMessage(data);
  }
}

export default function ConnectPopup() {
  const { user, passkey, loading: authLoading } = useAuth();
  const { activeAccount, accounts, evmAddress, evmComputing, evmProvider } = useWallet();

  const [showLogin, setShowLogin] = useState(false);
  const [approved, setApproved] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<PasskeyAccount | null>(null);

  // Sync selected with active
  useEffect(() => {
    if (activeAccount && !selectedAccount) {
      setSelectedAccount(activeAccount);
    }
  }, [activeAccount, selectedAccount]);

  // Once approved, listen for RPC requests from the parent (SDK popup) or extension
  useEffect(() => {
    if (!approved || !evmProvider) return;

    // Handle postMessage RPC (SDK popup mode)
    const msgHandler = async (event: MessageEvent) => {
      const { data } = event;
      if (data?.type !== 'flowindex_rpc_request') return;

      const { id, method, params } = data;
      try {
        const result = await evmProvider.request({ method, params });
        sendToOpener({ type: 'flowindex_rpc_response', id, result });
      } catch (err: any) {
        sendToOpener({
          type: 'flowindex_rpc_response',
          id,
          error: { code: err.code ?? -32603, message: err.message ?? 'Internal error' },
        });
      }
    };
    window.addEventListener('message', msgHandler);

    // Handle chrome.runtime messages (extension mode)
    let extHandler: ((msg: any) => void) | null = null;
    if (isExtension) {
      extHandler = (msg: any) => {
        if (msg?.target !== 'flowindex-popup' || msg?.type !== 'rpc_request') return;
        const { id, requestId, method, params } = msg;
        evmProvider.request({ method, params }).then((result: any) => {
          chrome.runtime.sendMessage({
            type: 'wallet_rpc_response',
            id,
            requestId,
            result,
          });
        }).catch((err: any) => {
          chrome.runtime.sendMessage({
            type: 'wallet_rpc_response',
            id,
            requestId,
            error: { code: err.code ?? -32603, message: err.message ?? 'Internal error' },
          });
        });
      };
      chrome.runtime.onMessage.addListener(extHandler);
    }

    return () => {
      window.removeEventListener('message', msgHandler);
      if (extHandler) chrome.runtime.onMessage.removeListener(extHandler);
    };
  }, [approved, evmProvider]);

  const handleApprove = useCallback(() => {
    if (!evmAddress) return;
    setApproved(true);
    // SDK mode
    sendToOpener({ type: 'flowindex_connected', address: evmAddress, chainId: CHAIN_ID });
    // Extension mode — also send wallet_connected for background.js
    if (isExtension) {
      chrome.runtime.sendMessage({ type: 'wallet_connected', address: evmAddress, chainId: CHAIN_ID });
    }
  }, [evmAddress]);

  const handleCancel = useCallback(() => {
    sendToOpener({ type: 'flowindex_disconnected' });
    if (isExtension) {
      chrome.runtime.sendMessage({ type: 'wallet_disconnected' });
    }
    window.close();
  }, []);

  // Loading
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-wallet-bg">
        <div className="text-center">
          <Loader2 className="w-6 h-6 animate-spin text-wallet-accent mx-auto mb-3" />
          <p className="text-sm text-wallet-muted">Loading...</p>
        </div>
      </div>
    );
  }

  // Not logged in
  if (!user) {
    if (showLogin) {
      return (
        <div className="min-h-screen bg-wallet-bg">
          <LoginModal open={true} onClose={() => setShowLogin(false)} showPasskey={true} />
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center min-h-screen bg-wallet-bg px-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-wallet-accent/15 flex items-center justify-center mx-auto">
            <Wallet className="w-7 h-7 text-wallet-accent" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">FlowIndex Wallet</h1>
            <p className="text-sm text-wallet-muted mt-1">Sign in to connect your EVM wallet</p>
          </div>
          <button
            onClick={() => setShowLogin(true)}
            className="w-full py-3 rounded-xl bg-wallet-accent text-black font-semibold text-sm hover:bg-wallet-accent/90 transition-colors"
          >
            Sign In with Passkey
          </button>
          <button
            onClick={handleCancel}
            className="w-full py-3 rounded-xl bg-wallet-surface border border-wallet-border text-wallet-muted font-medium text-sm hover:text-white transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Approved — show connected state
  if (approved) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-wallet-bg px-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-green-500/15 flex items-center justify-center mx-auto">
            <Check className="w-7 h-7 text-green-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Connected</h1>
            <p className="text-xs font-mono text-wallet-muted mt-2 break-all">{evmAddress}</p>
            <p className="text-xs text-wallet-muted mt-1">Flow-EVM Testnet (chain {CHAIN_ID})</p>
          </div>
          <div className="flex items-center gap-2 justify-center text-xs text-wallet-muted">
            <Shield className="w-3.5 h-3.5" />
            Keep this window open — signing requests will appear here
          </div>
          <button
            onClick={handleCancel}
            className="w-full py-3 rounded-xl bg-wallet-surface border border-wallet-border text-red-400 font-medium text-sm hover:bg-red-500/10 transition-colors"
          >
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  // Logged in — show account + EVM address, approve button
  const accountsWithEvm = accounts.filter((a) => a.publicKeySec1Hex);

  return (
    <div className="flex items-center justify-center min-h-screen bg-wallet-bg px-4">
      <div className="w-full max-w-sm space-y-4">
        {/* Header */}
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-wallet-accent/15 flex items-center justify-center mx-auto mb-3">
            <Wallet className="w-7 h-7 text-wallet-accent" />
          </div>
          <h1 className="text-lg font-bold text-white">Connect to dApp</h1>
          <p className="text-sm text-wallet-muted mt-1">Select an account to share</p>
        </div>

        {/* Account list */}
        <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
          {accountsWithEvm.map((account) => {
            const isSelected = selectedAccount?.credentialId === account.credentialId;
            return (
              <button
                key={account.credentialId}
                onClick={() => setSelectedAccount(account)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-3 rounded-xl border transition-all text-left',
                  isSelected
                    ? 'border-wallet-accent/50 bg-wallet-accent/5'
                    : 'border-wallet-border bg-wallet-surface hover:border-wallet-border/80',
                )}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">
                    {account.authenticatorName || 'Passkey Account'}
                  </p>
                  {account.evmAddress ? (
                    <p className="text-xs font-mono text-wallet-muted mt-0.5">
                      {formatShort(account.evmAddress, 6, 4)}
                    </p>
                  ) : (
                    <p className="text-xs text-wallet-muted mt-0.5">Computing EVM address...</p>
                  )}
                </div>
                {isSelected && <Check className="w-4 h-4 text-wallet-accent flex-shrink-0" />}
              </button>
            );
          })}
        </div>

        {/* EVM address info */}
        {evmComputing && (
          <div className="flex items-center gap-2 text-xs text-wallet-muted justify-center">
            <Loader2 className="w-3 h-3 animate-spin" />
            Computing smart wallet address...
          </div>
        )}
        {evmAddress && !evmComputing && (
          <div className="p-3 rounded-xl bg-wallet-surface border border-wallet-border">
            <p className="text-[10px] font-medium text-violet-400 uppercase tracking-wider mb-1">
              EVM Smart Wallet
            </p>
            <p className="text-xs font-mono text-white break-all">{evmAddress}</p>
            <p className="text-[10px] text-wallet-muted mt-1">Flow-EVM Testnet (chain {CHAIN_ID})</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleCancel}
            className="flex-1 py-3 rounded-xl bg-wallet-surface border border-wallet-border text-wallet-muted font-medium text-sm hover:text-white transition-colors flex items-center justify-center gap-1.5"
          >
            <X className="w-4 h-4" />
            Cancel
          </button>
          <button
            onClick={handleApprove}
            disabled={!evmAddress || evmComputing}
            className={cn(
              'flex-1 py-3 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-1.5',
              evmAddress && !evmComputing
                ? 'bg-wallet-accent text-black hover:bg-wallet-accent/90'
                : 'bg-wallet-surface text-wallet-muted cursor-not-allowed',
            )}
          >
            <Check className="w-4 h-4" />
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}

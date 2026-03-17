import { useEffect, useState, useCallback } from 'react';
import { useAuth, LoginModal, PasskeyOnboardingModal } from '@flowindex/auth-ui';
import { Button, Card, CardContent, CardHeader, CardTitle, cn, formatShort } from '@flowindex/flow-ui';
import { Loader2, Check, X, Wallet } from 'lucide-react';
import { onReadyResponse, approve, decline } from '@/fcl/messaging';
import { buildAuthnResponse } from '@/fcl/services';
import { useWallet } from '@/hooks/useWallet';
import type { PasskeyAccount } from '@flowindex/auth-core';

export default function Authn() {
  const { user, passkey, loading: authLoading } = useAuth();
  const { accounts, activeAccount, switchAccount, network, loading: walletLoading } = useWallet();

  const [hostReady, setHostReady] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<PasskeyAccount | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dappNetwork, setDappNetwork] = useState<string | null>(null);

  // On mount: FCL handshake (sends READY, listens for READY:RESPONSE)
  useEffect(() => {
    const cleanup = onReadyResponse((data) => {
      console.log('[Authn] FCL:VIEW:READY:RESPONSE', data);
      // Extract network from FCL config.client.network
      const net = (data as any)?.config?.client?.network;
      if (net) setDappNetwork(net);
      setHostReady(true);
    });
    return cleanup;
  }, []);

  // Sync selected account with active account
  useEffect(() => {
    if (activeAccount && !selectedAccount) {
      setSelectedAccount(activeAccount);
    }
  }, [activeAccount, selectedAccount]);

  const loading = authLoading || walletLoading;

  const handleSelect = useCallback((account: PasskeyAccount) => {
    setSelectedAccount(account);
    switchAccount(account.credentialId);
  }, [switchAccount]);

  const handleConnect = useCallback(() => {
    if (!selectedAccount) {
      setError('No account selected');
      return;
    }

    // Use dApp's requested network, fallback to wallet network
    const effectiveNetwork = dappNetwork || network;
    const address = effectiveNetwork === 'testnet'
      ? selectedAccount.flowAddressTestnet || selectedAccount.flowAddress
      : selectedAccount.flowAddress;
    if (!address) {
      setError(`Selected account has no ${effectiveNetwork} address`);
      return;
    }

    try {
      const response = buildAuthnResponse({
        address,
        keyId: 0,
        origin: window.location.origin,
        network: effectiveNetwork,
      });
      console.log('[Authn] approve response:', response);
      console.log('[Authn] window.opener:', !!window.opener, 'window.parent !== window:', window.parent !== window);
      approve(response);
      // Small delay before closing to ensure message is sent
      setTimeout(() => window.close(), 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to build auth response');
    }
  }, [selectedAccount]);

  const handleCancel = useCallback(() => {
    decline('User cancelled');
    window.close();
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-nothing-dark">
        <Card className="w-full max-w-[400px] mx-4 bg-nothing-dark border-zinc-800">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-nothing-green mb-3" />
            <p className="text-sm text-zinc-500 font-mono">Loading wallet...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Not logged in
  if (!user) {
    if (showLogin) {
      return (
        <div className="min-h-screen bg-nothing-dark">
          <LoginModal
            open={true}
            onClose={() => setShowLogin(false)}
            showPasskey={true}
          />
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center min-h-screen bg-nothing-dark">
        <Card className="w-full max-w-[400px] mx-4 bg-nothing-dark border-zinc-800">
          <CardHeader className="text-center pb-2">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Wallet className="w-5 h-5 text-nothing-green" />
              <CardTitle className="text-base font-semibold text-white">FlowIndex Wallet</CardTitle>
            </div>
            <p className="text-xs text-zinc-500 font-mono">Sign in to connect your wallet</p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              onClick={() => setShowLogin(true)}
              className="w-full bg-nothing-green hover:bg-nothing-green/90 text-black font-semibold"
            >
              Sign In
            </Button>
            <Button
              variant="outline"
              onClick={handleCancel}
              className="w-full border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600"
            >
              Cancel
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Logged in but no accounts with Flow addresses — show onboarding
  const effectiveNet = dappNetwork || network;
  const accountsWithAddress = accounts.filter((a) =>
    effectiveNet === 'testnet' ? !!(a.flowAddressTestnet || a.flowAddress) : !!a.flowAddress
  );

  if (accountsWithAddress.length === 0) {
    return (
      <div className="min-h-screen bg-nothing-dark">
        <PasskeyOnboardingModal
          open={true}
          email={user.email}
          onCreatePasskey={async (walletName) => {
            if (!passkey) throw new Error('Passkey not configured');
            // If already have a passkey (registered but provision failed), reuse it
            if (passkey.passkeys.length > 0) {
              const existing = passkey.passkeys[0];
              return { credentialId: existing.id, publicKeySec1Hex: '' };
            }
            return passkey.register(walletName);
          }}
          onProvisionAccounts={async (credentialId) => {
            if (!passkey) throw new Error('Passkey not configured');
            return passkey.provisionAccounts(credentialId);
          }}
          onPollTx={async (txId, network) => {
            if (!passkey) throw new Error('Passkey not configured');
            return passkey.pollProvisionTx(txId, network);
          }}
          onSaveAddress={async (credentialId, network, address) => {
            if (!passkey) throw new Error('Passkey not configured');
            await passkey.saveProvisionedAddress(credentialId, network, address);
          }}
          onDone={async () => {
            if (passkey) await passkey.refreshState();
          }}
          onSkip={handleCancel}
          onDontShowAgain={handleCancel}
        />
      </div>
    );
  }

  // Account selector
  return (
    <div className="flex items-center justify-center min-h-screen bg-nothing-dark">
      <Card className="w-full max-w-[400px] mx-4 bg-nothing-dark border-zinc-800">
        <CardHeader className="text-center pb-2">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Wallet className="w-5 h-5 text-nothing-green" />
            <CardTitle className="text-base font-semibold text-white">FlowIndex Wallet</CardTitle>
          </div>
          <p className="text-xs text-zinc-500 font-mono">Select an account to connect</p>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs font-mono">
              {error}
            </div>
          )}

          {!hostReady && (
            <div className="px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-400 text-xs font-mono flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" />
              Waiting for dApp...
            </div>
          )}

          {/* Account list */}
          <div className="space-y-1.5 max-h-[240px] overflow-y-auto">
            {accountsWithAddress.map((account) => {
              const isSelected = selectedAccount?.credentialId === account.credentialId;
              const isActive = activeAccount?.credentialId === account.credentialId;
              const rawAddr = effectiveNet === 'testnet'
                ? (account.flowAddressTestnet || account.flowAddress)
                : account.flowAddress;
              const addr = rawAddr.startsWith('0x') ? rawAddr : '0x' + rawAddr;

              return (
                <button
                  key={account.credentialId}
                  onClick={() => handleSelect(account)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all text-left',
                    isSelected
                      ? 'border-nothing-green/50 bg-nothing-green/5'
                      : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900',
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono text-white truncate">
                        {formatShort(addr)}
                      </span>
                      {isActive && (
                        <span className="text-[10px] font-mono text-nothing-green bg-nothing-green/10 px-1.5 py-0.5 rounded">
                          active
                        </span>
                      )}
                    </div>
                    {account.authenticatorName && (
                      <p className="text-[11px] text-zinc-500 font-mono truncate mt-0.5">
                        {account.authenticatorName}
                      </p>
                    )}
                  </div>
                  {isSelected && (
                    <Check className="w-4 h-4 text-nothing-green shrink-0" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              onClick={handleCancel}
              className="flex-1 border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600"
            >
              <X className="w-4 h-4 mr-1.5" />
              Cancel
            </Button>
            <Button
              onClick={handleConnect}
              disabled={!selectedAccount}
              className="flex-1 bg-nothing-green hover:bg-nothing-green/90 text-black font-semibold disabled:opacity-50"
            >
              Connect
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { useEffect, useState, useCallback } from 'react';
import { useAuth, LoginModal } from '@flowindex/auth-ui';
import { Button, Card, CardContent, CardHeader, CardTitle, cn, formatShort } from '@flowindex/flow-ui';
import { Loader2, Check, Plus, X, Wallet } from 'lucide-react';
import { sendReady, onReadyResponse, approve, decline } from '@/fcl/messaging';
import { buildAuthnResponse } from '@/fcl/services';
import { useWallet } from '@/hooks/useWallet';
import type { PasskeyAccount } from '@flowindex/auth-core';

export default function Authn() {
  const { user, passkey, loading: authLoading } = useAuth();
  const { accounts, activeAccount, switchAccount, loading: walletLoading } = useWallet();

  const [hostReady, setHostReady] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<PasskeyAccount | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On mount: send ready signal and listen for host response
  useEffect(() => {
    sendReady();
    const cleanup = onReadyResponse(() => {
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
    if (!selectedAccount) return;

    const address = selectedAccount.flowAddress;
    if (!address) {
      setError('Selected account has no Flow address');
      return;
    }

    try {
      const response = buildAuthnResponse({
        address,
        keyId: 0,
        origin: window.location.origin,
      });
      approve(response);
      window.close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to build auth response');
    }
  }, [selectedAccount]);

  const handleCancel = useCallback(() => {
    decline('User cancelled');
    window.close();
  }, []);

  const handleCreateAccount = useCallback(async () => {
    if (!passkey || !accounts.length) return;
    setProvisioning(true);
    setError(null);
    try {
      // Use the first credential to provision accounts
      const cred = accounts[0] ?? passkey.accounts[0];
      if (!cred) {
        setError('No passkey credential found');
        return;
      }
      await passkey.provisionAccounts(cred.credentialId);
      await passkey.refreshState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create account');
    } finally {
      setProvisioning(false);
    }
  }, [passkey, accounts]);

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

        <LoginModal
          open={showLogin}
          onClose={() => setShowLogin(false)}
          showPasskey={true}
        />
      </div>
    );
  }

  // Logged in but no accounts with Flow addresses
  const accountsWithAddress = accounts.filter((a) => !!a.flowAddress);

  if (accountsWithAddress.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-nothing-dark">
        <Card className="w-full max-w-[400px] mx-4 bg-nothing-dark border-zinc-800">
          <CardHeader className="text-center pb-2">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Wallet className="w-5 h-5 text-nothing-green" />
              <CardTitle className="text-base font-semibold text-white">FlowIndex Wallet</CardTitle>
            </div>
            <p className="text-xs text-zinc-500 font-mono">No Flow accounts yet</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {error && (
              <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs font-mono">
                {error}
              </div>
            )}
            <Button
              onClick={handleCreateAccount}
              disabled={provisioning}
              className="w-full bg-nothing-green hover:bg-nothing-green/90 text-black font-semibold"
            >
              {provisioning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Account
                </>
              )}
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
              const addr = account.flowAddress.startsWith('0x')
                ? account.flowAddress
                : '0x' + account.flowAddress;

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

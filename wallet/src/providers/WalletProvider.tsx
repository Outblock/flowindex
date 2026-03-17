import { createContext, useCallback, useEffect, useState } from 'react';
import { useAuth } from '@flowindex/auth-ui';
import type { PasskeyAccount } from '@flowindex/auth-core';
import type { EvmWalletProvider } from '@flowindex/evm-wallet';
import { useEvmWallet } from '@/hooks/useEvmWallet';

export interface WalletContextValue {
  activeAccount: PasskeyAccount | null;
  accounts: PasskeyAccount[];
  network: 'mainnet' | 'testnet';
  loading: boolean;
  evmAddress: string | null;
  evmComputing: boolean;
  evmProvider: EvmWalletProvider | null;
  switchAccount: (credentialId: string) => void;
  switchNetwork: (network: 'mainnet' | 'testnet') => void;
  refreshAccounts: () => Promise<void>;
}

const NETWORK_STORAGE_KEY = 'flowindex_wallet_network';

function loadNetwork(): 'mainnet' | 'testnet' {
  try {
    const stored = localStorage.getItem(NETWORK_STORAGE_KEY);
    if (stored === 'mainnet' || stored === 'testnet') return stored;
  } catch {
    // localStorage unavailable
  }
  return 'mainnet';
}

export const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { user, passkey, loading: authLoading } = useAuth();

  const [activeAccount, setActiveAccount] = useState<PasskeyAccount | null>(null);
  const [accounts, setAccounts] = useState<PasskeyAccount[]>([]);
  const [network, setNetwork] = useState<'mainnet' | 'testnet'>(loadNetwork);
  const [loading, setLoading] = useState(true);

  // Sync accounts from passkey state when auth changes
  useEffect(() => {
    if (authLoading) return;

    if (!user || !passkey) {
      setAccounts([]);
      setActiveAccount(null);
      setLoading(false);
      return;
    }

    // passkey.accounts is already loaded by AuthProvider when user authenticates
    const accts = passkey.accounts;
    setAccounts(accts);
    setActiveAccount((prev) => {
      if (!accts.length) return null;
      if (prev) {
        const matched = accts.find((a) => a.credentialId === prev.credentialId);
        if (matched) return matched;
      }
      return accts[0];
    });
    setLoading(false);
  }, [user, passkey?.accounts, authLoading]);

  const switchAccount = useCallback((credentialId: string) => {
    setActiveAccount((prev) => {
      const acct = accounts.find((a) => a.credentialId === credentialId);
      return acct ?? prev;
    });
  }, [accounts]);

  const switchNetwork = useCallback((net: 'mainnet' | 'testnet') => {
    setNetwork(net);
    try {
      localStorage.setItem(NETWORK_STORAGE_KEY, net);
    } catch {
      // localStorage unavailable
    }
  }, []);

  const refreshAccounts = useCallback(async () => {
    if (!passkey) return;
    setLoading(true);
    try {
      await passkey.refreshState();
      // After refresh, passkey.accounts will be updated and the useEffect above will sync
    } finally {
      setLoading(false);
    }
  }, [passkey]);

  // EVM wallet — computes smart wallet address from active account's public key
  const { evmAddress, isComputing: evmComputing, provider: evmProvider } = useEvmWallet(activeAccount);

  const value: WalletContextValue = {
    activeAccount,
    accounts,
    network,
    loading: loading || authLoading,
    evmAddress,
    evmComputing,
    evmProvider,
    switchAccount,
    switchNetwork,
    refreshAccounts,
  };

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

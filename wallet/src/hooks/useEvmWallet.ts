import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@flowindex/auth-ui';
import {
  getSmartWalletAddress,
  createEvmWalletProvider,
  FACTORY_ADDRESS,
  flowEvmTestnet,
} from '@flowindex/evm-wallet';
import type { EvmWalletProvider } from '@flowindex/evm-wallet';
import type { PasskeyAccount } from '@flowindex/auth-core';

const BUNDLER_URL = import.meta.env.VITE_BUNDLER_URL || 'https://bundler.flowindex.io';
const EVM_RPC_URL = flowEvmTestnet.rpcUrls.default.http[0];

export function useEvmWallet(account: PasskeyAccount | null) {
  const { passkey } = useAuth();
  const [evmAddress, setEvmAddress] = useState<string | null>(account?.evmAddress ?? null);
  const [isComputing, setIsComputing] = useState(false);

  useEffect(() => {
    if (!account || !account.publicKeySec1Hex || account.evmAddress) {
      setEvmAddress(account?.evmAddress ?? null);
      return;
    }

    let cancelled = false;
    setIsComputing(true);

    getSmartWalletAddress(account.publicKeySec1Hex, {
      factoryAddress: FACTORY_ADDRESS as `0x${string}`,
      rpcUrl: EVM_RPC_URL,
    })
      .then(async (addr) => {
        if (cancelled) return;
        setEvmAddress(addr);
        setIsComputing(false);

        // Persist to backend
        if (passkey) {
          try {
            await passkey.saveEvmAddress(account.credentialId, addr);
          } catch (e) {
            console.warn('[evm-wallet] Failed to save EVM address:', e);
          }
        }
      })
      .catch((e) => {
        if (!cancelled) {
          console.error('[evm-wallet] Failed to compute EVM address:', e);
          setIsComputing(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [account?.credentialId, account?.publicKeySec1Hex, account?.evmAddress, passkey]);

  const provider = useMemo<EvmWalletProvider | null>(() => {
    if (!evmAddress || !account) return null;
    return createEvmWalletProvider({
      smartWalletAddress: evmAddress as `0x${string}`,
      rpcUrl: EVM_RPC_URL,
      bundlerUrl: BUNDLER_URL,
      publicKeySec1Hex: account.publicKeySec1Hex,
      credentialId: account.credentialId,
      isDeployed: false,
    });
  }, [evmAddress, account?.credentialId]);

  return { evmAddress, isComputing, provider };
}

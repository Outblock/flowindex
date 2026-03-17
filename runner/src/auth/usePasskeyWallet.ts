import { useMemo } from 'react';
import { useAuth } from '@flowindex/auth-ui';
import type { PasskeyAccount, ProvisionResult, ProvisionStatus, ProvisionState } from '@flowindex/auth-ui';
import type { PasskeySignResult } from '@flowindex/flow-passkey';

export type { PasskeyAccount, PasskeySignResult, ProvisionStatus, ProvisionState };

function notConfigured(name: string): never {
  throw new Error(`Passkey not configured: ${name}`);
}

export function usePasskeyWallet() {
  const { passkey } = useAuth();

  const passkeys = useMemo(
    () => passkey?.passkeys?.map(p => ({ id: p.id, authenticatorName: p.authenticatorName })) ?? [],
    [passkey?.passkeys],
  );

  return {
    accounts: passkey?.accounts ?? [],
    passkeys,
    selectedAccount: passkey?.selectedAccount ?? null,
    selectAccount: passkey?.selectAccount ?? (() => {}),
    loading: passkey?.loading ?? false,
    hasPasskeySupport: passkey?.hasSupport ?? false,
    hasBoundPasskey: passkey?.hasBoundPasskey ?? false,

    register: passkey?.register ?? (async (_n?: string): Promise<{ credentialId: string; publicKeySec1Hex: string }> => notConfigured('register')),
    createPasskey: passkey?.register ?? (async (_n?: string): Promise<{ credentialId: string; publicKeySec1Hex: string }> => notConfigured('createPasskey')),
    login: passkey?.login ?? (async (): Promise<void> => notConfigured('login')),
    startConditionalLogin: passkey?.startConditionalLogin ?? (() => new AbortController()),
    sign: passkey?.sign ?? (async (_msg: string): Promise<PasskeySignResult> => notConfigured('sign')),
    provisionAccounts: passkey?.provisionAccounts ?? (async (_id: string): Promise<ProvisionResult> => notConfigured('provisionAccounts')),
    pollProvisionTx: passkey?.pollProvisionTx ?? (async (_txId: string, _net: 'mainnet' | 'testnet'): Promise<string> => notConfigured('pollProvisionTx')),
    saveProvisionedAddress: passkey?.saveProvisionedAddress ?? (async (_id: string, _net: string, _addr: string): Promise<void> => notConfigured('saveProvisionedAddress')),
    refreshPasskeyState: passkey?.refreshState ?? (async () => {}),

    provisionAccount: async (credentialId?: string) => {
      if (!passkey) throw new Error('Passkey not configured');
      const credId = credentialId ?? passkey.selectedAccount?.credentialId;
      if (!credId) throw new Error('No credential to provision');
      const result = await passkey.provisionAccounts(credId);
      for (const net of Object.values(result.networks)) {
        if (net.address) return net.address;
      }
      throw new Error('No address in provision result');
    },
  };
}

import { useAuth } from '@flowindex/auth-ui';
import type { PasskeyAccount } from '@flowindex/auth-ui';
import type { PasskeySignResult } from '@flowindex/flow-passkey';

export type { PasskeyAccount, PasskeySignResult };

export interface ProvisionStatus {
  txId?: string;
  address?: string;
  error?: string;
  status: 'idle' | 'pending' | 'polling' | 'sealed' | 'error';
}

export interface ProvisionState {
  mainnet: ProvisionStatus;
  testnet: ProvisionStatus;
}

const noop = async () => { throw new Error('Passkey not configured'); };

export function usePasskeyWallet() {
  const { passkey } = useAuth();

  return {
    accounts: passkey?.accounts ?? [],
    passkeys: passkey?.passkeys?.map(p => ({
      id: p.id,
      authenticatorName: p.authenticatorName,
    })) ?? [],
    selectedAccount: passkey?.selectedAccount ?? null,
    selectAccount: passkey?.selectAccount ?? (() => {}),
    loading: passkey?.loading ?? false,
    hasPasskeySupport: passkey?.hasSupport ?? false,
    hasBoundPasskey: passkey?.hasBoundPasskey ?? false,

    register: passkey?.register ?? noop,
    createPasskey: passkey?.register ?? noop,
    login: passkey?.login ?? noop,
    startConditionalLogin: passkey?.startConditionalLogin ?? (() => new AbortController()),
    sign: passkey?.sign ?? (noop as any),
    provisionAccounts: passkey?.provisionAccounts ?? (noop as any),
    pollProvisionTx: passkey?.pollProvisionTx ?? (noop as any),
    saveProvisionedAddress: passkey?.saveProvisionedAddress ?? (noop as any),
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

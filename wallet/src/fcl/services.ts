import type { FclAuthnResponse } from './types';

export function buildAuthnResponse(options: {
  address: string;
  keyId: number;
  origin: string;
  network?: string;
}): FclAuthnResponse {
  const { address, keyId, origin, network } = options;
  const addr = address.startsWith('0x') ? address : '0x' + address;

  return {
    f_type: 'AuthnResponse',
    f_vsn: '1.0.0',
    addr,
    paddr: null,
    network: network || 'mainnet',
    services: [
      {
        f_type: 'Service',
        f_vsn: '1.0.0',
        type: 'authn',
        uid: 'flowindex-wallet#authn',
        id: addr,
        identity: {
          address: addr,
        },
        provider: {
          f_type: 'ServiceProvider',
          f_vsn: '1.0.0',
          address: '0x0',
          name: 'FlowIndex Wallet',
          icon: `${origin}/icon.png`,
          description: 'Passkey wallet for Flow',
        },
      },
      {
        f_type: 'Service',
        f_vsn: '1.0.0',
        type: 'authz',
        uid: 'flowindex-wallet#authz',
        method: 'POP/RPC',
        endpoint: `${origin}/authz`,
        network: network || 'mainnet',
        identity: {
          address: addr,
          keyId,
        },
      },
      {
        f_type: 'Service',
        f_vsn: '1.0.0',
        type: 'user-signature',
        uid: 'flowindex-wallet#user-signature',
        method: 'POP/RPC',
        endpoint: `${origin}/sign-message`,
        network: network || 'mainnet',
      },
    ],
  };
}

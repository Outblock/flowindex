export interface FclServiceIdentity {
  address: string;
  keyId?: number;
}

export interface FclServiceProvider {
  f_type: 'ServiceProvider';
  f_vsn: '1.0.0';
  address: string;
  name?: string;
  icon?: string;
  description?: string;
}

export interface FclService {
  f_type: 'Service';
  f_vsn: '1.0.0';
  type: 'authn' | 'authz' | 'user-signature' | 'pre-authz' | 'account-proof';
  uid: string;
  id?: string;
  method?: 'POP/RPC' | 'HTTP/POST';
  endpoint?: string;
  network?: string;
  identity?: FclServiceIdentity;
  provider?: FclServiceProvider;
  data?: unknown;
  params?: unknown;
}

export interface FclAuthnResponse {
  f_type: 'AuthnResponse';
  f_vsn: '1.0.0';
  addr: string;
  paddr?: string | null;
  network?: string;
  services: FclService[];
}

export interface FclCompositeSignature {
  f_type: 'CompositeSignature';
  f_vsn: '1.0.0';
  addr: string;
  keyId: number;
  signature: string;
  extensionData?: string;
}

export interface FclSignable {
  f_type: 'Signable';
  f_vsn: '1.0.1';
  addr: string;
  keyId: number;
  voucher: {
    cadence: string;
    refBlock: string;
    computeLimit: number;
    arguments: unknown[];
    proposalKey: {
      address: string;
      keyId: number;
      sequenceNum: number;
    };
    payer: string;
    authorizers: string[];
    payloadSigs: unknown[];
    envelopeSigs: unknown[];
  };
}

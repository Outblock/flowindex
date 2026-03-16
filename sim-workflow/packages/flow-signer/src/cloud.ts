import type { FlowSigner, SignResult, SignerInfo, SignerConfig } from './interface';

// ---------------------------------------------------------------------------
// CloudSigner — delegates signing to FlowIndex custodial wallet API
// ---------------------------------------------------------------------------

/** Shape of a single key entry from GET /api/v1/wallet/me */
interface WalletMeKey {
  id: string;
  flow_address: string;
  public_key: string;
  key_index: number;
  label: string;
  sig_algo: string;
  hash_algo: string;
  source: string;
  created_at: string;
}

/** Envelope returned by the Go API: { data: {...}, error: {...} } */
interface ApiEnvelope<T> {
  data?: T;
  error?: { message: string };
}

export class CloudSigner implements FlowSigner {
  private readonly config: SignerConfig;
  private token?: string;

  private flowAddress?: string;
  private evmAddress?: string;
  private keyId?: string;
  private keyIndex = 0;
  private sigAlgo = 'ECDSA_secp256k1';
  private hashAlgo = 'SHA2_256';
  private ready = false;

  constructor(config: SignerConfig, token?: string) {
    this.config = config;
    this.token = token;
  }

  /** Inject or replace the JWT token at runtime. */
  setToken(token: string): void {
    this.token = token;
  }

  // ---- FlowSigner implementation ------------------------------------------

  async init(): Promise<void> {
    if (!this.token) throw new Error('CloudSigner requires a token');

    const resp = await fetch(`${this.config.flowindexUrl}/api/v1/wallet/me`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`CloudSigner init failed (${resp.status}): ${body}`);
    }

    const envelope = (await resp.json()) as ApiEnvelope<{
      keys: WalletMeKey[];
      accounts: unknown[];
    }>;

    if (envelope.error) {
      throw new Error(`CloudSigner init error: ${envelope.error.message}`);
    }

    const keys = envelope.data?.keys;
    if (!keys || keys.length === 0) {
      throw new Error('CloudSigner: no keys found for this wallet');
    }

    // Use the first key
    const key = keys[0];
    this.flowAddress = key.flow_address;
    this.keyId = key.id;
    this.keyIndex = key.key_index;
    this.sigAlgo = key.sig_algo;
    this.hashAlgo = key.hash_algo;
    this.ready = true;
  }

  info(): SignerInfo {
    return {
      type: 'cloud',
      flowAddress: this.flowAddress,
      evmAddress: this.evmAddress,
      keyIndex: this.keyIndex,
      sigAlgo: this.sigAlgo,
      hashAlgo: this.hashAlgo,
    };
  }

  async signFlowTransaction(messageHex: string): Promise<SignResult> {
    if (!this.token) throw new Error('CloudSigner: no token set');
    if (!this.keyId) throw new Error('CloudSigner: not initialized (no key_id). Call init() first.');

    const resp = await fetch(`${this.config.flowindexUrl}/api/v1/wallet/sign`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key_id: this.keyId, message: messageHex }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`CloudSigner sign failed (${resp.status}): ${body}`);
    }

    // The sign endpoint proxies to the flow-keys edge function.
    // The response may be the edge function's raw JSON or wrapped in the API envelope.
    const json = (await resp.json()) as Record<string, unknown>;

    // Try envelope format first: { data: { signature: "..." } }
    const dataObj = json?.data as Record<string, unknown> | undefined;
    const sig = (dataObj?.signature as string) ?? (json?.signature as string);
    if (!sig) {
      throw new Error(`CloudSigner: no signature in response: ${JSON.stringify(json)}`);
    }

    return { signature: sig };
  }

  isHeadless(): boolean {
    return !!this.token;
  }

  isReady(): boolean {
    return this.ready;
  }

  // ---- Getters ------------------------------------------------------------

  getFlowAddress(): string | undefined {
    return this.flowAddress;
  }

  getKeyIndex(): number {
    return this.keyIndex;
  }

  getKeyId(): string | undefined {
    return this.keyId;
  }
}

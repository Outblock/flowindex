/**
 * Signer abstraction layer for Flow transactions.
 *
 * Three implementations:
 *  - LocalSigner  (mnemonic or raw private key, headless)
 *  - CloudSigner  (FlowIndex custodial API, headless with JWT)
 *  - PasskeySigner (browser passkey approval, NOT headless)
 */

/** Shared config that every signer needs. */
export interface SignerConfig {
  flowindexUrl: string;
  network?: 'mainnet' | 'testnet';
}

export interface SignResult {
  /** Hex-encoded r||s signature (128 hex chars = 64 bytes) */
  signature: string;
  /** FLIP-264 extension data (passkey signer only) */
  extensionData?: string;
}

export interface SignerInfo {
  type: 'local' | 'cloud' | 'passkey';
  flowAddress?: string;
  evmAddress?: string;
  keyIndex: number;
  sigAlgo: string;
  hashAlgo: string;
}

export interface FlowSigner {
  /** Initialise the signer (derive keys, discover accounts, etc.) */
  init(): Promise<void>;

  /** Return current signer metadata */
  info(): SignerInfo;

  /**
   * Sign a Flow transaction envelope.
   * @param messageHex  Hex-encoded message bytes (RLP-encoded tx payload)
   */
  signFlowTransaction(messageHex: string): Promise<SignResult>;

  /** True when the signer can operate without user interaction */
  isHeadless(): boolean;
}

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { sha3_256 } from '@noble/hashes/sha3.js';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { mnemonicToAccount } from 'viem/accounts';
import type { FlowSigner, SignResult, SignerInfo, SignerConfig } from './interface.js';

// ---------------------------------------------------------------------------
// Hex helpers
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

/** Derive a Flow signing key from a BIP-39 mnemonic (m/44'/539'/0'/0/0). */
function deriveFlowKeyFromMnemonic(mnemonic: string): {
  privateKey: string;
  publicKey: string;
} {
  const seed = mnemonicToSeedSync(mnemonic);
  const hdKey = HDKey.fromMasterSeed(seed);
  const child = hdKey.derive("m/44'/539'/0'/0/0");
  if (!child.privateKey) throw new Error('Failed to derive Flow key from mnemonic');

  const privateKey = bytesToHex(child.privateKey);
  // Uncompressed public key with the leading 0x04 prefix stripped
  const pubKeyPoint = secp256k1.getPublicKey(child.privateKey, false);
  const publicKey = bytesToHex(pubKeyPoint).slice(2);

  return { privateKey, publicKey };
}

/** Get the uncompressed public key (sans 0x04 prefix) for a raw private key. */
function getPublicKeyFromPrivate(privateKeyHex: string, sigAlgo: string): string {
  const privBytes = hexToBytes(privateKeyHex);
  const curve = sigAlgo === 'ECDSA_P256' ? p256 : secp256k1;
  const pubKey = curve.getPublicKey(privBytes, false);
  return bytesToHex(pubKey).slice(2); // strip 04 prefix
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

function signMessage(
  privateKeyHex: string,
  messageHex: string,
  sigAlgo: string,
  hashAlgo: string,
): string {
  const msgBytes = hexToBytes(messageHex);

  // Hash the message with the configured algorithm
  const digest = hashAlgo === 'SHA2_256' ? sha256(msgBytes) : sha3_256(msgBytes);

  // ECDSA sign — noble v2 auto-hashes by default, so we must use prehash:false
  // since we've already hashed with the Flow-configured hash algorithm above.
  const privBytes = hexToBytes(privateKeyHex);
  const curve = sigAlgo === 'ECDSA_P256' ? p256 : secp256k1;
  const sigBytes = curve.sign(digest, privBytes, { lowS: true, prehash: false }) as Uint8Array;
  const sig = curve.Signature.fromBytes(sigBytes);

  // Return r||s  (each 32 bytes, total 64 bytes = 128 hex chars)
  const rHex = sig.r.toString(16).padStart(64, '0');
  const sHex = sig.s.toString(16).padStart(64, '0');
  return rHex + sHex;
}

// ---------------------------------------------------------------------------
// Account discovery
// ---------------------------------------------------------------------------

interface DiscoveredAccount {
  address: string;
  keyIndex: number;
}

async function discoverAccounts(
  publicKey: string,
  network: string,
  flowindexUrl: string,
): Promise<DiscoveredAccount[]> {
  // Try FlowIndex first
  try {
    const resp = await fetch(`${flowindexUrl}/api/flow/key/${publicKey}`);
    if (resp.ok) {
      const data = (await resp.json()) as {
        accounts?: { address: string; keyIndex: number; weight: number }[];
      };
      if (data.accounts && data.accounts.length > 0) {
        return data.accounts
          .filter((a) => a.weight >= 1000)
          .map((a) => ({ address: a.address, keyIndex: a.keyIndex }));
      }
    }
  } catch {
    // ignore — fall through to backup
  }

  // Fallback: Flow key-indexer
  const env = network === 'mainnet' ? 'mainnet' : 'testnet';
  try {
    const resp = await fetch(`https://${env}.key-indexer.flow.com/key/${publicKey}`);
    if (resp.ok) {
      const data = (await resp.json()) as {
        accounts?: { address: string; keyIndex: number; weight: number }[];
      };
      if (data.accounts && data.accounts.length > 0) {
        return data.accounts
          .filter((a) => a.weight >= 1000)
          .map((a) => ({ address: a.address, keyIndex: a.keyIndex }));
      }
    }
  } catch {
    // ignore
  }

  return [];
}

// ---------------------------------------------------------------------------
// LocalSigner options
// ---------------------------------------------------------------------------

export interface LocalSignerOptions {
  /** Raw hex private key (for local-key mode) */
  privateKey?: string;
  /** BIP-39 mnemonic phrase (for local-mnemonic mode) */
  mnemonic?: string;
  /** Explicit Flow address (skips on-chain discovery) */
  address?: string;
  /** Key index on the Flow account (default: 0) */
  keyIndex?: number;
  /** Signature algorithm (default: ECDSA_secp256k1) */
  sigAlgo?: 'ECDSA_P256' | 'ECDSA_secp256k1';
  /** Hash algorithm (default: SHA2_256) */
  hashAlgo?: 'SHA2_256' | 'SHA3_256';
  /** EVM private key hex (optional) */
  evmPrivateKey?: string;
  /** EVM HD derivation account index (default: 0) */
  evmAccountIndex?: number;
}

// ---------------------------------------------------------------------------
// LocalSigner
// ---------------------------------------------------------------------------

export class LocalSigner implements FlowSigner {
  private readonly config: SignerConfig;
  private readonly options: LocalSignerOptions;

  private flowPrivateKey = '';
  private flowPublicKey = '';
  private flowAddress?: string;
  private keyIndex = 0;
  private evmPrivateKey?: string;
  private evmAddress?: string;
  private sigAlgo: string;
  private hashAlgo: string;

  constructor(config: SignerConfig, options: LocalSignerOptions) {
    this.config = config;
    this.options = options;
    this.sigAlgo = options.sigAlgo ?? 'ECDSA_secp256k1';
    this.hashAlgo = options.hashAlgo ?? 'SHA2_256';
    this.keyIndex = options.keyIndex ?? 0;
  }

  // ---- FlowSigner implementation ------------------------------------------

  async init(): Promise<void> {
    const { mnemonic, privateKey } = this.options;

    if (mnemonic) {
      // Derive Flow key (secp256k1 via BIP-44 path)
      const flowKey = deriveFlowKeyFromMnemonic(mnemonic);
      this.flowPrivateKey = flowKey.privateKey;
      this.flowPublicKey = flowKey.publicKey;

      // Derive EVM account via viem (m/44'/60'/0'/0/{index})
      const evmAccount = mnemonicToAccount(mnemonic, {
        addressIndex: this.options.evmAccountIndex ?? 0,
      });
      this.evmPrivateKey = undefined; // viem account doesn't directly expose the key
      this.evmAddress = evmAccount.address;

      // If an explicit EVM key was provided, prefer it
      if (this.options.evmPrivateKey) {
        this.evmPrivateKey = this.options.evmPrivateKey;
      }
    } else if (privateKey) {
      this.flowPrivateKey = privateKey;
      this.flowPublicKey = getPublicKeyFromPrivate(this.flowPrivateKey, this.sigAlgo);

      // Use the same key for EVM if no dedicated EVM key was provided
      this.evmPrivateKey = this.options.evmPrivateKey ?? privateKey;
    } else {
      throw new Error('LocalSigner requires either a mnemonic or privateKey');
    }

    // Use explicit address / keyIndex if provided
    if (this.options.address) {
      this.flowAddress = this.options.address;
      if (this.options.keyIndex !== undefined) this.keyIndex = this.options.keyIndex;
    } else {
      // Discover account on-chain
      const network = this.config.network ?? 'mainnet';
      const accounts = await discoverAccounts(
        this.flowPublicKey,
        network,
        this.config.flowindexUrl,
      );
      if (accounts.length > 0) {
        this.flowAddress = accounts[0].address;
        this.keyIndex = accounts[0].keyIndex;
      }
    }
  }

  info(): SignerInfo {
    return {
      type: 'local',
      flowAddress: this.flowAddress,
      evmAddress: this.evmAddress,
      keyIndex: this.keyIndex,
      sigAlgo: this.sigAlgo,
      hashAlgo: this.hashAlgo,
    };
  }

  async signFlowTransaction(messageHex: string): Promise<SignResult> {
    if (!this.flowPrivateKey) throw new Error('LocalSigner not initialised');
    const signature = signMessage(
      this.flowPrivateKey,
      messageHex,
      this.sigAlgo,
      this.hashAlgo,
    );
    return { signature };
  }

  isHeadless(): boolean {
    return true;
  }

  // ---- Additional getters -------------------------------------------------

  getFlowAddress(): string | undefined {
    return this.flowAddress;
  }

  getKeyIndex(): number {
    return this.keyIndex;
  }

  getFlowPublicKey(): string {
    return this.flowPublicKey;
  }

  /** Return the EVM private key hex (for use with viem wallet clients). */
  getEvmPrivateKey(): string | undefined {
    return this.evmPrivateKey;
  }

  getEvmAddress(): string | undefined {
    return this.evmAddress;
  }
}

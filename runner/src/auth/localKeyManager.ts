/**
 * Local Key Manager — client-side Flow key management using @trustwallet/wallet-core WASM.
 *
 * Ported from Flow-Wallet-Tool patterns. All crypto operations run in the browser;
 * private keys never leave the client.
 */

import { initWasm } from '@trustwallet/wallet-core';
import type { WalletCore } from '@trustwallet/wallet-core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LocalKey {
  id: string;
  label: string;
  publicKeyP256: string; // uncompressed P256 hex, no 04 prefix
  publicKeySecp256k1: string; // uncompressed secp256k1 hex, no 04 prefix
  source: 'mnemonic' | 'privateKey' | 'keystore';
  encryptedKey: string; // wallet-core StoredKey JSON string
  hasPassword: boolean;
  createdAt: number;
}

export interface KeyAccount {
  flowAddress: string;
  keyIndex: number;
  sigAlgo: 'ECDSA_P256' | 'ECDSA_secp256k1';
  hashAlgo: 'SHA2_256' | 'SHA3_256';
  weight: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FLOW_BIP44_PATH = "m/44'/539'/0'/0/0";
const STORAGE_KEY = 'flow-local-keys';

// ---------------------------------------------------------------------------
// WASM singleton
// ---------------------------------------------------------------------------

let walletCoreInstance: WalletCore | null = null;
let walletCorePromise: Promise<WalletCore> | null = null;

export async function getWalletCore(): Promise<WalletCore> {
  if (walletCoreInstance) return walletCoreInstance;
  if (!walletCorePromise) {
    walletCorePromise = initWasm().then((core) => {
      walletCoreInstance = core;
      return core;
    });
  }
  return walletCorePromise;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a hex string to Uint8Array. */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Convert Uint8Array to hex string (no 0x prefix). */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Convert a string to UTF-8 Uint8Array (for passwords). */
function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Strip the 04 prefix from an uncompressed public key hex string.
 * Uncompressed keys are 65 bytes: 04 || x (32) || y (32).
 */
function stripUncompressedPrefix(hex: string): string {
  if (hex.startsWith('04') && hex.length === 130) {
    return hex.slice(2);
  }
  return hex;
}

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

/**
 * Generate a BIP39 mnemonic phrase.
 * @param wordCount 12 (128-bit) or 24 (256-bit), defaults to 12.
 */
export async function generateMnemonic(
  wordCount: 12 | 24 = 12,
): Promise<string> {
  const core = await getWalletCore();
  const strength = wordCount === 24 ? 256 : 128;
  const wallet = core.HDWallet.create(strength, '');
  const mnemonic = wallet.mnemonic();
  wallet.delete();
  return mnemonic;
}

/**
 * Generate a random private key (P256 curve).
 * Returns hex-encoded private key.
 */
export async function generatePrivateKey(): Promise<string> {
  const core = await getWalletCore();
  const pk = core.PrivateKey.create();
  const hex = bytesToHex(pk.data());
  pk.delete();
  return hex;
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

export interface DerivedKeys {
  privateKeyHex: string;
  publicKeyP256: string;
  publicKeySecp256k1: string;
}

/**
 * Derive keys from a BIP39 mnemonic using the Flow BIP44 path.
 */
export async function deriveFromMnemonic(
  mnemonic: string,
  passphrase: string = '',
  path: string = FLOW_BIP44_PATH,
): Promise<DerivedKeys> {
  const core = await getWalletCore();

  if (!core.Mnemonic.isValid(mnemonic)) {
    throw new Error('Invalid mnemonic phrase');
  }

  const wallet = core.HDWallet.createWithMnemonic(mnemonic, passphrase);
  const privateKey = wallet.getKeyByCurve(core.Curve.nist256p1, path);

  const result = extractPublicKeys(core, privateKey);
  wallet.delete();

  return result;
}

/**
 * Derive both public keys from a private key hex string.
 */
export async function deriveFromPrivateKey(hex: string): Promise<DerivedKeys> {
  const core = await getWalletCore();
  const pkBytes = hexToBytes(hex);

  if (!core.PrivateKey.isValid(pkBytes, core.Curve.nist256p1)) {
    throw new Error('Invalid private key');
  }

  const privateKey = core.PrivateKey.createWithData(pkBytes);
  const result = extractPublicKeys(core, privateKey);

  return result;
}

/**
 * Extract P256 and secp256k1 public keys from a wallet-core PrivateKey.
 * Returns hex strings without the 04 uncompressed prefix.
 * Note: deletes the PrivateKey after extraction.
 */
function extractPublicKeys(
  core: WalletCore,
  privateKey: InstanceType<WalletCore['PrivateKey']>,
): DerivedKeys {
  const privateKeyHex = bytesToHex(privateKey.data());

  // P256 (nist256p1) — uncompressed
  const pubP256 = privateKey.getPublicKeyNist256p1();
  const pubP256Uncompressed = pubP256.uncompressed();
  const p256Hex = stripUncompressedPrefix(
    bytesToHex(pubP256Uncompressed.data()),
  );
  pubP256Uncompressed.delete();
  pubP256.delete();

  // secp256k1 — uncompressed
  const pubSecp = privateKey.getPublicKeySecp256k1(false);
  const secpHex = stripUncompressedPrefix(bytesToHex(pubSecp.data()));
  pubSecp.delete();

  privateKey.delete();

  return {
    privateKeyHex,
    publicKeyP256: p256Hex,
    publicKeySecp256k1: secpHex,
  };
}

// ---------------------------------------------------------------------------
// Keystore encryption / decryption
// ---------------------------------------------------------------------------

/**
 * Encrypt a private key into a wallet-core StoredKey JSON string.
 * Uses Ethereum CoinType as a container (we only use the keystore JSON, not coin-specific features).
 */
export async function encryptToKeystore(
  privateKeyHex: string,
  password: string = '',
): Promise<string> {
  const core = await getWalletCore();
  const pkBytes = hexToBytes(privateKeyHex);
  const pwBytes = stringToBytes(password);

  const storedKey = core.StoredKey.importPrivateKey(
    pkBytes,
    'flow-key',
    pwBytes,
    core.CoinType.ethereum,
  );

  const json = storedKey.exportJSON();
  const jsonStr = new TextDecoder().decode(json);
  storedKey.delete();

  return jsonStr;
}

/**
 * Encrypt a mnemonic into a wallet-core StoredKey JSON string.
 */
export async function encryptMnemonicToKeystore(
  mnemonic: string,
  password: string = '',
): Promise<string> {
  const core = await getWalletCore();
  const pwBytes = stringToBytes(password);

  const storedKey = core.StoredKey.importHDWallet(
    mnemonic,
    'flow-mnemonic',
    pwBytes,
    core.CoinType.ethereum,
  );

  const json = storedKey.exportJSON();
  const jsonStr = new TextDecoder().decode(json);
  storedKey.delete();

  return jsonStr;
}

/**
 * Decrypt a private key from a wallet-core StoredKey JSON string.
 * Returns hex-encoded private key.
 */
export async function decryptFromKeystore(
  json: string,
  password: string = '',
): Promise<string> {
  const core = await getWalletCore();
  const jsonBytes = stringToBytes(json);
  const pwBytes = stringToBytes(password);

  const storedKey = core.StoredKey.importJSON(jsonBytes);
  const privateKeyBytes = storedKey.decryptPrivateKey(pwBytes);

  if (!privateKeyBytes || privateKeyBytes.length === 0) {
    storedKey.delete();
    throw new Error('Failed to decrypt keystore — wrong password?');
  }

  const hex = bytesToHex(privateKeyBytes);
  storedKey.delete();

  return hex;
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * Sign a hex-encoded message with a P256 private key.
 *
 * FCL sends `signable.message` as a hex string of the already-hashed
 * transaction envelope. We sign the raw bytes directly — no additional
 * hashing is performed here, matching the custodial signing behaviour
 * in execute.ts.
 *
 * @param privateKeyHex  Hex-encoded private key
 * @param messageHex     Hex-encoded message (already hashed by FCL)
 * @param sigAlgo        Signature algorithm, defaults to P256
 * @returns Hex-encoded signature
 */
export async function signMessage(
  privateKeyHex: string,
  messageHex: string,
  sigAlgo: 'ECDSA_P256' | 'ECDSA_secp256k1' = 'ECDSA_P256',
): Promise<string> {
  const core = await getWalletCore();
  const pkBytes = hexToBytes(privateKeyHex);
  const msgBytes = hexToBytes(messageHex);

  const privateKey = core.PrivateKey.createWithData(pkBytes);
  const curve =
    sigAlgo === 'ECDSA_secp256k1' ? core.Curve.secp256k1 : core.Curve.nist256p1;

  const signature = privateKey.sign(msgBytes, curve);
  privateKey.delete();

  if (!signature || signature.length === 0) {
    throw new Error('Signing failed');
  }

  // wallet-core returns a DER-encoded signature for ECDSA curves.
  // FCL expects a raw (r || s) signature (64 bytes).
  // Use AsnParser to convert DER → raw.
  const rawSig = core.AsnParser.ecdsaSignatureFromDer(signature);
  return bytesToHex(rawSig);
}

// ---------------------------------------------------------------------------
// Local storage persistence
// ---------------------------------------------------------------------------

export function saveLocalKeys(keys: LocalKey[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch (err) {
    console.error('Failed to save local keys:', err);
  }
}

export function loadLocalKeys(): LocalKey[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as LocalKey[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Account creation & discovery
// ---------------------------------------------------------------------------

/**
 * Create a Flow account via the Supabase edge function (which calls Lilico API).
 * The edge function endpoint /keys/create-account is public (no auth required).
 */
export async function createFlowAccount(
  publicKey: string,
  sigAlgo: 'ECDSA_P256' | 'ECDSA_secp256k1' = 'ECDSA_P256',
  hashAlgo: 'SHA2_256' | 'SHA3_256' = 'SHA3_256',
  network: 'mainnet' | 'testnet' = 'testnet',
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<{ address: string }> {
  const res = await fetch(`${supabaseUrl}/functions/v1/flow-keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseAnonKey,
    },
    body: JSON.stringify({
      endpoint: '/keys/create-account',
      data: {
        publicKey,
        signatureAlgorithm: sigAlgo,
        hashAlgorithm: hashAlgo,
        network,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Account creation failed: ${text}`);
  }

  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error?.message || 'Account creation failed');
  }
  return json.data;
}

/**
 * Query the Flow key indexer to find accounts that have a matching public key.
 * Uses the public Flow key indexer service (no auth needed, no CORS issues).
 */
export async function findAccountsForKey(
  publicKey: string,
  network: 'mainnet' | 'testnet' = 'testnet',
): Promise<KeyAccount[]> {
  // Flow's public key indexer
  const baseUrl = network === 'testnet'
    ? 'https://key-indexer.testnet.flow.com'
    : 'https://key-indexer.mainnet.flow.com';

  const res = await fetch(`${baseUrl}/key/${publicKey}`);

  if (!res.ok) {
    if (res.status === 404) return [];
    // Fallback: try Lilico's indexer
    return findAccountsViaLilico(publicKey, network);
  }

  const data = await res.json();

  // Normalize response into KeyAccount[]
  if (Array.isArray(data)) {
    return data.map((item: Record<string, unknown>) => ({
      flowAddress: String(item.address || item.flowAddress || ''),
      keyIndex: Number(item.keyIndex ?? item.key_index ?? 0),
      sigAlgo: normalizeSigAlgo(item.sigAlgo ?? item.sig_algo),
      hashAlgo: normalizeHashAlgo(item.hashAlgo ?? item.hash_algo),
      weight: Number(item.weight ?? 1000),
    }));
  }

  return [];
}

async function findAccountsViaLilico(
  publicKey: string,
  network: 'mainnet' | 'testnet',
): Promise<KeyAccount[]> {
  try {
    const url = network === 'testnet'
      ? `https://openapi.lilico.app/v1/address/testnet/${publicKey}`
      : `https://openapi.lilico.app/v1/address/${publicKey}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.address) {
      return [{
        flowAddress: data.address,
        keyIndex: 0,
        sigAlgo: 'ECDSA_P256',
        hashAlgo: 'SHA2_256',
        weight: 1000,
      }];
    }
    return [];
  } catch {
    return [];
  }
}

function normalizeSigAlgo(
  val: unknown,
): 'ECDSA_P256' | 'ECDSA_secp256k1' {
  const s = String(val).toUpperCase();
  if (s.includes('SECP256K1') || s === '3') return 'ECDSA_secp256k1';
  return 'ECDSA_P256';
}

function normalizeHashAlgo(val: unknown): 'SHA2_256' | 'SHA3_256' {
  const s = String(val).toUpperCase();
  if (s.includes('SHA2') || s === '1') return 'SHA2_256';
  return 'SHA3_256';
}

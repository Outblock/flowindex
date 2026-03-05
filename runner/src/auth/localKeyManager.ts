/**
 * Local Key Manager — client-side Flow key management using @trustwallet/wallet-core WASM.
 *
 * Ported from Flow-Wallet-Tool patterns. All crypto operations run in the browser;
 * private keys never leave the client.
 */

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
  autoPassword?: string; // random password for default keys (stored in localStorage, transparent to user)
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
    walletCorePromise = import('@trustwallet/wallet-core').then(({ initWasm }) => initWasm()).then((core) => {
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

/** Generate a random 32-char hex password for transparent key encryption. */
export function generateRandomPassword(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
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
  privateKeyHex: string;           // nist256p1-derived (used for P256 signing)
  privateKeyHexSecp256k1: string;  // secp256k1-derived (used for secp256k1 signing)
  publicKeyP256: string;
  publicKeySecp256k1: string;
}

/**
 * Derive keys from a BIP39 mnemonic using the Flow BIP44 path.
 *
 * HD derivation with different curves produces DIFFERENT private keys from the
 * same mnemonic+path. So we derive twice:
 *   - nist256p1 curve → private key for P256 signing, P256 public key
 *   - secp256k1 curve → private key for secp256k1 signing, secp256k1 public key
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

  // P256: derive with nist256p1 curve
  const p256PrivateKey = wallet.getKeyByCurve(core.Curve.nist256p1, path);
  const p256PrivHex = bytesToHex(p256PrivateKey.data());
  const pubP256 = p256PrivateKey.getPublicKeyNist256p1();
  const pubP256U = pubP256.uncompressed();
  const p256PubHex = stripUncompressedPrefix(bytesToHex(pubP256U.data()));
  pubP256U.delete();
  pubP256.delete();
  p256PrivateKey.delete();

  // secp256k1: derive with secp256k1 curve (different private key!)
  const secpPrivateKey = wallet.getKeyByCurve(core.Curve.secp256k1, path);
  const secpPrivHex = bytesToHex(secpPrivateKey.data());
  const pubSecp = secpPrivateKey.getPublicKeySecp256k1(false);
  const secpPubHex = stripUncompressedPrefix(bytesToHex(pubSecp.data()));
  pubSecp.delete();
  secpPrivateKey.delete();

  wallet.delete();

  return {
    privateKeyHex: p256PrivHex,
    privateKeyHexSecp256k1: secpPrivHex,
    publicKeyP256: p256PubHex,
    publicKeySecp256k1: secpPubHex,
  };
}

/**
 * Derive both public keys from a raw private key hex string.
 * For raw imports, the same key bytes are used with both curves.
 */
export async function deriveFromPrivateKey(hex: string): Promise<DerivedKeys> {
  const core = await getWalletCore();
  const pkBytes = hexToBytes(hex);

  if (!core.PrivateKey.isValid(pkBytes, core.Curve.nist256p1)) {
    throw new Error('Invalid private key');
  }

  const privateKey = core.PrivateKey.createWithData(pkBytes);
  const privateKeyHex = bytesToHex(privateKey.data());

  // P256
  const pubP256 = privateKey.getPublicKeyNist256p1();
  const pubP256U = pubP256.uncompressed();
  const p256Hex = stripUncompressedPrefix(bytesToHex(pubP256U.data()));
  pubP256U.delete();
  pubP256.delete();

  // secp256k1
  const pubSecp = privateKey.getPublicKeySecp256k1(false);
  const secpHex = stripUncompressedPrefix(bytesToHex(pubSecp.data()));
  pubSecp.delete();

  privateKey.delete();

  return {
    privateKeyHex,
    privateKeyHexSecp256k1: privateKeyHex, // same key for raw imports
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
 *
 * For mnemonic-based keystores, we decrypt the mnemonic and re-derive
 * with the correct curve (nist256p1 for P256, secp256k1 for secp256k1).
 * HD derivation with different curves produces different private keys!
 *
 * @param sigAlgo  Which curve's private key to return (for mnemonic keys).
 *                 Defaults to P256 for backwards compatibility.
 */
export async function decryptFromKeystore(
  json: string,
  password: string = '',
  sigAlgo: 'ECDSA_P256' | 'ECDSA_secp256k1' = 'ECDSA_P256',
): Promise<string> {
  const core = await getWalletCore();
  const jsonBytes = stringToBytes(json);
  const pwBytes = stringToBytes(password);

  const storedKey = core.StoredKey.importJSON(jsonBytes);

  // Check if this is a mnemonic-based keystore by trying to decrypt mnemonic
  const mnemonic = storedKey.decryptMnemonic(pwBytes);
  if (mnemonic && mnemonic.length > 0) {
    storedKey.delete();
    // Re-derive with the correct curve
    const derived = await deriveFromMnemonic(mnemonic);
    return sigAlgo === 'ECDSA_secp256k1'
      ? derived.privateKeyHexSecp256k1
      : derived.privateKeyHex;
  }

  // Private key-based keystore: decrypt directly (same key for both curves)
  const privateKeyBytes = storedKey.decryptPrivateKey(pwBytes);

  if (!privateKeyBytes || privateKeyBytes.length === 0) {
    storedKey.delete();
    throw new Error('Failed to decrypt keystore — wrong password?');
  }

  const hex = bytesToHex(privateKeyBytes);
  storedKey.delete();

  return hex;
}

/**
 * Decrypt the mnemonic from a mnemonic-based StoredKey JSON string.
 * Returns null if the keystore is not mnemonic-based.
 */
export async function decryptMnemonicFromKeystore(
  json: string,
  password: string = '',
): Promise<string | null> {
  const core = await getWalletCore();
  const jsonBytes = stringToBytes(json);
  const pwBytes = stringToBytes(password);

  const storedKey = core.StoredKey.importJSON(jsonBytes);
  const mnemonic = storedKey.decryptMnemonic(pwBytes);
  storedKey.delete();

  if (mnemonic && mnemonic.length > 0) return mnemonic;
  return null;
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

/**
 * Sign a hex-encoded message using wallet-core.
 *
 * FCL sends `signable.message` as a hex string of the RLP-encoded,
 * domain-tagged transaction payload (NOT pre-hashed). We must:
 *   1. Hash the message with the account's hash algorithm (SHA2_256 or SHA3_256)
 *   2. Sign the 32-byte digest with the private key (wallet-core expects a digest)
 *   3. Strip the recovery byte (v) — FCL expects raw r||s (64 bytes)
 *
 * Reference: Flow-Wallet-Tool signWithKey implementation.
 *
 * @param privateKeyHex  Hex-encoded private key
 * @param messageHex     Hex-encoded message (unhashed, from FCL signable.message)
 * @param sigAlgo        Signature algorithm
 * @param hashAlgo       Hash algorithm matching the on-chain key configuration
 * @returns Hex-encoded signature (r||s, 64 bytes)
 */
export async function signMessage(
  privateKeyHex: string,
  messageHex: string,
  sigAlgo: 'ECDSA_P256' | 'ECDSA_secp256k1' = 'ECDSA_secp256k1',
  hashAlgo: 'SHA2_256' | 'SHA3_256' = 'SHA2_256',
): Promise<string> {
  const core = await getWalletCore();
  const pkBytes = hexToBytes(privateKeyHex);
  const msgBytes = hexToBytes(messageHex);

  // 1. Hash the message with the correct algorithm
  const messageHash = hashAlgo === 'SHA3_256'
    ? core.Hash.sha3_256(msgBytes)
    : core.Hash.sha256(msgBytes);

  // 2. Sign the hash digest
  const privateKey = core.PrivateKey.createWithData(pkBytes);
  if (!privateKey) {
    throw new Error('Failed to load private key — the key data may be corrupt or invalid');
  }
  const curve =
    sigAlgo === 'ECDSA_secp256k1' ? core.Curve.secp256k1 : core.Curve.nist256p1;

  const signature = privateKey.sign(messageHash, curve);
  privateKey.delete();

  if (!signature || signature.length === 0) {
    throw new Error('Signing failed');
  }

  // 3. Strip recovery byte — FCL expects raw r||s (64 bytes)
  // Both curves return r(32) || s(32) || v(1) = 65 bytes when signing a 32-byte digest
  return bytesToHex(signature.subarray(0, signature.length - 1));
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
 * Returns immediately with the txId — does NOT wait for the tx to seal.
 * Use findAccountsForKey to discover the created address afterwards.
 */
export async function createFlowAccount(
  publicKey: string,
  sigAlgo: 'ECDSA_P256' | 'ECDSA_secp256k1' = 'ECDSA_secp256k1',
  hashAlgo: 'SHA2_256' | 'SHA3_256' = 'SHA3_256',
  network: 'mainnet' | 'testnet' = 'testnet',
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<{ txId: string }> {
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
  return { txId: json.data?.txId || json.data?.address || '' };
}

/**
 * Query FlowIndex API to find accounts that have a matching public key.
 * Uses flowindex.io (our own indexer) — no auth needed, supports both networks.
 */
export async function findAccountsForKey(
  publicKey: string,
  network: 'mainnet' | 'testnet' = 'testnet',
): Promise<KeyAccount[]> {
  // Try FlowIndex first with 5s timeout, fall back to Flow key-indexer
  try {
    const result = await findAccountsViaFlowIndex(publicKey, network);
    if (result.length > 0) return result;
  } catch { /* timeout or error — fall through */ }

  return findAccountsViaKeyIndexer(publicKey, network);
}

/** Fetch with a timeout (AbortController). */
function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

/** Primary: FlowIndex API. */
async function findAccountsViaFlowIndex(
  publicKey: string,
  network: 'mainnet' | 'testnet',
): Promise<KeyAccount[]> {
  const baseUrl = network === 'testnet'
    ? 'https://testnet.flowindex.io'
    : 'https://flowindex.io';

  const res = await fetchWithTimeout(`${baseUrl}/api/flow/key/${publicKey}`, 5000);
  if (!res.ok) return [];

  const json = await res.json();
  const data = json.data;

  if (Array.isArray(data)) {
    return data
      .filter((item: Record<string, unknown>) => !item.revoked && Number(item.weight ?? 1000) >= 1000)
      .map((item: Record<string, unknown>) => ({
        flowAddress: String(item.address || '').replace(/^0x/, ''),
        keyIndex: Number(item.key_index ?? 0),
        sigAlgo: normalizeSigAlgo(item.signing_algorithm),
        hashAlgo: normalizeHashAlgo(item.hashing_algorithm),
        weight: Number(item.weight ?? 1000),
      }));
  }
  return [];
}

/** Fallback: Flow key-indexer API (production / staging). */
async function findAccountsViaKeyIndexer(
  publicKey: string,
  network: 'mainnet' | 'testnet',
): Promise<KeyAccount[]> {
  const env = network === 'mainnet' ? 'production' : 'staging';
  const res = await fetch(`https://${env}.key-indexer.flow.com/key/${publicKey}`);
  if (!res.ok) return [];

  const json = await res.json();
  const accounts = json.accounts;

  if (Array.isArray(accounts)) {
    return accounts
      .filter((item: Record<string, unknown>) => !item.isRevoked && Number(item.weight ?? 0) >= 1000)
      .map((item: Record<string, unknown>) => ({
        flowAddress: String(item.address || '').replace(/^0x/, ''),
        keyIndex: Number(item.keyId ?? 0),
        sigAlgo: normalizeSigAlgo(item.signing || item.sigAlgo),
        hashAlgo: normalizeHashAlgo(item.hashing || item.hashAlgo),
        weight: Number(item.weight ?? 1000),
      }));
  }
  return [];
}

function normalizeSigAlgo(
  val: unknown,
): 'ECDSA_P256' | 'ECDSA_secp256k1' {
  const s = String(val).toUpperCase();
  if (s.includes('SECP256K1')) return 'ECDSA_secp256k1';
  // Flow SDK numbering: 2=P256, 3=secp256k1
  if (s === '3') return 'ECDSA_secp256k1';
  return 'ECDSA_P256';
}

function normalizeHashAlgo(val: unknown): 'SHA2_256' | 'SHA3_256' {
  const s = String(val).toUpperCase();
  if (s.includes('SHA2')) return 'SHA2_256';
  // FlowIndex API: 1=SHA2_256, 3=SHA3_256
  // Flow SDK:      1=SHA2_256, 3=SHA3_256
  if (s === '1') return 'SHA2_256';
  return 'SHA3_256';
}

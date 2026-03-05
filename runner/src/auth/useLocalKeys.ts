/**
 * useLocalKeys — React hook for managing locally-stored Flow keys.
 *
 * Keys are persisted in localStorage and encrypted via wallet-core StoredKey.
 * Private keys never leave the browser.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  LocalKey,
  KeyAccount,
  DerivedKeys,
} from './localKeyManager';
import {
  getWalletCore,
  generateMnemonic,
  deriveFromMnemonic,
  deriveFromPrivateKey,
  encryptToKeystore,
  encryptMnemonicToKeystore,
  decryptFromKeystore,
  decryptMnemonicFromKeystore,
  signMessage,
  saveLocalKeys,
  loadLocalKeys,
  findAccountsForKey,
  createFlowAccount,
  generateRandomPassword,
} from './localKeyManager';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Signer option for the dropdown — represents a local key + on-chain account. */
export interface LocalSignerOption {
  type: 'local';
  key: LocalKey;
  account: KeyAccount;
}

export interface UseLocalKeysReturn {
  localKeys: LocalKey[];
  accountsMap: Record<string, KeyAccount[]>; // keyId -> accounts
  loading: boolean;
  wasmReady: boolean;
  ensureWasmReady: () => Promise<void>;
  // Key operations
  generateNewKey: (
    label: string,
    wordCount?: 12 | 24,
    password?: string,
  ) => Promise<{ mnemonic: string; key: LocalKey }>;
  importMnemonic: (
    mnemonic: string,
    label: string,
    passphrase?: string,
    path?: string,
    password?: string,
  ) => Promise<LocalKey>;
  importPrivateKey: (
    hex: string,
    label: string,
    password?: string,
  ) => Promise<LocalKey>;
  importKeystore: (
    json: string,
    keystorePassword: string,
    label: string,
    newPassword?: string,
  ) => Promise<LocalKey>;
  deleteLocalKey: (id: string) => void;
  exportKeystore: (id: string, password?: string) => Promise<string>;
  // Signing
  signWithLocalKey: (
    keyId: string,
    message: string,
    hashAlgo?: 'SHA2_256' | 'SHA3_256',
    password?: string,
    sigAlgo?: 'ECDSA_P256' | 'ECDSA_secp256k1',
  ) => Promise<string>;
  // Account lookup
  refreshAccounts: (
    keyId: string,
    network: 'mainnet' | 'testnet',
  ) => Promise<KeyAccount[]>;
  // Account creation
  createAccount: (
    keyId: string,
    sigAlgo: 'ECDSA_P256' | 'ECDSA_secp256k1',
    hashAlgo: 'SHA2_256' | 'SHA3_256',
    network: 'mainnet' | 'testnet',
  ) => Promise<{ txId: string }>;
  // Private key access
  getPrivateKey: (keyId: string, password?: string, sigAlgo?: 'ECDSA_P256' | 'ECDSA_secp256k1') => Promise<string>;
  // Reveal secret — returns { type: 'mnemonic', value } or { type: 'privateKey', value }
  revealSecret: (keyId: string, password?: string) => Promise<{ type: 'mnemonic' | 'privateKey'; value: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(): string {
  return `lk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLocalKeys(): UseLocalKeysReturn {
  const [localKeys, setLocalKeys] = useState<LocalKey[]>([]);
  const [accountsMap, setAccountsMap] = useState<Record<string, KeyAccount[]>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [wasmReady, setWasmReady] = useState(false);

  // In-memory cache of decrypted private keys (keyId -> hex string)
  const keyCache = useRef<Map<string, string>>(new Map());

  // -------------------------------------------------------------------------
  // Init: load keys from localStorage
  // -------------------------------------------------------------------------

  useEffect(() => {
    const keys = loadLocalKeys();
    setLocalKeys(keys);
    setLoading(false);
  }, []);

  const ensureWasmReady = useCallback(async () => {
    if (wasmReady) return;
    try {
      await getWalletCore();
      setWasmReady(true);
    } catch (err) {
      console.error('Failed to init wallet-core WASM:', err);
      throw err;
    }
  }, [wasmReady]);

  // -------------------------------------------------------------------------
  // Persist keys to localStorage whenever they change
  // -------------------------------------------------------------------------

  const isInitialMount = useRef(true);

  useEffect(() => {
    // Skip the initial mount (we just loaded from localStorage)
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    saveLocalKeys(localKeys);
  }, [localKeys]);

  // -------------------------------------------------------------------------
  // Clear key cache on page unload
  // -------------------------------------------------------------------------

  useEffect(() => {
    const handleUnload = () => {
      keyCache.current.clear();
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, []);

  // -------------------------------------------------------------------------
  // Internal: get decrypted private key (cache-first)
  // -------------------------------------------------------------------------

  const getPrivateKey = useCallback(
    async (
      keyId: string,
      password?: string,
      sigAlgo: 'ECDSA_P256' | 'ECDSA_secp256k1' = 'ECDSA_P256',
    ): Promise<string> => {
      await ensureWasmReady();
      // Cache key includes sigAlgo because mnemonic keys have different
      // private keys per curve (HD derivation with different curves)
      const cacheKey = `${keyId}:${sigAlgo}`;

      // Try cache first
      const cached = keyCache.current.get(cacheKey);
      if (cached) return cached;

      // Find the key
      const key = localKeys.find((k) => k.id === keyId);
      if (!key) throw new Error(`Local key not found: ${keyId}`);

      // Use autoPassword if available (transparent to user)
      if (key.autoPassword) {
        const hex = await decryptFromKeystore(key.encryptedKey, key.autoPassword, sigAlgo);
        keyCache.current.set(cacheKey, hex);
        return hex;
      }

      // If password-protected and no password provided, signal the UI
      if (key.hasPassword && !password) {
        throw new Error('PASSWORD_REQUIRED');
      }

      const hex = await decryptFromKeystore(key.encryptedKey, password ?? '', sigAlgo);
      keyCache.current.set(cacheKey, hex);
      return hex;
    },
    [ensureWasmReady, localKeys],
  );

  // -------------------------------------------------------------------------
  // Reveal secret — mnemonic for mnemonic keys, private key for others
  // -------------------------------------------------------------------------

  const revealSecret = useCallback(
    async (keyId: string, password?: string): Promise<{ type: 'mnemonic' | 'privateKey'; value: string }> => {
      await ensureWasmReady();
      const key = localKeys.find((k) => k.id === keyId);
      if (!key) throw new Error(`Local key not found: ${keyId}`);

      const pw = key.autoPassword ?? password;
      if (!pw && key.hasPassword && !password) throw new Error('PASSWORD_REQUIRED');

      // For mnemonic-based keys, try to decrypt the mnemonic
      if (key.source === 'mnemonic') {
        const mnemonic = await decryptMnemonicFromKeystore(key.encryptedKey, pw ?? '');
        if (mnemonic) return { type: 'mnemonic', value: mnemonic };
      }

      // Fallback to private key
      const hex = await getPrivateKey(keyId, password);
      return { type: 'privateKey', value: hex };
    },
    [ensureWasmReady, localKeys, getPrivateKey],
  );

  // -------------------------------------------------------------------------
  // Internal: build a LocalKey from derived keys
  // -------------------------------------------------------------------------

  const buildLocalKey = useCallback(
    async (
      derived: DerivedKeys,
      label: string,
      source: LocalKey['source'],
      password: string,
    ): Promise<LocalKey> => {
      // If no user password, generate a random one for transparent encryption
      const autoPass = password.length === 0 ? generateRandomPassword() : undefined;
      const effectivePassword = autoPass ?? password;

      const encryptedKey = await encryptToKeystore(
        derived.privateKeyHex,
        effectivePassword,
      );

      const key: LocalKey = {
        id: generateId(),
        label,
        publicKeyP256: derived.publicKeyP256,
        publicKeySecp256k1: derived.publicKeySecp256k1,
        source,
        encryptedKey,
        hasPassword: password.length > 0,
        ...(autoPass ? { autoPassword: autoPass } : {}),
        createdAt: Date.now(),
      };

      // Cache the decrypted private keys (same key for both curves in raw import)
      keyCache.current.set(`${key.id}:ECDSA_P256`, derived.privateKeyHex);
      keyCache.current.set(`${key.id}:ECDSA_secp256k1`, derived.privateKeyHexSecp256k1);

      return key;
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Key operations
  // -------------------------------------------------------------------------

  const generateNewKey = useCallback(
    async (
      label: string,
      wordCount: 12 | 24 = 12,
      password: string = '',
    ): Promise<{ mnemonic: string; key: LocalKey }> => {
      await ensureWasmReady();
      const mnemonic = await generateMnemonic(wordCount);
      const derived = await deriveFromMnemonic(mnemonic);

      // If no user password, generate a random one for transparent encryption
      const autoPass = password.length === 0 ? generateRandomPassword() : undefined;
      const effectivePassword = autoPass ?? password;

      // For mnemonic-based keys, encrypt the mnemonic itself
      const encryptedKey = await encryptMnemonicToKeystore(mnemonic, effectivePassword);

      const key: LocalKey = {
        id: generateId(),
        label,
        publicKeyP256: derived.publicKeyP256,
        publicKeySecp256k1: derived.publicKeySecp256k1,
        source: 'mnemonic',
        encryptedKey,
        hasPassword: password.length > 0,
        ...(autoPass ? { autoPassword: autoPass } : {}),
        createdAt: Date.now(),
      };

      // Cache decrypted private keys for both curves
      keyCache.current.set(`${key.id}:ECDSA_P256`, derived.privateKeyHex);
      keyCache.current.set(`${key.id}:ECDSA_secp256k1`, derived.privateKeyHexSecp256k1);

      setLocalKeys((prev) => [...prev, key]);
      return { mnemonic, key };
    },
    [ensureWasmReady],
  );

  const importMnemonic = useCallback(
    async (
      mnemonic: string,
      label: string,
      passphrase: string = '',
      path?: string,
      password: string = '',
    ): Promise<LocalKey> => {
      await ensureWasmReady();
      const derived = await deriveFromMnemonic(mnemonic, passphrase, path);

      const autoPass = password.length === 0 ? generateRandomPassword() : undefined;
      const effectivePassword = autoPass ?? password;
      const encryptedKey = await encryptMnemonicToKeystore(mnemonic, effectivePassword);

      const key: LocalKey = {
        id: generateId(),
        label,
        publicKeyP256: derived.publicKeyP256,
        publicKeySecp256k1: derived.publicKeySecp256k1,
        source: 'mnemonic',
        encryptedKey,
        hasPassword: password.length > 0,
        ...(autoPass ? { autoPassword: autoPass } : {}),
        createdAt: Date.now(),
      };

      keyCache.current.set(`${key.id}:ECDSA_P256`, derived.privateKeyHex);
      keyCache.current.set(`${key.id}:ECDSA_secp256k1`, derived.privateKeyHexSecp256k1);

      setLocalKeys((prev) => [...prev, key]);
      return key;
    },
    [ensureWasmReady],
  );

  const importPrivateKey = useCallback(
    async (
      hex: string,
      label: string,
      password: string = '',
    ): Promise<LocalKey> => {
      await ensureWasmReady();
      const derived = await deriveFromPrivateKey(hex);
      const key = await buildLocalKey(derived, label, 'privateKey', password);
      setLocalKeys((prev) => [...prev, key]);
      return key;
    },
    [buildLocalKey],
  );

  const importKeystore = useCallback(
    async (
      json: string,
      keystorePassword: string,
      label: string,
      newPassword: string = '',
    ): Promise<LocalKey> => {
      await ensureWasmReady();
      // Decrypt from the imported keystore
      const privateKeyHex = await decryptFromKeystore(json, keystorePassword);
      const derived = await deriveFromPrivateKey(privateKeyHex);

      // Re-encrypt with the new password (or empty)
      const key = await buildLocalKey(derived, label, 'keystore', newPassword);
      setLocalKeys((prev) => [...prev, key]);
      return key;
    },
    [buildLocalKey, ensureWasmReady],
  );

  const deleteLocalKey = useCallback((id: string) => {
    keyCache.current.delete(`${id}:ECDSA_P256`);
    keyCache.current.delete(`${id}:ECDSA_secp256k1`);
    setLocalKeys((prev) => prev.filter((k) => k.id !== id));
    setAccountsMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const exportKeystore = useCallback(
    async (id: string, exportPassword: string = ''): Promise<string> => {
      await ensureWasmReady();
      // Decrypt using autoPassword or user password
      const privateKeyHex = await getPrivateKey(id, exportPassword);
      // Re-encrypt with the user-provided export password (never leak autoPassword)
      return encryptToKeystore(privateKeyHex, exportPassword);
    },
    [ensureWasmReady, getPrivateKey],
  );

  // -------------------------------------------------------------------------
  // Signing
  // -------------------------------------------------------------------------

  const signWithLocalKey = useCallback(
    async (
      keyId: string,
      message: string,
      hashAlgo: 'SHA2_256' | 'SHA3_256' = 'SHA2_256',
      password?: string,
      sigAlgo: 'ECDSA_P256' | 'ECDSA_secp256k1' = 'ECDSA_secp256k1',
    ): Promise<string> => {
      await ensureWasmReady();
      const privateKeyHex = await getPrivateKey(keyId, password, sigAlgo);
      return signMessage(privateKeyHex, message, sigAlgo, hashAlgo);
    },
    [ensureWasmReady, getPrivateKey],
  );

  // -------------------------------------------------------------------------
  // Account lookup
  // -------------------------------------------------------------------------

  const refreshAccounts = useCallback(
    async (
      keyId: string,
      network: 'mainnet' | 'testnet',
    ): Promise<KeyAccount[]> => {
      const key = localKeys.find((k) => k.id === keyId);
      if (!key) throw new Error(`Local key not found: ${keyId}`);

      // Query both P256 and secp256k1 public keys in parallel
      const [p256Accounts, secpAccounts] = await Promise.all([
        findAccountsForKey(key.publicKeyP256, network).catch(
          () => [] as KeyAccount[],
        ),
        findAccountsForKey(key.publicKeySecp256k1, network).catch(
          () => [] as KeyAccount[],
        ),
      ]);

      // Override sigAlgo based on which public key search found the account
      // (more reliable than trusting the API's numeric value)
      for (const acc of p256Accounts) acc.sigAlgo = 'ECDSA_P256';
      for (const acc of secpAccounts) acc.sigAlgo = 'ECDSA_secp256k1';

      // Merge and deduplicate by address + keyIndex
      const seen = new Set<string>();
      const merged: KeyAccount[] = [];
      for (const account of [...p256Accounts, ...secpAccounts]) {
        const dedupeKey = `${account.flowAddress}-${account.keyIndex}`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          merged.push(account);
        }
      }

      setAccountsMap((prev) => ({ ...prev, [keyId]: merged }));
      return merged;
    },
    [localKeys],
  );

  // -------------------------------------------------------------------------
  // Account creation
  // -------------------------------------------------------------------------

  const createAccount = useCallback(
    async (
      keyId: string,
      sigAlgo: 'ECDSA_P256' | 'ECDSA_secp256k1',
      hashAlgo: 'SHA2_256' | 'SHA3_256',
      network: 'mainnet' | 'testnet',
    ): Promise<{ txId: string }> => {
      const key = localKeys.find((k) => k.id === keyId);
      if (!key) throw new Error(`Local key not found: ${keyId}`);

      const publicKey =
        sigAlgo === 'ECDSA_secp256k1'
          ? key.publicKeySecp256k1
          : key.publicKeyP256;

      const result = await createFlowAccount(
        publicKey,
        sigAlgo,
        hashAlgo,
        network,
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
      );

      // Refresh accounts after creation
      await refreshAccounts(keyId, network).catch(() => {
        // Non-critical — the account may not be indexed immediately
      });

      return { txId: result.txId ?? '' };
    },
    [localKeys, refreshAccounts],
  );

  return {
    localKeys,
    accountsMap,
    loading,
    wasmReady,
    ensureWasmReady,
    generateNewKey,
    importMnemonic,
    importPrivateKey,
    importKeystore,
    deleteLocalKey,
    exportKeystore,
    signWithLocalKey,
    refreshAccounts,
    createAccount,
    getPrivateKey,
    revealSecret,
  };
}

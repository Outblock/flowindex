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
  DecryptedKeys,
} from './localKeyManager';
import {
  getWalletCore,
  generateMnemonic,
  deriveFromMnemonic,
  deriveFromPrivateKey,
  encryptToKeystore,
  encryptMnemonicToKeystore,
  decryptFromKeystore,
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

  // In-memory cache of decrypted private keys (keyId -> { p256, secp256k1? })
  const keyCache = useRef<Map<string, DecryptedKeys>>(new Map());

  // -------------------------------------------------------------------------
  // Init: load keys from localStorage + init WASM
  // -------------------------------------------------------------------------

  useEffect(() => {
    const keys = loadLocalKeys();
    setLocalKeys(keys);

    getWalletCore()
      .then(() => setWasmReady(true))
      .catch((err) => console.error('Failed to init wallet-core WASM:', err))
      .finally(() => setLoading(false));
  }, []);

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
    async (keyId: string, password?: string, sigAlgo?: 'ECDSA_P256' | 'ECDSA_secp256k1'): Promise<string> => {
      // Try cache first
      const cached = keyCache.current.get(keyId);
      if (cached) {
        // For secp256k1, use the dedicated key if available (mnemonic-derived)
        if (sigAlgo === 'ECDSA_secp256k1' && cached.privateKeySecpHex) {
          return cached.privateKeySecpHex;
        }
        return cached.privateKeyHex;
      }

      // Find the key
      const key = localKeys.find((k) => k.id === keyId);
      if (!key) throw new Error(`Local key not found: ${keyId}`);

      // Use autoPassword if available (transparent to user)
      if (key.autoPassword) {
        const decrypted = await decryptFromKeystore(
          key.encryptedKey,
          key.autoPassword,
        );
        keyCache.current.set(keyId, decrypted);
        if (sigAlgo === 'ECDSA_secp256k1' && decrypted.privateKeySecpHex) {
          return decrypted.privateKeySecpHex;
        }
        return decrypted.privateKeyHex;
      }

      // If password-protected and no password provided, signal the UI
      if (key.hasPassword && !password) {
        throw new Error('PASSWORD_REQUIRED');
      }

      const decrypted = await decryptFromKeystore(
        key.encryptedKey,
        password ?? '',
      );

      // Cache the decrypted keys
      keyCache.current.set(keyId, decrypted);

      if (sigAlgo === 'ECDSA_secp256k1' && decrypted.privateKeySecpHex) {
        return decrypted.privateKeySecpHex;
      }
      return decrypted.privateKeyHex;
    },
    [localKeys],
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

      // Cache the decrypted private keys
      keyCache.current.set(key.id, {
        privateKeyHex: derived.privateKeyHex,
        privateKeySecpHex: derived.privateKeySecpHex,
      });

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

      // Cache decrypted private keys
      keyCache.current.set(key.id, {
        privateKeyHex: derived.privateKeyHex,
        privateKeySecpHex: derived.privateKeySecpHex,
      });

      setLocalKeys((prev) => [...prev, key]);
      return { mnemonic, key };
    },
    [],
  );

  const importMnemonic = useCallback(
    async (
      mnemonic: string,
      label: string,
      passphrase: string = '',
      path?: string,
      password: string = '',
    ): Promise<LocalKey> => {
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

      keyCache.current.set(key.id, {
        privateKeyHex: derived.privateKeyHex,
        privateKeySecpHex: derived.privateKeySecpHex,
      });

      setLocalKeys((prev) => [...prev, key]);
      return key;
    },
    [],
  );

  const importPrivateKey = useCallback(
    async (
      hex: string,
      label: string,
      password: string = '',
    ): Promise<LocalKey> => {
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
      // Decrypt from the imported keystore
      const decrypted = await decryptFromKeystore(json, keystorePassword);
      const derived = await deriveFromPrivateKey(decrypted.privateKeyHex);

      // Re-encrypt with the new password (or empty)
      const key = await buildLocalKey(derived, label, 'keystore', newPassword);
      setLocalKeys((prev) => [...prev, key]);
      return key;
    },
    [buildLocalKey],
  );

  const deleteLocalKey = useCallback((id: string) => {
    keyCache.current.delete(id);
    setLocalKeys((prev) => prev.filter((k) => k.id !== id));
    setAccountsMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const exportKeystore = useCallback(
    async (id: string, exportPassword: string = ''): Promise<string> => {
      // Decrypt using autoPassword or user password
      const privateKeyHex = await getPrivateKey(id, exportPassword);
      // Re-encrypt with the user-provided export password (never leak autoPassword)
      return encryptToKeystore(privateKeyHex, exportPassword);
    },
    [getPrivateKey],
  );

  // -------------------------------------------------------------------------
  // Signing
  // -------------------------------------------------------------------------

  const signWithLocalKey = useCallback(
    async (
      keyId: string,
      message: string,
      _hashAlgo?: 'SHA2_256' | 'SHA3_256',
      password?: string,
      sigAlgo: 'ECDSA_P256' | 'ECDSA_secp256k1' = 'ECDSA_P256',
    ): Promise<string> => {
      const privateKeyHex = await getPrivateKey(keyId, password, sigAlgo);
      return signMessage(privateKeyHex, message, sigAlgo);
    },
    [getPrivateKey],
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
  };
}

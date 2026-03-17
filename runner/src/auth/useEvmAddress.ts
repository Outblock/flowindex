import { useState, useEffect } from 'react';
import type { LocalKey } from './localKeyManager';
import { getEvmAddress } from './localKeyManager';

/**
 * Hook to get the EVM EOA address for a LocalKey.
 * Returns key.evmAddress immediately if available, otherwise falls back
 * to async derivation via wallet-core for legacy keys.
 */
export function useEvmAddress(key: LocalKey | null): string | null {
  const [address, setAddress] = useState<string | null>(key?.evmAddress ?? null);

  useEffect(() => {
    if (!key) { setAddress(null); return; }
    // Fast path: already stored on the key
    if (key.evmAddress) { setAddress(key.evmAddress); return; }
    // Fallback: async derivation for legacy keys
    let cancelled = false;
    getEvmAddress(key).then((addr) => {
      if (!cancelled) setAddress(addr);
    }).catch(() => {
      if (!cancelled) setAddress(null);
    });
    return () => { cancelled = true; };
  }, [key?.evmAddress, key?.publicKeySecp256k1]);

  return address;
}

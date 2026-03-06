// ---------------------------------------------------------------------------
// useAddresses — manages Flow addresses with localStorage fallback
// When authenticated: syncs to Supabase. When not: localStorage only.
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth/AuthContext';
import {
  listAddresses,
  addAddress as addAddressApi,
  deleteAddress as deleteAddressApi,
  type VerifiedAddress,
  type AddressSource,
} from './api';

const STORAGE_KEY = 'runner_deploy_addresses';

function loadLocal(): VerifiedAddress[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocal(addrs: VerifiedAddress[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(addrs));
}

export function useAddresses() {
  const { accessToken } = useAuth();
  const [addresses, setAddresses] = useState<VerifiedAddress[]>(loadLocal);
  const [loading, setLoading] = useState(false);

  // Fetch from server when authenticated
  const fetchAddresses = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const result = await listAddresses(accessToken);
      setAddresses(result);
      saveLocal(result);
    } catch {
      // Keep localStorage addresses on failure
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (accessToken) fetchAddresses();
  }, [accessToken, fetchAddresses]);

  const addAddress = useCallback(
    async (
      address: string,
      network: string,
      source: AddressSource,
      label?: string,
    ): Promise<VerifiedAddress> => {
      const normalized = address.replace(/^0x/, '').toLowerCase();

      // If authenticated, save to server
      if (accessToken) {
        const result = await addAddressApi(accessToken, normalized, network, source, label);
        await fetchAddresses();
        return result;
      }

      // Otherwise, save to localStorage only
      const existing = addresses.find(
        (a) => a.address === normalized && a.network === network,
      );
      if (existing) {
        // Update source/label
        const updated = { ...existing, source, label: label || existing.label };
        setAddresses((prev) => {
          const next = prev.map((a) => (a.id === existing.id ? updated : a));
          saveLocal(next);
          return next;
        });
        return updated;
      }

      const newAddr: VerifiedAddress = {
        id: crypto.randomUUID(),
        user_id: '',
        address: normalized,
        network,
        label: label || null,
        source,
        verified_at: new Date().toISOString(),
      };
      setAddresses((prev) => {
        const next = [...prev, newAddr];
        saveLocal(next);
        return next;
      });
      return newAddr;
    },
    [accessToken, addresses, fetchAddresses],
  );

  const removeAddress = useCallback(
    async (id: string): Promise<void> => {
      if (accessToken) {
        await deleteAddressApi(accessToken, id);
      }
      setAddresses((prev) => {
        const next = prev.filter((a) => a.id !== id);
        saveLocal(next);
        return next;
      });
    },
    [accessToken],
  );

  return { addresses, loading, addAddress, removeAddress, fetchAddresses };
}

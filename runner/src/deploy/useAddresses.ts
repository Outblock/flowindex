// ---------------------------------------------------------------------------
// useAddresses — state management for verified Flow addresses
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth/AuthContext';
import {
  listAddresses,
  addAddress as addAddressApi,
  deleteAddress,
  type VerifiedAddress,
  type AddressSource,
} from './api';

export function useAddresses() {
  const { accessToken } = useAuth();
  const [addresses, setAddresses] = useState<VerifiedAddress[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAddresses = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const result = await listAddresses(accessToken);
      setAddresses(result);
    } catch {
      // Silently fail — user may not have any addresses yet
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  // Auto-fetch when token becomes available
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
      if (!accessToken) throw new Error('Not authenticated');
      const result = await addAddressApi(accessToken, address, network, source, label);
      // Refresh the list after adding
      await fetchAddresses();
      return result;
    },
    [accessToken, fetchAddresses],
  );

  const removeAddress = useCallback(
    async (id: string): Promise<void> => {
      if (!accessToken) throw new Error('Not authenticated');
      await deleteAddress(accessToken, id);
      // Optimistic removal
      setAddresses((prev) => prev.filter((a) => a.id !== id));
    },
    [accessToken],
  );

  return { addresses, loading, addAddress, removeAddress, fetchAddresses };
}

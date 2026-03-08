'use client'

import { useEffect, useMemo } from 'react'
import { useWalletStore } from '@/stores/wallet/store'

/**
 * Hook that loads wallet signer options and returns dropdown-compatible options.
 * Fetches wallets from FlowIndex if user has fi_auth cookie.
 */
export function useSignerOptions() {
  const { fetchWallets, getSignerOptions, isLoading, error } = useWalletStore()

  useEffect(() => {
    // Extract fi_auth token from cookie (client-side)
    if (typeof document === 'undefined') return
    const match = document.cookie.match(/fi_auth=([^;]+)/)
    if (match) {
      try {
        const token = decodeURIComponent(match[1]).replace(/^"(.*)"$/, '$1')
        fetchWallets(token)
      } catch {
        // Invalid cookie format, skip
      }
    }
  }, [fetchWallets])

  const signerOptions = useMemo(() => {
    const walletOptions = getSignerOptions()
    return [
      { label: 'Manual Key', id: 'manual' },
      ...walletOptions.map((opt) => ({ label: opt.label, id: opt.id })),
    ]
  }, [getSignerOptions])

  return {
    options: signerOptions,
    isLoading,
    error,
    hasWallets: signerOptions.length > 1, // More than just "Manual Key"
  }
}

import type { ProtocolResult, ProtocolId } from './types'
import { fetchIncrementFiPositions } from './incrementfi'
import { useState, useEffect, useCallback, useRef } from 'react'

/** Price map: token symbol → USD price */
type PriceMap = Record<string, number>

/**
 * Fetch DeFi positions from all protocols in parallel.
 * EVM adapters are dynamically imported (code-split) and skipped if no COA address.
 */
export async function fetchAllPositions(
  flowAddress: string,
  coaAddress: string | undefined,
  flowPriceUsd: number,
  prices: PriceMap,
): Promise<ProtocolResult[]> {
  const promises: Promise<ProtocolResult>[] = []

  // Cadence protocols — always query
  promises.push(fetchIncrementFiPositions(flowAddress, flowPriceUsd))

  // EVM protocols — only if COA address exists
  if (coaAddress) {
    const normalizedCoa = (coaAddress.startsWith('0x') ? coaAddress : `0x${coaAddress}`) as `0x${string}`

    // Dynamic import for code-splitting — viem only loaded when DeFi tab is opened
    const evmPromise = import('./evm/ankr').then(({ fetchAnkrPositions }) =>
      fetchAnkrPositions(normalizedCoa, flowPriceUsd)
    )
    const morePromise = import('./evm/more-markets').then(({ fetchMoreMarketsPositions }) =>
      fetchMoreMarketsPositions(normalizedCoa, prices)
    )
    const kittyPromise = import('./evm/kittypunch').then(({ fetchKittyPunchPositions }) =>
      fetchKittyPunchPositions(normalizedCoa, prices)
    )
    const flowswapPromise = import('./evm/flowswap').then(({ fetchFlowSwapPositions }) =>
      fetchFlowSwapPositions(normalizedCoa, prices)
    )

    promises.push(evmPromise, morePromise, kittyPromise, flowswapPromise)
  }

  const settled = await Promise.allSettled(promises)

  return settled.map((result, i) => {
    if (result.status === 'fulfilled') return result.value
    // Promise.allSettled rejection — shouldn't happen since adapters catch internally
    const protocols: ProtocolId[] = coaAddress
      ? ['incrementfi', 'ankr', 'more-markets', 'kittypunch', 'flowswap']
      : ['incrementfi']
    return {
      protocol: protocols[i] ?? 'incrementfi',
      status: 'error' as const,
      positions: [],
      error: result.reason?.message || 'Unknown error',
    }
  })
}

/**
 * Build price map from FLOW price. Extend with more tokens as backend provides them.
 * Defined at module level to avoid object identity instability.
 */
function buildPriceMap(flowPriceUsd: number): PriceMap {
  return {
    FLOW: flowPriceUsd,
    WFLOW: flowPriceUsd,
    // Add more as available from backend /status endpoint
  }
}

/**
 * React hook for fetching DeFi positions.
 * Manages loading, error, and staleness states.
 * Accepts only primitive/stable values to avoid re-render loops.
 */
export function useDefiPositions(
  flowAddress: string,
  coaAddress: string | undefined,
  flowPriceUsd: number,
) {
  const [results, setResults] = useState<ProtocolResult[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null)
  const fetchIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const id = ++fetchIdRef.current
    setLoading(true)

    // Build price map from primitives — no object identity issues
    const prices = buildPriceMap(flowPriceUsd)
    const allResults = await fetchAllPositions(flowAddress, coaAddress, flowPriceUsd, prices)

    // Only update if this is still the latest fetch
    if (id === fetchIdRef.current) {
      setResults(allResults)
      setLoading(false)
      setFetchedAt(new Date())
    }
  }, [flowAddress, coaAddress, flowPriceUsd])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Compute summary
  const totalValueUsd = results.reduce((sum, r) => {
    if (r.status !== 'ok') return sum
    return sum + r.positions.reduce((pSum, p) => {
      const posValue = p.assets.reduce((aSum, a) => aSum + (a.valueUsd ?? 0), 0)
      // Borrowing is negative
      return pSum + (p.type === 'borrowing' ? -posValue : posValue)
    }, 0)
  }, 0)

  const positionCount = results.reduce(
    (sum, r) => sum + (r.status === 'ok' ? r.positions.length : 0), 0
  )

  return {
    results,
    loading,
    fetchedAt,
    refresh,
    totalValueUsd,
    positionCount,
  }
}

import { useDefiPositions } from '../../services/defi'
import { DefiSummaryBar } from './defi/DefiSummaryBar'
import { DefiProtocolSection } from './defi/DefiProtocolSection'
import { DefiEmptyState } from './defi/DefiEmptyState'
import { GlassCard } from '@flowindex/flow-ui'

interface Props {
  address: string
  coaAddress?: string
  flowPriceUsd: number
}

export function AccountDefiTab({ address, coaAddress, flowPriceUsd }: Props) {
  const {
    results,
    loading,
    fetchedAt,
    refresh,
    totalValueUsd,
    positionCount,
  } = useDefiPositions(address, coaAddress, flowPriceUsd)

  if (loading && results.length === 0) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between mb-4">
          <div className="h-5 w-40 bg-zinc-200 dark:bg-white/5 animate-pulse rounded" />
          <div className="h-8 w-8 bg-zinc-200 dark:bg-white/5 animate-pulse rounded" />
        </div>
        {[0, 1, 2].map((i) => (
          <GlassCard key={i} className="h-14 animate-pulse" />
        ))}
      </div>
    )
  }

  // Sort by total value (highest first), errors last
  const sorted = [...results].sort((a, b) => {
    if (a.status === 'error' && b.status !== 'error') return 1
    if (b.status === 'error' && a.status !== 'error') return -1
    const valueA = a.positions.reduce((s, p) => s + p.assets.reduce((as2, asset) => as2 + (asset.valueUsd ?? 0), 0), 0)
    const valueB = b.positions.reduce((s, p) => s + p.assets.reduce((as2, asset) => as2 + (asset.valueUsd ?? 0), 0), 0)
    return valueB - valueA
  })

  const allEmpty = results.every((r) => r.status === 'ok' && r.positions.length === 0)

  if (allEmpty && !loading) {
    return (
      <>
        <DefiSummaryBar
          totalValueUsd={0}
          positionCount={0}
          fetchedAt={fetchedAt}
          loading={loading}
          onRefresh={refresh}
        />
        <DefiEmptyState noCoa={!coaAddress} />
      </>
    )
  }

  return (
    <div>
      <DefiSummaryBar
        totalValueUsd={totalValueUsd}
        positionCount={positionCount}
        fetchedAt={fetchedAt}
        loading={loading}
        onRefresh={refresh}
      />
      <div className="space-y-3">
        {sorted.map((result) => (
          <DefiProtocolSection
            key={result.protocol}
            result={result}
            defaultExpanded={result.status === 'ok' && result.positions.length > 0}
          />
        ))}
      </div>
    </div>
  )
}

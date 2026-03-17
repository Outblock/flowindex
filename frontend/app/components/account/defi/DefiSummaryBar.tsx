import { RefreshCw } from 'lucide-react'

interface Props {
  totalValueUsd: number
  positionCount: number
  fetchedAt: Date | null
  loading: boolean
  onRefresh: () => void
}

export function DefiSummaryBar({ totalValueUsd, positionCount, fetchedAt, loading, onRefresh }: Props) {
  const timeAgo = fetchedAt ? getTimeAgo(fetchedAt) : null

  return (
    <div className="flex items-center justify-between mb-4">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500">DeFi Positions</h3>
        {positionCount > 0 && (
          <div className="flex items-center gap-3 mt-1">
            <span className="text-lg font-bold font-mono">
              ${totalValueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
            <span className="text-xs text-zinc-400">
              {positionCount} position{positionCount !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-3">
        {timeAgo && (
          <span className="text-[10px] text-zinc-400">
            Fetched {timeAgo}
          </span>
        )}
        <button
          onClick={onRefresh}
          disabled={loading}
          className="p-2 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 text-zinc-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </div>
  )
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

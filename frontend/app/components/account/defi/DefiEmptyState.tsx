import { ChartLine } from 'lucide-react'
import { GlassCard } from '@flowindex/flow-ui'

export function DefiEmptyState({ noCoa }: { noCoa?: boolean }) {
  return (
    <GlassCard className="p-12 text-center">
      <ChartLine className="h-10 w-10 mx-auto mb-4 text-zinc-300 dark:text-zinc-600" />
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No DeFi positions found for this account.
      </p>
      {noCoa && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-2">
          No EVM address linked — only Cadence protocol positions were checked.
        </p>
      )}
    </GlassCard>
  )
}

import type { DeFiPosition } from '../../../services/defi/types'

export function LpPositionRow({ position }: { position: DeFiPosition }) {
  const totalValue = position.assets.reduce((sum, a) => sum + (a.valueUsd ?? 0), 0)

  return (
    <div className="py-2.5 px-3 border-b border-zinc-100 dark:border-white/5 last:border-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
            LP
          </span>
          <span className="text-sm font-medium">{position.meta.poolName || 'Pool'}</span>
          {position.meta.tickRange && (
            <span className="text-[10px] text-zinc-400 font-mono">
              V3 [{position.meta.tickRange[0]}, {position.meta.tickRange[1]}]
            </span>
          )}
        </div>
        {totalValue > 0 && (
          <span className="text-sm font-mono text-zinc-500 dark:text-zinc-400">
            ${totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
        )}
      </div>
      <div className="flex gap-4 mt-1.5 ml-[52px]">
        {position.assets.map((asset, i) => (
          <span key={i} className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
            {asset.amountDisplay.toLocaleString(undefined, { maximumFractionDigits: 4 })} {asset.symbol}
          </span>
        ))}
      </div>
    </div>
  )
}

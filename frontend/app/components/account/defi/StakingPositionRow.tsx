import type { DeFiPosition } from '../../../services/defi/types'

export function StakingPositionRow({ position }: { position: DeFiPosition }) {
  const asset = position.assets[0]
  if (!asset) return null

  return (
    <div className="py-2.5 px-3 border-b border-zinc-100 dark:border-white/5 last:border-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
            Staked
          </span>
          <span className="text-sm font-medium">{asset.symbol}</span>
        </div>
        <div className="text-right">
          <div className="text-sm font-mono">
            {asset.amountDisplay.toLocaleString(undefined, { maximumFractionDigits: 4 })}
          </div>
          {asset.valueUsd != null && (
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              ${asset.valueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </div>
          )}
        </div>
      </div>
      {position.meta.exchangeRate != null && (
        <div className="text-[11px] text-zinc-400 mt-1 ml-[52px]">
          Rate: 1 {asset.symbol} ≈ {position.meta.exchangeRate.toFixed(4)} FLOW
        </div>
      )}
    </div>
  )
}

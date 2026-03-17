import type { DeFiPosition } from '../../../services/defi/types'

export function LendingPositionRow({ position }: { position: DeFiPosition }) {
  const asset = position.assets[0]
  if (!asset) return null
  const isBorrow = position.type === 'borrowing'

  return (
    <div className="flex items-center justify-between py-2.5 px-3 border-b border-zinc-100 dark:border-white/5 last:border-0">
      <div className="flex items-center gap-3">
        <span className={`text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded ${
          isBorrow
            ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
            : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
        }`}>
          {isBorrow ? 'Borrow' : 'Supply'}
        </span>
        <span className="text-sm font-medium">{asset.symbol}</span>
      </div>
      <div className="text-right">
        <div className="text-sm font-mono">
          {asset.amountDisplay.toLocaleString(undefined, { maximumFractionDigits: 4 })}
        </div>
        {asset.valueUsd != null && (
          <div className={`text-xs ${isBorrow ? 'text-red-500' : 'text-zinc-500 dark:text-zinc-400'}`}>
            {isBorrow ? '-' : ''}${Math.abs(asset.valueUsd).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
        )}
      </div>
    </div>
  )
}

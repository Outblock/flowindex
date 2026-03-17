import { useState } from 'react'
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
import { GlassCard } from '@flowindex/flow-ui'
import type { ProtocolResult, DeFiPosition } from '../../../services/defi/types'
import { PROTOCOL_META } from '../../../services/defi/types'
import { LendingPositionRow } from './LendingPositionRow'
import { LpPositionRow } from './LpPositionRow'
import { StakingPositionRow } from './StakingPositionRow'

function PositionRow({ position }: { position: DeFiPosition }) {
  switch (position.type) {
    case 'lending':
    case 'borrowing':
      return <LendingPositionRow position={position} />
    case 'lp':
    case 'farming':
      return <LpPositionRow position={position} />
    case 'liquid-staking':
      return <StakingPositionRow position={position} />
    default:
      return null
  }
}

interface Props {
  result: ProtocolResult
  defaultExpanded?: boolean
}

export function DefiProtocolSection({ result, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const meta = PROTOCOL_META[result.protocol]
  const isError = result.status === 'error'
  const isEmpty = result.status === 'ok' && result.positions.length === 0
  const hasPositions = result.status === 'ok' && result.positions.length > 0

  // Calculate total value
  const totalValue = hasPositions
    ? result.positions.reduce((sum, p) => {
        const posValue = p.assets.reduce((aSum, a) => aSum + (a.valueUsd ?? 0), 0)
        return sum + (p.type === 'borrowing' ? -posValue : posValue)
      }, 0)
    : 0

  // Health factor from MORE Markets
  const healthFactor = result.positions.find((p) => p.meta.healthFactor != null)?.meta.healthFactor

  return (
    <GlassCard className="overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          {isError ? (
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          ) : expanded ? (
            <ChevronDown className="h-4 w-4 text-zinc-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-zinc-400" />
          )}
          <span className="font-bold text-sm">{meta.name}</span>
          <span className="text-[10px] uppercase tracking-wider text-zinc-400 bg-zinc-100 dark:bg-white/5 px-1.5 py-0.5 rounded">
            {meta.type}
          </span>
          {isEmpty && (
            <span className="text-[10px] text-zinc-400">(no positions)</span>
          )}
          {isError && (
            <span className="text-[10px] text-red-500">{result.error || 'Failed to load'}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {healthFactor != null && (
            <span className={`text-[10px] font-mono ${
              healthFactor < 1.5 ? 'text-red-500' : healthFactor < 2.5 ? 'text-amber-500' : 'text-zinc-400'
            }`}>
              HF: {healthFactor.toFixed(2)}
            </span>
          )}
          {hasPositions && totalValue !== 0 && (
            <span className="text-sm font-mono text-emerald-600 dark:text-emerald-400">
              ${totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          )}
        </div>
      </button>

      {expanded && hasPositions && (
        <div className="border-t border-zinc-100 dark:border-white/5">
          {result.positions.map((position, i) => (
            <PositionRow key={i} position={position} />
          ))}
        </div>
      )}
    </GlassCard>
  )
}

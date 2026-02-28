import { memo } from 'react'
import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'
import { NODE_TYPE_MAP } from '../nodeTypes'
import { COLORS } from '../constants'

function ConditionNode({ data, selected }: NodeProps) {
  const meta = NODE_TYPE_MAP[data.nodeType]
  if (!meta) return null
  const Icon = meta.icon
  const isIF = meta.type === 'condition_if'

  const config = data.config ?? {}
  const preview = config.field
    ? `${config.field} ${config.operator ?? '=='} ${config.value ?? ''}`
    : ''

  return (
    <div
      className={`bg-white dark:bg-neutral-800 border rounded-xl px-4 py-3 min-w-[160px] max-w-[200px] transition-shadow ${
        selected ? 'shadow-lg shadow-amber-500/20 border-amber-500/50' : 'border-zinc-200 dark:border-neutral-700'
      }`}
      style={{ borderLeftWidth: 3, borderLeftColor: COLORS.condition }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !border-2 !border-zinc-300 dark:!border-neutral-700 !bg-amber-500"
      />
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4" style={{ color: COLORS.condition }} />
        <span className="text-sm font-medium text-zinc-900 dark:text-white">{meta.label}</span>
      </div>
      {preview && (
        <p className="text-xs text-zinc-500 dark:text-neutral-400 truncate">{preview}</p>
      )}
      {isIF ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="true"
            className="!w-3 !h-3 !border-2 !border-zinc-300 dark:!border-neutral-700 !bg-emerald-400"
            style={{ top: '35%' }}
          />
          <Handle
            type="source"
            position={Position.Right}
            id="false"
            className="!w-3 !h-3 !border-2 !border-zinc-300 dark:!border-neutral-700 !bg-red-400"
            style={{ top: '65%' }}
          />
          <div className="absolute -right-7 text-[10px] text-emerald-400" style={{ top: '28%' }}>T</div>
          <div className="absolute -right-7 text-[10px] text-red-400" style={{ top: '58%' }}>F</div>
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          className="!w-3 !h-3 !border-2 !border-zinc-300 dark:!border-neutral-700 !bg-amber-500"
        />
      )}
    </div>
  )
}

export default memo(ConditionNode)

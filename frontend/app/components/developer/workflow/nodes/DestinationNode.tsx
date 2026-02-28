import { memo } from 'react'
import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'
import { NODE_TYPE_MAP } from '../nodeTypes'
import { COLORS } from '../constants'

function DestinationNode({ data, selected }: NodeProps) {
  const meta = NODE_TYPE_MAP[data.nodeType]
  if (!meta) return null
  const Icon = meta.icon

  const config = data.config ?? {}
  const preview = config.url || config.webhook_url || config.chat_id || config.to || ''

  return (
    <div
      className={`bg-white dark:bg-neutral-800 border rounded-xl px-4 py-3 min-w-[160px] max-w-[200px] transition-shadow ${
        selected ? 'shadow-lg shadow-blue-500/20 border-blue-500/50' : 'border-zinc-200 dark:border-neutral-700'
      }`}
      style={{ borderLeftWidth: 3, borderLeftColor: COLORS.destination }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !border-2 !border-zinc-300 dark:!border-neutral-700 !bg-blue-500"
      />
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4" style={{ color: COLORS.destination }} />
        <span className="text-sm font-medium text-zinc-900 dark:text-white">{meta.label}</span>
      </div>
      {preview && (
        <p className="text-xs text-zinc-500 dark:text-neutral-400 truncate">{String(preview)}</p>
      )}
    </div>
  )
}

export default memo(DestinationNode)

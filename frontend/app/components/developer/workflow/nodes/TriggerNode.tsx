import { memo } from 'react'
import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'
import { NODE_TYPE_MAP } from '../nodeTypes'
import { COLORS } from '../constants'

function TriggerNode({ data, selected }: NodeProps) {
  const meta = NODE_TYPE_MAP[data.nodeType]
  if (!meta) return null
  const Icon = meta.icon

  // Build a short config preview string
  const config = data.config ?? {}
  const preview = Object.entries(config)
    .filter(([, v]) => v !== '' && v !== undefined)
    .slice(0, 2)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')

  return (
    <div
      className={`bg-white dark:bg-neutral-800 border rounded-xl px-4 py-3 min-w-[180px] max-w-[220px] transition-shadow ${
        selected ? 'shadow-lg shadow-[#00ef8b]/20 border-[#00ef8b]/50' : 'border-zinc-200 dark:border-neutral-700'
      }`}
      style={{ borderLeftWidth: 3, borderLeftColor: COLORS.trigger }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4" style={{ color: COLORS.trigger }} />
        <span className="text-sm font-medium text-zinc-900 dark:text-white truncate">{meta.label}</span>
      </div>
      {preview && (
        <p className="text-xs text-zinc-500 dark:text-neutral-400 truncate">{preview}</p>
      )}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !border-2 !border-zinc-300 dark:!border-neutral-700 !bg-[#00ef8b]"
      />
    </div>
  )
}

export default memo(TriggerNode)

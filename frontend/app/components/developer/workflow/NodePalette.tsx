import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { TRIGGER_NODE_TYPES, CONDITION_NODE_TYPES, DESTINATION_NODE_TYPES } from './nodeTypes'
import type { NodeTypeMeta } from './nodeTypes'
import { COLORS } from './constants'

interface NodePaletteProps {
  onAddNode: (nodeType: string) => void
}

interface CategoryProps {
  title: string
  color: string
  items: NodeTypeMeta[]
  onAddNode: (nodeType: string) => void
}

function Category({ title, color, items, onAddNode }: CategoryProps) {
  const [open, setOpen] = useState(true)

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium uppercase tracking-wider hover:bg-zinc-100 dark:hover:bg-neutral-800 rounded-lg transition-colors"
        style={{ color }}
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {title}
      </button>
      {open && (
        <div className="space-y-0.5 mt-0.5">
          {items.map((node) => {
            const Icon = node.icon
            return (
              <button
                key={node.type}
                onClick={() => onAddNode(node.type)}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/reactflow-node-type', node.type)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-zinc-600 dark:text-neutral-300 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-neutral-800 rounded-lg transition-colors cursor-grab active:cursor-grabbing"
              >
                <Icon className="w-4 h-4 shrink-0" style={{ color: node.color }} />
                {node.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function NodePalette({ onAddNode }: NodePaletteProps) {
  return (
    <div className="w-52 shrink-0 border-r border-zinc-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 p-2 space-y-2 overflow-y-auto">
      <p className="px-3 py-1 text-xs font-semibold text-zinc-400 dark:text-neutral-500 uppercase tracking-wider">
        Add Nodes
      </p>
      <Category title="Triggers" color={COLORS.trigger} items={TRIGGER_NODE_TYPES} onAddNode={onAddNode} />
      <Category title="Conditions" color={COLORS.condition} items={CONDITION_NODE_TYPES} onAddNode={onAddNode} />
      <Category title="Destinations" color={COLORS.destination} items={DESTINATION_NODE_TYPES} onAddNode={onAddNode} />
    </div>
  )
}

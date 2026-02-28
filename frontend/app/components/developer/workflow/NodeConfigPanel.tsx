import { X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { NODE_TYPE_MAP } from './nodeTypes'
import type { ConfigFieldDef } from './nodeTypes'
import SearchableSelect from './SearchableSelect'
import { fetchFTTokens, fetchNFTCollections, fetchContracts, fetchContractEvents, fetchEventsByName } from './fetchOptions'

const FETCH_FN_MAP: Record<string, (query: string) => Promise<any[]>> = {
  ft_tokens: fetchFTTokens,
  nft_collections: fetchNFTCollections,
  contracts: fetchContracts,
  events_search: fetchEventsByName,
}

interface NodeConfigPanelProps {
  selectedNodeId: string | null
  nodeType: string | null
  config: Record<string, string>
  onConfigChange: (key: string, value: string) => void
  onClose: () => void
  onDelete: () => void
}

export default function NodeConfigPanel({
  selectedNodeId,
  nodeType,
  config,
  onConfigChange,
  onClose,
  onDelete,
}: NodeConfigPanelProps) {
  const meta = nodeType ? NODE_TYPE_MAP[nodeType] : null

  return (
    <AnimatePresence>
      {selectedNodeId && meta && (
        <motion.div
          initial={{ x: 320, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 320, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="w-80 shrink-0 border-l border-zinc-200 dark:border-neutral-800 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-sm flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-neutral-800">
            <div className="flex items-center gap-2">
              <meta.icon className="w-4 h-4" style={{ color: meta.color }} />
              <span className="text-sm font-medium text-zinc-900 dark:text-white">{meta.label}</span>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-zinc-400 dark:text-neutral-500 hover:text-zinc-700 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-neutral-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Config fields */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {meta.configFields.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-neutral-500">No configuration needed for this node.</p>
            ) : (
              meta.configFields.map((field: ConfigFieldDef) => (
                <div key={field.key}>
                  <label
                    htmlFor={`cfg-${field.key}`}
                    className="block text-xs text-zinc-500 dark:text-neutral-400 mb-1.5"
                  >
                    {field.label}
                  </label>
                  {field.type === 'searchable' ? (
                    <SearchableSelect
                      value={config[field.key] ?? ''}
                      onChange={(val) => onConfigChange(field.key, val)}
                      fetchOptions={
                        field.fetchFn === 'contract_events'
                          ? () => fetchContractEvents(config[field.linkedField ?? ''] || '')
                          : FETCH_FN_MAP[field.fetchFn ?? ''] ?? (() => Promise.resolve([]))
                      }
                      placeholder={field.placeholder}
                    />
                  ) : field.type === 'select' ? (
                    <select
                      id={`cfg-${field.key}`}
                      value={config[field.key] ?? ''}
                      onChange={(e) => onConfigChange(field.key, e.target.value)}
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-neutral-800 border border-zinc-300 dark:border-neutral-700 rounded-lg text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-[#00ef8b]/50 focus:ring-1 focus:ring-[#00ef8b]/25 transition-colors"
                    >
                      <option value="">-- Select --</option>
                      {field.options?.map((opt) =>
                        typeof opt === 'object' ? (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ) : (
                          <option key={opt} value={opt}>{opt}</option>
                        ),
                      )}
                    </select>
                  ) : (
                    <input
                      id={`cfg-${field.key}`}
                      type={field.type === 'number' ? 'number' : 'text'}
                      value={config[field.key] ?? ''}
                      onChange={(e) => onConfigChange(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className="w-full px-3 py-2 bg-zinc-50 dark:bg-neutral-800 border border-zinc-300 dark:border-neutral-700 rounded-lg text-sm text-zinc-900 dark:text-white font-mono placeholder-zinc-400 dark:placeholder-neutral-500 focus:outline-none focus:border-[#00ef8b]/50 focus:ring-1 focus:ring-[#00ef8b]/25 transition-colors"
                    />
                  )}
                </div>
              ))
            )}
          </div>

          {/* Delete button */}
          <div className="p-4 border-t border-zinc-200 dark:border-neutral-800">
            <button
              onClick={onDelete}
              className="w-full py-2 text-sm font-medium text-red-500 dark:text-red-400 bg-red-500/10 rounded-lg hover:bg-red-500/20 transition-colors"
            >
              Delete Node
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

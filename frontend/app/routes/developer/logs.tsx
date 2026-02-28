import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, Filter, Loader2, X, Copy, Check } from 'lucide-react'
import DeveloperLayout from '../../components/developer/DeveloperLayout'
import { listDeliveryLogs } from '../../lib/webhookApi'
import type { DeliveryLog } from '../../lib/webhookApi'

export const Route = createFileRoute('/developer/logs')({
  component: DeveloperLogs,
})

const PER_PAGE = 50

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadgeClass(status: number | null): string {
  if (status == null)
    return 'bg-neutral-700/50 text-neutral-400'
  if (status >= 200 && status < 300)
    return 'bg-emerald-500/15 text-emerald-400'
  return 'bg-red-500/15 text-red-400'
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 3) + '...' : str
}

function formatPayload(payload: unknown): string {
  try {
    const obj = typeof payload === 'string' ? JSON.parse(payload) : payload
    return JSON.stringify(obj, null, 2)
  } catch {
    return typeof payload === 'string' ? payload : String(payload)
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function DeveloperLogs() {
  const [logs, setLogs] = useState<DeliveryLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [selectedLog, setSelectedLog] = useState<DeliveryLog | null>(null)
  const [copied, setCopied] = useState(false)

  // Filters
  const [filterEventType, setFilterEventType] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | '2xx' | 'error'>('all')

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, unknown> = {
        page,
        per_page: PER_PAGE,
      }
      if (filterEventType.trim()) {
        params.event_type = filterEventType.trim()
      }
      if (filterStatus === '2xx') {
        params.status_min = 200
        params.status_max = 299
      } else if (filterStatus === 'error') {
        params.status_min = 400
        params.status_max = 599
      }

      const result = await listDeliveryLogs(params as never)
      setLogs(Array.isArray(result.data) ? result.data : [])
      setTotal(result.total ?? 0)
    } catch {
      setLogs([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [page, filterEventType, filterStatus])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  // Reset to page 1 when filters change
  function applyFilters() {
    if (page !== 1) {
      setPage(1)
    } else {
      fetchLogs()
    }
  }

  function handleCopyPayload() {
    if (!selectedLog) return
    navigator.clipboard.writeText(formatPayload(selectedLog.payload))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <DeveloperLayout>
      <div className="flex-1 overflow-y-auto max-w-5xl mx-auto w-full space-y-6 p-4 md:p-6">
        {/* Header */}
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white">Delivery Logs</h1>
          <p className="text-xs md:text-sm text-neutral-400 mt-1">
            Inspect webhook delivery attempts and their responses
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label
              htmlFor="filter-event-type"
              className="block text-xs text-neutral-500 mb-1"
            >
              Event Type
            </label>
            <input
              id="filter-event-type"
              type="text"
              value={filterEventType}
              onChange={(e) => setFilterEventType(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyFilters()
              }}
              placeholder="e.g. ft.transfer"
              className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-white font-mono placeholder-neutral-500 focus:outline-none focus:border-[#00ef8b]/50 focus:ring-1 focus:ring-[#00ef8b]/25 transition-colors"
            />
          </div>
          <div className="min-w-[160px]">
            <label
              htmlFor="filter-status"
              className="block text-xs text-neutral-500 mb-1"
            >
              Status
            </label>
            <select
              id="filter-status"
              value={filterStatus}
              onChange={(e) =>
                setFilterStatus(e.target.value as 'all' | '2xx' | 'error')
              }
              className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-white focus:outline-none focus:border-[#00ef8b]/50 focus:ring-1 focus:ring-[#00ef8b]/25 transition-colors"
            >
              <option value="all">All</option>
              <option value="2xx">2xx Success</option>
              <option value="error">4xx-5xx Error</option>
            </select>
          </div>
          <button
            onClick={applyFilters}
            className="flex items-center gap-2 px-4 py-2 bg-neutral-800 border border-neutral-700 text-neutral-300 text-sm font-medium rounded-lg hover:bg-neutral-700 transition-colors"
          >
            <Filter className="w-4 h-4" />
            Filter
          </button>
        </div>

        {/* Table */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-neutral-500" />
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-16 text-neutral-500">
              <p className="text-sm">No delivery logs yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-neutral-800 text-left">
                    <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">
                      Timestamp
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">
                      Event Type
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">
                      Payload
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {logs.map((log) => {
                    let payloadPreview = ''
                    try {
                      payloadPreview = truncate(
                        typeof log.payload === 'string'
                          ? log.payload
                          : JSON.stringify(log.payload),
                        80,
                      )
                    } catch {
                      payloadPreview = '--'
                    }

                    return (
                      <motion.tr
                        key={log.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        onClick={() => setSelectedLog(log)}
                        className="hover:bg-neutral-800/30 transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-3 text-sm text-neutral-300 whitespace-nowrap">
                          {new Date(log.delivered_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-mono text-[#00ef8b]">
                            {log.event_type}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClass(log.status_code)}`}
                          >
                            {log.status_code != null ? log.status_code : '--'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="text-xs font-mono text-neutral-400 block max-w-[300px] truncate"
                          >
                            {payloadPreview}
                          </span>
                        </td>
                      </motion.tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {!loading && total > 0 && (
          <div className="flex items-center justify-between text-sm text-neutral-400">
            <span>
              {total} log{total !== 1 ? 's' : ''} total
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="flex items-center gap-1 px-3 py-1.5 bg-neutral-800 border border-neutral-700 rounded-lg hover:bg-neutral-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4" />
                Prev
              </button>
              <span className="text-neutral-300">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="flex items-center gap-1 px-3 py-1.5 bg-neutral-800 border border-neutral-700 rounded-lg hover:bg-neutral-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Log Detail Slide-over */}
      <AnimatePresence>
        {selectedLog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setSelectedLog(null) }}
          >
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="w-full max-w-lg bg-neutral-900 border-l border-neutral-800 h-full overflow-y-auto"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800 sticky top-0 bg-neutral-900 z-10">
                <h2 className="text-base font-semibold text-white">Delivery Detail</h2>
                <button
                  onClick={() => setSelectedLog(null)}
                  className="p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-5 space-y-5">
                {/* Meta fields */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-neutral-500 mb-1">Timestamp</p>
                    <p className="text-sm text-neutral-200">
                      {new Date(selectedLog.delivered_at).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-neutral-500 mb-1">Status Code</p>
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClass(selectedLog.status_code)}`}
                    >
                      {selectedLog.status_code != null ? selectedLog.status_code : '--'}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs text-neutral-500 mb-1">Event Type</p>
                    <p className="text-sm font-mono text-[#00ef8b]">{selectedLog.event_type}</p>
                  </div>
                  <div>
                    <p className="text-xs text-neutral-500 mb-1">Log ID</p>
                    <p className="text-sm font-mono text-neutral-400 truncate" title={selectedLog.id}>
                      {selectedLog.id}
                    </p>
                  </div>
                  {selectedLog.subscription_id && (
                    <div>
                      <p className="text-xs text-neutral-500 mb-1">Subscription</p>
                      <p className="text-sm font-mono text-neutral-400 truncate" title={selectedLog.subscription_id}>
                        {selectedLog.subscription_id}
                      </p>
                    </div>
                  )}
                  {selectedLog.endpoint_id && (
                    <div>
                      <p className="text-xs text-neutral-500 mb-1">Endpoint</p>
                      <p className="text-sm font-mono text-neutral-400 truncate" title={selectedLog.endpoint_id}>
                        {selectedLog.endpoint_id}
                      </p>
                    </div>
                  )}
                </div>

                {/* Payload */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-neutral-500 uppercase tracking-wider font-medium">Payload</p>
                    <button
                      onClick={handleCopyPayload}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded-md transition-colors"
                    >
                      {copied ? <Check className="w-3 h-3 text-[#00ef8b]" /> : <Copy className="w-3 h-3" />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <pre className="p-4 bg-neutral-950 border border-neutral-800 rounded-lg text-xs font-mono text-neutral-300 overflow-x-auto whitespace-pre-wrap break-all max-h-[60vh]">
                    {formatPayload(selectedLog.payload)}
                  </pre>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </DeveloperLayout>
  )
}

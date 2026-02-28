import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Filter, Loader2 } from 'lucide-react'
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function DeveloperLogs() {
  const [logs, setLogs] = useState<DeliveryLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

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

  return (
    <DeveloperLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-white">Delivery Logs</h1>
          <p className="text-sm text-neutral-400 mt-1">
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
                        className="hover:bg-neutral-800/30 transition-colors"
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
                            title={
                              typeof log.payload === 'string'
                                ? log.payload
                                : JSON.stringify(log.payload)
                            }
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
    </DeveloperLayout>
  )
}

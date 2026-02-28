import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Key, Globe, Bell, FileText, ArrowRight, Loader2, CheckCircle, XCircle } from 'lucide-react'
import DeveloperLayout from '../../components/developer/DeveloperLayout'
import { listAPIKeys, listEndpoints, listSubscriptions, listDeliveryLogs } from '../../lib/webhookApi'
import type { DeliveryLog } from '../../lib/webhookApi'

export const Route = createFileRoute('/developer/')({
  component: DeveloperDashboardPage,
})

interface DashboardStats {
  apiKeys: number
  endpoints: number
  subscriptions: number
}

function DeveloperDashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({ apiKeys: 0, endpoints: 0, subscriptions: 0 })
  const [recentLogs, setRecentLogs] = useState<DeliveryLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      try {
        const [keys, endpoints, subs, logs] = await Promise.all([
          listAPIKeys().catch(() => []),
          listEndpoints().catch(() => []),
          listSubscriptions().catch(() => []),
          listDeliveryLogs({ per_page: 5 }).catch(() => ({ data: [] })),
        ])
        setStats({
          apiKeys: Array.isArray(keys) ? keys.length : 0,
          endpoints: Array.isArray(endpoints) ? endpoints.length : 0,
          subscriptions: Array.isArray(subs) ? subs.length : 0,
        })
        setRecentLogs(Array.isArray(logs.data) ? logs.data : [])
      } catch {
        // Stats remain at 0
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const statCards = [
    { label: 'API Keys', value: stats.apiKeys, icon: Key, path: '/developer/keys', color: 'text-[#00ef8b]' },
    { label: 'Endpoints', value: stats.endpoints, icon: Globe, path: '/developer/endpoints', color: 'text-blue-400' },
    { label: 'Subscriptions', value: stats.subscriptions, icon: Bell, path: '/developer/subscriptions', color: 'text-amber-400' },
  ]

  return (
    <DeveloperLayout>
      <div className="max-w-5xl mx-auto space-y-6 md:space-y-8 p-4 md:p-6">
        {/* Page header */}
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-xs md:text-sm text-neutral-400 mt-1">Overview of your webhook configuration</p>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {statCards.map((card, i) => {
            const Icon = card.icon
            return (
              <motion.div
                key={card.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
              >
                <Link
                  to={card.path}
                  className="block bg-neutral-900 border border-neutral-800 rounded-xl p-5 hover:border-neutral-700 transition-colors group"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className={`w-10 h-10 rounded-lg bg-neutral-800 flex items-center justify-center ${card.color}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <ArrowRight className="w-4 h-4 text-neutral-600 group-hover:text-neutral-400 transition-colors" />
                  </div>
                  <div className="text-2xl font-bold text-white">
                    {loading ? <Loader2 className="w-5 h-5 animate-spin text-neutral-500" /> : card.value}
                  </div>
                  <div className="text-sm text-neutral-400 mt-0.5">{card.label}</div>
                </Link>
              </motion.div>
            )
          })}
        </div>

        {/* Recent deliveries */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Recent Deliveries</h2>
            <Link
              to="/developer/logs"
              className="text-sm text-[#00ef8b] hover:text-[#00ef8b]/80 transition-colors flex items-center gap-1"
            >
              View all <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-neutral-500" />
              </div>
            ) : recentLogs.length === 0 ? (
              <div className="text-center py-12 text-neutral-500 text-sm">
                <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No deliveries yet</p>
                <p className="text-neutral-600 mt-1">Deliveries will appear here once webhooks fire</p>
              </div>
            ) : (
              <div className="divide-y divide-neutral-800">
                {recentLogs.map((log) => {
                  const isSuccess = log.status_code >= 200 && log.status_code < 300
                  return (
                    <div
                      key={log.id}
                      className="flex items-center gap-4 px-4 py-3 hover:bg-neutral-800/50 transition-colors"
                    >
                      {isSuccess ? (
                        <CheckCircle className="w-4 h-4 text-[#00ef8b] shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <span className="text-sm text-white font-mono">{log.event_type}</span>
                      </div>
                      <span className={`text-xs font-mono px-2 py-0.5 rounded ${
                        isSuccess ? 'bg-[#00ef8b]/10 text-[#00ef8b]' : 'bg-red-500/10 text-red-400'
                      }`}>
                        {log.status_code}
                      </span>
                      <span className="text-xs text-neutral-500 hidden sm:inline">
                        {new Date(log.delivered_at).toLocaleString()}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </motion.div>

        {/* Quick actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
        >
          <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Create API Key', path: '/developer/keys', icon: Key },
              { label: 'Add Endpoint', path: '/developer/endpoints', icon: Globe },
              { label: 'New Subscription', path: '/developer/subscriptions', icon: Bell },
              { label: 'View Logs', path: '/developer/logs', icon: FileText },
            ].map((action) => {
              const Icon = action.icon
              return (
                <Link
                  key={action.label}
                  to={action.path}
                  className="flex items-center gap-3 px-4 py-3 bg-neutral-900 border border-neutral-800 rounded-lg hover:border-neutral-700 transition-colors text-sm text-neutral-300 hover:text-white"
                >
                  <Icon className="w-4 h-4 text-neutral-500" />
                  {action.label}
                </Link>
              )
            })}
          </div>
        </motion.div>
      </div>
    </DeveloperLayout>
  )
}

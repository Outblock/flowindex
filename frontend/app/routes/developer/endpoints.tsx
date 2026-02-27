import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Edit2, Globe, Loader2, AlertTriangle } from 'lucide-react'
import DeveloperLayout from '../../components/developer/DeveloperLayout'
import {
  listEndpoints,
  createEndpoint,
  updateEndpoint,
  deleteEndpoint,
} from '../../lib/webhookApi'
import type { Endpoint } from '../../lib/webhookApi'

export const Route = createFileRoute('/developer/endpoints')({
  component: DeveloperEndpoints,
})

function DeveloperEndpoints() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create/Edit modal state
  const [showModal, setShowModal] = useState(false)
  const [editTarget, setEditTarget] = useState<Endpoint | null>(null)
  const [formUrl, setFormUrl] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [saving, setSaving] = useState(false)

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<Endpoint | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchEndpoints = useCallback(async () => {
    try {
      setError(null)
      const data = await listEndpoints()
      setEndpoints(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load endpoints')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchEndpoints()
  }, [fetchEndpoints])

  function openCreateModal() {
    setEditTarget(null)
    setFormUrl('')
    setFormDescription('')
    setShowModal(true)
  }

  function openEditModal(endpoint: Endpoint) {
    setEditTarget(endpoint)
    setFormUrl(endpoint.url)
    setFormDescription(endpoint.description)
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setEditTarget(null)
    setFormUrl('')
    setFormDescription('')
  }

  async function handleSave() {
    if (!formUrl.trim()) return
    setSaving(true)
    try {
      if (editTarget) {
        const updated = await updateEndpoint(editTarget.id, {
          url: formUrl.trim(),
          description: formDescription.trim(),
        })
        setEndpoints((prev) =>
          prev.map((ep) => (ep.id === updated.id ? updated : ep)),
        )
      } else {
        const created = await createEndpoint(formUrl.trim(), formDescription.trim())
        setEndpoints((prev) => [created, ...prev])
      }
      closeModal()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Failed to ${editTarget ? 'update' : 'create'} endpoint`,
      )
      closeModal()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteEndpoint(deleteTarget.id)
      setEndpoints((prev) => prev.filter((ep) => ep.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete endpoint')
    } finally {
      setDeleting(false)
    }
  }

  /** Naive "active" heuristic: endpoints with a URL are active. */
  function isActive(endpoint: Endpoint) {
    return !!endpoint.url
  }

  return (
    <DeveloperLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Webhook Endpoints</h1>
            <p className="text-sm text-neutral-400 mt-1">
              Manage URLs where webhook events will be delivered
            </p>
          </div>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-4 py-2 bg-[#00ef8b] text-black font-medium text-sm rounded-lg hover:bg-[#00ef8b]/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Endpoint
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-400/60 hover:text-red-400 transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Content */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-neutral-500" />
            </div>
          ) : endpoints.length === 0 ? (
            <div className="text-center py-16 text-neutral-500">
              <Globe className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">
                No endpoints yet. Add one to start receiving webhooks.
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-neutral-800 text-left">
                  <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    URL
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider w-24">
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {endpoints.map((endpoint) => (
                  <motion.tr
                    key={endpoint.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="hover:bg-neutral-800/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span
                        className="text-sm font-mono text-neutral-300 block max-w-xs truncate"
                        title={endpoint.url}
                      >
                        {endpoint.url}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-neutral-400">
                      {endpoint.description || '\u2014'}
                    </td>
                    <td className="px-4 py-3">
                      {isActive(endpoint) ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-neutral-400">
                      {new Date(endpoint.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEditModal(endpoint)}
                          className="p-1.5 rounded-md text-neutral-500 hover:text-white hover:bg-neutral-700 transition-colors"
                          title="Edit endpoint"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(endpoint)}
                          className="p-1.5 rounded-md text-neutral-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Delete endpoint"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Create / Edit Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeModal()
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-neutral-900 border border-neutral-800 rounded-xl w-full max-w-md mx-4 p-6 space-y-4"
            >
              <h2 className="text-lg font-semibold text-white">
                {editTarget ? 'Edit Endpoint' : 'Add Endpoint'}
              </h2>

              <div>
                <label
                  htmlFor="endpoint-url"
                  className="block text-sm text-neutral-400 mb-1.5"
                >
                  URL
                </label>
                <input
                  id="endpoint-url"
                  type="url"
                  required
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder="https://example.com/webhooks"
                  className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-white font-mono placeholder-neutral-500 focus:outline-none focus:border-[#00ef8b]/50 focus:ring-1 focus:ring-[#00ef8b]/25 transition-colors"
                  autoFocus
                />
              </div>

              <div>
                <label
                  htmlFor="endpoint-description"
                  className="block text-sm text-neutral-400 mb-1.5"
                >
                  Description
                </label>
                <input
                  id="endpoint-description"
                  type="text"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSave()
                  }}
                  placeholder="Optional description"
                  className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-[#00ef8b]/50 focus:ring-1 focus:ring-[#00ef8b]/25 transition-colors"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={closeModal}
                  className="flex-1 py-2 bg-neutral-800 text-neutral-300 text-sm font-medium rounded-lg hover:bg-neutral-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={!formUrl.trim() || saving}
                  className="flex-1 py-2 bg-[#00ef8b] text-black text-sm font-medium rounded-lg hover:bg-[#00ef8b]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editTarget ? 'Save' : 'Add'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setDeleteTarget(null)
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-neutral-900 border border-neutral-800 rounded-xl w-full max-w-sm mx-4 p-6 space-y-4"
            >
              <h2 className="text-lg font-semibold text-white">Delete Endpoint</h2>
              <p className="text-sm text-neutral-400">
                Are you sure you want to delete the endpoint{' '}
                <span className="text-white font-mono text-xs break-all">
                  {deleteTarget.url}
                </span>
                ? This action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="flex-1 py-2 bg-neutral-800 text-neutral-300 text-sm font-medium rounded-lg hover:bg-neutral-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 py-2 bg-red-500/20 text-red-400 text-sm font-medium rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </DeveloperLayout>
  )
}

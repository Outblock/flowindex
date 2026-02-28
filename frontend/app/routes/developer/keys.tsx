import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Copy, Check, Key, Loader2, AlertTriangle, Eye, EyeOff, Edit2, Zap } from 'lucide-react'
import DeveloperLayout from '../../components/developer/DeveloperLayout'
import { listAPIKeys, createAPIKey, deleteAPIKey, getAccountUsage } from '../../lib/webhookApi'
import type { APIKey, AccountUsage } from '../../lib/webhookApi'

export const Route = createFileRoute('/developer/keys')({
  component: DeveloperKeys,
})

function maskKey(prefix: string | undefined): string {
  if (!prefix) return '••••••••••••••••••••'
  return prefix + '••••••••••••••••'
}

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Never'
  const d = new Date(dateStr)
  const now = Date.now()
  const diffMs = now - d.getTime()
  if (diffMs < 0) return 'Just now'
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString()
}

function DeveloperKeys() {
  const [keys, setKeys] = useState<APIKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [usage, setUsage] = useState<AccountUsage | null>(null)

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createName, setCreateName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Per-key UI state
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null)

  // Edit modal state
  const [editTarget, setEditTarget] = useState<APIKey | null>(null)
  const [editName, setEditName] = useState('')
  const [saving, setSaving] = useState(false)

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<APIKey | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchKeys = useCallback(async () => {
    try {
      setError(null)
      const data = await listAPIKeys()
      setKeys(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load API keys')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchUsage = useCallback(async () => {
    try {
      const data = await getAccountUsage()
      setUsage(data)
    } catch {
      // Non-critical, silently ignore
    }
  }, [])

  useEffect(() => {
    fetchKeys()
    fetchUsage()
  }, [fetchKeys, fetchUsage])

  async function handleCreate() {
    if (!createName.trim()) return
    setCreating(true)
    try {
      const newKey = await createAPIKey(createName.trim())
      setCreatedKey(newKey.key ?? null)
      setKeys((prev) => [newKey, ...prev])
      setCreateName('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create API key')
      setShowCreateModal(false)
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteAPIKey(deleteTarget.id)
      setKeys((prev) => prev.filter((k) => k.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete API key')
    } finally {
      setDeleting(false)
    }
  }

  function handleCopy() {
    if (!createdKey) return
    navigator.clipboard.writeText(createdKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleCopyPrefix(apiKey: APIKey) {
    const text = apiKey.key_prefix ?? ''
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopiedKeyId(apiKey.id)
    setTimeout(() => setCopiedKeyId(null), 2000)
  }

  function toggleReveal(id: string) {
    setRevealedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function openEditModal(apiKey: APIKey) {
    setEditTarget(apiKey)
    setEditName(apiKey.name)
  }

  async function handleEditSave() {
    if (!editTarget || !editName.trim()) return
    setSaving(true)
    try {
      setKeys((prev) =>
        prev.map((k) => (k.id === editTarget.id ? { ...k, name: editName.trim() } : k)),
      )
      setEditTarget(null)
    } finally {
      setSaving(false)
    }
  }

  function closeCreateModal() {
    setShowCreateModal(false)
    setCreateName('')
    setCreatedKey(null)
    setCopied(false)
  }

  return (
    <DeveloperLayout>
      <div className="flex-1 overflow-y-auto max-w-4xl mx-auto w-full space-y-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-bold text-white">API Keys</h1>
            <p className="text-xs md:text-sm text-neutral-400 mt-1">
              Manage API keys for authenticating webhook requests
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-3 md:px-4 py-2 bg-[#00ef8b] text-black font-medium text-sm rounded-lg hover:bg-[#00ef8b]/90 transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Create Key</span>
            <span className="sm:hidden">Create</span>
          </button>
        </div>

        {/* Rate Limit / Usage Card */}
        {usage && (
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 md:p-5">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-[#00ef8b]" />
              <span className="text-sm font-medium text-white">
                {usage.tier.name} Plan
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-neutral-800 text-neutral-400">
                {usage.tier.id}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <UsageMeter
                label="Subscriptions"
                used={usage.subscriptions_used}
                max={usage.tier.max_subscriptions}
              />
              <UsageMeter
                label="Endpoints"
                used={usage.endpoints_used}
                max={usage.tier.max_endpoints}
              />
              <div>
                <p className="text-xs text-neutral-500 mb-1">Events / hour</p>
                <p className="text-sm text-neutral-200 font-mono">{usage.tier.max_events_per_hour.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-neutral-500 mb-1">API requests / hour</p>
                <p className="text-sm text-neutral-200 font-mono">{usage.tier.max_api_requests.toLocaleString()}</p>
              </div>
            </div>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="flex-1 min-w-0 truncate">{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-400/60 hover:text-red-400 transition-colors shrink-0">
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
          ) : keys.length === 0 ? (
            <div className="text-center py-16 text-neutral-500">
              <Key className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No API keys yet. Create one to get started.</p>
            </div>
          ) : (
            <>
              {/* Mobile card list */}
              <div className="md:hidden divide-y divide-neutral-800">
                {keys.map((apiKey) => {
                  const isRevealed = revealedKeys.has(apiKey.id)
                  const isCopied = copiedKeyId === apiKey.id
                  return (
                    <motion.div
                      key={apiKey.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-white truncate">{apiKey.name}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => openEditModal(apiKey)}
                            className="p-1.5 rounded-md text-neutral-500 hover:text-white hover:bg-neutral-700 transition-colors"
                            title="Edit name"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(apiKey)}
                            className="p-1.5 rounded-md text-neutral-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Delete key"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 px-3 py-2 bg-neutral-800 rounded-lg">
                        <code className="flex-1 text-xs font-mono text-neutral-400 truncate select-all">
                          {isRevealed ? (apiKey.key_prefix ? `${apiKey.key_prefix}...` : '***') : maskKey(apiKey.key_prefix)}
                        </code>
                        <button
                          onClick={() => toggleReveal(apiKey.id)}
                          className="p-1 rounded text-neutral-500 hover:text-white transition-colors shrink-0"
                          title={isRevealed ? 'Hide' : 'Reveal'}
                        >
                          {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => handleCopyPrefix(apiKey)}
                          className="p-1 rounded text-neutral-500 hover:text-white transition-colors shrink-0"
                          title="Copy key prefix"
                        >
                          {isCopied ? <Check className="w-3.5 h-3.5 text-[#00ef8b]" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <div className="flex items-center justify-between text-xs text-neutral-500">
                        <span>Created {new Date(apiKey.created_at).toLocaleDateString()}</span>
                        <span>Last used: {timeAgo(apiKey.last_used)}</span>
                      </div>
                    </motion.div>
                  )
                })}
              </div>

              {/* Desktop table */}
              <table className="w-full hidden md:table">
                <thead>
                  <tr className="border-b border-neutral-800 text-left">
                    <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Name</th>
                    <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Key</th>
                    <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Created</th>
                    <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Last Used</th>
                    <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider w-28"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {keys.map((apiKey) => {
                    const isRevealed = revealedKeys.has(apiKey.id)
                    const isCopied = copiedKeyId === apiKey.id
                    return (
                      <motion.tr
                        key={apiKey.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="hover:bg-neutral-800/30 transition-colors"
                      >
                        <td className="px-4 py-3 text-sm text-white">{apiKey.name}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <code className="text-sm font-mono text-neutral-400 select-all">
                              {isRevealed ? (apiKey.key_prefix ? `${apiKey.key_prefix}...` : '***') : maskKey(apiKey.key_prefix)}
                            </code>
                            <button
                              onClick={() => toggleReveal(apiKey.id)}
                              className="p-1 rounded text-neutral-500 hover:text-white transition-colors"
                              title={isRevealed ? 'Hide' : 'Reveal'}
                            >
                              {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={() => handleCopyPrefix(apiKey)}
                              className="p-1 rounded text-neutral-500 hover:text-white transition-colors"
                              title="Copy key prefix"
                            >
                              {isCopied ? <Check className="w-3.5 h-3.5 text-[#00ef8b]" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-neutral-400">
                          {new Date(apiKey.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-sm text-neutral-400">
                          {timeAgo(apiKey.last_used)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => openEditModal(apiKey)}
                              className="p-1.5 rounded-md text-neutral-500 hover:text-white hover:bg-neutral-700 transition-colors"
                              title="Edit name"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setDeleteTarget(apiKey)}
                              className="p-1.5 rounded-md text-neutral-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                              title="Delete key"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </motion.tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>

        {/* Tip about full key */}
        {keys.length > 0 && (
          <p className="text-xs text-neutral-500 text-center">
            Full API keys are only shown once at creation. The copy button copies the key prefix for identification.
          </p>
        )}
      </div>

      {/* Create Key Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget && !createdKey) closeCreateModal() }}
          >
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              className="bg-neutral-900 border border-neutral-800 rounded-t-xl sm:rounded-xl w-full max-w-md mx-0 sm:mx-4 p-6"
            >
              {createdKey ? (
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold text-white">API Key Created</h2>
                  <p className="text-sm text-neutral-400">
                    Copy this key now. You will not be able to see it again.
                  </p>
                  <div className="flex items-center gap-2 p-3 bg-neutral-800 rounded-lg border border-neutral-700">
                    <code className="flex-1 text-xs sm:text-sm font-mono text-[#00ef8b] break-all select-all">
                      {createdKey}
                    </code>
                    <button
                      onClick={handleCopy}
                      className="shrink-0 p-1.5 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors"
                      title="Copy to clipboard"
                    >
                      {copied ? <Check className="w-4 h-4 text-[#00ef8b]" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  <button
                    onClick={closeCreateModal}
                    className="w-full py-2 bg-neutral-800 text-white text-sm font-medium rounded-lg hover:bg-neutral-700 transition-colors"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold text-white">Create API Key</h2>
                  <div>
                    <label htmlFor="key-name" className="block text-sm text-neutral-400 mb-1.5">
                      Key Name
                    </label>
                    <input
                      id="key-name"
                      type="text"
                      value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
                      placeholder="e.g. Production, Staging"
                      className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-[#00ef8b]/50 focus:ring-1 focus:ring-[#00ef8b]/25 transition-colors"
                      autoFocus
                    />
                  </div>
                  <div className="flex gap-3">
                    <button onClick={closeCreateModal} className="flex-1 py-2 bg-neutral-800 text-neutral-300 text-sm font-medium rounded-lg hover:bg-neutral-700 transition-colors">
                      Cancel
                    </button>
                    <button
                      onClick={handleCreate}
                      disabled={!createName.trim() || creating}
                      className="flex-1 py-2 bg-[#00ef8b] text-black text-sm font-medium rounded-lg hover:bg-[#00ef8b]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {creating && <Loader2 className="w-4 h-4 animate-spin" />}
                      Create
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Name Modal */}
      <AnimatePresence>
        {editTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setEditTarget(null) }}
          >
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              className="bg-neutral-900 border border-neutral-800 rounded-t-xl sm:rounded-xl w-full max-w-sm mx-0 sm:mx-4 p-6 space-y-4"
            >
              <h2 className="text-lg font-semibold text-white">Rename API Key</h2>
              <div>
                <label htmlFor="edit-key-name" className="block text-sm text-neutral-400 mb-1.5">
                  Key Name
                </label>
                <input
                  id="edit-key-name"
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleEditSave() }}
                  className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-[#00ef8b]/50 focus:ring-1 focus:ring-[#00ef8b]/25 transition-colors"
                  autoFocus
                />
              </div>
              <div className="flex gap-3">
                <button onClick={() => setEditTarget(null)} className="flex-1 py-2 bg-neutral-800 text-neutral-300 text-sm font-medium rounded-lg hover:bg-neutral-700 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleEditSave}
                  disabled={!editName.trim() || saving}
                  className="flex-1 py-2 bg-[#00ef8b] text-black text-sm font-medium rounded-lg hover:bg-[#00ef8b]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save
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
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setDeleteTarget(null) }}
          >
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              className="bg-neutral-900 border border-neutral-800 rounded-t-xl sm:rounded-xl w-full max-w-sm mx-0 sm:mx-4 p-6 space-y-4"
            >
              <h2 className="text-lg font-semibold text-white">Delete API Key</h2>
              <p className="text-sm text-neutral-400">
                Are you sure you want to delete{' '}
                <span className="text-white font-medium">{deleteTarget.name}</span>? This
                action cannot be undone.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2 bg-neutral-800 text-neutral-300 text-sm font-medium rounded-lg hover:bg-neutral-700 transition-colors">
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

function UsageMeter({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0
  const isHigh = pct >= 80
  return (
    <div>
      <p className="text-xs text-neutral-500 mb-1">{label}</p>
      <p className="text-sm text-neutral-200 font-mono mb-1.5">
        {used} <span className="text-neutral-500">/ {max}</span>
      </p>
      <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isHigh ? 'bg-amber-500' : 'bg-[#00ef8b]'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

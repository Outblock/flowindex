import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Edit2, Globe, Loader2, AlertTriangle, Send, MessageSquare, Hash, Mail, Link2 } from 'lucide-react'
import DeveloperLayout from '../../components/developer/DeveloperLayout'
import {
  listEndpoints,
  createEndpoint,
  updateEndpoint,
  deleteEndpoint,
} from '../../lib/webhookApi'
import type { Endpoint, EndpointType } from '../../lib/webhookApi'

export const Route = createFileRoute('/developer/endpoints')({
  component: DeveloperEndpoints,
})

// ---------------------------------------------------------------------------
// Channel config
// ---------------------------------------------------------------------------

interface ChannelConfig {
  label: string
  icon: typeof Globe
  color: string
  bgColor: string
  borderColor: string
  placeholder: string
  helpText: string
  extraFields?: { key: string; label: string; placeholder: string; type?: string }[]
  buildUrl?: (fields: Record<string, string>) => string
  urlHidden?: boolean
}

const CHANNELS: Record<EndpointType, ChannelConfig> = {
  webhook: {
    label: 'Webhook',
    icon: Link2,
    color: 'text-neutral-300',
    bgColor: 'bg-neutral-800',
    borderColor: 'border-neutral-600',
    placeholder: 'https://example.com/webhooks',
    helpText: 'HMAC-signed POST requests via Svix with automatic retries',
  },
  discord: {
    label: 'Discord',
    icon: Hash,
    color: 'text-[#5865F2]',
    bgColor: 'bg-[#5865F2]/10',
    borderColor: 'border-[#5865F2]/30',
    placeholder: 'https://discord.com/api/webhooks/...',
    helpText: 'Rich embed messages to your Discord channel',
  },
  slack: {
    label: 'Slack',
    icon: MessageSquare,
    color: 'text-[#E01E5A]',
    bgColor: 'bg-[#E01E5A]/10',
    borderColor: 'border-[#E01E5A]/30',
    placeholder: 'https://hooks.slack.com/services/...',
    helpText: 'Formatted messages to your Slack channel',
  },
  telegram: {
    label: 'Telegram',
    icon: Send,
    color: 'text-[#26A5E4]',
    bgColor: 'bg-[#26A5E4]/10',
    borderColor: 'border-[#26A5E4]/30',
    placeholder: '',
    helpText: 'Markdown messages to your Telegram chat or group',
    extraFields: [
      { key: 'bot_token', label: 'Bot Token', placeholder: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11' },
      { key: 'chat_id', label: 'Chat ID', placeholder: '-1001234567890 or @channelname' },
    ],
    buildUrl: (fields) => `telegram://${fields.bot_token}/${fields.chat_id}`,
    urlHidden: true,
  },
  email: {
    label: 'Email',
    icon: Mail,
    color: 'text-amber-400',
    bgColor: 'bg-amber-400/10',
    borderColor: 'border-amber-400/30',
    placeholder: 'user@example.com',
    helpText: 'Coming soon — email notifications for events',
  },
}

const CHANNEL_ORDER: EndpointType[] = ['webhook', 'discord', 'slack', 'telegram', 'email']

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectChannelType(url: string): EndpointType {
  if (url.includes('discord.com/api/webhooks/') || url.includes('discordapp.com/api/webhooks/')) return 'discord'
  if (url.includes('hooks.slack.com/')) return 'slack'
  if (url.startsWith('telegram://')) return 'telegram'
  return 'webhook'
}

function getChannelConfig(ep: Endpoint) {
  const type_ = ep.endpoint_type || detectChannelType(ep.url)
  return CHANNELS[type_] || CHANNELS.webhook
}

function channelBadge(ep: Endpoint) {
  const config = getChannelConfig(ep)
  const Icon = config.icon
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${config.bgColor} ${config.color} border ${config.borderColor}`}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  )
}

function displayUrl(ep: Endpoint): string {
  const type_ = ep.endpoint_type || detectChannelType(ep.url)
  if (type_ === 'telegram') {
    const trimmed = ep.url.replace('telegram://', '')
    const parts = trimmed.split('/')
    return parts.length >= 2 ? `Chat: ${parts[1]}` : ep.url
  }
  return ep.url
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function DeveloperEndpoints() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showModal, setShowModal] = useState(false)
  const [editTarget, setEditTarget] = useState<Endpoint | null>(null)
  const [selectedChannel, setSelectedChannel] = useState<EndpointType>('webhook')
  const [formUrl, setFormUrl] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formExtra, setFormExtra] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

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
    setSelectedChannel('webhook')
    setFormUrl('')
    setFormDescription('')
    setFormExtra({})
    setShowModal(true)
  }

  function openEditModal(endpoint: Endpoint) {
    setEditTarget(endpoint)
    const type_ = endpoint.endpoint_type || detectChannelType(endpoint.url)
    setSelectedChannel(type_)
    setFormUrl(endpoint.url)
    setFormDescription(endpoint.description)
    if (type_ === 'telegram') {
      const trimmed = endpoint.url.replace('telegram://', '')
      const parts = trimmed.split('/')
      setFormExtra({
        bot_token: parts[0] || '',
        chat_id: parts.slice(1).join('/') || '',
      })
    } else {
      setFormExtra({})
    }
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setEditTarget(null)
    setFormUrl('')
    setFormDescription('')
    setFormExtra({})
  }

  async function handleSave() {
    const channelConfig = CHANNELS[selectedChannel]
    let url = formUrl.trim()
    if (channelConfig.buildUrl) {
      url = channelConfig.buildUrl(formExtra)
    }
    if (!url) return

    setSaving(true)
    try {
      if (editTarget) {
        const updated = await updateEndpoint(editTarget.id, {
          url,
          description: formDescription.trim(),
        })
        setEndpoints((prev) =>
          prev.map((ep) => (ep.id === updated.id ? updated : ep)),
        )
      } else {
        const created = await createEndpoint(
          url,
          formDescription.trim(),
          selectedChannel,
          Object.keys(formExtra).length > 0 ? formExtra : undefined,
        )
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

  function isActive(endpoint: Endpoint) {
    return !!endpoint.url
  }

  const channelConfig = CHANNELS[selectedChannel]
  const isEmailDisabled = selectedChannel === 'email'

  const canSave = (() => {
    if (isEmailDisabled) return false
    if (channelConfig.buildUrl) {
      return (channelConfig.extraFields || []).every((f) => (formExtra[f.key] || '').trim() !== '')
    }
    return formUrl.trim() !== ''
  })()

  return (
    <DeveloperLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-bold text-white">Notification Channels</h1>
            <p className="text-xs md:text-sm text-neutral-400 mt-1">
              Configure where events are delivered
            </p>
          </div>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-2 px-3 md:px-4 py-2 bg-[#00ef8b] text-black font-medium text-sm rounded-lg hover:bg-[#00ef8b]/90 transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Add Channel</span>
            <span className="sm:hidden">Add</span>
          </button>
        </div>

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
          ) : endpoints.length === 0 ? (
            <div className="text-center py-16 text-neutral-500">
              <Globe className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No channels configured yet. Add one to start receiving notifications.</p>
            </div>
          ) : (
            <>
              {/* Mobile card list */}
              <div className="md:hidden divide-y divide-neutral-800">
                {endpoints.map((endpoint) => (
                  <motion.div
                    key={endpoint.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="p-4 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      {channelBadge(endpoint)}
                      <div className="flex items-center gap-1">
                        {isActive(endpoint) ? (
                          <span className="w-2 h-2 rounded-full bg-green-400" />
                        ) : (
                          <span className="w-2 h-2 rounded-full bg-red-400" />
                        )}
                        <button
                          onClick={() => openEditModal(endpoint)}
                          className="p-1.5 rounded-md text-neutral-500 hover:text-white hover:bg-neutral-700 transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(endpoint)}
                          className="p-1.5 rounded-md text-neutral-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <p className="text-sm font-mono text-neutral-300 truncate" title={endpoint.url}>
                      {displayUrl(endpoint)}
                    </p>
                    {endpoint.description && (
                      <p className="text-xs text-neutral-500 truncate">{endpoint.description}</p>
                    )}
                  </motion.div>
                ))}
              </div>

              {/* Desktop table */}
              <table className="w-full hidden md:table">
                <thead>
                  <tr className="border-b border-neutral-800 text-left">
                    <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Channel</th>
                    <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Destination</th>
                    <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Description</th>
                    <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider w-24"></th>
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
                      <td className="px-4 py-3">{channelBadge(endpoint)}</td>
                      <td className="px-4 py-3">
                        <span className="text-sm font-mono text-neutral-300 block max-w-xs truncate" title={endpoint.url}>
                          {displayUrl(endpoint)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-neutral-400">{endpoint.description || '\u2014'}</td>
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
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEditModal(endpoint)} className="p-1.5 rounded-md text-neutral-500 hover:text-white hover:bg-neutral-700 transition-colors" title="Edit">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => setDeleteTarget(endpoint)} className="p-1.5 rounded-md text-neutral-500 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Delete">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </>
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
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) closeModal() }}
          >
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 40 }}
              className="bg-neutral-900 border border-neutral-800 rounded-t-xl sm:rounded-xl w-full max-w-lg mx-0 sm:mx-4 p-5 sm:p-6 space-y-5 max-h-[90vh] overflow-y-auto"
            >
              <h2 className="text-lg font-semibold text-white">
                {editTarget ? 'Edit Channel' : 'Add Notification Channel'}
              </h2>

              {/* Channel type picker */}
              {!editTarget && (
                <div className="space-y-2">
                  <label className="block text-sm text-neutral-400">Channel Type</label>
                  <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
                    {CHANNEL_ORDER.map((type_) => {
                      const config = CHANNELS[type_]
                      const Icon = config.icon
                      const isSelected = selectedChannel === type_
                      const isDisabled = type_ === 'email'
                      return (
                        <button
                          key={type_}
                          onClick={() => {
                            if (!isDisabled) {
                              setSelectedChannel(type_)
                              setFormUrl('')
                              setFormExtra({})
                            }
                          }}
                          disabled={isDisabled}
                          className={`relative flex flex-col items-center gap-1 sm:gap-1.5 p-2 sm:p-3 rounded-lg border text-[10px] sm:text-xs font-medium transition-all ${
                            isSelected
                              ? `${config.bgColor} ${config.borderColor} ${config.color}`
                              : isDisabled
                              ? 'border-neutral-800 text-neutral-600 cursor-not-allowed opacity-50'
                              : 'border-neutral-800 text-neutral-500 hover:border-neutral-700 hover:text-neutral-300'
                          }`}
                        >
                          <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                          <span>{config.label}</span>
                          {isDisabled && (
                            <span className="absolute -top-1 -right-1 text-[8px] sm:text-[9px] px-1 py-0.5 rounded bg-neutral-800 text-neutral-500 border border-neutral-700">
                              Soon
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <p className="text-xs text-neutral-500">{channelConfig.helpText}</p>

              {/* Dynamic form fields */}
              {channelConfig.extraFields ? (
                channelConfig.extraFields.map((field) => (
                  <div key={field.key}>
                    <label htmlFor={`field-${field.key}`} className="block text-sm text-neutral-400 mb-1.5">
                      {field.label}
                    </label>
                    <input
                      id={`field-${field.key}`}
                      type={field.type || 'text'}
                      value={formExtra[field.key] || ''}
                      onChange={(e) => setFormExtra((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-white font-mono placeholder-neutral-500 focus:outline-none focus:border-[#00ef8b]/50 focus:ring-1 focus:ring-[#00ef8b]/25 transition-colors"
                    />
                  </div>
                ))
              ) : (
                <div>
                  <label htmlFor="endpoint-url" className="block text-sm text-neutral-400 mb-1.5">
                    {selectedChannel === 'webhook' ? 'Webhook URL' : `${channelConfig.label} Webhook URL`}
                  </label>
                  <input
                    id="endpoint-url"
                    type="url"
                    required
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
                    placeholder={channelConfig.placeholder}
                    className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-white font-mono placeholder-neutral-500 focus:outline-none focus:border-[#00ef8b]/50 focus:ring-1 focus:ring-[#00ef8b]/25 transition-colors"
                    autoFocus
                    disabled={isEmailDisabled}
                  />
                </div>
              )}

              <div>
                <label htmlFor="endpoint-description" className="block text-sm text-neutral-400 mb-1.5">
                  Description
                </label>
                <input
                  id="endpoint-description"
                  type="text"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && canSave) handleSave() }}
                  placeholder="Optional label for this channel"
                  className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-[#00ef8b]/50 focus:ring-1 focus:ring-[#00ef8b]/25 transition-colors"
                />
              </div>

              <div className="flex gap-3">
                <button onClick={closeModal} className="flex-1 py-2 bg-neutral-800 text-neutral-300 text-sm font-medium rounded-lg hover:bg-neutral-700 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={!canSave || saving}
                  className="flex-1 py-2 bg-[#00ef8b] text-black text-sm font-medium rounded-lg hover:bg-[#00ef8b]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editTarget ? 'Save' : 'Add Channel'}
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
              <h2 className="text-lg font-semibold text-white">Delete Channel</h2>
              <p className="text-sm text-neutral-400">
                Are you sure you want to delete this {getChannelConfig(deleteTarget).label} channel?
                This action cannot be undone.
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

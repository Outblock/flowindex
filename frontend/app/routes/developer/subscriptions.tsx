import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Loader2, AlertTriangle, Bell } from 'lucide-react'
import DeveloperLayout from '../../components/developer/DeveloperLayout'
import {
  listSubscriptions,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  listEndpoints,
} from '../../lib/webhookApi'
import type { Subscription, Endpoint } from '../../lib/webhookApi'

export const Route = createFileRoute('/developer/subscriptions')({
  component: DeveloperSubscriptions,
})

// ---------------------------------------------------------------------------
// Event type definitions and their condition field schemas
// ---------------------------------------------------------------------------

const EVENT_TYPES = [
  'ft.transfer',
  'ft.large_transfer',
  'nft.transfer',
  'transaction.sealed',
  'block.sealed',
  'account.created',
  'account.key.added',
  'account.key.removed',
  'account.key_change',
  'account.contract.added',
  'account.contract.updated',
  'account.contract.removed',
  'address.activity',
  'contract.event',
  'staking.event',
  'defi.swap',
  'defi.liquidity',
  'evm.transaction',
] as const

type EventTypeId = (typeof EVENT_TYPES)[number]

/** Human-readable labels for event types */
const EVENT_TYPE_LABELS: Record<EventTypeId, string> = {
  'ft.transfer': 'FT Transfer',
  'ft.large_transfer': 'FT Whale Transfer',
  'nft.transfer': 'NFT Transfer',
  'transaction.sealed': 'Transaction Sealed',
  'block.sealed': 'Block Sealed',
  'account.created': 'Account Created',
  'account.key.added': 'Account Key Added',
  'account.key.removed': 'Account Key Removed',
  'account.key_change': 'Account Key Change',
  'account.contract.added': 'Contract Deployed',
  'account.contract.updated': 'Contract Updated',
  'account.contract.removed': 'Contract Removed',
  'address.activity': 'Address Activity',
  'contract.event': 'Contract Event',
  'staking.event': 'Staking Event',
  'defi.swap': 'DeFi Swap',
  'defi.liquidity': 'DeFi Liquidity',
  'evm.transaction': 'EVM Transaction',
}

// ---------------------------------------------------------------------------
// Preset token / collection lists
// ---------------------------------------------------------------------------

const FT_TOKENS = [
  { value: '', label: 'Any Token' },
  { value: 'A.1654653399040a61.FlowToken', label: 'FLOW' },
  { value: 'A.b19436aae4d94622.FiatToken', label: 'USDC' },
  { value: 'A.cfdd90d4a00f7b5b.TeleportedTetherToken', label: 'USDT (Teleported)' },
  { value: 'A.d6f80565193ad727.stFlowToken', label: 'stFLOW' },
  { value: 'A.231cc0dbbcffc4b7.ceWBTC', label: 'BTC (Celer)' },
  { value: 'A.231cc0dbbcffc4b7.ceWETH', label: 'ETH (Celer)' },
  { value: 'A.4ea047c3e73ca460.FlowIDTableStaking', label: 'FLOW Staking' },
  { value: 'A.0f9df91c9121c460.BloctoToken', label: 'BLT' },
  { value: 'A.7e60df042a9c0868.FlowToken', label: 'DUST' },
  { value: 'A.3c1c4b041ad18279.PYUSD', label: 'PYUSD' },
  { value: 'A.d01e482eb680ec9f.REVV', label: 'REVV' },
]

const NFT_COLLECTIONS = [
  { value: '', label: 'Any Collection' },
  { value: 'A.0b2a3299cc857e29.TopShot', label: 'NBA Top Shot' },
  { value: 'A.e4cf4bdc1751c65d.AllDay', label: 'NFL All Day' },
  { value: 'A.329feb3ab062d289.UFC_NFT', label: 'UFC Strike' },
  { value: 'A.87ca73a41bb50ad5.Golazos', label: 'LaLiga Golazos' },
  { value: 'A.2d4c3caffbeab845.FLOAT', label: 'FLOAT' },
  { value: 'A.1d7e57aa55817448.MetaverseMarket', label: 'Flovatar' },
  { value: 'A.f8d6e0586b0a20c7.NonFungibleToken', label: 'Any (NonFungibleToken)' },
]

interface ConditionFieldDef {
  key: string
  label: string
  type: 'text' | 'number' | 'select'
  options?: { value: string; label: string }[] | string[]
  placeholder?: string
  required?: boolean
  /** If true the value is split by comma into an array */
  isArray?: boolean
}

const CONDITION_FIELDS: Record<EventTypeId, ConditionFieldDef[]> = {
  'ft.transfer': [
    { key: 'addresses', label: 'Addresses', type: 'text', placeholder: '0x1,0x2', isArray: true },
    { key: 'direction', label: 'Direction', type: 'select', options: ['in', 'out', 'both'] },
    { key: 'token_contract', label: 'Token', type: 'select', options: FT_TOKENS },
    { key: 'min_amount', label: 'Min Amount', type: 'number', placeholder: '0' },
  ],
  'ft.large_transfer': [
    { key: 'token_contract', label: 'Token', type: 'select', options: FT_TOKENS },
    { key: 'min_amount', label: 'Min Amount', type: 'number', placeholder: '1000', required: true },
  ],
  'nft.transfer': [
    { key: 'addresses', label: 'Addresses', type: 'text', placeholder: '0x1,0x2', isArray: true },
    { key: 'collection', label: 'Collection', type: 'select', options: NFT_COLLECTIONS },
    { key: 'direction', label: 'Direction', type: 'select', options: ['in', 'out', 'both'] },
  ],
  'transaction.sealed': [],
  'block.sealed': [],
  'account.created': [
    { key: 'addresses', label: 'Addresses (optional)', type: 'text', placeholder: '0x1,0x2', isArray: true },
  ],
  'account.key.added': [
    { key: 'addresses', label: 'Addresses', type: 'text', placeholder: '0x1,0x2', isArray: true },
  ],
  'account.key.removed': [
    { key: 'addresses', label: 'Addresses', type: 'text', placeholder: '0x1,0x2', isArray: true },
  ],
  'account.key_change': [
    { key: 'addresses', label: 'Addresses', type: 'text', placeholder: '0x1,0x2', isArray: true },
  ],
  'account.contract.added': [
    { key: 'addresses', label: 'Addresses', type: 'text', placeholder: '0x1,0x2', isArray: true },
  ],
  'account.contract.updated': [
    { key: 'addresses', label: 'Addresses', type: 'text', placeholder: '0x1,0x2', isArray: true },
  ],
  'account.contract.removed': [
    { key: 'addresses', label: 'Addresses', type: 'text', placeholder: '0x1,0x2', isArray: true },
  ],
  'contract.event': [
    { key: 'contract_address', label: 'Contract Address', type: 'text', placeholder: '0x...' },
    { key: 'event_names', label: 'Event Names', type: 'text', placeholder: 'Deposit,Withdraw', isArray: true },
  ],
  'address.activity': [
    { key: 'addresses', label: 'Addresses', type: 'text', placeholder: '0x1,0x2', isArray: true, required: true },
    { key: 'roles', label: 'Roles', type: 'text', placeholder: 'PROPOSER,PAYER', isArray: true },
  ],
  'staking.event': [
    { key: 'event_types', label: 'Event Types', type: 'text', placeholder: 'DelegatorStaked,TokensCommitted', isArray: true },
    { key: 'node_id', label: 'Node ID', type: 'text', placeholder: '' },
    { key: 'min_amount', label: 'Min Amount', type: 'number', placeholder: '0' },
  ],
  'defi.swap': [
    { key: 'pair_id', label: 'Pair ID', type: 'text', placeholder: '' },
    { key: 'min_amount', label: 'Min Amount', type: 'number', placeholder: '0' },
    { key: 'addresses', label: 'Addresses', type: 'text', placeholder: '0x1,0x2', isArray: true },
  ],
  'defi.liquidity': [
    { key: 'pair_id', label: 'Pair ID', type: 'text', placeholder: '' },
    { key: 'event_type', label: 'Event Type', type: 'select', options: ['add', 'remove'] },
  ],
  'evm.transaction': [
    { key: 'from', label: 'From Address', type: 'text', placeholder: '0x...' },
    { key: 'to', label: 'To Address', type: 'text', placeholder: '0x...' },
    { key: 'min_value', label: 'Min Value (wei)', type: 'number', placeholder: '0' },
  ],
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a conditions object from the flat form values, omitting empties. */
function buildConditions(
  eventType: EventTypeId,
  values: Record<string, string>,
): Record<string, unknown> | null {
  const fields = CONDITION_FIELDS[eventType]
  if (!fields) return null

  const out: Record<string, unknown> = {}
  for (const field of fields) {
    const raw = (values[field.key] ?? '').trim()
    if (!raw) continue

    if (field.isArray) {
      const arr = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (arr.length > 0) out[field.key] = arr
    } else if (field.type === 'number') {
      const n = Number(raw)
      if (!isNaN(n)) out[field.key] = n
    } else {
      out[field.key] = raw
    }
  }

  return Object.keys(out).length > 0 ? out : null
}

/** Truncated JSON preview for conditions column. */
function conditionsPreview(conditions: Record<string, unknown> | null): string {
  if (!conditions || Object.keys(conditions).length === 0) return '\u2014'
  const json = JSON.stringify(conditions)
  return json.length > 60 ? json.slice(0, 57) + '...' : json
}

// ---------------------------------------------------------------------------
// Extended subscription type with is_enabled (server may or may not include it)
// ---------------------------------------------------------------------------

interface SubscriptionRow extends Subscription {
  is_enabled?: boolean
  endpoint_url?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function DeveloperSubscriptions() {
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([])
  const [endpoints, setEndpoints] = useState<Endpoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create modal state
  const [showModal, setShowModal] = useState(false)
  const [formEventType, setFormEventType] = useState<EventTypeId>('ft.transfer')
  const [formEndpointId, setFormEndpointId] = useState('')
  const [formConditions, setFormConditions] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<SubscriptionRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Toggle in-flight tracker
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())

  const fetchData = useCallback(async () => {
    try {
      setError(null)
      const [subs, eps] = await Promise.all([listSubscriptions(), listEndpoints()])
      const endpointMap = new Map(eps.map((e) => [e.id, e]))
      setEndpoints(Array.isArray(eps) ? eps : [])
      setSubscriptions(
        (Array.isArray(subs) ? subs : []).map((s) => ({
          ...s,
          is_enabled: (s as SubscriptionRow).is_enabled ?? true,
          endpoint_url: endpointMap.get(s.endpoint_id)?.url,
        })),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subscriptions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // --- Modal helpers ---

  function openCreateModal() {
    setFormEventType('ft.transfer')
    setFormEndpointId(endpoints[0]?.id ?? '')
    setFormConditions({})
    setShowModal(true)
  }

  function closeModal() {
    setShowModal(false)
    setFormConditions({})
  }

  function setConditionField(key: string, value: string) {
    setFormConditions((prev) => ({ ...prev, [key]: value }))
  }

  // --- Actions ---

  async function handleCreate() {
    if (!formEndpointId) return
    setSaving(true)
    try {
      const conditions = buildConditions(formEventType, formConditions)
      const created = await createSubscription(formEndpointId, formEventType, conditions)
      const ep = endpoints.find((e) => e.id === formEndpointId)
      setSubscriptions((prev) => [
        { ...created, is_enabled: true, endpoint_url: ep?.url },
        ...prev,
      ])
      closeModal()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create subscription')
      closeModal()
    } finally {
      setSaving(false)
    }
  }

  async function handleToggle(sub: SubscriptionRow) {
    const newEnabled = !sub.is_enabled
    setTogglingIds((prev) => new Set(prev).add(sub.id))
    try {
      await updateSubscription(sub.id, { is_enabled: newEnabled } as never)
      setSubscriptions((prev) =>
        prev.map((s) => (s.id === sub.id ? { ...s, is_enabled: newEnabled } : s)),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update subscription')
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev)
        next.delete(sub.id)
        return next
      })
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteSubscription(deleteTarget.id)
      setSubscriptions((prev) => prev.filter((s) => s.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete subscription')
    } finally {
      setDeleting(false)
    }
  }

  // --- Condition fields for selected event type ---

  const conditionFields = CONDITION_FIELDS[formEventType] ?? []

  return (
    <DeveloperLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Subscriptions</h1>
            <p className="text-sm text-neutral-400 mt-1">
              Subscribe to on-chain events and get notified via your endpoints
            </p>
          </div>
          <button
            onClick={openCreateModal}
            disabled={endpoints.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-[#00ef8b] text-black font-medium text-sm rounded-lg hover:bg-[#00ef8b]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" />
            New Subscription
          </button>
        </div>

        {/* Warning: no endpoints */}
        {!loading && endpoints.length === 0 && (
          <div className="flex items-center gap-2 px-4 py-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-400 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            You need at least one endpoint before creating subscriptions.
          </div>
        )}

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
          ) : subscriptions.length === 0 ? (
            <div className="text-center py-16 text-neutral-500">
              <Bell className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">
                No subscriptions yet. Create one to start receiving event notifications.
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-neutral-800 text-left">
                  <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    Event Type
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    Endpoint
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    Conditions
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    Enabled
                  </th>
                  <th className="px-4 py-3 text-xs font-medium text-neutral-500 uppercase tracking-wider w-16" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {subscriptions.map((sub) => (
                  <motion.tr
                    key={sub.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="hover:bg-neutral-800/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <span className="text-sm font-mono text-[#00ef8b]">
                        {sub.event_type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-sm font-mono text-neutral-300 block max-w-[200px] truncate"
                        title={sub.endpoint_url ?? sub.endpoint_id}
                      >
                        {sub.endpoint_url ?? sub.endpoint_id}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs font-mono text-neutral-400 block max-w-[200px] truncate"
                        title={
                          sub.conditions ? JSON.stringify(sub.conditions) : undefined
                        }
                      >
                        {conditionsPreview(sub.conditions)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggle(sub)}
                        disabled={togglingIds.has(sub.id)}
                        className="relative w-10 h-5 rounded-full transition-colors focus:outline-none disabled:opacity-50"
                        style={{
                          backgroundColor: sub.is_enabled
                            ? 'rgba(0,239,139,0.3)'
                            : 'rgba(82,82,82,0.5)',
                        }}
                        title={sub.is_enabled ? 'Disable' : 'Enable'}
                      >
                        <span
                          className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                            sub.is_enabled ? 'left-[22px] bg-[#00ef8b]' : 'left-0.5 bg-neutral-400'
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setDeleteTarget(sub)}
                        className="p-1.5 rounded-md text-neutral-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Delete subscription"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Create Subscription Modal */}
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
              className="bg-neutral-900 border border-neutral-800 rounded-xl w-full max-w-lg mx-4 p-6 space-y-4 max-h-[85vh] overflow-y-auto"
            >
              <h2 className="text-lg font-semibold text-white">New Subscription</h2>

              {/* Event Type */}
              <div>
                <label
                  htmlFor="sub-event-type"
                  className="block text-sm text-neutral-400 mb-1.5"
                >
                  Event Type
                </label>
                <select
                  id="sub-event-type"
                  value={formEventType}
                  onChange={(e) => {
                    setFormEventType(e.target.value as EventTypeId)
                    setFormConditions({})
                  }}
                  className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-white focus:outline-none focus:border-[#00ef8b]/50 focus:ring-1 focus:ring-[#00ef8b]/25 transition-colors"
                >
                  {EVENT_TYPES.map((et) => (
                    <option key={et} value={et}>
                      {EVENT_TYPE_LABELS[et]} ({et})
                    </option>
                  ))}
                </select>
              </div>

              {/* Endpoint */}
              <div>
                <label
                  htmlFor="sub-endpoint"
                  className="block text-sm text-neutral-400 mb-1.5"
                >
                  Endpoint
                </label>
                <select
                  id="sub-endpoint"
                  value={formEndpointId}
                  onChange={(e) => setFormEndpointId(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-white font-mono focus:outline-none focus:border-[#00ef8b]/50 focus:ring-1 focus:ring-[#00ef8b]/25 transition-colors"
                >
                  {endpoints.map((ep) => (
                    <option key={ep.id} value={ep.id}>
                      {ep.url}
                    </option>
                  ))}
                </select>
              </div>

              {/* Condition Fields */}
              {conditionFields.length > 0 && (
                <div className="space-y-3 pt-2">
                  <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider">
                    Conditions
                  </p>
                  {conditionFields.map((field) => (
                    <div key={field.key}>
                      <label
                        htmlFor={`cond-${field.key}`}
                        className="block text-sm text-neutral-400 mb-1.5"
                      >
                        {field.label}
                        {field.required && (
                          <span className="text-red-400 ml-0.5">*</span>
                        )}
                      </label>
                      {field.type === 'select' ? (
                        <select
                          id={`cond-${field.key}`}
                          value={formConditions[field.key] ?? ''}
                          onChange={(e) => setConditionField(field.key, e.target.value)}
                          className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-white focus:outline-none focus:border-[#00ef8b]/50 focus:ring-1 focus:ring-[#00ef8b]/25 transition-colors"
                        >
                          {!(field.options?.[0] && typeof field.options[0] === 'object') && (
                            <option value="">-- Select --</option>
                          )}
                          {field.options?.map((opt) =>
                            typeof opt === 'object' ? (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ) : (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ),
                          )}
                        </select>
                      ) : (
                        <input
                          id={`cond-${field.key}`}
                          type={field.type === 'number' ? 'number' : 'text'}
                          value={formConditions[field.key] ?? ''}
                          onChange={(e) => setConditionField(field.key, e.target.value)}
                          placeholder={field.placeholder}
                          className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-white font-mono placeholder-neutral-500 focus:outline-none focus:border-[#00ef8b]/50 focus:ring-1 focus:ring-[#00ef8b]/25 transition-colors"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={closeModal}
                  className="flex-1 py-2 bg-neutral-800 text-neutral-300 text-sm font-medium rounded-lg hover:bg-neutral-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!formEndpointId || saving}
                  className="flex-1 py-2 bg-[#00ef8b] text-black text-sm font-medium rounded-lg hover:bg-[#00ef8b]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Create
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
              <h2 className="text-lg font-semibold text-white">Delete Subscription</h2>
              <p className="text-sm text-neutral-400">
                Are you sure you want to delete the{' '}
                <span className="text-[#00ef8b] font-mono text-xs">
                  {deleteTarget.event_type}
                </span>{' '}
                subscription? This action cannot be undone.
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

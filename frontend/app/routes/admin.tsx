import { createFileRoute } from '@tanstack/react-router'
import { useState, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Shield, Search, Save, Coins, Image, Loader2, X, FileCode, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'
import { resolveApiBaseUrl } from '../api'
import toast from 'react-hot-toast'

export const Route = createFileRoute('/admin')({
  component: AdminPage,
})

// ── helpers ──────────────────────────────────────────────────────────

async function adminFetch(path: string, token: string, options?: RequestInit) {
  const base = await resolveApiBaseUrl()
  const res = await fetch(`${base}/${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options?.headers || {}),
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error || `HTTP ${res.status}`)
  }
  return res.json()
}

const STORAGE_KEY = 'flowindex_admin_token'

// ── main component ──────────────────────────────────────────────────

function AdminPage() {
  const [token, setToken] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) || '' : '',
  )
  const [tokenInput, setTokenInput] = useState(token)
  const [authed, setAuthed] = useState(!!token)

  const [tab, setTab] = useState<'ft' | 'nft' | 'scripts'>('ft')

  const handleLogin = () => {
    if (!tokenInput.trim()) return
    localStorage.setItem(STORAGE_KEY, tokenInput.trim())
    setToken(tokenInput.trim())
    setAuthed(true)
  }

  const handleLogout = () => {
    localStorage.removeItem(STORAGE_KEY)
    setToken('')
    setTokenInput('')
    setAuthed(false)
  }

  if (!authed) {
    return (
      <div className="container mx-auto px-4 py-8 space-y-8">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center space-x-4">
          <div className="p-3 bg-nothing-green/10">
            <Shield className="h-8 w-8 text-nothing-green-dark dark:text-nothing-green" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-white uppercase tracking-tighter">Admin</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 font-mono">Token Metadata Management</p>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="max-w-md bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none space-y-4">
          <label className="block text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest font-mono">Admin Token</label>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            placeholder="Enter admin token..."
            className="w-full px-3 py-2 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-sm text-sm font-mono text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-nothing-green"
          />
          <button
            onClick={handleLogin}
            className="px-4 py-2 bg-nothing-green text-black text-xs uppercase tracking-widest font-mono font-bold hover:bg-nothing-green/90 transition-colors"
          >
            Authenticate
          </button>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="p-3 bg-nothing-green/10">
            <Shield className="h-8 w-8 text-nothing-green-dark dark:text-nothing-green" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-white uppercase tracking-tighter">Admin</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 font-mono">Token Metadata Management</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="px-3 py-1.5 border border-zinc-200 dark:border-white/10 text-xs uppercase tracking-widest font-mono text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
        >
          Logout
        </button>
      </motion.div>

      {/* Tab switcher */}
      <div className="flex gap-1 border-b border-zinc-200 dark:border-white/10">
        <TabButton active={tab === 'ft'} onClick={() => setTab('ft')} icon={<Coins className="w-4 h-4" />} label="FT Tokens" />
        <TabButton active={tab === 'nft'} onClick={() => setTab('nft')} icon={<Image className="w-4 h-4" />} label="NFT Collections" />
        <TabButton active={tab === 'scripts'} onClick={() => setTab('scripts')} icon={<FileCode className="w-4 h-4" />} label="Script Templates" />
      </div>

      {tab === 'ft' ? <FTPanel token={token} /> : tab === 'nft' ? <NFTPanel token={token} /> : <ScriptTemplatesPanel token={token} />}
    </div>
  )
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-xs uppercase tracking-widest font-mono transition-colors border-b-2 -mb-px ${
        active
          ? 'border-nothing-green text-nothing-green-dark dark:text-nothing-green'
          : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

// ── FT Panel ────────────────────────────────────────────────────────

function FTPanel({ token }: { token: string }) {
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const doSearch = useCallback(async () => {
    setLoading(true)
    try {
      const data = await adminFetch(`admin/ft?limit=50&search=${encodeURIComponent(search)}`, token)
      setItems(data?.data || [])
      setLoaded(true)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }, [search, token])

  useEffect(() => { doSearch() }, [token]) // auto-load on mount

  return (
    <div className="space-y-4">
      <SearchBar value={search} onChange={setSearch} onSearch={doSearch} loading={loading} />
      {loaded && items.length === 0 && (
        <p className="text-sm text-zinc-500 font-mono text-center py-8">No tokens found.</p>
      )}
      {items.map((item) => (
        <FTRow key={item.identifier} item={item} token={token} />
      ))}
    </div>
  )
}

function FTRow({ item, token }: { item: any; token: string }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: item.name || '',
    symbol: item.symbol || '',
    logo: item.logo || '',
    description: item.description || '',
    external_url: item.external_url || '',
    decimals: item.decimals ?? 0,
  })

  const handleSave = async () => {
    setSaving(true)
    try {
      await adminFetch(`admin/ft/${encodeURIComponent(item.identifier)}`, token, {
        method: 'PUT',
        body: JSON.stringify(form),
      })
      toast.success(`Updated ${item.identifier}`)
      setEditing(false)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {form.logo ? (
            <img src={form.logo} alt="" className="w-8 h-8 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
          ) : (
            <div className="w-8 h-8 flex items-center justify-center bg-zinc-100 dark:bg-white/10 text-sm font-bold text-zinc-500 dark:text-zinc-400 font-mono">
              {(form.symbol || '?')[0].toUpperCase()}
            </div>
          )}
          <div>
            <span className="font-mono text-sm text-zinc-900 dark:text-white font-semibold">{item.identifier}</span>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">{form.name} ({form.symbol})</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1 px-3 py-1.5 bg-nothing-green text-black text-xs uppercase tracking-widest font-mono font-bold hover:bg-nothing-green/90 transition-colors disabled:opacity-50">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save
              </button>
              <button onClick={() => setEditing(false)}
                className="flex items-center gap-1 px-3 py-1.5 border border-zinc-200 dark:border-white/10 text-xs uppercase tracking-widest font-mono text-zinc-500 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                <X className="w-3 h-3" /> Cancel
              </button>
            </>
          ) : (
            <button onClick={() => setEditing(true)}
              className="px-3 py-1.5 border border-zinc-200 dark:border-white/10 text-xs uppercase tracking-widest font-mono text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
              Edit
            </button>
          )}
        </div>
      </div>
      {editing && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 pt-3 border-t border-zinc-100 dark:border-white/5">
          <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Field label="Symbol" value={form.symbol} onChange={(v) => setForm({ ...form, symbol: v })} />
          <Field label="Logo URL" value={form.logo} onChange={(v) => setForm({ ...form, logo: v })} />
          <Field label="External URL" value={form.external_url} onChange={(v) => setForm({ ...form, external_url: v })} />
          <Field label="Decimals" value={String(form.decimals)} onChange={(v) => setForm({ ...form, decimals: parseInt(v) || 0 })} />
          <Field label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} multiline />
        </div>
      )}
    </div>
  )
}

// ── NFT Panel ───────────────────────────────────────────────────────

function NFTPanel({ token }: { token: string }) {
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const doSearch = useCallback(async () => {
    setLoading(true)
    try {
      const data = await adminFetch(`admin/nft?limit=50&search=${encodeURIComponent(search)}`, token)
      setItems(data?.data || [])
      setLoaded(true)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }, [search, token])

  useEffect(() => { doSearch() }, [token]) // auto-load on mount

  return (
    <div className="space-y-4">
      <SearchBar value={search} onChange={setSearch} onSearch={doSearch} loading={loading} />
      {loaded && items.length === 0 && (
        <p className="text-sm text-zinc-500 font-mono text-center py-8">No collections found.</p>
      )}
      {items.map((item) => (
        <NFTRow key={item.identifier} item={item} token={token} />
      ))}
    </div>
  )
}

function NFTRow({ item, token }: { item: any; token: string }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: item.name || '',
    symbol: item.symbol || '',
    square_image: item.square_image || '',
    banner_image: item.banner_image || '',
    description: item.description || '',
    external_url: item.external_url || '',
  })

  const handleSave = async () => {
    setSaving(true)
    try {
      await adminFetch(`admin/nft/${encodeURIComponent(item.identifier)}`, token, {
        method: 'PUT',
        body: JSON.stringify(form),
      })
      toast.success(`Updated ${item.identifier}`)
      setEditing(false)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {form.square_image ? (
            <img src={form.square_image} alt="" className="w-8 h-8 object-cover rounded-sm" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
          ) : (
            <div className="w-8 h-8 flex items-center justify-center bg-zinc-100 dark:bg-white/10 text-sm font-bold text-zinc-500 dark:text-zinc-400 font-mono">
              {(form.symbol || item.contract_name || '?')[0].toUpperCase()}
            </div>
          )}
          <div>
            <span className="font-mono text-sm text-zinc-900 dark:text-white font-semibold">{item.identifier}</span>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">{form.name} ({form.symbol})</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1 px-3 py-1.5 bg-nothing-green text-black text-xs uppercase tracking-widest font-mono font-bold hover:bg-nothing-green/90 transition-colors disabled:opacity-50">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save
              </button>
              <button onClick={() => setEditing(false)}
                className="flex items-center gap-1 px-3 py-1.5 border border-zinc-200 dark:border-white/10 text-xs uppercase tracking-widest font-mono text-zinc-500 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                <X className="w-3 h-3" /> Cancel
              </button>
            </>
          ) : (
            <button onClick={() => setEditing(true)}
              className="px-3 py-1.5 border border-zinc-200 dark:border-white/10 text-xs uppercase tracking-widest font-mono text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
              Edit
            </button>
          )}
        </div>
      </div>
      {editing && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 pt-3 border-t border-zinc-100 dark:border-white/5">
          <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          <Field label="Symbol" value={form.symbol} onChange={(v) => setForm({ ...form, symbol: v })} />
          <Field label="Square Image URL" value={form.square_image} onChange={(v) => setForm({ ...form, square_image: v })} />
          <Field label="Banner Image URL" value={form.banner_image} onChange={(v) => setForm({ ...form, banner_image: v })} />
          <Field label="External URL" value={form.external_url} onChange={(v) => setForm({ ...form, external_url: v })} />
          <Field label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} multiline />
        </div>
      )}
    </div>
  )
}

// ── Script Templates Panel ───────────────────────────────────────────

const SCRIPT_CATEGORIES = [
  '', 'FT_TRANSFER', 'NFT_TRANSFER', 'NFT_PURCHASE', 'NFT_LISTING',
  'STAKING', 'ACCOUNT_SETUP', 'EVM_BRIDGE', 'EVM_CALL', 'SWAP',
  'LIQUIDITY', 'CONTRACT_DEPLOY', 'SYSTEM', 'OTHER',
]

function ScriptTemplatesPanel({ token }: { token: string }) {
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [stats, setStats] = useState<any>(null)
  const [refreshing, setRefreshing] = useState(false)

  const loadStats = useCallback(async () => {
    try {
      const data = await adminFetch('admin/script-templates/stats', token)
      setStats(data?.data || null)
    } catch { /* ignore */ }
  }, [token])

  const doSearch = useCallback(async () => {
    setLoading(true)
    try {
      const data = await adminFetch(`admin/script-templates?limit=50&search=${encodeURIComponent(search)}`, token)
      setItems(data?.data || [])
      setLoaded(true)
      loadStats()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }, [search, token, loadStats])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await adminFetch('admin/script-templates/refresh-counts', token, { method: 'POST' })
      toast.success('Counts refreshed')
      doSearch()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => { doSearch() }, [token]) // auto-load on mount

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      {stats && (
        <div className="flex gap-4 flex-wrap">
          <StatBadge label="Total Scripts" value={stats.total?.toLocaleString() || '0'} />
          <StatBadge label="Labeled" value={stats.labeled?.toLocaleString() || '0'} />
          <StatBadge label="Unlabeled" value={stats.unlabeled?.toLocaleString() || '0'} />
          <StatBadge label="TX Coverage" value={`${(stats.coverage_pct || 0).toFixed(1)}%`} highlight />
        </div>
      )}

      <div className="flex gap-2">
        <div className="flex-1">
          <SearchBar value={search} onChange={setSearch} onSearch={doSearch} loading={loading} />
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 border border-zinc-200 dark:border-white/10 text-xs uppercase tracking-widest font-mono text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
        >
          {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
      </div>

      {loaded && items.length === 0 && (
        <p className="text-sm text-zinc-500 font-mono text-center py-8">No script templates found. Click "Refresh" to populate.</p>
      )}
      {items.map((item) => (
        <ScriptTemplateRow key={item.script_hash} item={item} token={token} />
      ))}
    </div>
  )
}

function StatBadge({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`px-3 py-2 border rounded-sm ${highlight ? 'border-nothing-green/30 bg-nothing-green/5' : 'border-zinc-200 dark:border-white/10 bg-white dark:bg-nothing-dark'}`}>
      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 uppercase tracking-widest font-mono">{label}</div>
      <div className={`text-lg font-bold font-mono ${highlight ? 'text-nothing-green-dark dark:text-nothing-green' : 'text-zinc-900 dark:text-white'}`}>{value}</div>
    </div>
  )
}

function ScriptTemplateRow({ item, token }: { item: any; token: string }) {
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [scriptText, setScriptText] = useState<string | null>(null)
  const [loadingScript, setLoadingScript] = useState(false)
  const [category, setCategory] = useState(item.category || '')
  const [label, setLabel] = useState(item.label || '')
  const [description, setDescription] = useState(item.description || '')

  const handleSave = async () => {
    setSaving(true)
    try {
      await adminFetch(`admin/script-templates/${encodeURIComponent(item.script_hash)}`, token, {
        method: 'PUT',
        body: JSON.stringify({ category, label, description }),
      })
      toast.success('Template updated')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleExpand = async () => {
    if (!expanded && scriptText === null) {
      setLoadingScript(true)
      try {
        const data = await adminFetch(`admin/script-templates/${encodeURIComponent(item.script_hash)}/script`, token)
        setScriptText(data?.data?.script_text || '')
      } catch {
        setScriptText('(failed to load)')
      } finally {
        setLoadingScript(false)
      }
    }
    setExpanded(!expanded)
  }

  return (
    <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm p-4">
      <div className="flex items-start gap-3">
        {/* Expand toggle */}
        <button onClick={handleExpand} className="flex-shrink-0 pt-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <span className="font-mono text-xs text-zinc-900 dark:text-white">{item.script_hash}</span>
            <span className="text-xs font-mono text-zinc-400 bg-zinc-100 dark:bg-white/10 px-2 py-0.5 rounded-sm">
              {(item.tx_count || 0).toLocaleString()} txs
            </span>
          </div>

          {/* Script preview */}
          {item.script_preview && (
            <pre className="text-[10px] text-zinc-500 dark:text-zinc-500 font-mono mb-3 whitespace-pre-wrap line-clamp-2 leading-tight">
              {item.script_preview}
            </pre>
          )}

          {/* Inline edit fields */}
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="px-2 py-1 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-sm text-xs font-mono text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-nothing-green"
            >
              {SCRIPT_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c || '(none)'}</option>
              ))}
            </select>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label..."
              className="flex-1 min-w-[200px] px-2 py-1 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-sm text-xs font-mono text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-nothing-green"
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1 px-3 py-1 bg-nothing-green text-black text-[10px] uppercase tracking-widest font-mono font-bold hover:bg-nothing-green/90 transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save
            </button>
          </div>
        </div>
      </div>

      {/* Expanded script text */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-white/5">
          <Field label="Description" value={description} onChange={setDescription} multiline />
          <div className="mt-3">
            <label className="block text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest font-mono mb-1">Full Script</label>
            {loadingScript ? (
              <div className="flex items-center gap-2 text-xs text-zinc-400 py-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading...
              </div>
            ) : (
              <pre className="text-[10px] text-zinc-600 dark:text-zinc-400 font-mono bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-sm p-3 max-h-64 overflow-auto whitespace-pre-wrap">
                {scriptText || '(empty)'}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── shared UI ───────────────────────────────────────────────────────

function SearchBar({ value, onChange, onSearch, loading }: { value: string; onChange: (v: string) => void; onSearch: () => void; loading: boolean }) {
  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSearch()}
          placeholder="Search by name, symbol, or contract..."
          className="w-full pl-10 pr-3 py-2 bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm text-sm font-mono text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-nothing-green"
        />
      </div>
      <button
        onClick={onSearch}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-nothing-green text-black text-xs uppercase tracking-widest font-mono font-bold hover:bg-nothing-green/90 transition-colors disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
        Search
      </button>
    </div>
  )
}

function Field({ label, value, onChange, multiline }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  const cls = "w-full px-3 py-1.5 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-sm text-sm font-mono text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-nothing-green"
  return (
    <div className={multiline ? 'md:col-span-2' : ''}>
      <label className="block text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest font-mono mb-1">{label}</label>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className={cls} />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={cls} />
      )}
    </div>
  )
}

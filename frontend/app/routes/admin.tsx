import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useState, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Shield, Search, Save, Coins, Image, Loader2, X, FileCode, RefreshCw, ChevronDown, ChevronRight, Sparkles, Download, Eye, Check, CircleCheck, Tags, Trash2, Plus, Fish, ArrowLeftRight, ChartLine, Tag } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { VerifiedBadge } from '../components/ui/VerifiedBadge'
import { resolveApiBaseUrl } from '../api'
import toast from 'react-hot-toast'
import { Pagination } from '../components/Pagination'
import Avatar from 'boring-avatars'
import { colorsFromAddress } from '../components/AddressLink'

type AdminTab = 'ft' | 'nft' | 'contracts' | 'scripts' | 'import' | 'labels'
const VALID_TABS: AdminTab[] = ['ft', 'nft', 'contracts', 'scripts', 'import', 'labels']

export const Route = createFileRoute('/admin')({
  component: AdminPage,
  validateSearch: (search: Record<string, unknown>): { tab?: AdminTab } => {
    const tab = search.tab as string
    return {
      tab: VALID_TABS.includes(tab as AdminTab) ? (tab as AdminTab) : undefined,
    }
  },
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

  const { tab: searchTab } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const tab: AdminTab = searchTab || 'ft'
  const setTab = (t: AdminTab) => navigate({ search: { tab: t } as any })

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
        <TabButton active={tab === 'contracts'} onClick={() => setTab('contracts')} icon={<FileCode className="w-4 h-4" />} label="Contracts" />
        <TabButton active={tab === 'scripts'} onClick={() => setTab('scripts')} icon={<FileCode className="w-4 h-4" />} label="Script Templates" />
        <TabButton active={tab === 'import'} onClick={() => setTab('import')} icon={<Download className="w-4 h-4" />} label="Import Token" />
        <TabButton active={tab === 'labels'} onClick={() => setTab('labels')} icon={<Tags className="w-4 h-4" />} label="Account Labels" />
      </div>

      {tab === 'ft' ? <FTPanel token={token} /> : tab === 'nft' ? <NFTPanel token={token} /> : tab === 'contracts' ? <ContractsPanel token={token} /> : tab === 'scripts' ? <ScriptTemplatesPanel token={token} /> : tab === 'labels' ? <AccountLabelsPanel token={token} /> : <ImportTokenPanel token={token} />}
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

function VerifiedFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1">
      {[{ label: 'All', val: '' }, { label: 'Verified', val: 'true' }, { label: 'Unverified', val: 'false' }].map((opt) => (
        <button key={opt.val} onClick={() => onChange(opt.val)}
          className={`px-2.5 py-1 text-[10px] uppercase tracking-widest font-mono transition-colors ${
            value === opt.val
              ? 'bg-nothing-green text-black font-bold'
              : 'border border-zinc-200 dark:border-white/10 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/5'
          }`}>
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ── Contracts Panel ──────────────────────────────────────────────────

function ContractsPanel({ token }: { token: string }) {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [verified, setVerified] = useState('')
  const [page, setPage] = useState(1)
  const [refreshing, setRefreshing] = useState(false)
  const limit = 25

  const fetchContracts = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String((page - 1) * limit) })
      if (search) params.set('search', search)
      if (verified) params.set('verified', verified)
      const res = await adminFetch(`admin/contracts?${params}`, token)
      setItems(res.data || [])
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }, [token, page, search, verified])

  useEffect(() => { fetchContracts() }, [fetchContracts])

  const refreshCounts = async () => {
    setRefreshing(true)
    try {
      const res = await adminFetch('admin/contracts/refresh-dependent-counts', token, { method: 'POST' })
      toast.success(`Refreshed dependent counts (${res.data?.updated || 0} updated)`)
      fetchContracts()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-zinc-400" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search by name or address..."
              className="flex-1 px-3 py-2 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-sm text-sm font-mono text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-nothing-green"
            />
          </div>
        </div>
        <VerifiedFilter value={verified} onChange={(v) => { setVerified(v); setPage(1) }} />
        <button
          onClick={refreshCounts}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-2 border border-zinc-200 dark:border-white/10 text-xs uppercase tracking-widest font-mono text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5 disabled:opacity-50 transition-colors"
        >
          {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh Counts
        </button>
      </div>

      {loading ? (
        <div className="p-8 text-center text-zinc-500 text-sm"><Loader2 className="w-5 h-5 animate-spin inline-block" /></div>
      ) : items.length === 0 ? (
        <p className="text-sm text-zinc-500 font-mono text-center py-8">No contracts found.</p>
      ) : items.map((c: any) => (
        <ContractRow key={c.identifier} item={c} token={token} onUpdate={(updated) => {
          setItems(prev => prev.map(x => x.identifier === c.identifier ? { ...x, ...updated } : x))
        }} />
      ))}
      {!loading && items.length > 0 && (
        <Pagination currentPage={page} onPageChange={setPage} hasNext={items.length === limit} />
      )}
    </div>
  )
}

function ContractRow({ item, token, onUpdate }: { item: any; token: string; onUpdate: (updated: any) => void }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isVerified, setIsVerified] = useState(Boolean(item.is_verified))
  const [kind, setKind] = useState(item.kind || '')

  const toggleVerified = async () => {
    const next = !isVerified
    try {
      await adminFetch(`admin/contracts/${encodeURIComponent(item.identifier)}`, token, {
        method: 'PUT',
        body: JSON.stringify({ is_verified: next }),
      })
      setIsVerified(next)
      onUpdate({ is_verified: next })
      toast.success(`${item.identifier} ${next ? 'verified' : 'unverified'}`)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await adminFetch(`admin/contracts/${encodeURIComponent(item.identifier)}`, token, {
        method: 'PUT',
        body: JSON.stringify({ kind: kind || '' }),
      })
      onUpdate({ kind })
      toast.success(`Updated ${item.identifier}`)
      setEditing(false)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const kindBadge = (k: string) => {
    if (!k) return null
    const colors = k === 'FT'
      ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300'
      : 'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300'
    return <span className={`px-1.5 py-0.5 text-[10px] uppercase tracking-widest font-mono font-bold ${colors}`}>{k}</span>
  }

  return (
    <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar size={32} name={item.identifier} variant="marble" colors={colorsFromAddress(item.address)} />
          <div>
            <div className="flex items-center gap-1.5">
              <Link to={`/contracts/${item.identifier}` as any} className="font-mono text-sm text-nothing-green-dark dark:text-nothing-green hover:underline font-semibold">
                {item.identifier}
              </Link>
              {isVerified && <VerifiedBadge size={14} />}
              {kindBadge(kind)}
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
              {Number(item.dependent_count || 0).toLocaleString()} dependents
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleVerified} title={isVerified ? 'Unverify' : 'Verify'}
            className={`px-2.5 py-1.5 text-[10px] uppercase tracking-widest font-mono font-bold transition-colors ${
              isVerified
                ? 'bg-nothing-green/20 text-nothing-green-dark dark:text-nothing-green border border-nothing-green/30'
                : 'border border-zinc-200 dark:border-white/10 text-zinc-400 hover:text-nothing-green hover:border-nothing-green/30'
            }`}>
            <CircleCheck className="w-3.5 h-3.5" />
          </button>
          {editing ? (
            <>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1 px-3 py-1.5 bg-nothing-green text-black text-xs uppercase tracking-widest font-mono font-bold hover:bg-nothing-green/90 transition-colors disabled:opacity-50">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save
              </button>
              <button onClick={() => { setEditing(false); setKind(item.kind || '') }}
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
        <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-white/5">
          <div className="max-w-xs">
            <label className="block text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest font-mono mb-1">Kind</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="w-full px-3 py-1.5 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-sm text-sm font-mono text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-nothing-green"
            >
              <option value="">None</option>
              <option value="FT">FT</option>
              <option value="NFT">NFT</option>
            </select>
          </div>
        </div>
      )}
    </div>
  )
}

function FTPanel({ token }: { token: string }) {
  const [search, setSearch] = useState('')
  const [verified, setVerified] = useState('')
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [fetchingMetadata, setFetchingMetadata] = useState(false)

  const doSearch = useCallback(async (p = page) => {
    setLoading(true)
    try {
      const offset = (p - 1) * 50
      let url = `admin/ft?limit=50&offset=${offset}&search=${encodeURIComponent(search)}`
      if (verified) url += `&verified=${verified}`
      const data = await adminFetch(url, token)
      const rows = data?.data || []
      setItems(rows)
      setHasNext(rows.length >= 50)
      setLoaded(true)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }, [search, verified, token, page])

  const handleSearch = () => { setPage(1); doSearch(1) }
  const handlePageChange = (p: number) => { setPage(p); doSearch(p) }
  const handleVerifiedChange = (v: string) => { setVerified(v); setPage(1); setTimeout(() => doSearch(1), 0) }

  const handleBatchFetchMetadata = async () => {
    setFetchingMetadata(true)
    try {
      const data = await adminFetch('admin/batch-fetch-metadata', token, { method: 'POST' })
      const msg = `FT: ${data.ft_updated}/${data.ft_total} updated, NFT: ${data.nft_updated}/${data.nft_total} updated`
      if (data.ft_updated > 0 || data.nft_updated > 0) {
        toast.success(msg)
      } else {
        toast(msg, { icon: '\u2139\uFE0F' })
      }
      doSearch(page)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setFetchingMetadata(false)
    }
  }

  useEffect(() => { doSearch(1) }, [token]) // auto-load on mount

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1"><SearchBar value={search} onChange={setSearch} onSearch={handleSearch} loading={loading} /></div>
        <button
          onClick={handleBatchFetchMetadata}
          disabled={fetchingMetadata}
          className="flex items-center gap-2 px-4 py-2 border border-zinc-200 dark:border-white/10 text-xs uppercase tracking-widest font-mono text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
        >
          {fetchingMetadata ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Fetch Missing
        </button>
        <VerifiedFilter value={verified} onChange={handleVerifiedChange} />
      </div>
      {loaded && items.length === 0 && (
        <p className="text-sm text-zinc-500 font-mono text-center py-8">No tokens found.</p>
      )}
      {items.map((item) => (
        <FTRow key={item.identifier} item={item} token={token} />
      ))}
      {loaded && items.length > 0 && (
        <Pagination currentPage={page} onPageChange={handlePageChange} hasNext={hasNext} />
      )}
    </div>
  )
}

function FTRow({ item, token }: { item: any; token: string }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isVerified, setIsVerified] = useState(Boolean(item.is_verified))
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
        body: JSON.stringify({ ...form, is_verified: isVerified }),
      })
      toast.success(`Updated ${item.identifier}`)
      setEditing(false)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const toggleVerified = async () => {
    const next = !isVerified
    try {
      await adminFetch(`admin/ft/${encodeURIComponent(item.identifier)}`, token, {
        method: 'PUT',
        body: JSON.stringify({ is_verified: next }),
      })
      setIsVerified(next)
      toast.success(`${item.identifier} ${next ? 'verified' : 'unverified'}`)
    } catch (e: any) {
      toast.error(e.message)
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
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-sm text-zinc-900 dark:text-white font-semibold">{item.identifier}</span>
              {isVerified && <VerifiedBadge size={14} />}
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">{form.name} ({form.symbol})</div>
            <div className="flex items-center gap-3 mt-0.5 text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
              {item.total_supply ? <span>Supply: {Number(item.total_supply).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span> : null}
              {item.holder_count ? <span>Holders: {Number(item.holder_count).toLocaleString()}</span> : null}
              {item.evm_address ? <a href={`https://evm.flowindex.io/address/${item.evm_address}`} target="_blank" rel="noopener noreferrer" className="text-violet-500 hover:underline">{item.evm_address.slice(0, 10)}...</a> : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleVerified} title={isVerified ? 'Unverify' : 'Verify'}
            className={`px-2.5 py-1.5 text-[10px] uppercase tracking-widest font-mono font-bold transition-colors ${
              isVerified
                ? 'bg-nothing-green/20 text-nothing-green-dark dark:text-nothing-green border border-nothing-green/30'
                : 'border border-zinc-200 dark:border-white/10 text-zinc-400 hover:text-nothing-green hover:border-nothing-green/30'
            }`}>
            <CircleCheck className="w-3.5 h-3.5" />
          </button>
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
  const [verified, setVerified] = useState('')
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)

  const doSearch = useCallback(async (p = page) => {
    setLoading(true)
    try {
      const offset = (p - 1) * 50
      let url = `admin/nft?limit=50&offset=${offset}&search=${encodeURIComponent(search)}`
      if (verified) url += `&verified=${verified}`
      const data = await adminFetch(url, token)
      const rows = data?.data || []
      setItems(rows)
      setHasNext(rows.length >= 50)
      setLoaded(true)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }, [search, verified, token, page])

  const handleSearch = () => { setPage(1); doSearch(1) }
  const handlePageChange = (p: number) => { setPage(p); doSearch(p) }
  const handleVerifiedChange = (v: string) => { setVerified(v); setPage(1); setTimeout(() => doSearch(1), 0) }

  useEffect(() => { doSearch(1) }, [token]) // auto-load on mount

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1"><SearchBar value={search} onChange={setSearch} onSearch={handleSearch} loading={loading} /></div>
        <VerifiedFilter value={verified} onChange={handleVerifiedChange} />
      </div>
      {loaded && items.length === 0 && (
        <p className="text-sm text-zinc-500 font-mono text-center py-8">No collections found.</p>
      )}
      {items.map((item) => (
        <NFTRow key={item.identifier} item={item} token={token} />
      ))}
      {loaded && items.length > 0 && (
        <Pagination currentPage={page} onPageChange={handlePageChange} hasNext={hasNext} />
      )}
    </div>
  )
}

function NFTRow({ item, token }: { item: any; token: string }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isVerified, setIsVerified] = useState(Boolean(item.is_verified))
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
        body: JSON.stringify({ ...form, is_verified: isVerified }),
      })
      toast.success(`Updated ${item.identifier}`)
      setEditing(false)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const toggleVerified = async () => {
    const next = !isVerified
    try {
      await adminFetch(`admin/nft/${encodeURIComponent(item.identifier)}`, token, {
        method: 'PUT',
        body: JSON.stringify({ is_verified: next }),
      })
      setIsVerified(next)
      toast.success(`${item.identifier} ${next ? 'verified' : 'unverified'}`)
    } catch (e: any) {
      toast.error(e.message)
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
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-sm text-zinc-900 dark:text-white font-semibold">{item.identifier}</span>
              {isVerified && <VerifiedBadge size={14} />}
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">{form.name} ({form.symbol})</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleVerified} title={isVerified ? 'Unverify' : 'Verify'}
            className={`px-2.5 py-1.5 text-[10px] uppercase tracking-widest font-mono font-bold transition-colors ${
              isVerified
                ? 'bg-nothing-green/20 text-nothing-green-dark dark:text-nothing-green border border-nothing-green/30'
                : 'border border-zinc-200 dark:border-white/10 text-zinc-400 hover:text-nothing-green hover:border-nothing-green/30'
            }`}>
            <CircleCheck className="w-3.5 h-3.5" />
          </button>
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
  '', 'FT_TRANSFER', 'FT_MINT', 'FT_BURN',
  'NFT_TRANSFER', 'NFT_MINT', 'NFT_BURN', 'NFT_PURCHASE', 'NFT_LISTING',
  'STAKING', 'REWARD_CLAIM', 'GOVERNANCE',
  'ACCOUNT_CREATION', 'ACCOUNT_SETUP', 'SCHEDULED',
  'EVM_BRIDGE', 'EVM_CALL', 'SWAP', 'LIQUIDITY',
  'CONTRACT_DEPLOY', 'SYSTEM', 'OTHER',
]

function ScriptTemplatesPanel({ token }: { token: string }) {
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [stats, setStats] = useState<any>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [aiClassifying, setAiClassifying] = useState(false)
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [filter, setFilter] = useState<'all' | 'unlabeled' | 'labeled'>('all')

  const loadStats = useCallback(async () => {
    try {
      const data = await adminFetch('admin/script-templates/stats', token)
      setStats(data?.data || null)
    } catch { /* ignore */ }
  }, [token])

  const doSearch = useCallback(async (p = page, f = filter) => {
    setLoading(true)
    try {
      const offset = (p - 1) * 50
      let url = `admin/script-templates?limit=50&offset=${offset}&search=${encodeURIComponent(search)}`
      if (f === 'labeled') url += '&labeled=true'
      else if (f === 'unlabeled') url += '&labeled=false'
      const data = await adminFetch(url, token)
      const rows = data?.data || []
      setItems(rows)
      setHasNext(rows.length >= 50)
      setLoaded(true)
      loadStats()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }, [search, token, loadStats, page, filter])

  const handleSearch = () => { setPage(1); doSearch(1, filter) }
  const handlePageChange = (p: number) => { setPage(p); doSearch(p, filter) }
  const handleFilterChange = (f: 'all' | 'unlabeled' | 'labeled') => { setFilter(f); setPage(1); doSearch(1, f) }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await adminFetch('admin/script-templates/refresh-counts', token, { method: 'POST' })
      toast.success('Counts refreshed')
      doSearch(page, filter)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setRefreshing(false)
    }
  }

  const handleAIClassifyBatch = async () => {
    setAiClassifying(true)
    try {
      const data = await adminFetch('admin/script-templates/ai-classify-batch', token, {
        method: 'POST',
        body: JSON.stringify({ min_tx_count: 1000, limit: 20 }),
      })
      const results = data?.data || []
      const successes = results.filter((r: any) => !r.error)
      const failures = results.filter((r: any) => r.error)
      if (successes.length > 0) toast.success(`AI classified ${successes.length} templates`)
      if (failures.length > 0) toast.error(`${failures.length} failed`)
      doSearch(page, filter)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setAiClassifying(false)
    }
  }

  useEffect(() => { doSearch(1, filter) }, [token]) // auto-load on mount

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
          <SearchBar value={search} onChange={setSearch} onSearch={handleSearch} loading={loading} />
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 border border-zinc-200 dark:border-white/10 text-xs uppercase tracking-widest font-mono text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
        >
          {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Refresh
        </button>
        <button
          onClick={handleAIClassifyBatch}
          disabled={aiClassifying}
          className="flex items-center gap-2 px-4 py-2 border border-nothing-green/30 bg-nothing-green/5 text-xs uppercase tracking-widest font-mono text-nothing-green-dark dark:text-nothing-green hover:bg-nothing-green/10 transition-colors disabled:opacity-50"
        >
          {aiClassifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          AI Classify Top 20
        </button>
      </div>

      {/* Filter toggle */}
      <div className="flex gap-1">
        {(['all', 'unlabeled', 'labeled'] as const).map((f) => (
          <button
            key={f}
            onClick={() => handleFilterChange(f)}
            className={`px-3 py-1.5 text-xs uppercase tracking-widest font-mono transition-colors ${
              filter === f
                ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900'
                : 'border border-zinc-200 dark:border-white/10 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/5'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {loaded && items.length === 0 && (
        <p className="text-sm text-zinc-500 font-mono text-center py-8">No script templates found. Click &quot;Refresh&quot; to populate.</p>
      )}
      {items.map((item) => (
        <ScriptTemplateRow key={item.script_hash} item={item} token={token} />
      ))}
      {loaded && items.length > 0 && (
        <Pagination currentPage={page} onPageChange={handlePageChange} hasNext={hasNext} />
      )}
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
  const [aiClassifying, setAiClassifying] = useState(false)
  const [categories, setCategories] = useState<string[]>(() => (item.category || '').split(',').filter(Boolean))
  const [label, setLabel] = useState(item.label || '')
  const [description, setDescription] = useState(item.description || '')

  const handleSave = async () => {
    setSaving(true)
    try {
      await adminFetch(`admin/script-templates/${encodeURIComponent(item.script_hash)}`, token, {
        method: 'PUT',
        body: JSON.stringify({ category: categories.join(','), label, description }),
      })
      toast.success(item.variant_count > 1 ? `Updated ${item.variant_count} variants` : 'Template updated')
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

  const handleAIClassify = async () => {
    setAiClassifying(true)
    try {
      const data = await adminFetch('admin/script-templates/ai-classify', token, {
        method: 'POST',
        body: JSON.stringify({ script_hash: item.script_hash }),
      })
      const result = data?.data
      if (result) {
        setCategories(result.categories || [])
        setLabel(result.label || '')
        setDescription(result.description || '')
        toast.success('AI classified')
      }
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setAiClassifying(false)
    }
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
            {item.variant_count > 1 && (
              <span className="text-xs font-mono text-purple-500 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800/40 px-2 py-0.5 rounded-sm" title="Number of script variants (differing only in comments) grouped under the same normalized hash">
                {item.variant_count} variants
              </span>
            )}
          </div>

          {/* Script preview */}
          {item.script_preview && (
            <pre className="text-[10px] text-zinc-500 dark:text-zinc-500 font-mono mb-3 whitespace-pre-wrap line-clamp-2 leading-tight">
              {item.script_preview}
            </pre>
          )}

          {/* Tags (multi-select) */}
          <div className="flex items-center gap-1.5 flex-wrap mb-2">
            {categories.map((c) => (
              <span key={c} className="inline-flex items-center gap-1 px-2 py-0.5 bg-nothing-green/10 border border-nothing-green/30 rounded-sm text-[10px] font-mono text-nothing-green-dark dark:text-nothing-green uppercase tracking-wider">
                {c}
                <button onClick={() => setCategories(categories.filter(x => x !== c))} className="hover:text-red-500 transition-colors"><X className="w-2.5 h-2.5" /></button>
              </span>
            ))}
            <select
              value=""
              onChange={(e) => { if (e.target.value && !categories.includes(e.target.value)) setCategories([...categories, e.target.value]); e.target.value = ''; }}
              className="px-2 py-0.5 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-sm text-[10px] font-mono text-zinc-500 dark:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-nothing-green"
            >
              <option value="">+ Add tag</option>
              {SCRIPT_CATEGORIES.filter(c => c && !categories.includes(c)).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          {/* Label + Save */}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label..."
              className="flex-1 min-w-[200px] px-2 py-1 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-sm text-xs font-mono text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-nothing-green"
            />
            <button
              onClick={handleAIClassify}
              disabled={aiClassifying}
              className="flex items-center gap-1 px-3 py-1 border border-nothing-green/30 bg-nothing-green/5 text-nothing-green-dark dark:text-nothing-green text-[10px] uppercase tracking-widest font-mono font-bold hover:bg-nothing-green/10 transition-colors disabled:opacity-50"
              title="AI Classify"
            >
              {aiClassifying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              AI
            </button>
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

// ── Import Token Panel ───────────────────────────────────────────────

function ImportTokenPanel({ token }: { token: string }) {
  const [input, setInput] = useState('')
  const [address, setAddress] = useState('')
  const [contractName, setContractName] = useState('')
  const [tokenType, setTokenType] = useState<'ft' | 'nft'>('ft')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [preview, setPreview] = useState<any>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [contractOptions, setContractOptions] = useState<string[]>([])
  const [fetchingContracts, setFetchingContracts] = useState(false)

  // Parse input: A.{hex}.{Name} or just a hex address
  const parseInput = (value: string) => {
    setInput(value)
    setPreview(null)
    setForm({})
    setContractOptions([])
    const trimmed = value.trim()

    // Match A.{hex}.{Name}
    const aMatch = trimmed.match(/^A\.([0-9a-fA-F]+)\.(\w+)$/)
    if (aMatch) {
      setAddress(aMatch[1])
      setContractName(aMatch[2])
      return
    }

    // Match hex address (with or without 0x)
    const hexMatch = trimmed.replace(/^0x/, '').match(/^[0-9a-fA-F]{8,16}$/)
    if (hexMatch) {
      setAddress(hexMatch[0])
      setContractName('')
      // Auto-fetch contracts from chain
      fetchContractNames(hexMatch[0])
      return
    }

    setAddress('')
    setContractName('')
  }

  const fetchContractNames = async (addr: string) => {
    setFetchingContracts(true)
    try {
      const { ensureHeyApiConfigured } = await import('../api/heyapi')
      await ensureHeyApiConfigured()
      const { getFlowV1AccountByAddress } = await import('../api/gen/find')
      const res = await getFlowV1AccountByAddress({ path: { address: `0x${addr.replace(/^0x/, '')}` } })
      const account = (res.data as any)?.data?.[0]
      // contracts is an array of strings (contract names)
      const contracts: string[] = (account?.contracts || []).filter((c: any) => typeof c === 'string' && c)
      setContractOptions(contracts)
      if (contracts.length === 1) setContractName(contracts[0])
    } catch {
      setContractOptions([])
    } finally {
      setFetchingContracts(false)
    }
  }

  const handlePreview = async () => {
    const addr = address.trim().replace(/^0x/, '')
    const name = contractName.trim()
    if (!addr || !name) { toast.error('Address and contract name are required'); return }
    setLoading(true)
    setPreview(null)
    try {
      const data = await adminFetch('admin/import-token/preview', token, {
        method: 'POST',
        body: JSON.stringify({ address: addr, contract_name: name, type: tokenType }),
      })
      const md = data?.data
      if (!md) {
        // Chain metadata not available — allow manual entry
        toast('No metadata from chain — fill in manually', { icon: '\u26A0\uFE0F' })
        setPreview({ _manual: true })
        if (tokenType === 'ft') {
          setForm({ name: '', symbol: '', decimals: '0', description: '', external_url: '', logo: '', vault_path: '', receiver_path: '', balance_path: '', evm_address: '' })
        } else {
          setForm({ name: '', symbol: '', description: '', external_url: '', square_image: '', banner_image: '', evm_address: '' })
        }
        return
      }
      setPreview(md)
      if (tokenType === 'ft') {
        setForm({
          name: md.name || '', symbol: md.symbol || '', decimals: String(md.decimals ?? 0),
          description: md.description || '', external_url: md.external_url || '', logo: md.logo || '',
          vault_path: md.vault_path || '', receiver_path: md.receiver_path || '', balance_path: md.balance_path || '',
          evm_address: md.evm_address || '',
        })
      } else {
        setForm({
          name: md.name || '', symbol: md.symbol || '',
          description: md.description || '', external_url: md.external_url || '',
          square_image: md.square_image || '', banner_image: md.banner_image || '',
          evm_address: md.evm_address || '',
        })
      }
    } catch (e: any) {
      // If chain metadata fetch fails (404), allow manual entry
      if (e.message?.includes('404') || e.message?.includes('not found') || e.message?.includes('could not fetch')) {
        toast('Chain metadata unavailable — fill in manually', { icon: '\u26A0\uFE0F' })
        setPreview({ _manual: true })
        if (tokenType === 'ft') {
          setForm({ name: contractName.trim(), symbol: '', decimals: '0', description: '', external_url: '', logo: '', vault_path: '', receiver_path: '', balance_path: '', evm_address: '' })
        } else {
          setForm({ name: contractName.trim(), symbol: '', description: '', external_url: '', square_image: '', banner_image: '', evm_address: '' })
        }
      } else {
        toast.error(e.message)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    const addr = address.trim().replace(/^0x/, '')
    const name = contractName.trim()
    setSaving(true)
    try {
      await adminFetch('admin/import-token/save', token, {
        method: 'POST',
        body: JSON.stringify({
          type: tokenType,
          contract_address: addr,
          contract_name: name,
          ...form,
          decimals: tokenType === 'ft' ? parseInt(form.decimals) || 0 : undefined,
        }),
      })
      toast.success(`Saved ${tokenType === 'ft' ? 'FT' : 'NFT'}: A.${addr}.${name}`)
      setPreview(null)
      setForm({})
      setInput('')
      setAddress('')
      setContractName('')
      setContractOptions([])
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const updateForm = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const isReady = address && contractName

  return (
    <div className="space-y-6">
      {/* Step 1: Input */}
      <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm p-6 space-y-4">
        <h3 className="text-xs uppercase tracking-widest font-mono text-zinc-500 dark:text-zinc-400">Step 1 — Identify Token</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest font-mono mb-1">Identifier or Address</label>
            <input
              type="text" value={input} onChange={(e) => parseInput(e.target.value)}
              placeholder="A.0b2a3299cc857e29.TopShot  or  0b2a3299cc857e29"
              className="w-full px-3 py-2 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-sm text-sm font-mono text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-nothing-green"
            />
          </div>

          {/* Status line */}
          {address && (
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="text-zinc-400">Address:</span>
              <span className="text-zinc-900 dark:text-white">{address}</span>
              {contractName ? (
                <>
                  <span className="text-zinc-400">•</span>
                  <span className="text-zinc-400">Contract:</span>
                  <span className="text-nothing-green-dark dark:text-nothing-green font-bold">{contractName}</span>
                  <Check className="w-3 h-3 text-nothing-green" />
                </>
              ) : fetchingContracts ? (
                <Loader2 className="w-3 h-3 animate-spin text-zinc-400" />
              ) : null}
            </div>
          )}

          {/* Contract picker dropdown */}
          {contractOptions.length > 1 && !contractName && (
            <div>
              <label className="block text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest font-mono mb-1">Select Contract</label>
              <div className="flex flex-wrap gap-2">
                {contractOptions.map((name) => (
                  <button key={name} onClick={() => setContractName(name)}
                    className="px-3 py-1.5 border border-zinc-200 dark:border-white/10 text-xs font-mono text-zinc-700 dark:text-zinc-300 hover:bg-nothing-green/10 hover:border-nothing-green/30 transition-colors">
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {contractOptions.length === 0 && address && !contractName && !fetchingContracts && (
            <div>
              <label className="block text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest font-mono mb-1">Contract Name (manual)</label>
              <input
                type="text" value={contractName} onChange={(e) => setContractName(e.target.value)}
                placeholder="TopShot"
                className="w-full px-3 py-2 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-sm text-sm font-mono text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-nothing-green"
              />
            </div>
          )}

          <div className="flex items-center gap-4">
            <div>
              <label className="block text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest font-mono mb-1">Type</label>
              <div className="flex gap-1">
                {(['ft', 'nft'] as const).map((t) => (
                  <button key={t} onClick={() => { setTokenType(t); setPreview(null); setForm({}) }}
                    className={`px-3 py-2 text-xs uppercase tracking-widest font-mono font-bold transition-colors ${
                      tokenType === t
                        ? 'bg-nothing-green text-black'
                        : 'border border-zinc-200 dark:border-white/10 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/5'
                    }`}>
                    {t === 'ft' ? 'Fungible' : 'NFT'}
                  </button>
                ))}
              </div>
            </div>
            <div className="pt-5">
              <button onClick={handlePreview} disabled={loading || !isReady}
                className="flex items-center gap-2 px-4 py-2 bg-nothing-green text-black text-xs uppercase tracking-widest font-mono font-bold hover:bg-nothing-green/90 transition-colors disabled:opacity-50">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                Preview from Chain
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Step 2: Review & Save */}
      {preview && (
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm p-6 space-y-4">
          <h3 className="text-xs uppercase tracking-widest font-mono text-zinc-500 dark:text-zinc-400">Step 2 — Review & Save</h3>

          {/* Image previews */}
          <div className="flex gap-4 flex-wrap">
            {tokenType === 'ft' && form.logo && (
              <div>
                <label className="block text-[10px] text-zinc-400 uppercase tracking-widest font-mono mb-1">Logo</label>
                <img src={form.logo} alt="Logo" className="w-16 h-16 object-contain border border-zinc-200 dark:border-white/10 rounded-sm" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
              </div>
            )}
            {tokenType === 'nft' && form.square_image && (
              <div>
                <label className="block text-[10px] text-zinc-400 uppercase tracking-widest font-mono mb-1">Square Image</label>
                <img src={form.square_image} alt="Square" className="w-16 h-16 object-cover border border-zinc-200 dark:border-white/10 rounded-sm" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
              </div>
            )}
            {tokenType === 'nft' && form.banner_image && (
              <div>
                <label className="block text-[10px] text-zinc-400 uppercase tracking-widest font-mono mb-1">Banner Image</label>
                <img src={form.banner_image} alt="Banner" className="h-16 max-w-[200px] object-cover border border-zinc-200 dark:border-white/10 rounded-sm" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Name" value={form.name || ''} onChange={(v) => updateForm('name', v)} />
            <Field label="Symbol" value={form.symbol || ''} onChange={(v) => updateForm('symbol', v)} />
            {tokenType === 'ft' && (
              <>
                <Field label="Decimals" value={form.decimals || '0'} onChange={(v) => updateForm('decimals', v)} />
                <Field label="Logo URL" value={form.logo || ''} onChange={(v) => updateForm('logo', v)} />
                <Field label="Vault Path" value={form.vault_path || ''} onChange={(v) => updateForm('vault_path', v)} />
                <Field label="Receiver Path" value={form.receiver_path || ''} onChange={(v) => updateForm('receiver_path', v)} />
                <Field label="Balance Path" value={form.balance_path || ''} onChange={(v) => updateForm('balance_path', v)} />
              </>
            )}
            {tokenType === 'nft' && (
              <>
                <Field label="Square Image URL" value={form.square_image || ''} onChange={(v) => updateForm('square_image', v)} />
                <Field label="Banner Image URL" value={form.banner_image || ''} onChange={(v) => updateForm('banner_image', v)} />
              </>
            )}
            <Field label="External URL" value={form.external_url || ''} onChange={(v) => updateForm('external_url', v)} />
            <Field label="EVM Address" value={form.evm_address || ''} onChange={(v) => updateForm('evm_address', v)} />
            <Field label="Description" value={form.description || ''} onChange={(v) => updateForm('description', v)} multiline />
          </div>

          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-nothing-green text-black text-xs uppercase tracking-widest font-mono font-bold hover:bg-nothing-green/90 transition-colors disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Save to Database
          </button>
        </div>
      )}
    </div>
  )
}

// ── Account Labels Panel ─────────────────────────────────────────────

const LABEL_CATEGORIES = ['whale', 'service', 'exchange', 'defi', 'nft', 'custom'] as const

const LABEL_CAT_CONFIG: Record<string, { icon: LucideIcon; className: string }> = {
  whale:    { icon: Fish,           className: "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800" },
  service:  { icon: Shield,         className: "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800" },
  exchange: { icon: ArrowLeftRight, className: "bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800" },
  defi:     { icon: ChartLine,      className: "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800" },
  nft:      { icon: Image,          className: "bg-pink-50 dark:bg-pink-950/30 text-pink-700 dark:text-pink-400 border-pink-200 dark:border-pink-800" },
  custom:   { icon: Tag,            className: "bg-zinc-100 dark:bg-zinc-800/50 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700" },
}

function AccountLabelsPanel({ token }: { token: string }) {
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  const doSearch = useCallback(async (p = page) => {
    setLoading(true)
    try {
      const offset = (p - 1) * 50
      const url = `admin/account-labels?limit=50&offset=${offset}&search=${encodeURIComponent(search)}`
      const data = await adminFetch(url, token)
      const rows = data?.data || []
      setItems(rows)
      setHasNext(rows.length >= 50)
      setLoaded(true)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }, [search, token, page])

  const handleSearch = () => { setPage(1); doSearch(1) }
  const handlePageChange = (p: number) => { setPage(p); doSearch(p) }

  const handleDelete = async (address: string, tag: string) => {
    try {
      await adminFetch(`admin/account-labels/${encodeURIComponent(address)}/${encodeURIComponent(tag)}`, token, { method: 'DELETE' })
      toast.success(`Deleted ${tag} from ${address}`)
      doSearch(page)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  useEffect(() => { doSearch(1) }, [token])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex-1"><SearchBar value={search} onChange={setSearch} onSearch={handleSearch} loading={loading} /></div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-2 px-4 py-2 bg-nothing-green text-black text-xs uppercase tracking-widest font-mono font-bold hover:bg-nothing-green/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Label
        </button>
      </div>

      {showAdd && (
        <AddLabelForm token={token} onSaved={() => { setShowAdd(false); doSearch(page) }} onCancel={() => setShowAdd(false)} />
      )}

      {loaded && items.length === 0 && (
        <p className="text-sm text-zinc-500 font-mono text-center py-8">No account labels found.</p>
      )}

      {items.length > 0 && (
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden">
          <table className="w-full text-sm font-mono">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-white/10 text-[10px] uppercase tracking-widest text-zinc-500 dark:text-zinc-400">
                <th className="text-left px-4 py-2">Address</th>
                <th className="text-left px-4 py-2">Tag</th>
                <th className="text-left px-4 py-2">Label</th>
                <th className="text-left px-4 py-2">Category</th>
                <th className="text-right px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const catCfg = LABEL_CAT_CONFIG[item.category] || LABEL_CAT_CONFIG.custom
                const CatIcon = catCfg.icon
                return (
                  <tr key={`${item.address}-${item.tag}`} className="border-b border-zinc-100 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                    <td className="px-4 py-2.5">
                      <Link to="/accounts/$address" params={{ address: item.address }} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                        <div className="shrink-0 w-6 h-6 [&>svg]:w-full [&>svg]:h-full">
                          <Avatar size={24} name={item.address} variant="beam" colors={colorsFromAddress(item.address)} />
                        </div>
                        <span className="text-xs text-zinc-900 dark:text-white font-mono hover:text-nothing-green-dark dark:hover:text-nothing-green transition-colors">{item.address}</span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-300">{item.tag}</td>
                    <td className="px-4 py-2.5 text-zinc-700 dark:text-zinc-300">{item.label}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-medium border ${catCfg.className}`}>
                        <CatIcon className="w-3 h-3" />
                        {item.category}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => handleDelete(item.address, item.tag)}
                        className="p-1.5 text-zinc-400 hover:text-red-500 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {loaded && items.length > 0 && (
        <Pagination currentPage={page} onPageChange={handlePageChange} hasNext={hasNext} />
      )}
    </div>
  )
}

function AddLabelForm({ token, onSaved, onCancel }: { token: string; onSaved: () => void; onCancel: () => void }) {
  const [address, setAddress] = useState('')
  const [tag, setTag] = useState('')
  const [label, setLabel] = useState('')
  const [category, setCategory] = useState<string>('custom')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!address.trim() || !tag.trim()) {
      toast.error('Address and tag are required')
      return
    }
    setSaving(true)
    try {
      await adminFetch('admin/account-labels', token, {
        method: 'POST',
        body: JSON.stringify({ address: address.trim(), tag: tag.trim(), label: label.trim(), category }),
      })
      toast.success(`Added ${tag} to ${address}`)
      onSaved()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm p-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest font-mono mb-1">Address</label>
          <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x1654653399040a61"
            className="w-full px-3 py-1.5 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-sm text-sm font-mono text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-nothing-green placeholder:text-zinc-400" />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest font-mono mb-1">Tag (unique key)</label>
          <input type="text" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="e.g. dapper-wallet"
            className="w-full px-3 py-1.5 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-sm text-sm font-mono text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-nothing-green placeholder:text-zinc-400" />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest font-mono mb-1">Display Label</label>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Dapper Wallet"
            className="w-full px-3 py-1.5 bg-zinc-50 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-sm text-sm font-mono text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-nothing-green placeholder:text-zinc-400" />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest font-mono mb-1">Category</label>
          <div className="flex flex-wrap gap-1.5">
            {LABEL_CATEGORIES.map((cat) => (
              <button key={cat} onClick={() => setCategory(cat)}
                className={`px-2.5 py-1 text-[10px] uppercase tracking-widest font-mono transition-colors rounded-full ${
                  category === cat
                    ? 'bg-nothing-green text-black font-bold'
                    : 'border border-zinc-200 dark:border-white/10 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/5'
                }`}>
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-nothing-green text-black text-xs uppercase tracking-widest font-mono font-bold hover:bg-nothing-green/90 transition-colors disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save
        </button>
        <button onClick={onCancel}
          className="flex items-center gap-2 px-4 py-2 border border-zinc-200 dark:border-white/10 text-xs uppercase tracking-widest font-mono text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
          <X className="w-4 h-4" />
          Cancel
        </button>
      </div>
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

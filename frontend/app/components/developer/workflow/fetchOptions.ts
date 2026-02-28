import type { SearchableSelectOption } from './SearchableSelect'

const API_URL = import.meta.env.VITE_API_URL || ''

// ---------------------------------------------------------------------------
// Simple in-memory cache (5 min TTL)
// ---------------------------------------------------------------------------
const cache = new Map<string, { data: SearchableSelectOption[]; ts: number }>()
const CACHE_TTL = 5 * 60 * 1000

function getCached(key: string): SearchableSelectOption[] | null {
  const entry = cache.get(key)
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data
  if (entry) cache.delete(key)
  return null
}

function setCache(key: string, data: SearchableSelectOption[]) {
  cache.set(key, { data, ts: Date.now() })
}

async function fetchJSON(url: string): Promise<{ data: any[]; _meta?: any }> {
  const res = await fetch(`${API_URL}${url}`)
  if (!res.ok) throw new Error(`API ${res.status}`)
  return res.json()
}

// ---------------------------------------------------------------------------
// 1. FT Tokens
// ---------------------------------------------------------------------------
export async function fetchFTTokens(query: string): Promise<SearchableSelectOption[]> {
  const q = query.trim()
  const cacheKey = `ft:${q}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  const url = q
    ? `/flow/ft?search=${encodeURIComponent(q)}&limit=20`
    : `/flow/ft?limit=30`

  const { data } = await fetchJSON(url)
  const options: SearchableSelectOption[] = [
    { value: '', label: 'Any Token' },
    ...data.map((t: any) => ({
      value: `A.${(t.address || '').replace(/^0x/, '')}.${t.contract_name}`,
      label: t.symbol || t.name || t.contract_name,
      sublabel: t.id || `A.${(t.address || '').replace(/^0x/, '')}.${t.contract_name}`,
      icon: t.logo || undefined,
    })),
  ]
  setCache(cacheKey, options)
  return options
}

// ---------------------------------------------------------------------------
// 2. NFT Collections (no server-side search — filter client-side)
// ---------------------------------------------------------------------------
export async function fetchNFTCollections(query: string): Promise<SearchableSelectOption[]> {
  const q = query.trim().toLowerCase()
  const cacheKey = 'nft:all'

  let all = getCached(cacheKey)
  if (!all) {
    const { data } = await fetchJSON('/flow/nft?limit=50')
    all = data.map((c: any) => ({
      value: `A.${(c.address || '').replace(/^0x/, '')}.${c.contract_name}`,
      label: c.display_name || c.name || c.contract_name,
      sublabel: c.id || `A.${(c.address || '').replace(/^0x/, '')}.${c.contract_name}`,
      icon: c.square_image || undefined,
    }))
    setCache(cacheKey, all)
  }

  const filtered = q
    ? all.filter(
        (o) =>
          o.label.toLowerCase().includes(q) ||
          (o.sublabel || '').toLowerCase().includes(q),
      )
    : all

  return [{ value: '', label: 'Any Collection' }, ...filtered]
}

// ---------------------------------------------------------------------------
// 3. Contracts
// ---------------------------------------------------------------------------
export async function fetchContracts(query: string): Promise<SearchableSelectOption[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const cacheKey = `contract:${q}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  const { data } = await fetchJSON(`/flow/contract?body=${encodeURIComponent(q)}&limit=15`)
  const options: SearchableSelectOption[] = data.map((c: any) => ({
    value: c.identifier || c.id,
    label: c.name || c.contract_name,
    sublabel: c.identifier || c.id,
    icon: c.token_logo || undefined,
  }))
  setCache(cacheKey, options)
  return options
}

// ---------------------------------------------------------------------------
// 4. Contract Events (by contract identifier)
// ---------------------------------------------------------------------------
export async function fetchContractEvents(contractIdentifier: string): Promise<SearchableSelectOption[]> {
  const id = contractIdentifier.trim()
  if (!id) return []

  const cacheKey = `contract-events:${id}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  const { data } = await fetchJSON(`/flow/contract/${encodeURIComponent(id)}/events?limit=50`)
  const options: SearchableSelectOption[] = data.map((e: any) => ({
    value: e.event_name,
    label: e.event_name,
    sublabel: `${e.count ?? 0} occurrences`,
  }))
  setCache(cacheKey, options)
  return options
}

// ---------------------------------------------------------------------------
// 5. Events by name search
// ---------------------------------------------------------------------------
export async function fetchEventsByName(query: string): Promise<SearchableSelectOption[]> {
  const q = query.trim()
  if (q.length < 2) return []

  const cacheKey = `events:${q}`
  const cached = getCached(cacheKey)
  if (cached) return cached

  const { data } = await fetchJSON(`/flow/events/search?name=${encodeURIComponent(q)}&limit=20`)
  const options: SearchableSelectOption[] = data.map((e: any) => ({
    value: e.type,
    label: `${e.contract_name}.${e.event_name}`,
    sublabel: `${e.contract_address} \u00b7 ${e.count ?? 0} events`,
  }))
  setCache(cacheKey, options)
  return options
}

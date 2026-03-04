import { createFileRoute, Link } from '@tanstack/react-router'
import { AddressLink } from '../../components/AddressLink';
import { motion, AnimatePresence } from 'framer-motion';
import { Image, LayoutGrid, LayoutList, Users, Search, X, Loader2, ArrowLeftRight, AlertTriangle, ListFilter, Check } from 'lucide-react';
import { VerifiedBadge } from '../../components/ui/VerifiedBadge';
import { EVMBridgeBadge } from '../../components/ui/EVMBridgeBadge';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ensureHeyApiConfigured, getBaseURL } from '../../api/heyapi';
import { Pagination } from '../../components/Pagination';

interface NFTsSearch {
  page?: number;
  search?: string;
  filter?: string;
}

const LIMIT = 25;

const NFT_FILTERS = [
  { key: 'evm_bridged', label: 'EVM Bridged' },
] as const;
type NFTFilterKey = typeof NFT_FILTERS[number]['key'];

async function fetchCollections(page: number, search: string, filters: NFTFilterKey[]) {
  const offset = (page - 1) * LIMIT;
  await ensureHeyApiConfigured();
  const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
  if (search) params.set('search', search);
  for (const f of filters) params.append('filter', f);
  const res = await fetch(`${getBaseURL()}/flow/nft?${params}`);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const json = await res.json();
  return { collections: json?.data || [], meta: json?._meta || null };
}

async function fetchNFTStats(): Promise<{ total: number; total_nfts: number; evm_bridged: number } | null> {
  try {
    await ensureHeyApiConfigured();
    const res = await fetch(`${getBaseURL()}/flow/nft/stats`);
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data || null;
  } catch {
    return null;
  }
}

function NFTsListSkeleton() {
  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="p-3 bg-zinc-100 dark:bg-white/10 animate-pulse"><div className="h-8 w-8" /></div>
          <div className="space-y-2">
            <div className="h-8 w-32 bg-zinc-200 dark:bg-white/10 rounded-sm animate-pulse" />
            <div className="h-4 w-56 bg-zinc-100 dark:bg-white/5 rounded-sm animate-pulse" />
          </div>
        </div>
        <div className="h-8 w-20 bg-zinc-100 dark:bg-white/10 rounded-sm animate-pulse" />
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-5 rounded-sm">
            <div className="h-3 w-24 bg-zinc-100 dark:bg-white/5 rounded-sm animate-pulse mb-3" />
            <div className="h-7 w-20 bg-zinc-200 dark:bg-white/10 rounded-sm animate-pulse" />
          </div>
        ))}
      </div>

      {/* Search bar */}
      <div className="h-12 bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm animate-pulse" />

      {/* Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {[...Array(15)].map((_, i) => (
          <div key={i} className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 overflow-hidden">
            <div className="aspect-square bg-zinc-200 dark:bg-white/10 animate-pulse" />
            <div className="p-3 space-y-2">
              <div className="h-3.5 w-24 bg-zinc-200 dark:bg-white/10 rounded-sm animate-pulse" />
              <div className="h-3 w-32 bg-zinc-100 dark:bg-white/5 rounded-sm animate-pulse" />
              <div className="h-4 w-16 bg-zinc-100 dark:bg-white/5 rounded-sm animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const Route = createFileRoute('/nfts/')({
  component: NFTs,
  pendingComponent: NFTsListSkeleton,
  validateSearch: (search: Record<string, unknown>): NFTsSearch => ({
    page: Number(search.page) || 1,
    search: (search.search as string) || undefined,
    filter: (search.filter as string) || undefined,
  }),
  loader: async ({ location }) => {
    const params = new URLSearchParams(location.search);
    const page = Number(params.get('page') || '1');
    const search = params.get('search') || '';
    const filters = params.getAll('filter').filter(f => NFT_FILTERS.some(ff => ff.key === f)) as NFTFilterKey[];
    try {
      const [data, stats] = await Promise.all([
        fetchCollections(page, search, filters),
        fetchNFTStats(),
      ]);
      return { ...data, stats, page, search, filters };
    } catch (e) {
      console.error('Failed to load NFT collections', e);
      return { collections: [], meta: null, stats: null, page, search, filters };
    }
  },
})

function CollectionImage({ name, src }: { name: string; src?: string }) {
  const [failed, setFailed] = useState(false);
  const letter = (name || '?')[0].toUpperCase();

  return (
    <div className="aspect-square w-full bg-zinc-100 dark:bg-white/10 relative overflow-hidden">
      {(!src || failed) ? (
        <div className="w-full h-full flex items-center justify-center">
          <span className="text-4xl font-bold font-mono text-zinc-400 dark:text-zinc-500 select-none">
            {letter}
          </span>
        </div>
      ) : (
        <img
          src={src}
          alt={name}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 w-full h-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

function CollectionLogo({ name, src }: { name: string; src?: string }) {
  const [failed, setFailed] = useState(false);
  const letter = (name || '?')[0].toUpperCase();

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name}
        width={32}
        height={32}
        loading="lazy"
        decoding="async"
        className="w-8 h-8 object-contain"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="w-8 h-8 flex items-center justify-center bg-zinc-100 dark:bg-white/10 font-mono text-sm font-bold text-zinc-500 dark:text-zinc-400">
      {letter}
    </div>
  );
}

function buildURL(base: string, page: number, search: string, filters: NFTFilterKey[]) {
  const params = new URLSearchParams();
  params.set('page', String(page));
  if (search) params.set('search', search);
  for (const f of filters) params.append('filter', f);
  return `${base}?${params}`;
}

function NFTs() {
  const loaderData = Route.useLoaderData();

  const [collections, setCollections] = useState<any[]>(loaderData.collections);
  const [meta, setMeta] = useState<any>(loaderData.meta);
  const [stats, setStats] = useState<any>(loaderData.stats);
  const [currentPage, setCurrentPage] = useState(loaderData.page);
  const [currentSearch, setCurrentSearch] = useState(loaderData.search || '');
  const [searchInput, setSearchInput] = useState(loaderData.search || '');
  const [isLoading, setIsLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [activeFilters, setActiveFilters] = useState<NFTFilterKey[]>(loaderData.filters || []);
  const [filterOpen, setFilterOpen] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCollections(loaderData.collections);
    setMeta(loaderData.meta);
    setStats(loaderData.stats);
    setCurrentPage(loaderData.page);
    setCurrentSearch(loaderData.search || '');
    setSearchInput(loaderData.search || '');
    setActiveFilters(loaderData.filters || []);
  }, [loaderData]);

  // Close filter dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    if (filterOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [filterOpen]);

  const doFetch = useCallback(async (page: number, search: string, filters: NFTFilterKey[]) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    try {
      const data = await fetchCollections(page, search, filters);
      if (controller.signal.aborted) return;
      setCollections(data.collections);
      setMeta(data.meta);
      setCurrentPage(page);
      setCurrentSearch(search);
      window.history.replaceState({}, '', buildURL('/nfts', page, search, filters));
    } catch (e) {
      if (controller.signal.aborted) return;
      console.error('Failed to fetch NFT collections', e);
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doFetch(1, value.trim(), activeFilters), 300);
  };

  const handleClear = () => {
    setSearchInput('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    doFetch(1, '', activeFilters);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      doFetch(1, searchInput.trim(), activeFilters);
    }
  };

  const handlePageChange = (newPage: number) => doFetch(newPage, currentSearch, activeFilters);

  const handleFilterToggle = (key: NFTFilterKey) => {
    const next = activeFilters.includes(key)
      ? activeFilters.filter(f => f !== key)
      : [...activeFilters, key];
    setActiveFilters(next);
    doFetch(1, currentSearch, next);
  };

  const handleClearFilters = () => {
    setActiveFilters([]);
    setFilterOpen(false);
    doFetch(1, currentSearch, []);
  };

  const totalCount = Number(meta?.count || 0);
  const offset = (currentPage - 1) * LIMIT;
  const hasNext = totalCount > 0 ? offset + LIMIT < totalCount : collections.length === LIMIT;

  const normalizeHex = (value: any) => {
    if (!value) return '';
    const lower = String(value).toLowerCase();
    return lower.startsWith('0x') ? lower : `0x${lower}`;
  };

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center space-x-4">
          <div className="p-3 bg-nothing-green/10">
            <Image className="h-8 w-8 text-nothing-green-dark dark:text-nothing-green" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-white uppercase tracking-tighter">NFTs</h1>
            <p className="text-sm font-mono text-zinc-500 dark:text-zinc-400">
              Non-Fungible Tokens on Flow
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 bg-zinc-100 dark:bg-white/10 p-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 transition-colors ${viewMode === 'grid' ? 'bg-white dark:bg-white/20 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 transition-colors ${viewMode === 'list' ? 'bg-white dark:bg-white/20 text-zinc-900 dark:text-white shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
          >
            <LayoutList className="w-4 h-4" />
          </button>
        </div>
      </motion.div>

      {/* Stats Cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-1 md:grid-cols-3 gap-4"
      >
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-5 rounded-sm">
          <div className="flex items-center gap-2 mb-1">
            <Image className="h-4 w-4 text-zinc-400" />
            <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest">Total Collections</p>
          </div>
          <p className="text-2xl font-bold font-mono text-zinc-900 dark:text-white">
            {stats?.total != null ? stats.total.toLocaleString() : '-'}
          </p>
        </div>

        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-5 rounded-sm">
          <div className="flex items-center gap-2 mb-1">
            <Users className="h-4 w-4 text-zinc-400" />
            <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest">Total NFTs</p>
          </div>
          <p className="text-2xl font-bold font-mono text-zinc-900 dark:text-white">
            {stats?.total_nfts != null ? stats.total_nfts.toLocaleString() : '-'}
          </p>
        </div>

        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-5 rounded-sm">
          <div className="flex items-center gap-2 mb-1">
            <ArrowLeftRight className="h-4 w-4 text-zinc-400" />
            <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest">EVM Bridged</p>
          </div>
          <p className="text-2xl font-bold font-mono text-zinc-900 dark:text-white">
            {stats?.evm_bridged != null ? stats.evm_bridged.toLocaleString() : '-'}
          </p>
        </div>
      </motion.div>

      {/* Indexing disclaimer */}
      <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-700/30 rounded-sm text-xs text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>Historical indexing is still in progress. Holder counts, item counts, and transfer data may be incomplete or inaccurate until indexing completes.</span>
      </div>

      {/* Search + Filter */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            ref={inputRef}
            type="text"
            value={searchInput}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Search by name, symbol, or address..."
            className="w-full pl-11 pr-10 py-3 bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm text-sm font-mono text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-nothing-green dark:focus:ring-nothing-green/50 transition-shadow"
          />
          {searchInput ? (
            <button
              onClick={handleClear}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          ) : isLoading ? (
            <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400 animate-spin" />
          ) : null}
        </div>

        {/* Filter dropdown */}
        <div className="relative" ref={filterRef}>
          <button
            onClick={() => setFilterOpen(!filterOpen)}
            className={`relative p-3 border rounded-sm transition-colors ${
              activeFilters.length > 0
                ? 'bg-nothing-green/10 border-nothing-green/30 text-nothing-green-dark dark:text-nothing-green'
                : 'bg-white dark:bg-nothing-dark border-zinc-200 dark:border-white/10 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:border-zinc-300 dark:hover:border-white/20'
            }`}
          >
            <ListFilter className="h-4 w-4" />
            {activeFilters.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-nothing-green text-[10px] font-bold text-black flex items-center justify-center">
                {activeFilters.length}
              </span>
            )}
          </button>

          {filterOpen && (
            <div className="absolute right-0 top-full mt-2 z-50 w-56 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-sm shadow-lg overflow-hidden">
              <div className="px-3 py-2 border-b border-zinc-100 dark:border-white/5 flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-widest text-zinc-500 dark:text-zinc-400">Filters</span>
                {activeFilters.length > 0 && (
                  <button onClick={handleClearFilters} className="text-[10px] font-mono text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
                    Clear all
                  </button>
                )}
              </div>
              {NFT_FILTERS.map(({ key, label }) => {
                const active = activeFilters.includes(key);
                return (
                  <button
                    key={key}
                    onClick={() => handleFilterToggle(key)}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-mono text-left hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                  >
                    <span className={`w-4 h-4 rounded-sm border flex items-center justify-center shrink-0 transition-colors ${
                      active
                        ? 'bg-nothing-green border-nothing-green text-black'
                        : 'border-zinc-300 dark:border-zinc-600'
                    }`}>
                      {active && <Check className="w-3 h-3" />}
                    </span>
                    <span className={active ? 'text-zinc-900 dark:text-white' : 'text-zinc-600 dark:text-zinc-400'}>{label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Active filter tags */}
      {activeFilters.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {activeFilters.map(key => {
            const label = NFT_FILTERS.find(f => f.key === key)?.label || key;
            return (
              <span key={key} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-mono bg-nothing-green/10 border border-nothing-green/30 text-nothing-green-dark dark:text-nothing-green rounded-sm">
                {label}
                <button onClick={() => handleFilterToggle(key)} className="hover:text-red-400 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <div className={`space-y-4 transition-opacity ${isLoading ? 'opacity-60' : ''}`}>
        {viewMode === 'grid' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {collections.length === 0 && !isLoading ? (
              <div className="col-span-full p-8 text-center text-zinc-500 text-sm font-mono">
                {currentSearch ? `No collections matching "${currentSearch}"` : 'No NFT collections found'}
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                {collections.map((c: any, i: number) => {
                  const id = String(c?.id || '');
                  const displayName = c?.display_name || c?.name || c?.contract_name || id;
                  const contractId = id;
                  const count = Number(c?.number_of_tokens || 0);
                  const squareImage = c?.square_image || '';
                  const evmAddress = String(c?.evm_address || '');
                  const isVerified = Boolean(c?.is_verified);
                  const holderCount = Number(c?.holder_count || 0);

                  return (
                    <motion.div
                      layout
                      key={id || `col-${i}`}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.02 }}
                    >
                      <Link
                        to={`/nfts/${encodeURIComponent(id)}` as any}
                        className="block bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 hover:border-zinc-300 dark:hover:border-white/20 transition-all overflow-hidden group"
                      >
                        <div className="overflow-hidden">
                          <CollectionImage name={displayName} src={squareImage} />
                        </div>
                        <div className="p-3 space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <h3 className="font-mono font-bold text-sm text-zinc-900 dark:text-white truncate group-hover:text-nothing-green-dark dark:group-hover:text-nothing-green transition-colors">
                              {displayName}
                            </h3>
                            {isVerified && <VerifiedBadge size={14} />}
                            {evmAddress && <EVMBridgeBadge evmAddress={evmAddress} />}
                          </div>
                          <p className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400 truncate" title={contractId}>
                            {contractId}
                          </p>
                          <div className="pt-1 flex items-center gap-2">
                            <span className="inline-block font-mono text-[10px] uppercase tracking-widest bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 px-2 py-0.5 rounded-sm">
                              {Number.isFinite(count) ? count.toLocaleString() : '0'} items
                            </span>
                            {holderCount > 0 && (
                              <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 px-2 py-0.5 rounded-sm">
                                <Users className="w-3 h-3" />
                                {holderCount.toLocaleString()}
                              </span>
                            )}
                          </div>
                        </div>
                      </Link>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            )}
          </div>
        ) : (
          <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 overflow-hidden shadow-sm dark:shadow-none">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-white/5">
                    <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider font-mono">Collection</th>
                    <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider font-mono">Address</th>
                    <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider font-mono text-right">Items</th>
                    <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider font-mono text-right">Holders</th>
                  </tr>
                </thead>
                <tbody>
                  {collections.length === 0 && !isLoading ? (
                    <tr>
                      <td colSpan={4} className="p-8 text-center text-zinc-500 text-sm font-mono">
                        {currentSearch ? `No collections matching "${currentSearch}"` : 'No NFT collections found'}
                      </td>
                    </tr>
                  ) : (
                    <AnimatePresence mode="popLayout">
                      {collections.map((c: any, i: number) => {
                        const id = String(c?.id || '');
                        const displayName = c?.display_name || c?.name || c?.contract_name || id;
                        const addr = normalizeHex(c?.address);
                        const count = Number(c?.number_of_tokens || 0);
                        const holderCount = Number(c?.holder_count || 0);
                        const squareImage = c?.square_image || '';
                        const evmAddress = String(c?.evm_address || '');
                        const isVerified = Boolean(c?.is_verified);

                        return (
                          <motion.tr
                            layout
                            key={id || `col-${i}`}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            className="border-b border-zinc-100 dark:border-white/5 group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                          >
                            <td className="p-4">
                              <div className="flex items-center gap-3">
                                <CollectionLogo name={displayName} src={squareImage} />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <Link
                                      to={`/nfts/${encodeURIComponent(id)}` as any}
                                      className="font-mono text-sm text-nothing-green-dark dark:text-nothing-green hover:underline truncate"
                                      title={id}
                                    >
                                      {displayName}
                                    </Link>
                                    {isVerified && <VerifiedBadge size={14} />}
                                    {evmAddress && <EVMBridgeBadge evmAddress={evmAddress} />}
                                  </div>
                                  <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono truncate" title={id}>
                                    {c?.contract_name || id}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="p-4">
                              {addr ? (
                                <AddressLink address={addr} prefixLen={20} suffixLen={0} />
                              ) : (
                                <span className="text-zinc-500 font-mono text-sm">N/A</span>
                              )}
                            </td>
                            <td className="p-4 text-right">
                              <span className="font-mono text-sm text-zinc-900 dark:text-white">
                                {count.toLocaleString()}
                              </span>
                            </td>
                            <td className="p-4 text-right">
                              <span className="font-mono text-sm text-zinc-900 dark:text-white">
                                {holderCount.toLocaleString()}
                              </span>
                            </td>
                          </motion.tr>
                        );
                      })}
                    </AnimatePresence>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-4">
          <Pagination currentPage={currentPage} onPageChange={handlePageChange} hasNext={hasNext} />
        </div>
      </div>
    </div>
  );
}

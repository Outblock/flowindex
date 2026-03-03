import { createFileRoute, Link } from '@tanstack/react-router'
import { AddressLink } from '../../components/AddressLink';
import { motion, AnimatePresence } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Coins, Info, Search, X, Loader2, DollarSign, ArrowLeftRight, AlertTriangle } from 'lucide-react';
import { VerifiedBadge } from '../../components/ui/VerifiedBadge';
import { EVMBridgeBadge } from '../../components/ui/EVMBridgeBadge';
import { ensureHeyApiConfigured, getBaseURL } from '../../api/heyapi';
import { getFlowV1Ft } from '../../api/gen/find';
import { Pagination } from '../../components/Pagination';

interface TokensSearch {
  page?: number;
  search?: string;
}

const LIMIT = 25;

async function fetchTokens(page: number, search: string, filter?: string) {
  const offset = (page - 1) * LIMIT;
  await ensureHeyApiConfigured();
  const query: any = { limit: LIMIT, offset };
  if (search) query.search = search;
  if (filter) query.filter = filter;
  const res = await getFlowV1Ft({ query });
  const payload: any = res.data;
  return { tokens: payload?.data || [], meta: payload?._meta || null };
}

async function fetchFTStats(): Promise<{ total: number; with_price: number; evm_bridged: number } | null> {
  try {
    await ensureHeyApiConfigured();
    const res = await fetch(`${getBaseURL()}/flow/ft/stats`);
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data || null;
  } catch {
    return null;
  }
}

export const Route = createFileRoute('/tokens/')({
  component: Tokens,
  validateSearch: (search: Record<string, unknown>): TokensSearch => ({
    page: Number(search.page) || 1,
    search: (search.search as string) || undefined,
  }),
  loader: async ({ location }) => {
    const params = new URLSearchParams(location.search);
    const page = Number(params.get('page') || '1');
    const search = params.get('search') || '';
    try {
      const [data, stats] = await Promise.all([
        fetchTokens(page, search),
        fetchFTStats(),
      ]);
      return { ...data, stats, page, search };
    } catch (e) {
      console.error('Failed to load tokens', e);
      return { tokens: [], meta: null, stats: null, page, search };
    }
  },
})

function TokenLogo({ logo, symbol }: { logo?: string; symbol: string }) {
  const [failed, setFailed] = useState(false);
  const letter = (symbol || '?')[0].toUpperCase();

  if (logo && !failed) {
    return (
      <img
        src={logo}
        alt={symbol}
        width={32}
        height={32}
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

function formatDate(dateStr: string | undefined | null): string {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '-';
  }
}

function Tokens() {
  const loaderData = Route.useLoaderData();

  const [tokens, setTokens] = useState<any[]>(loaderData.tokens);
  const [meta, setMeta] = useState<any>(loaderData.meta);
  const [stats, setStats] = useState<any>(loaderData.stats);
  const [currentPage, setCurrentPage] = useState(loaderData.page);
  const [currentSearch, setCurrentSearch] = useState(loaderData.search || '');
  const [searchInput, setSearchInput] = useState(loaderData.search || '');
  const [isLoading, setIsLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'' | 'has_price' | 'evm_bridged'>('');

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setTokens(loaderData.tokens);
    setMeta(loaderData.meta);
    setStats(loaderData.stats);
    setCurrentPage(loaderData.page);
    setCurrentSearch(loaderData.search || '');
    setSearchInput(loaderData.search || '');
  }, [loaderData]);

  const doFetch = useCallback(async (page: number, search: string, filter?: string) => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    try {
      const data = await fetchTokens(page, search, filter);
      if (controller.signal.aborted) return;
      setTokens(data.tokens);
      setMeta(data.meta);
      setCurrentPage(page);
      setCurrentSearch(search);
      const url = `/tokens?page=${page}${search ? `&search=${encodeURIComponent(search)}` : ''}`;
      window.history.replaceState({}, '', url);
    } catch (e) {
      if (controller.signal.aborted) return;
      console.error('Failed to fetch tokens', e);
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doFetch(1, value.trim(), activeFilter), 300);
  };

  const handleClear = () => {
    setSearchInput('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    doFetch(1, '', activeFilter);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      doFetch(1, searchInput.trim(), activeFilter);
    }
  };

  const handlePageChange = (newPage: number) => doFetch(newPage, currentSearch, activeFilter);

  const handleFilterToggle = (filter: '' | 'has_price' | 'evm_bridged') => {
    const next = activeFilter === filter ? '' : filter;
    setActiveFilter(next);
    doFetch(1, currentSearch, next);
  };

  const totalCount = Number(meta?.count || 0);
  const offset = (currentPage - 1) * LIMIT;
  const hasNext = totalCount > 0 ? offset + LIMIT < totalCount : tokens.length === LIMIT;

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
            <Coins className="h-8 w-8 text-nothing-green-dark dark:text-nothing-green" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-white uppercase tracking-tighter">Tokens</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 font-mono">
              Fungible Tokens on Flow
            </p>
          </div>
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
            <Coins className="h-4 w-4 text-zinc-400" />
            <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest">Total Tokens</p>
          </div>
          <p className="text-2xl font-bold font-mono text-zinc-900 dark:text-white">
            {stats?.total != null ? stats.total.toLocaleString() : '-'}
          </p>
        </div>

        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-5 rounded-sm">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="h-4 w-4 text-zinc-400" />
            <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest">With Market Price</p>
          </div>
          <p className="text-2xl font-bold font-mono text-zinc-900 dark:text-white">
            {stats?.with_price != null ? stats.with_price.toLocaleString() : '-'}
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
        <span>Historical indexing is still in progress. Holder counts, deploy dates, and transfer data may be incomplete or inaccurate until indexing completes.</span>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono uppercase tracking-widest">Filter:</span>
        <button
          onClick={() => handleFilterToggle('has_price')}
          className={`px-3 py-1 text-xs font-mono rounded-sm border transition-colors ${
            activeFilter === 'has_price'
              ? 'bg-nothing-green/20 border-nothing-green/40 text-nothing-green-dark dark:text-nothing-green'
              : 'bg-white dark:bg-white/5 border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-white/20'
          }`}
        >
          With Market Price
        </button>
        <button
          onClick={() => handleFilterToggle('evm_bridged')}
          className={`px-3 py-1 text-xs font-mono rounded-sm border transition-colors ${
            activeFilter === 'evm_bridged'
              ? 'bg-nothing-green/20 border-nothing-green/40 text-nothing-green-dark dark:text-nothing-green'
              : 'bg-white dark:bg-white/5 border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-white/20'
          }`}
        >
          EVM Bridged
        </button>
      </div>

      {/* Search */}
      <div className="relative">
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

      <div className={`bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden shadow-sm dark:shadow-none transition-opacity ${isLoading ? 'opacity-60' : ''}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-white/5">
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider font-mono">Token</th>
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider font-mono">Address</th>
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider font-mono text-right">Deployed</th>
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider font-mono text-right">
                  <span className="inline-flex items-center gap-1.5 group relative">
                    Holders
                    <Info className="h-3 w-3 text-zinc-400 cursor-help" />
                    <span className="absolute right-0 top-full mt-1 z-50 w-48 p-2 text-[10px] normal-case tracking-normal font-normal bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity">
                      Holder counts may be inaccurate while historical indexing is in progress.
                    </span>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence mode="popLayout">
                {tokens.length === 0 && !isLoading && (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-sm text-zinc-500 dark:text-zinc-400 font-mono">
                      {currentSearch ? `No tokens matching "${currentSearch}"` : 'No tokens found'}
                    </td>
                  </tr>
                )}
                {tokens.map((t: any) => {
                  const id = String(t?.id || t?.token || '');
                  const addr = normalizeHex(t?.address);
                  const symbol = String(t?.symbol || '');
                  const name = String(t?.name || '');
                  const contractName = String(t?.contract_name || '');
                  const holderCount = Number(t?.holder_count || 0);
                  const logo = t?.logo || '';
                  const evmAddress = String(t?.evm_address || '');
                  const isVerified = Boolean(t?.is_verified);
                  const deployedAt = t?.deployed_at;

                  return (
                    <motion.tr
                      layout
                      key={id || `${addr}-${symbol}`}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="border-b border-zinc-100 dark:border-white/5 group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <TokenLogo logo={logo} symbol={symbol || contractName} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <Link
                                to={`/tokens/${encodeURIComponent(id)}` as any}
                                className="font-mono text-sm text-nothing-green-dark dark:text-nothing-green hover:underline truncate"
                                title={id}
                              >
                                {name && symbol ? (
                                  <>
                                    {name}
                                    <span className="ml-1.5 text-zinc-500 dark:text-zinc-400">{symbol}</span>
                                  </>
                                ) : (
                                  symbol || contractName || id
                                )}
                              </Link>
                              {isVerified && <VerifiedBadge size={14} />}
                              {evmAddress && <EVMBridgeBadge evmAddress={evmAddress} />}
                            </div>
                            <div className="text-xs text-zinc-500 dark:text-zinc-400 font-mono truncate" title={id}>
                              {contractName || id}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        {addr ? (
                          <AddressLink address={addr} prefixLen={20} suffixLen={0} />
                        ) : (
                          <span className="text-zinc-500 font-mono text-sm">-</span>
                        )}
                      </td>
                      <td className="p-4 text-right">
                        <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                          {formatDate(deployedAt)}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <span className="font-mono text-sm text-zinc-900 dark:text-white">
                          {holderCount > 0 ? holderCount.toLocaleString() : '-'}
                        </span>
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        <div className="p-4 border-t border-zinc-200 dark:border-white/5">
          <Pagination currentPage={currentPage} onPageChange={handlePageChange} hasNext={hasNext} />
        </div>
      </div>
    </div>
  );
}

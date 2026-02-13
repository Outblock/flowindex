import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Search, Filter, Radio, ChevronDown, X, Loader2, Circle } from 'lucide-react';
import NumberFlow from '@number-flow/react';
import { ensureHeyApiConfigured, fetchStatus } from '../../api/heyapi';
import { getFlowV1Transaction } from '../../api/gen/find';
import { useWebSocketMessages, useWebSocketStatus } from '../../hooks/useWebSocket';
import { Pagination } from '../../components/Pagination';
import { ActivityRow, deriveActivityType } from '../../components/TransactionRow';

const PAGE_SIZE = 20;

interface Filters {
    status: string;
    address: string;
}

export const Route = createFileRoute('/tx/')({
    component: Transactions,
    loader: async () => {
        try {
            await ensureHeyApiConfigured();
            const [transactionsRes, statusRes] = await Promise.all([
                getFlowV1Transaction({ query: { limit: PAGE_SIZE, offset: 0 } }),
                fetchStatus()
            ]);
            const items = transactionsRes.data?.data ?? [];
            return { initialTxs: Array.isArray(items) ? items : [], statusRes };
        } catch (e) {
            console.error("Failed to load transactions", e);
            return { initialTxs: [], statusRes: null };
        }
    }
})

function transformTx(tx: any) {
    return {
        ...tx,
        type: tx.type || (tx.status === 'SEALED' ? 'TRANSFER' : 'PENDING'),
        payer: tx.payer_address || tx.proposer_address,
        blockHeight: tx.block_height,
    };
}

function Transactions() {
    const { initialTxs, statusRes } = Route.useLoaderData();
    const [transactions, setTransactions] = useState<any[]>(() => (initialTxs || []).map(transformTx));
    const [status, setStatus] = useState<any>(statusRes);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(initialTxs?.length >= PAGE_SIZE);
    const [liveFeed, setLiveFeed] = useState(false);
    const [newTxIds, setNewTxIds] = useState<Set<string>>(new Set());
    const [expandedTxId, setExpandedTxId] = useState<string | null>(null);
    const [filters, setFilters] = useState<Filters>({ status: '', address: '' });
    const [showFilters, setShowFilters] = useState(false);
    const [activeTypeFilter, setActiveTypeFilter] = useState('');

    const { isConnected } = useWebSocketStatus();
    const { lastMessage } = useWebSocketMessages();

    // ── Fetch transactions with filters ──
    const fetchPage = useCallback(async (pg: number, f: Filters) => {
        setLoading(true);
        try {
            await ensureHeyApiConfigured();
            const query: any = { limit: PAGE_SIZE, offset: (pg - 1) * PAGE_SIZE };
            if (f.status) query.status = f.status;
            if (f.address) {
                const addr = f.address.toLowerCase().replace(/^0x/, '');
                query.payer = addr;
            }
            const res = await getFlowV1Transaction({ query });
            const items = res?.data?.data ?? (Array.isArray(res?.data) ? res.data : []);
            const txs = items.map(transformTx);
            setTransactions(txs);
            setHasMore(items.length >= PAGE_SIZE);
        } catch (err) {
            console.error("Failed to load transactions", err);
        } finally {
            setLoading(false);
        }
    }, []);

    // ── Page change ──
    const handlePageChange = useCallback((newPage: number) => {
        setPage(newPage);
        fetchPage(newPage, filters);
    }, [fetchPage, filters]);

    // ── Apply filters ──
    const applyFilters = useCallback((newFilters: Filters) => {
        setFilters(newFilters);
        setPage(1);
        fetchPage(1, newFilters);
    }, [fetchPage]);

    // ── Live feed ──
    useEffect(() => {
        if (!liveFeed || !lastMessage || page !== 1) return;
        if (lastMessage.type !== 'new_transaction') return;
        if (filters.status || filters.address) return; // Don't mix live with filters

        const newTx = transformTx(lastMessage.payload);
        setTransactions(prev => {
            const exists = prev.some(t => t.id === newTx.id);
            if (exists) return prev;
            return [newTx, ...prev].slice(0, PAGE_SIZE);
        });

        setNewTxIds(prev => new Set(prev).add(newTx.id));
        setTimeout(() => setNewTxIds(prev => {
            const next = new Set(prev);
            next.delete(newTx.id);
            return next;
        }), 3000);

        setStatus((prev: any) => prev ? { ...prev, total_transactions: (prev.total_transactions || 0) + 1 } : prev);
    }, [lastMessage, liveFeed, page, filters]);

    // ── Status refresh ──
    useEffect(() => {
        const refresh = async () => {
            try {
                const s = await fetchStatus();
                if (s) setStatus(s);
            } catch { /* ignore */ }
        };
        refresh();
        const interval = setInterval(refresh, 15000);
        return () => clearInterval(interval);
    }, []);

    // ── Client-side type filter ──
    const displayTxs = activeTypeFilter
        ? transactions.filter(tx => deriveActivityType(tx).type === activeTypeFilter)
        : transactions;

    // ── Type counts for filter chips ──
    const typeCounts = new Map<string, number>();
    for (const tx of transactions) {
        const t = deriveActivityType(tx).type;
        typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
    }
    const typeChips = Array.from(typeCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);

    const hasActiveFilters = filters.status || filters.address || activeTypeFilter;

    return (
        <div className="container mx-auto px-4 py-8 space-y-6 font-mono">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <div className="p-2.5 border border-zinc-200 dark:border-white/10">
                        <Activity className="h-6 w-6 text-zinc-600 dark:text-zinc-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-zinc-900 dark:text-white uppercase tracking-widest">Transactions</h1>
                        <p className="text-[10px] text-zinc-400 uppercase tracking-widest">Network Activity</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* Filter toggle */}
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] uppercase tracking-widest border rounded-sm transition-colors ${
                            showFilters || hasActiveFilters
                                ? 'border-nothing-green-dark/30 dark:border-nothing-green/30 text-nothing-green-dark dark:text-nothing-green bg-nothing-green/5'
                                : 'border-zinc-200 dark:border-white/10 text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                        }`}
                    >
                        <Filter className="w-3 h-3" />
                        Filters
                        {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-nothing-green" />}
                    </button>

                    {/* Live feed toggle */}
                    <button
                        onClick={() => setLiveFeed(!liveFeed)}
                        className={`inline-flex items-center gap-2 px-3 py-1.5 text-[10px] uppercase tracking-widest border rounded-sm transition-colors ${
                            liveFeed
                                ? 'border-emerald-400/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/5'
                                : 'border-zinc-200 dark:border-white/10 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
                        }`}
                    >
                        {liveFeed ? (
                            <>
                                <Radio className="w-3 h-3" />
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                Live
                            </>
                        ) : (
                            <>
                                <Circle className="w-3 h-3" />
                                Live Off
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-4">
                    <p className="text-[10px] text-zinc-400 uppercase tracking-widest mb-1">Total Transactions</p>
                    <p className="text-xl font-bold font-mono text-zinc-900 dark:text-white">
                        <NumberFlow value={status?.total_transactions || 0} format={{ useGrouping: true }} />
                    </p>
                </div>
                <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-4">
                    <p className="text-[10px] text-zinc-400 uppercase tracking-widest mb-1">Latest Block</p>
                    <p className="text-xl font-bold font-mono text-zinc-900 dark:text-white">
                        #{status?.latest_height?.toLocaleString() || '—'}
                    </p>
                </div>
                <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-4">
                    <p className="text-[10px] text-zinc-400 uppercase tracking-widest mb-1">Page</p>
                    <p className="text-xl font-bold font-mono text-zinc-900 dark:text-white">{page}</p>
                </div>
                <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-4">
                    <p className="text-[10px] text-zinc-400 uppercase tracking-widest mb-1">Showing</p>
                    <p className="text-xl font-bold font-mono text-zinc-900 dark:text-white">{displayTxs.length}</p>
                </div>
            </div>

            {/* Filters panel */}
            <AnimatePresence>
                {showFilters && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                    >
                        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-4 space-y-4">
                            <div className="flex items-center justify-between">
                                <p className="text-[10px] text-zinc-400 uppercase tracking-widest">Filters</p>
                                {hasActiveFilters && (
                                    <button
                                        onClick={() => { applyFilters({ status: '', address: '' }); setActiveTypeFilter(''); }}
                                        className="inline-flex items-center gap-1 text-[10px] text-red-500 uppercase tracking-widest hover:underline"
                                    >
                                        <X className="w-3 h-3" /> Clear All
                                    </button>
                                )}
                            </div>

                            <div className="flex flex-wrap gap-3">
                                {/* Status filter */}
                                <div className="flex items-center gap-2">
                                    <label className="text-[10px] text-zinc-500 uppercase tracking-widest">Status</label>
                                    <select
                                        value={filters.status}
                                        onChange={(e) => applyFilters({ ...filters, status: e.target.value })}
                                        className="text-xs bg-zinc-50 dark:bg-black/40 border border-zinc-200 dark:border-white/10 px-2 py-1.5 rounded-sm text-zinc-700 dark:text-zinc-300 font-mono"
                                    >
                                        <option value="">All</option>
                                        <option value="SEALED">Sealed</option>
                                        <option value="EXPIRED">Expired</option>
                                        <option value="PENDING">Pending</option>
                                    </select>
                                </div>

                                {/* Address search */}
                                <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                                    <label className="text-[10px] text-zinc-500 uppercase tracking-widest flex-shrink-0">Address</label>
                                    <div className="relative flex-1">
                                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400" />
                                        <input
                                            type="text"
                                            value={filters.address}
                                            onChange={(e) => setFilters(prev => ({ ...prev, address: e.target.value }))}
                                            onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(filters); }}
                                            placeholder="Filter by payer address..."
                                            className="w-full text-xs bg-zinc-50 dark:bg-black/40 border border-zinc-200 dark:border-white/10 pl-7 pr-2 py-1.5 rounded-sm text-zinc-700 dark:text-zinc-300 font-mono placeholder:text-zinc-300 dark:placeholder:text-zinc-600"
                                        />
                                    </div>
                                    <button
                                        onClick={() => applyFilters(filters)}
                                        className="text-[10px] text-nothing-green-dark dark:text-nothing-green uppercase tracking-widest border border-nothing-green-dark/20 dark:border-nothing-green/20 px-2.5 py-1.5 rounded-sm hover:bg-nothing-green/5 transition-colors"
                                    >
                                        Search
                                    </button>
                                </div>
                            </div>

                            {/* Type chips (client-side filter) */}
                            {typeChips.length > 1 && (
                                <div className="flex flex-wrap gap-1.5">
                                    <button
                                        onClick={() => setActiveTypeFilter('')}
                                        className={`text-[10px] uppercase tracking-widest px-2 py-1 rounded-sm border transition-colors ${
                                            !activeTypeFilter
                                                ? 'border-zinc-900 dark:border-white text-zinc-900 dark:text-white bg-zinc-100 dark:bg-white/10'
                                                : 'border-zinc-200 dark:border-white/10 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
                                        }`}
                                    >
                                        All
                                    </button>
                                    {typeChips.map(([type, count]) => {
                                        const info = deriveActivityType({ tags: [], contract_imports: type === 'contract' ? ['x'] : [], ft_transfers: type === 'ft' ? [{}] : [], defi_events: type === 'swap' ? [{}] : [] });
                                        return (
                                            <button
                                                key={type}
                                                onClick={() => setActiveTypeFilter(activeTypeFilter === type ? '' : type)}
                                                className={`text-[10px] uppercase tracking-widest px-2 py-1 rounded-sm border transition-colors ${
                                                    activeTypeFilter === type
                                                        ? `${info.bgColor} ${info.color}`
                                                        : 'border-zinc-200 dark:border-white/10 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
                                                }`}
                                            >
                                                {info.label} <span className="font-mono">{count}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Transaction List */}
            <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden relative">
                {loading && (
                    <div className="absolute inset-0 bg-white/60 dark:bg-black/60 z-10 flex items-center justify-center">
                        <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
                    </div>
                )}

                {displayTxs.length === 0 && !loading ? (
                    <div className="p-12 text-center">
                        <Activity className="w-8 h-8 text-zinc-300 dark:text-zinc-600 mx-auto mb-3" />
                        <p className="text-sm text-zinc-400 uppercase tracking-widest">No transactions found</p>
                        {hasActiveFilters && (
                            <button
                                onClick={() => { applyFilters({ status: '', address: '' }); setActiveTypeFilter(''); }}
                                className="mt-3 text-[10px] text-nothing-green-dark dark:text-nothing-green uppercase tracking-widest hover:underline"
                            >
                                Clear filters
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="space-y-0">
                        <AnimatePresence initial={false}>
                            {displayTxs.map((tx) => {
                                const isNew = newTxIds.has(tx.id);
                                return (
                                    <motion.div
                                        key={`${tx.id}-${tx.block_height || tx.blockHeight}`}
                                        initial={isNew ? { opacity: 0, height: 0 } : false}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        transition={{ duration: 0.3 }}
                                        className={isNew ? 'bg-nothing-green/5' : ''}
                                    >
                                        <ActivityRow
                                            tx={tx}
                                            expanded={expandedTxId === tx.id}
                                            onToggle={() => setExpandedTxId(prev => prev === tx.id ? null : tx.id)}
                                        />
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                    </div>
                )}

                {/* Pagination */}
                <div className="p-4 border-t border-zinc-200 dark:border-white/5">
                    <Pagination
                        currentPage={page}
                        onPageChange={handlePageChange}
                        hasNext={hasMore && !activeTypeFilter}
                    />
                </div>
            </div>
        </div>
    );
}

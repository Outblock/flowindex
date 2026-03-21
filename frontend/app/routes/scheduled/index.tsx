import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { AddressLink } from '../../components/AddressLink';
import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, ChevronRight, Timer, Zap, Ban, ArrowLeft, LayoutGrid, List, RefreshCw, Search } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { resolveApiBaseUrl } from '../../api';
import { Pagination } from '../../components/Pagination';
import { formatRelativeTime } from '../../lib/time';
import { useTimeTicker } from '../../hooks/useTimeTicker';
import { PageHeader } from '../../components/ui/PageHeader';

interface ScheduledTx {
    scheduled_id: number;
    priority: number;
    priority_label: string;
    expected_at: string;
    execution_effort: number;
    fees: string;
    handler_owner: string;
    handler_type: string;
    handler_contract: string;
    handler_contract_address: string;
    handler_uuid: number;
    handler_public_path: string;
    scheduled_block: number;
    scheduled_tx_id: string;
    scheduled_at: string;
    status: string;
    executed_block?: number;
    executed_tx_id?: string;
    executed_at?: string;
    fees_returned?: string;
    fees_deducted?: string;
}

interface HandlerSummary {
    handler_owner: string;
    handler_type: string;
    handler_contract: string;
    handler_contract_address: string;
    handler_uuid: number;
    total_count: number;
    scheduled_count: number;
    executed_count: number;
    canceled_count: number;
    total_fees: string;
    first_scheduled: string;
    last_scheduled: string;
    last_executed_at?: string;
    is_recurring: boolean;
    avg_interval_sec: number | null;
}

interface ScheduledSearchTx extends ScheduledTx {
    matched_event_type: string;
    matched_event_name: string;
}

interface ScheduledSearch {
    tab?: 'transactions' | 'handlers' | 'search';
    handler_owner?: string;
    handler_uuid?: number;
}

const formatInterval = (sec: number | null | undefined): string => {
    if (sec == null || sec <= 0) return '';
    if (sec < 60) return `~${Math.round(sec)}s`;
    if (sec < 3600) return `~${Math.round(sec / 60)}m`;
    if (sec < 86400) return `~${Math.round(sec / 3600)}h`;
    return `~${Math.round(sec / 86400)}d`;
};

function ScheduledSkeleton() {
    return (
        <div className="min-h-screen bg-gray-50/50 dark:bg-black text-zinc-900 dark:text-white font-mono">
            <div className="max-w-7xl mx-auto px-4 pt-12 pb-24">
                <div className="mb-8 space-y-2">
                    <div className="h-8 w-72 bg-zinc-200 dark:bg-white/10 rounded-sm animate-pulse" />
                    <div className="h-4 w-96 bg-zinc-100 dark:bg-white/5 rounded-sm animate-pulse" />
                </div>
                {[...Array(12)].map((_, i) => (
                    <div key={i} className="grid grid-cols-12 gap-4 px-4 py-4 border-b border-zinc-100 dark:border-white/5 items-center">
                        <div className="col-span-1"><div className="h-3 w-12 bg-zinc-200 dark:bg-white/10 rounded-sm animate-pulse" /></div>
                        <div className="col-span-2"><div className="h-3 w-20 bg-zinc-100 dark:bg-white/5 rounded-sm animate-pulse" /></div>
                        <div className="col-span-2"><div className="h-3 w-28 bg-zinc-100 dark:bg-white/5 rounded-sm animate-pulse" /></div>
                        <div className="col-span-1"><div className="h-3 w-10 bg-zinc-200 dark:bg-white/10 rounded-sm animate-pulse" /></div>
                        <div className="col-span-1"><div className="h-3 w-14 bg-zinc-100 dark:bg-white/5 rounded-sm animate-pulse" /></div>
                        <div className="col-span-2"><div className="h-3 w-20 bg-zinc-100 dark:bg-white/5 rounded-sm animate-pulse" /></div>
                        <div className="col-span-1"><div className="h-3 w-16 bg-zinc-200 dark:bg-white/10 rounded-sm animate-pulse" /></div>
                        <div className="col-span-2"><div className="h-3 w-16 bg-zinc-100 dark:bg-white/5 rounded-sm animate-pulse" /></div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export const Route = createFileRoute('/scheduled/')({
    component: ScheduledPage,
    pendingComponent: ScheduledSkeleton,
    validateSearch: (search: Record<string, unknown>): ScheduledSearch => ({
        tab: (search.tab as ScheduledSearch['tab']) || undefined,
        handler_owner: (search.handler_owner as string) || undefined,
        handler_uuid: search.handler_uuid ? Number(search.handler_uuid) : undefined,
    }),
    loader: async () => {
        try {
            const baseUrl = await resolveApiBaseUrl();
            const res = await fetch(`${baseUrl}/flow/scheduled-transaction?limit=20&offset=0`);
            const payload = await res.json();
            return { initialData: payload };
        } catch (e) {
            console.error('Failed to load scheduled transactions', e);
            return { initialData: null };
        }
    }
})

const priorityColor = (p: number) => {
    switch (p) {
        case 0: return 'text-red-500 bg-red-500/10 border-red-500/20';
        case 1: return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
        case 2: return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
        default: return 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20';
    }
};

const statusIcon = (status: string) => {
    switch (status) {
        case 'EXECUTED': return <CheckCircle className="h-3 w-3" />;
        case 'CANCELED': return <Ban className="h-3 w-3" />;
        default: return <Timer className="h-3 w-3" />;
    }
};

const statusColor = (status: string) => {
    switch (status) {
        case 'EXECUTED': return 'text-emerald-500';
        case 'CANCELED': return 'text-red-500';
        default: return 'text-amber-400';
    }
};

const formatDate = (iso: string) => {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
        ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const truncateHash = (hash: string, head = 10, tail = 8) => {
    if (!hash) return '';
    if (hash.length <= head + tail + 3) return hash;
    return `${hash.slice(0, head)}...${hash.slice(-tail)}`;
};

function ExpandedRow({ tx }: { tx: ScheduledTx }) {
    return (
        <div className="px-4 py-4 bg-zinc-50 dark:bg-white/[0.02] border-b border-zinc-100 dark:border-white/5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {/* Left column */}
                <div className="space-y-3">
                    <div>
                        <span className="text-zinc-500 text-[10px] uppercase tracking-wider">Handler</span>
                        <p className="text-zinc-800 dark:text-zinc-200 mt-0.5 break-all">{tx.handler_type}</p>
                    </div>
                    <div>
                        <span className="text-zinc-500 text-[10px] uppercase tracking-wider">Handler UUID</span>
                        <p className="text-zinc-800 dark:text-zinc-200 mt-0.5">{tx.handler_uuid}</p>
                    </div>
                    {tx.handler_public_path && (
                        <div>
                            <span className="text-zinc-500 text-[10px] uppercase tracking-wider">Public Path</span>
                            <p className="text-zinc-800 dark:text-zinc-200 mt-0.5">{tx.handler_public_path}</p>
                        </div>
                    )}
                    <div className="flex gap-6">
                        <div>
                            <span className="text-zinc-500 text-[10px] uppercase tracking-wider">Scheduled At</span>
                            <p className="text-zinc-800 dark:text-zinc-200 mt-0.5">{formatDate(tx.scheduled_at)}</p>
                        </div>
                        <div>
                            <span className="text-zinc-500 text-[10px] uppercase tracking-wider">Expected At</span>
                            <p className="text-zinc-800 dark:text-zinc-200 mt-0.5">{formatDate(tx.expected_at)}</p>
                        </div>
                    </div>
                </div>

                {/* Right column */}
                <div className="space-y-3">
                    <div>
                        <span className="text-zinc-500 text-[10px] uppercase tracking-wider">Scheduled By</span>
                        <div className="flex items-center gap-2 mt-0.5">
                            <Link
                                to={`/blocks/${tx.scheduled_block}` as any}
                                className="text-nothing-green-dark dark:text-nothing-green hover:underline"
                            >
                                #{tx.scheduled_block}
                            </Link>
                            <span className="text-zinc-400">|</span>
                            <Link
                                to={`/txs/${tx.scheduled_tx_id.replace('0x', '')}` as any}
                                className="text-nothing-green-dark dark:text-nothing-green hover:underline"
                            >
                                {truncateHash(tx.scheduled_tx_id)}
                            </Link>
                        </div>
                    </div>

                    {tx.status === 'EXECUTED' && tx.executed_tx_id && (
                        <div>
                            <span className="text-zinc-500 text-[10px] uppercase tracking-wider">Executed In</span>
                            <div className="flex items-center gap-2 mt-0.5">
                                {tx.executed_block && (
                                    <>
                                        <Link
                                            to={`/blocks/${tx.executed_block}` as any}
                                            className="text-nothing-green-dark dark:text-nothing-green hover:underline"
                                        >
                                            #{tx.executed_block}
                                        </Link>
                                        <span className="text-zinc-400">|</span>
                                    </>
                                )}
                                <Link
                                    to={`/txs/${tx.executed_tx_id.replace('0x', '')}` as any}
                                    className="text-nothing-green-dark dark:text-nothing-green hover:underline"
                                >
                                    {truncateHash(tx.executed_tx_id)}
                                </Link>
                            </div>
                            {tx.executed_at && (
                                <p className="text-zinc-500 mt-0.5">{formatDate(tx.executed_at)}</p>
                            )}
                        </div>
                    )}

                    {tx.status === 'CANCELED' && (
                        <div className="flex gap-6">
                            {tx.fees_returned && (
                                <div>
                                    <span className="text-zinc-500 text-[10px] uppercase tracking-wider">Fees Returned</span>
                                    <p className="text-zinc-800 dark:text-zinc-200 mt-0.5">{tx.fees_returned} FLOW</p>
                                </div>
                            )}
                            {tx.fees_deducted && (
                                <div>
                                    <span className="text-zinc-500 text-[10px] uppercase tracking-wider">Fees Deducted</span>
                                    <p className="text-zinc-800 dark:text-zinc-200 mt-0.5">{tx.fees_deducted} FLOW</p>
                                </div>
                            )}
                        </div>
                    )}

                    <div>
                        <Link
                            to={`/scheduled/${tx.scheduled_id}` as any}
                            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-nothing-green-dark dark:text-nothing-green hover:underline"
                        >
                            View Full Details →
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ── Handlers Tab ─────────────────────────────────────── */

function HandlersTab() {
    const navigate = useNavigate({ from: '/scheduled/' });
    const [handlers, setHandlers] = useState<HandlerSummary[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [hasNext, setHasNext] = useState(false);
    const [loading, setLoading] = useState(true);
    const [hideRecurring, setHideRecurring] = useState(false);
    const nowTick = useTimeTicker(20000);

    const loadPage = useCallback(async (page: number) => {
        setLoading(true);
        try {
            const offset = (page - 1) * 20;
            const baseUrl = await resolveApiBaseUrl();
            const res = await fetch(`${baseUrl}/flow/scheduled-handler?limit=20&offset=${offset}`);
            const payload = await res.json();
            setHandlers(payload?.data || []);
            const meta = payload?._meta;
            setHasNext((meta?.count || 0) >= 20);
        } catch (err) {
            console.error('Failed to load handlers', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadPage(currentPage);
    }, [currentPage, loadPage]);

    const handleCardClick = (h: HandlerSummary) => {
        navigate({
            search: {
                tab: 'transactions' as const,
                handler_owner: h.handler_owner,
                handler_uuid: h.handler_uuid,
            },
            replace: false,
        });
    };

    const displayedHandlers = hideRecurring ? handlers.filter((h) => !h.is_recurring) : handlers;

    return (
        <div>
            {/* Hide recurring toggle */}
            <div className="flex items-center gap-2 mb-4">
                <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400 cursor-pointer select-none">
                    <input
                        type="checkbox"
                        checked={hideRecurring}
                        onChange={(e) => setHideRecurring(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-zinc-300 dark:border-white/20 accent-amber-500"
                    />
                    Hide recurring handlers
                </label>
            </div>

            <div className="min-h-[300px] relative">
                {loading && handlers.length === 0 && (
                    <div className="absolute inset-0 bg-white/50 dark:bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                        <div className="w-8 h-8 border-2 border-dashed border-zinc-900 dark:border-white rounded-full animate-spin" />
                    </div>
                )}

                {!loading && displayedHandlers.length === 0 && (
                    <div className="text-center text-zinc-500 italic py-12">
                        {hideRecurring && handlers.length > 0 ? 'All handlers on this page are recurring' : 'No handlers found'}
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {displayedHandlers.map((h) => (
                        <div
                            key={`${h.handler_owner}-${h.handler_uuid}`}
                            onClick={() => handleCardClick(h)}
                            className="border border-zinc-200 dark:border-white/10 bg-white dark:bg-white/[0.02] hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors cursor-pointer p-4 space-y-3"
                        >
                            {/* Contract name */}
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    <h3 className="text-sm font-bold text-zinc-900 dark:text-white truncate" title={h.handler_type}>
                                        {h.handler_contract}
                                    </h3>
                                    {h.is_recurring && (
                                        <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border border-amber-500/20 text-amber-500 bg-amber-500/10 font-medium flex-shrink-0">
                                            <RefreshCw className="h-2.5 w-2.5" />
                                            Recurring
                                        </span>
                                    )}
                                </div>
                                <ChevronRight className="h-4 w-4 text-zinc-400 flex-shrink-0 mt-0.5" />
                            </div>
                            {h.avg_interval_sec != null && h.avg_interval_sec > 0 && (
                                <div className="text-[10px] text-zinc-500">
                                    Avg interval: <span className="text-zinc-700 dark:text-zinc-300 font-medium">{formatInterval(h.avg_interval_sec)}</span>
                                </div>
                            )}

                            {/* Owner */}
                            <div onClick={(e) => e.stopPropagation()}>
                                <span className="text-[10px] uppercase tracking-wider text-zinc-500">Owner</span>
                                <div className="mt-0.5">
                                    <AddressLink address={h.handler_owner} prefixLen={8} suffixLen={4} size={14} />
                                </div>
                            </div>

                            {/* Stats badges */}
                            <div className="flex flex-wrap gap-1.5">
                                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-400 font-medium">
                                    {h.total_count.toLocaleString()} total
                                </span>
                                {h.scheduled_count > 0 && (
                                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-amber-500/20 text-amber-500 bg-amber-500/10 font-medium">
                                        <Timer className="h-2.5 w-2.5" />
                                        {h.scheduled_count.toLocaleString()}
                                    </span>
                                )}
                                {h.executed_count > 0 && (
                                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-emerald-500/20 text-emerald-500 bg-emerald-500/10 font-medium">
                                        <CheckCircle className="h-2.5 w-2.5" />
                                        {h.executed_count.toLocaleString()}
                                    </span>
                                )}
                                {h.canceled_count > 0 && (
                                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-red-500/20 text-red-500 bg-red-500/10 font-medium">
                                        <Ban className="h-2.5 w-2.5" />
                                        {h.canceled_count.toLocaleString()}
                                    </span>
                                )}
                            </div>

                            {/* Fees + times */}
                            <div className="space-y-1.5 text-[10px]">
                                <div className="flex justify-between">
                                    <span className="text-zinc-500 uppercase tracking-wider">Total Fees</span>
                                    <span className="text-zinc-700 dark:text-zinc-300 font-medium">
                                        {parseFloat(h.total_fees).toFixed(4)} FLOW
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-zinc-500 uppercase tracking-wider">Last Scheduled</span>
                                    <span className="text-zinc-500">
                                        {h.last_scheduled ? formatRelativeTime(h.last_scheduled, nowTick) : '-'}
                                    </span>
                                </div>
                                {h.last_executed_at && (
                                    <div className="flex justify-between">
                                        <span className="text-zinc-500 uppercase tracking-wider">Last Executed</span>
                                        <span className="text-zinc-500">
                                            {formatRelativeTime(h.last_executed_at, nowTick)}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <Pagination
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                hasNext={hasNext}
            />
        </div>
    );
}

/* ── Transactions Tab ─────────────────────────────────── */

function TransactionsTab({ handlerOwner, handlerUuid }: { handlerOwner?: string; handlerUuid?: number }) {
    const { initialData } = Route.useLoaderData();
    const navigate = useNavigate({ from: '/scheduled/' });
    const [transactions, setTransactions] = useState<ScheduledTx[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [hasNext, setHasNext] = useState(false);
    const [loading, setLoading] = useState(false);
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const nowTick = useTimeTicker(20000);

    const isFiltered = !!(handlerOwner && handlerUuid);

    // Build the fetch URL based on whether we're filtered by handler
    const buildUrl = useCallback((baseUrl: string, offset: number) => {
        if (isFiltered) {
            const ownerClean = handlerOwner!.replace(/^0x/, '');
            return `${baseUrl}/flow/scheduled-handler/${ownerClean}/${handlerUuid}?limit=20&offset=${offset}`;
        }
        return `${baseUrl}/flow/scheduled-transaction?limit=20&offset=${offset}`;
    }, [isFiltered, handlerOwner, handlerUuid]);

    // Use initial data only when NOT filtered
    useEffect(() => {
        if (!isFiltered && initialData?.data) {
            setTransactions(initialData.data);
            const meta = initialData._meta;
            setHasNext((meta?.count || 0) >= 20);
        }
    }, [initialData, isFiltered]);

    const loadPage = useCallback(async (page: number) => {
        setLoading(true);
        try {
            const offset = (page - 1) * 20;
            const baseUrl = await resolveApiBaseUrl();
            const res = await fetch(buildUrl(baseUrl, offset));
            const payload = await res.json();
            setTransactions(payload?.data || []);
            const meta = payload?._meta;
            setHasNext((meta?.count || 0) >= 20);
        } catch (err) {
            console.error('Failed to load scheduled transactions', err);
        } finally {
            setLoading(false);
        }
    }, [buildUrl]);

    // Load filtered data on mount, or when page changes
    useEffect(() => {
        if (isFiltered || currentPage > 1) {
            loadPage(currentPage);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPage, isFiltered]);

    const clearFilter = () => {
        setCurrentPage(1);
        navigate({ search: {}, replace: true });
    };

    return (
        <div>
            {/* Handler filter banner */}
            {isFiltered && (
                <div className="mb-4 flex items-center gap-3 px-4 py-2.5 border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/[0.02]">
                    <button
                        onClick={clearFilter}
                        className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
                    >
                        <ArrowLeft className="h-3 w-3" />
                        Clear filter
                    </button>
                    <span className="text-[10px] text-zinc-400">|</span>
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">
                        Showing transactions for handler <span className="font-medium text-zinc-800 dark:text-zinc-200">{handlerOwner}</span>
                        {' / '}
                        <span className="font-medium text-zinc-800 dark:text-zinc-200">{handlerUuid}</span>
                    </span>
                </div>
            )}

            <div className="overflow-x-auto min-h-[300px] relative">
                {loading && transactions.length === 0 && (
                    <div className="absolute inset-0 bg-white/50 dark:bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                        <div className="w-8 h-8 border-2 border-dashed border-zinc-900 dark:border-white rounded-full animate-spin" />
                    </div>
                )}

                {/* Table Header */}
                <div className="hidden md:grid grid-cols-12 gap-3 px-4 py-3 text-[10px] uppercase tracking-widest text-zinc-500 border-b border-zinc-200 dark:border-white/10">
                    <div className="col-span-1">ID</div>
                    <div className="col-span-2">Owner</div>
                    <div className="col-span-2">Handler</div>
                    <div className="col-span-1">Priority</div>
                    <div className="col-span-1">Fees</div>
                    <div className="col-span-2">Expected At</div>
                    <div className="col-span-1">Status</div>
                    <div className="col-span-2 text-right">Scheduled</div>
                </div>

                {/* Rows */}
                {transactions.map((tx) => {
                    const isExpanded = expandedId === tx.scheduled_id;
                    const timeStr = tx.scheduled_at ? formatRelativeTime(tx.scheduled_at, nowTick) : '';

                    return (
                        <div key={tx.scheduled_id}>
                            <div
                                className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-3 px-4 py-3 border-b border-zinc-100 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors items-center cursor-pointer"
                                onClick={() => setExpandedId(isExpanded ? null : tx.scheduled_id)}
                            >
                                {/* ID */}
                                <div className="col-span-1 flex items-center gap-1.5">
                                    <motion.div
                                        animate={{ rotate: isExpanded ? 90 : 0 }}
                                        transition={{ duration: 0.2 }}
                                        className="flex-shrink-0"
                                    >
                                        <ChevronRight className="h-3 w-3 text-zinc-400" />
                                    </motion.div>
                                    <Link
                                        to={`/scheduled/${tx.scheduled_id}` as any}
                                        className="text-nothing-green-dark dark:text-nothing-green hover:underline text-xs font-medium"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        {tx.scheduled_id}
                                    </Link>
                                </div>

                                {/* Owner */}
                                <div className="col-span-2" onClick={(e) => e.stopPropagation()}>
                                    {tx.handler_owner ? (
                                        <AddressLink address={tx.handler_owner} prefixLen={8} suffixLen={4} size={14} />
                                    ) : (
                                        <span className="text-xs text-zinc-400">-</span>
                                    )}
                                </div>

                                {/* Handler Contract */}
                                <div className="col-span-2">
                                    <span className="text-xs text-zinc-700 dark:text-zinc-300 truncate block" title={tx.handler_type}>
                                        {tx.handler_contract}
                                    </span>
                                </div>

                                {/* Priority */}
                                <div className="col-span-1">
                                    <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border font-medium ${priorityColor(tx.priority)}`}>
                                        <Zap className="h-2.5 w-2.5" />
                                        {tx.priority_label}
                                    </span>
                                </div>

                                {/* Fees */}
                                <div className="col-span-1">
                                    <span className="text-xs text-zinc-600 dark:text-zinc-400">
                                        {parseFloat(tx.fees).toFixed(4)}
                                    </span>
                                </div>

                                {/* Expected At */}
                                <div className="col-span-2">
                                    <span className="text-[10px] text-zinc-500">{formatDate(tx.expected_at)}</span>
                                </div>

                                {/* Status */}
                                <div className="col-span-1">
                                    <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold ${statusColor(tx.status)}`}>
                                        {statusIcon(tx.status)}
                                        {tx.status}
                                    </span>
                                </div>

                                {/* Scheduled Time */}
                                <div className="col-span-2 text-right">
                                    <span className="text-[10px] text-zinc-400">{timeStr}</span>
                                </div>
                            </div>

                            {/* Expanded details */}
                            <AnimatePresence initial={false}>
                                {isExpanded && (
                                    <motion.div
                                        key="expand"
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                                        style={{ overflow: 'hidden' }}
                                    >
                                        <ExpandedRow tx={tx} />
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    );
                })}

                {transactions.length === 0 && !loading && (
                    <div className="text-center text-zinc-500 italic py-12">No scheduled transactions found</div>
                )}
            </div>

            <Pagination
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                hasNext={hasNext}
            />
        </div>
    );
}

/* ── Search Tab ───────────────────────────────────────── */

function SearchTab() {
    const [eventType, setEventType] = useState('');
    const [fieldName, setFieldName] = useState('');
    const [fieldValue, setFieldValue] = useState('');
    const [results, setResults] = useState<ScheduledSearchTx[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [hasNext, setHasNext] = useState(false);
    const [loading, setLoading] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const nowTick = useTimeTicker(20000);

    const doSearch = useCallback(async (page: number, evtType: string, fName: string, fValue: string) => {
        if (!evtType.trim()) return;
        setLoading(true);
        setHasSearched(true);
        try {
            const offset = (page - 1) * 20;
            const baseUrl = await resolveApiBaseUrl();
            const params = new URLSearchParams({ event_type: evtType.trim(), limit: '20', offset: String(offset) });
            if (fName.trim()) params.set('field', fName.trim());
            if (fValue.trim()) params.set('value', fValue.trim());
            const res = await fetch(`${baseUrl}/flow/scheduled-transaction/search?${params}`);
            const payload = await res.json();
            setResults(payload?.data || []);
            const meta = payload?._meta;
            setHasNext((meta?.count || 0) >= 20);
        } catch (err) {
            console.error('Search failed', err);
        } finally {
            setLoading(false);
        }
    }, []);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setCurrentPage(1);
        doSearch(1, eventType, fieldName, fieldValue);
    };

    useEffect(() => {
        if (hasSearched && currentPage > 1) {
            doSearch(currentPage, eventType, fieldName, fieldValue);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPage]);

    return (
        <div>
            {/* Search form */}
            <form onSubmit={handleSubmit} className="mb-6 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                        <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Event Type</label>
                        <input
                            type="text"
                            value={eventType}
                            onChange={(e) => setEventType(e.target.value)}
                            placeholder="e.g., FungibleToken.Deposited"
                            className="w-full px-3 py-2 text-xs bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-nothing-green"
                        />
                    </div>
                    <div>
                        <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Field Name <span className="text-zinc-400">(optional)</span></label>
                        <input
                            type="text"
                            value={fieldName}
                            onChange={(e) => setFieldName(e.target.value)}
                            placeholder="e.g., to"
                            className="w-full px-3 py-2 text-xs bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-nothing-green"
                        />
                    </div>
                    <div>
                        <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Field Value <span className="text-zinc-400">(optional)</span></label>
                        <input
                            type="text"
                            value={fieldValue}
                            onChange={(e) => setFieldValue(e.target.value)}
                            placeholder="e.g., 0xa7d9a1bece1378a3"
                            className="w-full px-3 py-2 text-xs bg-white dark:bg-white/5 border border-zinc-200 dark:border-white/10 text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-nothing-green"
                        />
                    </div>
                </div>
                <button
                    type="submit"
                    disabled={!eventType.trim() || loading}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs uppercase tracking-widest font-medium bg-zinc-900 dark:bg-white text-white dark:text-black hover:bg-zinc-700 dark:hover:bg-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    <Search className="h-3 w-3" />
                    Search
                </button>
            </form>

            {/* Results */}
            <div className="overflow-x-auto min-h-[200px] relative">
                {loading && results.length === 0 && (
                    <div className="absolute inset-0 bg-white/50 dark:bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                        <div className="w-8 h-8 border-2 border-dashed border-zinc-900 dark:border-white rounded-full animate-spin" />
                    </div>
                )}

                {hasSearched && !loading && results.length === 0 && (
                    <div className="text-center text-zinc-500 italic py-12">No matching scheduled transactions found</div>
                )}

                {!hasSearched && !loading && (
                    <div className="text-center text-zinc-500 italic py-12">Enter an event type and click Search</div>
                )}

                {results.length > 0 && (
                    <>
                        {/* Table Header */}
                        <div className="hidden md:grid grid-cols-12 gap-3 px-4 py-3 text-[10px] uppercase tracking-widest text-zinc-500 border-b border-zinc-200 dark:border-white/10">
                            <div className="col-span-1">ID</div>
                            <div className="col-span-2">Owner</div>
                            <div className="col-span-2">Matched Event</div>
                            <div className="col-span-1">Priority</div>
                            <div className="col-span-1">Fees</div>
                            <div className="col-span-2">Expected At</div>
                            <div className="col-span-1">Status</div>
                            <div className="col-span-2 text-right">Scheduled</div>
                        </div>

                        {results.map((tx) => {
                            const isExpanded = expandedId === tx.scheduled_id;
                            const timeStr = tx.scheduled_at ? formatRelativeTime(tx.scheduled_at, nowTick) : '';

                            return (
                                <div key={tx.scheduled_id}>
                                    <div
                                        className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-3 px-4 py-3 border-b border-zinc-100 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors items-center cursor-pointer"
                                        onClick={() => setExpandedId(isExpanded ? null : tx.scheduled_id)}
                                    >
                                        {/* ID */}
                                        <div className="col-span-1 flex items-center gap-1.5">
                                            <motion.div
                                                animate={{ rotate: isExpanded ? 90 : 0 }}
                                                transition={{ duration: 0.2 }}
                                                className="flex-shrink-0"
                                            >
                                                <ChevronRight className="h-3 w-3 text-zinc-400" />
                                            </motion.div>
                                            <Link
                                                to={`/scheduled/${tx.scheduled_id}` as any}
                                                className="text-nothing-green-dark dark:text-nothing-green hover:underline text-xs font-medium"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                {tx.scheduled_id}
                                            </Link>
                                        </div>

                                        {/* Owner */}
                                        <div className="col-span-2" onClick={(e) => e.stopPropagation()}>
                                            {tx.handler_owner ? (
                                                <AddressLink address={tx.handler_owner} prefixLen={8} suffixLen={4} size={14} />
                                            ) : (
                                                <span className="text-xs text-zinc-400">-</span>
                                            )}
                                        </div>

                                        {/* Matched Event */}
                                        <div className="col-span-2">
                                            <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border border-purple-500/20 text-purple-500 bg-purple-500/10 font-medium truncate" title={tx.matched_event_type}>
                                                {tx.matched_event_name || tx.matched_event_type}
                                            </span>
                                        </div>

                                        {/* Priority */}
                                        <div className="col-span-1">
                                            <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border font-medium ${priorityColor(tx.priority)}`}>
                                                <Zap className="h-2.5 w-2.5" />
                                                {tx.priority_label}
                                            </span>
                                        </div>

                                        {/* Fees */}
                                        <div className="col-span-1">
                                            <span className="text-xs text-zinc-600 dark:text-zinc-400">
                                                {parseFloat(tx.fees).toFixed(4)}
                                            </span>
                                        </div>

                                        {/* Expected At */}
                                        <div className="col-span-2">
                                            <span className="text-[10px] text-zinc-500">{formatDate(tx.expected_at)}</span>
                                        </div>

                                        {/* Status */}
                                        <div className="col-span-1">
                                            <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold ${statusColor(tx.status)}`}>
                                                {statusIcon(tx.status)}
                                                {tx.status}
                                            </span>
                                        </div>

                                        {/* Scheduled Time */}
                                        <div className="col-span-2 text-right">
                                            <span className="text-[10px] text-zinc-400">{timeStr}</span>
                                        </div>
                                    </div>

                                    {/* Expanded details */}
                                    <AnimatePresence initial={false}>
                                        {isExpanded && (
                                            <motion.div
                                                key="expand"
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: 0.2, ease: 'easeInOut' }}
                                                style={{ overflow: 'hidden' }}
                                            >
                                                <ExpandedRow tx={tx} />
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            );
                        })}
                    </>
                )}
            </div>

            {results.length > 0 && (
                <Pagination
                    currentPage={currentPage}
                    onPageChange={setCurrentPage}
                    hasNext={hasNext}
                />
            )}
        </div>
    );
}

/* ── Main Page ────────────────────────────────────────── */

function ScheduledPage() {
    const { tab: searchTab, handler_owner, handler_uuid } = Route.useSearch();
    const navigate = useNavigate({ from: '/scheduled/' });

    // If handler filter params are present, force to transactions tab
    const isFiltered = !!(handler_owner && handler_uuid);
    const activeTab = isFiltered ? 'transactions' : (searchTab || 'transactions');

    const setTab = (tab: 'transactions' | 'handlers' | 'search') => {
        navigate({ search: { tab: tab === 'transactions' ? undefined : tab }, replace: true });
    };

    return (
        <div className="min-h-screen bg-gray-50/50 dark:bg-black text-zinc-900 dark:text-white font-mono transition-colors duration-300">
            <div className="max-w-7xl mx-auto px-4 pt-12 pb-24">
                <PageHeader
                    title="Scheduled Transactions"
                    subtitle="FlowTransactionScheduler entries"
                />

                {/* Tab bar */}
                <div className="flex items-center gap-0 border-b border-zinc-200 dark:border-white/10 mb-6">
                    <button
                        onClick={() => setTab('transactions')}
                        className={`flex items-center gap-1.5 px-4 py-2.5 text-xs uppercase tracking-widest font-medium border-b-2 transition-colors ${
                            activeTab === 'transactions'
                                ? 'border-nothing-green text-zinc-900 dark:text-white'
                                : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                        }`}
                    >
                        <List className="h-3.5 w-3.5" />
                        Transactions
                    </button>
                    <button
                        onClick={() => setTab('handlers')}
                        className={`flex items-center gap-1.5 px-4 py-2.5 text-xs uppercase tracking-widest font-medium border-b-2 transition-colors ${
                            activeTab === 'handlers'
                                ? 'border-nothing-green text-zinc-900 dark:text-white'
                                : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                        }`}
                    >
                        <LayoutGrid className="h-3.5 w-3.5" />
                        Handlers
                    </button>
                    <button
                        onClick={() => setTab('search')}
                        className={`flex items-center gap-1.5 px-4 py-2.5 text-xs uppercase tracking-widest font-medium border-b-2 transition-colors ${
                            activeTab === 'search'
                                ? 'border-nothing-green text-zinc-900 dark:text-white'
                                : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                        }`}
                    >
                        <Search className="h-3.5 w-3.5" />
                        Search
                    </button>
                </div>

                {activeTab === 'transactions' ? (
                    <TransactionsTab handlerOwner={handler_owner} handlerUuid={handler_uuid} />
                ) : activeTab === 'search' ? (
                    <SearchTab />
                ) : (
                    <HandlersTab />
                )}
            </div>
        </div>
    );
}

import { createFileRoute, Link } from '@tanstack/react-router'
import { AddressLink } from '../../components/AddressLink';
import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, ChevronRight, Timer, Zap, Ban } from 'lucide-react';
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
    component: ScheduledTransactions,
    pendingComponent: ScheduledSkeleton,
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

function ScheduledTransactions() {
    const { initialData } = Route.useLoaderData();
    const [transactions, setTransactions] = useState<ScheduledTx[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [hasNext, setHasNext] = useState(false);
    const [loading, setLoading] = useState(false);
    const [expandedId, setExpandedId] = useState<number | null>(null);
    const nowTick = useTimeTicker(20000);

    useEffect(() => {
        if (initialData?.data) {
            setTransactions(initialData.data);
            const meta = initialData._meta;
            setTotal(meta?.total || 0);
            setHasNext((meta?.count || 0) >= 20);
        }
    }, [initialData]);

    const loadPage = useCallback(async (page: number) => {
        setLoading(true);
        try {
            const offset = (page - 1) * 20;
            const baseUrl = await resolveApiBaseUrl();
            const res = await fetch(`${baseUrl}/flow/scheduled-transaction?limit=20&offset=${offset}`);
            const payload = await res.json();
            setTransactions(payload?.data || []);
            const meta = payload?._meta;
            setTotal(meta?.total || 0);
            setHasNext((meta?.count || 0) >= 20);
        } catch (err) {
            console.error('Failed to load scheduled transactions', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (currentPage > 1) loadPage(currentPage);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPage]);

    return (
        <div className="min-h-screen bg-gray-50/50 dark:bg-black text-zinc-900 dark:text-white font-mono transition-colors duration-300">
            <div className="max-w-7xl mx-auto px-4 pt-12 pb-24">
                <PageHeader
                    title="Scheduled Transactions"
                    subtitle={`FlowTransactionScheduler entries${total > 0 ? ` (${total.toLocaleString()} total)` : ''}`}
                />

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
        </div>
    );
}

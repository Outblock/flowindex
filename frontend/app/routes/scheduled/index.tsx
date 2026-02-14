import { createFileRoute, Link } from '@tanstack/react-router'
import { AddressLink } from '../../components/AddressLink';
import { useState, useEffect, useCallback } from 'react';
import { Clock, CheckCircle, XCircle } from 'lucide-react';
import { resolveApiBaseUrl } from '../../api';
import { Pagination } from '../../components/Pagination';
import { formatRelativeTime } from '../../lib/time';
import { useTimeTicker } from '../../hooks/useTimeTicker';
import { PageHeader } from '../../components/ui/PageHeader';

export const Route = createFileRoute('/scheduled/')({
    component: ScheduledTransactions,
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

function ScheduledTransactions() {
    const { initialData } = Route.useLoaderData();
    const [transactions, setTransactions] = useState<any[]>([]);
    const [currentPage, setCurrentPage] = useState(1);
    const [hasNext, setHasNext] = useState(false);
    const [loading, setLoading] = useState(false);
    const nowTick = useTimeTicker(20000);

    const normalizeHex = (value: any) => {
        if (!value) return '';
        const lower = String(value).toLowerCase();
        return lower.startsWith('0x') ? lower : `0x${lower}`;
    };

    const formatMiddle = (value: string, head = 12, tail = 8) => {
        if (!value) return '';
        if (value.length <= head + tail + 3) return value;
        return `${value.slice(0, head)}...${value.slice(-tail)}`;
    };

    // Initialize from loader data
    useEffect(() => {
        if (initialData?.data) {
            setTransactions(initialData.data);
            const meta = initialData.meta;
            setHasNext(meta?.count >= 20);
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
            const meta = payload?.meta;
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
                <PageHeader title="Scheduled Transactions" subtitle="Transactions involving FlowTransactionScheduler" />

                <div className="overflow-x-auto min-h-[300px] relative">
                    {loading && transactions.length === 0 && (
                        <div className="absolute inset-0 bg-white/50 dark:bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                            <div className="w-8 h-8 border-2 border-dashed border-zinc-900 dark:border-white rounded-full animate-spin" />
                        </div>
                    )}

                    {/* Table Header */}
                    <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-3 text-[10px] uppercase tracking-widest text-zinc-500 border-b border-zinc-200 dark:border-white/10">
                        <div className="col-span-4">Transaction Hash</div>
                        <div className="col-span-2">Block</div>
                        <div className="col-span-2">Proposer</div>
                        <div className="col-span-2">Status</div>
                        <div className="col-span-2 text-right">Time</div>
                    </div>

                    {/* Rows */}
                    {transactions.map((tx: any) => {
                        const txId = normalizeHex(tx.id || tx.transaction_hash);
                        const proposer = normalizeHex(tx.proposer || tx.proposer_address);
                        const status = tx.status || 'UNKNOWN';
                        const isSealed = status === 'SEALED';
                        const blockHeight = tx.block_height || tx.blockHeight;
                        const timestamp = tx.timestamp || tx.created_at;
                        const timeStr = timestamp ? formatRelativeTime(timestamp, nowTick) : '';

                        return (
                            <div
                                key={txId}
                                className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 px-4 py-4 border-b border-zinc-100 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors items-center"
                            >
                                <div className="col-span-4 flex items-center gap-2">
                                    <Clock className="h-4 w-4 text-indigo-500 flex-shrink-0" />
                                    <Link
                                        to={`/tx/${txId.replace('0x', '')}`}
                                        className="text-nothing-green-dark dark:text-nothing-green hover:underline text-xs truncate"
                                    >
                                        {formatMiddle(txId, 14, 10)}
                                    </Link>
                                </div>

                                <div className="col-span-2">
                                    {blockHeight ? (
                                        <Link
                                            to={`/blocks/${blockHeight}`}
                                            className="text-xs text-nothing-green-dark dark:text-nothing-green hover:underline"
                                        >
                                            #{blockHeight}
                                        </Link>
                                    ) : (
                                        <span className="text-xs text-zinc-400">-</span>
                                    )}
                                </div>

                                <div className="col-span-2">
                                    {proposer ? (
                                        <AddressLink address={proposer} prefixLen={8} suffixLen={4} size={14} />
                                    ) : (
                                        <span className="text-xs text-zinc-400">-</span>
                                    )}
                                </div>

                                <div className="col-span-2">
                                    <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold ${isSealed ? 'text-emerald-500' : 'text-red-500'}`}>
                                        {isSealed ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                                        {status}
                                    </span>
                                </div>

                                <div className="col-span-2 text-right">
                                    <span className="text-[10px] text-zinc-400">{timeStr}</span>
                                </div>
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

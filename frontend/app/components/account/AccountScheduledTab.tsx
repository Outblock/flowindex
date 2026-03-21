import { useState, useEffect, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import { resolveApiBaseUrl } from '../../api';
import { normalizeAddress } from './accountUtils';
import { Pagination } from '../Pagination';
import { formatRelativeTime } from '../../lib/time';

interface Props {
    address: string;
}

export function AccountScheduledTab({ address }: Props) {
    const normalizedAddress = normalizeAddress(address);
    const [txs, setTxs] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [hasNext, setHasNext] = useState(false);

    const loadPage = useCallback(async (page: number) => {
        setLoading(true);
        try {
            const offset = (page - 1) * 20;
            const baseUrl = await resolveApiBaseUrl();
            const url = `${baseUrl}/flow/account/${normalizedAddress}/scheduled-transaction?limit=20&offset=${offset}`;
            const res = await fetch(url);
            const payload: any = await res.json();
            const items = payload?.data ?? [];
            setTxs(items);
            setHasNext(items.length >= 20);
        } catch (err) {
            console.error('Failed to load scheduled transactions', err);
        } finally {
            setLoading(false);
        }
    }, [normalizedAddress]);

    useEffect(() => {
        setTxs([]);
        setCurrentPage(1);
        setHasNext(false);
        loadPage(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [address]);

    useEffect(() => {
        if (currentPage > 1) loadPage(currentPage);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPage]);

    return (
        <div>
            <div className="overflow-x-auto min-h-[200px] relative">
                {loading && txs.length === 0 && (
                    <div className="absolute inset-0 bg-white/50 dark:bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                        <div className="w-8 h-8 border-2 border-dashed border-zinc-900 dark:border-white rounded-full animate-spin" />
                    </div>
                )}

                {txs.length > 0 && (
                    <div className="space-y-0">
                        {txs.map((tx) => (
                            <Link
                                key={`sched:${tx.scheduled_id}`}
                                to="/scheduled/$id"
                                params={{ id: String(tx.scheduled_id) }}
                                className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 text-sm">
                                        <span className="font-mono text-xs text-zinc-600 dark:text-zinc-400">#{tx.scheduled_id}</span>
                                        <span className={`text-xs px-1.5 py-0.5 rounded-sm font-medium ${
                                            tx.status === 'EXECUTED' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                                            tx.status === 'CANCELED' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                                            'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                        }`}>{tx.status}</span>
                                        <span className={`text-xs px-1.5 py-0.5 rounded-sm ${
                                            tx.priority === 0 ? 'bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400' :
                                            tx.priority === 1 ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400' :
                                            'bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400'
                                        }`}>{tx.priority_label}</span>
                                        <span className="text-xs text-zinc-500 dark:text-zinc-500 truncate">{tx.handler_contract}</span>
                                    </div>
                                    <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                                        <span>Fee: {tx.fees} FLOW</span>
                                        <span>Effort: {tx.execution_effort}</span>
                                        {tx.scheduled_at && <span>Scheduled: {formatRelativeTime(tx.scheduled_at)}</span>}
                                        {tx.executed_at && <span>Executed: {formatRelativeTime(tx.executed_at)}</span>}
                                    </div>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}

                {txs.length === 0 && !loading && (
                    <div className="text-center text-zinc-500 italic py-8">No scheduled transactions found</div>
                )}
            </div>

            {(txs.length > 0 || currentPage > 1) && (
                <Pagination
                    currentPage={currentPage}
                    onPageChange={setCurrentPage}
                    hasNext={hasNext}
                />
            )}
        </div>
    );
}

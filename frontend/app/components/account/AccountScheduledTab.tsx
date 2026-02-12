import { useState, useEffect, useCallback } from 'react';
import { resolveApiBaseUrl } from '../../api';
import { normalizeAddress } from './accountUtils';
import { ActivityRow, dedup } from './AccountActivityTab';
import { Pagination } from '../Pagination';

interface Props {
    address: string;
}

export function AccountScheduledTab({ address }: Props) {
    const normalizedAddress = normalizeAddress(address);
    const [txs, setTxs] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [expandedTxId, setExpandedTxId] = useState<string | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [cursors, setCursors] = useState<Record<number, string>>({ 1: '' });
    const [hasNext, setHasNext] = useState(false);

    const loadPage = useCallback(async (page: number) => {
        setLoading(true);
        setExpandedTxId(null);
        try {
            const cursorValue = cursors[page] ?? '';
            const baseUrl = await resolveApiBaseUrl();
            const url = `${baseUrl}/accounts/${normalizedAddress}/scheduled-transactions?cursor=${encodeURIComponent(cursorValue)}&limit=20`;
            const res = await fetch(url);
            const payload: any = await res.json();
            const items = payload?.items ?? (Array.isArray(payload) ? payload : []);
            const mapped = items.map((tx: any) => ({
                ...tx,
                payer: tx.payer_address || tx.payer || tx.proposer_address,
                proposer: tx.proposer_address || tx.proposer,
                blockHeight: tx.block_height,
            }));
            setTxs(dedup(mapped));
            const next = payload?.next_cursor ?? '';
            if (next) {
                setCursors(prev => ({ ...prev, [page + 1]: next }));
                setHasNext(true);
            } else {
                setHasNext(false);
            }
        } catch (err) {
            console.error('Failed to load scheduled transactions', err);
        } finally {
            setLoading(false);
        }
    }, [cursors, normalizedAddress]);

    useEffect(() => {
        setTxs([]);
        setCurrentPage(1);
        setCursors({ 1: '' });
        setHasNext(false);
        setExpandedTxId(null);
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
                            <ActivityRow
                                key={tx.id}
                                tx={tx}
                                address={normalizedAddress}
                                expanded={expandedTxId === tx.id}
                                onToggle={() => setExpandedTxId(prev => prev === tx.id ? null : tx.id)}
                            />
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

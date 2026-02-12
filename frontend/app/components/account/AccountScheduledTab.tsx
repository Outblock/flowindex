import { useState, useEffect } from 'react';
import { resolveApiBaseUrl } from '../../api';
import { normalizeAddress } from './accountUtils';
import { ActivityRow, dedup } from './AccountActivityTab';

interface Props {
    address: string;
}

export function AccountScheduledTab({ address }: Props) {
    const normalizedAddress = normalizeAddress(address);
    const [txs, setTxs] = useState<any[]>([]);
    const [cursor, setCursor] = useState('');
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(false);
    const [expandedTxId, setExpandedTxId] = useState<string | null>(null);

    const loadScheduledTransactions = async (cursorValue: string, append: boolean) => {
        setLoading(true);
        try {
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
            setTxs(append ? prev => dedup([...prev, ...mapped]) : dedup(mapped));
            const next = payload?.next_cursor ?? '';
            setCursor(next);
            setHasMore(!!next);
        } catch (err) {
            console.error('Failed to load scheduled transactions', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        setTxs([]);
        setCursor('');
        setHasMore(false);
        setExpandedTxId(null);
        loadScheduledTransactions('', false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [address]);

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
                        {hasMore && (
                            <div className="text-center py-3">
                                <button
                                    onClick={() => loadScheduledTransactions(cursor, true)}
                                    disabled={loading}
                                    className="px-4 py-2 text-xs border border-zinc-200 dark:border-white/10 rounded-sm hover:bg-zinc-100 dark:hover:bg-white/5 disabled:opacity-50"
                                >
                                    {loading ? 'Loading...' : 'Load More'}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {txs.length === 0 && !loading && (
                    <div className="text-center text-zinc-500 italic py-8">No scheduled transactions found</div>
                )}
            </div>
        </div>
    );
}

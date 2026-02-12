import { useState, useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import { getFlowV1NftTransfer } from '../../api/gen/find';
import { normalizeAddress, formatShort } from './accountUtils';

interface Props {
    address: string;
}

export function AccountNFTTransfersTab({ address }: Props) {
    const normalizedAddress = normalizeAddress(address);

    const [transfers, setTransfers] = useState<any[]>([]);
    const [cursor, setCursor] = useState('');
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(false);

    const loadTransfers = async (cursorValue: string, append: boolean) => {
        setLoading(true);
        try {
            const offset = cursorValue ? parseInt(cursorValue, 10) : 0;
            await ensureHeyApiConfigured();
            const res = await getFlowV1NftTransfer({ query: { address: normalizedAddress, offset, limit: 20 } });
            const payload: any = res.data;
            const items = payload?.data ?? [];
            setTransfers(append ? prev => [...prev, ...items] : items);
            const nextOffset = items.length >= 20 ? String(offset + 20) : '';
            setCursor(nextOffset);
            setHasMore(!!nextOffset);
        } catch (err) {
            console.error('Failed to load NFT transfers', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        setTransfers([]);
        setCursor('');
        setHasMore(false);
        loadTransfers('', false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [address]);

    return (
        <div>
            <h2 className="text-zinc-900 dark:text-white text-sm uppercase tracking-widest mb-6 border-b border-zinc-100 dark:border-white/5 pb-2">
                NFT Transfers
            </h2>
            <div className="overflow-x-auto min-h-[200px] relative">
                {loading && transfers.length === 0 && (
                    <div className="absolute inset-0 bg-white/50 dark:bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                        <div className="w-8 h-8 border-2 border-dashed border-zinc-900 dark:border-white rounded-full animate-spin" />
                    </div>
                )}
                {transfers.length > 0 ? (
                    <table className="w-full text-left text-xs">
                        <thead>
                            <tr className="border-b border-zinc-200 dark:border-white/5 text-zinc-500 uppercase tracking-wider bg-zinc-50 dark:bg-white/5">
                                <th className="p-4 font-normal">NFT ID</th>
                                <th className="p-4 font-normal">Collection</th>
                                <th className="p-4 font-normal">From</th>
                                <th className="p-4 font-normal">To</th>
                                <th className="p-4 font-normal text-right">Block</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                            {transfers.map((tx: any, i: number) => (
                                <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                                    <td className="p-4 font-mono">{tx.nft_id}</td>
                                    <td className="p-4 font-mono text-zinc-500">{tx.type_id || '—'}</td>
                                    <td className="p-4">
                                        {tx.from_address ? <Link to={`/accounts/${normalizeAddress(tx.from_address)}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(tx.from_address)}</Link> : '—'}
                                    </td>
                                    <td className="p-4">
                                        {tx.to_address ? <Link to={`/accounts/${normalizeAddress(tx.to_address)}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(tx.to_address)}</Link> : '—'}
                                    </td>
                                    <td className="p-4 text-right text-zinc-500">{tx.block_height ?? '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : !loading ? (
                    <div className="text-center text-zinc-500 italic py-8">No NFT transfers found</div>
                ) : null}
            </div>
            {hasMore && (
                <div className="text-center py-3">
                    <button onClick={() => loadTransfers(cursor, true)} disabled={loading} className="px-4 py-2 text-xs border border-zinc-200 dark:border-white/10 rounded-sm hover:bg-zinc-100 dark:hover:bg-white/5 disabled:opacity-50">
                        {loading ? 'Loading...' : 'Load More'}
                    </button>
                </div>
            )}
        </div>
    );
}

import { useState, useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import { getFlowV1AccountByAddressFtTransfer } from '../../api/gen/find';
import { normalizeAddress } from './accountUtils';
import { AddressLink } from '../AddressLink';
import { UsdValue } from '../UsdValue';

interface Props {
    address: string;
}

function timeAgo(ts: string): string {
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 0) return 'just now';
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
}

function formatDateTime(ts: string): string {
    const d = new Date(ts);
    const mon = d.toLocaleString('en-US', { month: 'short' });
    const day = d.getDate();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${mon} ${day} ${hh}:${mm}`;
}

function formatTxHash(hash: string): string {
    if (!hash) return '';
    const h = hash.startsWith('0x') ? hash : `0x${hash}`;
    if (h.length <= 18) return h;
    return `${h.slice(0, 10)}...${h.slice(-6)}`;
}

export function AccountFTTransfersTab({ address }: Props) {
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
            const res = await getFlowV1AccountByAddressFtTransfer({ path: { address: normalizedAddress }, query: { offset, limit: 20 } });
            const payload: any = res.data;
            const items = payload?.data ?? [];
            setTransfers(append ? prev => [...prev, ...items] : items);
            const nextOffset = items.length >= 20 ? String(offset + 20) : '';
            setCursor(nextOffset);
            setHasMore(!!nextOffset);
        } catch (err) {
            console.error('Failed to load FT transfers', err);
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
                FT Transfers
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
                                <th className="p-4 font-normal">Token</th>
                                <th className="p-4 font-normal">Amount</th>
                                <th className="p-4 font-normal">From</th>
                                <th className="p-4 font-normal">To</th>
                                <th className="p-4 font-normal text-right">Time</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                            {transfers.map((tx: any, i: number) => {
                                const token = tx.token ?? {};
                                const logo = token.logo;
                                const name = token.name || token.symbol || tx.token_id || '—';
                                const symbol = token.symbol || '';
                                return (
                                    <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                                        <td className="p-4">
                                            <div className="flex items-center gap-2">
                                                {logo ? (
                                                    <img src={logo} alt={name} className="w-5 h-5 rounded-full object-cover flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                                ) : (
                                                    <div className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-white/10 flex items-center justify-center flex-shrink-0 text-[9px] font-bold text-zinc-500">
                                                        {(symbol || name).charAt(0).toUpperCase()}
                                                    </div>
                                                )}
                                                <span className="font-medium text-zinc-900 dark:text-white">{name}</span>
                                                {symbol && symbol !== name && (
                                                    <span className="text-zinc-400 text-[10px] uppercase">{symbol}</span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex flex-col">
                                                <span className={`font-mono ${tx.direction === 'in' ? 'text-emerald-600 dark:text-emerald-400' : tx.direction === 'out' ? 'text-red-500 dark:text-red-400' : 'text-zinc-900 dark:text-white'}`}>
                                                    {tx.direction === 'in' ? '+' : tx.direction === 'out' ? '-' : ''}
                                                    {tx.amount != null ? Number(tx.amount).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—'}
                                                    {symbol ? ` ${symbol}` : ''}
                                                </span>
                                                <UsdValue value={tx.usd_value} className="text-[10px]" />
                                            </div>
                                        </td>
                                        <td className="p-4 align-middle">
                                            <div className="flex items-center">
                                                {tx.sender ? <AddressLink address={tx.sender} /> : '—'}
                                            </div>
                                        </td>
                                        <td className="p-4 align-middle">
                                            <div className="flex items-center">
                                                {tx.receiver ? <AddressLink address={tx.receiver} /> : '—'}
                                            </div>
                                        </td>
                                        <td className="p-4 text-right align-middle">
                                            <div className="flex flex-col items-end gap-0.5">
                                                {tx.timestamp ? (
                                                    <span className="text-zinc-700 dark:text-zinc-300">
                                                        {formatDateTime(tx.timestamp)}{' '}
                                                        <span className="text-zinc-400">| {timeAgo(tx.timestamp)}</span>
                                                    </span>
                                                ) : null}
                                                <span className="text-zinc-400 text-[10px]">
                                                    #{tx.block_height ?? '—'}
                                                    {tx.transaction_hash ? (
                                                        <>{' | '}<Link to={`/transactions/${tx.transaction_hash}` as any} className="hover:underline text-nothing-green-dark dark:text-nothing-green">tx:{formatTxHash(tx.transaction_hash)}</Link></>
                                                    ) : null}
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                ) : !loading ? (
                    <div className="text-center text-zinc-500 italic py-8">No FT transfers found</div>
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

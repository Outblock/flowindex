import { useState, useEffect, useMemo } from 'react';
import { List, Calendar } from 'lucide-react';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import { getFlowV1AccountByAddressFtTransfer } from '../../api/gen/find';
import { normalizeAddress } from './accountUtils';
import { TransferRow } from '../TransferRow';

type ViewMode = 'pages' | 'timeline';

interface Props {
    address: string;
}

function getTimeSection(timestamp: string, now: Date): string {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return 'Unknown';
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (d >= today) return 'Today';
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 6);
    if (d >= weekAgo) return 'This Week';
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    if (d >= monthStart) return 'Earlier This Month';
    return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeCadenceTransfer(tx: any, viewedAddress: string) {
    const token = tx.token ?? {};
    const symbol = token.symbol || token.name || '';
    const amount = tx.amount != null ? Number(tx.amount).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '0';
    const direction: 'in' | 'out' | 'self' = tx.direction === 'out' ? 'out' : 'in';
    const senderNorm = tx.sender?.toLowerCase().replace(/^0x/, '') || '';
    const receiverNorm = tx.receiver?.toLowerCase().replace(/^0x/, '') || '';
    const viewedNorm = viewedAddress.toLowerCase().replace(/^0x/, '');

    let counterpartyAddress = direction === 'in' ? (tx.sender || '') : (tx.receiver || '');
    let counterpartyRole: 'from' | 'to' = direction === 'in' ? 'from' : 'to';

    // Handle self-transfers
    if (senderNorm === viewedNorm && receiverNorm === viewedNorm) {
        counterpartyAddress = tx.receiver || '';
        counterpartyRole = 'to';
    }

    return {
        direction,
        amount,
        tokenSymbol: symbol,
        tokenIcon: token.logo || null,
        counterpartyAddress,
        counterpartyRole,
        txHash: tx.transaction_hash || '',
        timestamp: tx.timestamp || '',
        blockNumber: tx.block_height,
        txLinkPrefix: '/transactions/',
        usdValue: tx.usd_value ?? null,
    };
}

export function AccountFTTransfersTab({ address }: Props) {
    const normalizedAddress = normalizeAddress(address);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [transfers, setTransfers] = useState<any[]>([]);
    const [cursor, setCursor] = useState('');
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('timeline');

    const loadTransfers = async (cursorValue: string, append: boolean) => {
        setLoading(true);
        try {
            const offset = cursorValue ? parseInt(cursorValue, 10) : 0;
            await ensureHeyApiConfigured();
            const res = await getFlowV1AccountByAddressFtTransfer({ path: { address: normalizedAddress }, query: { offset, limit: 20 } });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    // Timeline grouping
    const timeGroups = useMemo(() => {
        if (viewMode !== 'timeline') return null;
        const now = new Date();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const groups: { label: string; items: any[] }[] = [];
        let currentLabel = '';
        for (const item of transfers) {
            const label = getTimeSection(item.timestamp || '', now);
            if (label !== currentLabel) {
                groups.push({ label, items: [item] });
                currentLabel = label;
            } else {
                groups[groups.length - 1].items.push(item);
            }
        }
        return groups;
    }, [transfers, viewMode]);

    return (
        <div>
            {/* View Mode Toggle */}
            <div className="flex items-center gap-1 mb-4">
                <button
                    onClick={() => setViewMode('pages')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                        viewMode === 'pages'
                            ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-sm'
                            : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                    }`}
                >
                    <List className="h-3 w-3" />
                    Pages
                </button>
                <button
                    onClick={() => setViewMode('timeline')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
                        viewMode === 'timeline'
                            ? 'bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 shadow-sm'
                            : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                    }`}
                >
                    <Calendar className="h-3 w-3" />
                    Timeline
                </button>
            </div>

            {/* Loading skeleton */}
            {loading && transfers.length === 0 && (
                <div className="space-y-0">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="flex items-start gap-3 p-4 border-b border-zinc-100 dark:border-white/5">
                            <div className="w-9 h-9 rounded-lg bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
                            <div className="flex-1 space-y-2">
                                <div className="h-3.5 w-48 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
                                <div className="h-3 w-72 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
                            </div>
                            <div className="h-3 w-12 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
                        </div>
                    ))}
                </div>
            )}

            {/* Empty state */}
            {!loading && transfers.length === 0 && (
                <div className="text-center text-zinc-500 italic py-8">No FT transfers found</div>
            )}

            {/* Timeline View */}
            {transfers.length > 0 && viewMode === 'timeline' && timeGroups && (
                <div>
                    {timeGroups.map((group) => (
                        <div key={group.label}>
                            <div className="sticky top-14 z-10 bg-zinc-100 dark:bg-zinc-800/80 backdrop-blur-sm px-4 py-1.5">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{group.label}</span>
                            </div>
                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                            {group.items.map((tx: any, idx: number) => {
                                const props = normalizeCadenceTransfer(tx, normalizedAddress);
                                return <TransferRow key={`${props.txHash}-${idx}`} {...props} />;
                            })}
                        </div>
                    ))}
                </div>
            )}

            {/* Pages View */}
            {transfers.length > 0 && viewMode === 'pages' && (
                <div>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {transfers.map((tx: any, idx: number) => {
                        const props = normalizeCadenceTransfer(tx, normalizedAddress);
                        return <TransferRow key={`${props.txHash}-${idx}`} {...props} />;
                    })}
                </div>
            )}

            {/* Load More */}
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

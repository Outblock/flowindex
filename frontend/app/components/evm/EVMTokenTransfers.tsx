import { useState, useEffect, useCallback, useMemo } from 'react';
import { List, Calendar } from 'lucide-react';
import { getEVMAddressTokenTransfers, getEVMTransactionTokenTransfers } from '@/api/evm';
import { formatWei } from '@/lib/evmUtils';
import { TransferRow } from '@/components/TransferRow';
import { LoadMorePagination } from '@/components/LoadMorePagination';
import type { BSTokenTransfer, BSPageParams } from '@/types/blockscout';

type ViewMode = 'pages' | 'timeline';

interface EVMTokenTransfersProps {
    address?: string;
    txHash?: string;
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

function normalizeTransfer(transfer: BSTokenTransfer, viewedAddress?: string) {
    const decimals = transfer.token.decimals ? parseInt(transfer.token.decimals, 10) : 18;
    const amount = transfer.total?.value ? formatWei(transfer.total.value, decimals) : '0';
    const txHash = transfer.tx_hash || transfer.transaction_hash || '';
    const fromAddr = transfer.from?.hash?.toLowerCase() || '';
    const toAddr = transfer.to?.hash?.toLowerCase() || '';
    const viewed = viewedAddress?.toLowerCase() || '';

    let direction: 'in' | 'out' | 'self' = 'in';
    let counterpartyAddress = fromAddr;
    let counterpartyRole: 'from' | 'to' = 'from';

    if (viewed) {
        if (fromAddr === viewed && toAddr === viewed) {
            direction = 'self';
            counterpartyAddress = toAddr;
            counterpartyRole = 'to';
        } else if (fromAddr === viewed) {
            direction = 'out';
            counterpartyAddress = toAddr;
            counterpartyRole = 'to';
        } else {
            direction = 'in';
            counterpartyAddress = fromAddr;
            counterpartyRole = 'from';
        }
    }

    return {
        direction,
        amount,
        tokenSymbol: transfer.token.symbol || 'Unknown',
        tokenIcon: transfer.token.icon_url,
        typeBadge: transfer.token.type,
        counterpartyAddress,
        counterpartyRole,
        txHash,
        timestamp: transfer.timestamp,
        blockNumber: transfer.block_number,
    };
}

export function EVMTokenTransfers({ address, txHash }: EVMTokenTransfersProps) {
    const [items, setItems] = useState<BSTokenTransfer[]>([]);
    const [nextPage, setNextPage] = useState<BSPageParams | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>('timeline');

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);
        setItems([]);
        setNextPage(null);

        const fetchFn = address
            ? getEVMAddressTokenTransfers(address)
            : txHash
                ? getEVMTransactionTokenTransfers(txHash)
                : null;

        if (!fetchFn) {
            setLoading(false);
            setError('No address or transaction hash provided');
            return;
        }

        fetchFn
            .then((res) => {
                if (cancelled) return;
                setItems(res.items);
                setNextPage(res.next_page_params);
            })
            .catch((e) => {
                if (cancelled) return;
                setError(e?.message || 'Failed to load token transfers');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [address, txHash]);

    const loadMore = useCallback(async (params: BSPageParams) => {
        setLoadingMore(true);
        try {
            const res = address
                ? await getEVMAddressTokenTransfers(address, params)
                : await getEVMTransactionTokenTransfers(txHash!, params);
            setItems((prev) => [...prev, ...res.items]);
            setNextPage(res.next_page_params);
        } catch (e: any) {
            setError(e?.message || 'Failed to load more');
        } finally {
            setLoadingMore(false);
        }
    }, [address, txHash]);

    // Timeline grouping
    const timeGroups = useMemo(() => {
        if (viewMode !== 'timeline') return null;
        const now = new Date();
        const groups: { label: string; items: BSTokenTransfer[] }[] = [];
        let currentLabel = '';
        for (const item of items) {
            const label = getTimeSection(item.timestamp, now);
            if (label !== currentLabel) {
                groups.push({ label, items: [item] });
                currentLabel = label;
            } else {
                groups[groups.length - 1].items.push(item);
            }
        }
        return groups;
    }, [items, viewMode]);

    if (loading) {
        return (
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
        );
    }

    if (error) {
        return (
            <div className="text-center py-12 text-zinc-500">
                <p className="text-sm">{error}</p>
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className="text-center py-12 text-zinc-500">
                <p className="text-sm">No token transfers found.</p>
            </div>
        );
    }

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

            {/* Timeline View */}
            {viewMode === 'timeline' && timeGroups && (
                <div>
                    {timeGroups.map((group) => (
                        <div key={group.label}>
                            <div className="sticky top-14 z-10 bg-zinc-100 dark:bg-zinc-800/80 backdrop-blur-sm px-4 py-1.5">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{group.label}</span>
                            </div>
                            {group.items.map((transfer, idx) => {
                                const props = normalizeTransfer(transfer, address);
                                return (
                                    <TransferRow
                                        key={`${props.txHash}-${transfer.log_index}-${idx}`}
                                        {...props}
                                    />
                                );
                            })}
                        </div>
                    ))}
                </div>
            )}

            {/* Pages View */}
            {viewMode === 'pages' && (
                <div>
                    {items.map((transfer, idx) => {
                        const props = normalizeTransfer(transfer, address);
                        return (
                            <TransferRow
                                key={`${props.txHash}-${transfer.log_index}-${idx}`}
                                {...props}
                            />
                        );
                    })}
                </div>
            )}

            <LoadMorePagination
                nextPageParams={nextPage}
                isLoading={loadingMore}
                onLoadMore={loadMore}
            />
        </div>
    );
}

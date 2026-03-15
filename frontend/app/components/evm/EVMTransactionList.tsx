import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, List, Calendar } from 'lucide-react';
import { getEVMAddressTransactions } from '@/api/evm';
import { formatRelativeTime } from '@/lib/time';
import { formatWei, truncateHash, txStatusLabel } from '@/lib/evmUtils';
import { AddressLink } from '@/components/AddressLink';
import { LoadMorePagination } from '@/components/LoadMorePagination';
import type { BSTransaction, BSPageParams } from '@/types/blockscout';

type ViewMode = 'pages' | 'timeline';

interface EVMTransactionListProps {
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

function TxRow({ tx, viewedAddress }: { tx: BSTransaction; viewedAddress: string }) {
    const fromAddr = tx.from?.hash?.toLowerCase() || '';
    const toAddr = tx.to?.hash?.toLowerCase() || '';
    const viewed = viewedAddress.toLowerCase();
    const status = txStatusLabel(tx.status);
    const method = tx.decoded_input?.method_call?.split('(')[0] || tx.method || '';
    const value = formatWei(tx.value);
    const timeStr = formatRelativeTime(tx.timestamp, Date.now());

    let direction: 'in' | 'out' | 'self' = 'in';
    let DirIcon = ArrowDownLeft;
    let dirColor = 'text-emerald-500';
    let dirLabel = 'Received';
    let counterpartyAddr = fromAddr;
    let counterpartyRole = 'from';

    if (fromAddr === viewed && toAddr === viewed) {
        direction = 'self';
        DirIcon = ArrowLeftRight;
        dirColor = 'text-zinc-500';
        dirLabel = 'Self';
        counterpartyAddr = toAddr;
        counterpartyRole = 'to';
    } else if (fromAddr === viewed) {
        direction = 'out';
        DirIcon = ArrowUpRight;
        dirColor = 'text-red-500';
        dirLabel = 'Sent';
        counterpartyAddr = toAddr;
        counterpartyRole = 'to';
    } else {
        counterpartyAddr = fromAddr;
        counterpartyRole = 'from';
    }

    const iconBg = direction === 'out'
        ? 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20'
        : direction === 'self'
            ? 'bg-zinc-100 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700'
            : 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20';

    return (
        <div className="flex items-start gap-3 p-3 md:p-4 border-b border-zinc-100 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
            {/* Direction Icon */}
            <div className={`flex-shrink-0 w-9 h-9 rounded-lg border flex items-center justify-center ${iconBg}`}>
                <DirIcon className={`h-4 w-4 ${dirColor}`} />
            </div>

            {/* Main Content */}
            <div className="flex-1 min-w-0">
                {/* Line 1: Direction + Value + Method */}
                <div className="flex items-center gap-2 mb-0.5">
                    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${dirColor}`}>
                        {dirLabel}
                    </span>
                    {value !== '0' && (
                        <span className="font-mono text-xs font-medium text-zinc-900 dark:text-zinc-100">
                            {value} <span className="text-zinc-500">FLOW</span>
                        </span>
                    )}
                    {method && (
                        <span className="text-[9px] px-1.5 py-px bg-zinc-100 dark:bg-zinc-800 text-zinc-500 uppercase truncate max-w-[120px]" title={method}>
                            {method}
                        </span>
                    )}
                    {status.label !== 'Success' && (
                        <span className={`text-[9px] px-1.5 py-px uppercase font-bold ${status.color}`}>
                            {status.label}
                        </span>
                    )}
                </div>

                {/* Line 2: Counterparty + TX hash */}
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-zinc-500">
                    {counterpartyAddr && tx.to && (
                        <>
                            <span className="capitalize">{counterpartyRole}</span>
                            <AddressLink address={counterpartyAddr} prefixLen={6} suffixLen={4} size={14} showTag={false} showBlockscoutLink={false} />
                            <span className="text-zinc-300 dark:text-zinc-600">·</span>
                        </>
                    )}
                    {!tx.to && (
                        <>
                            <span className="text-zinc-400 italic">Contract Create</span>
                            <span className="text-zinc-300 dark:text-zinc-600">·</span>
                        </>
                    )}
                    <span>tx:</span>
                    <Link
                        to={`/txs/${tx.hash}` as any}
                        className="text-[#5353D3] dark:text-[#7B7BE8] hover:underline font-mono"
                    >
                        {truncateHash(tx.hash)}
                    </Link>
                </div>
            </div>

            {/* Right: Time + Block */}
            <div className="flex-shrink-0 text-right">
                <p className="text-xs text-zinc-500" title={tx.timestamp}>{timeStr}</p>
                <p className="text-[10px] text-zinc-400 mt-0.5">
                    <Link to={`/blocks/${tx.block_number}` as any} className="hover:underline">
                        #{tx.block_number.toLocaleString()}
                    </Link>
                </p>
            </div>
        </div>
    );
}

export function EVMTransactionList({ address }: EVMTransactionListProps) {
    const [items, setItems] = useState<BSTransaction[]>([]);
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

        getEVMAddressTransactions(address)
            .then((res) => {
                if (cancelled) return;
                setItems(res.items);
                setNextPage(res.next_page_params);
            })
            .catch((e) => {
                if (cancelled) return;
                setError(e?.message || 'Failed to load transactions');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [address]);

    const loadMore = useCallback(async (params: BSPageParams) => {
        setLoadingMore(true);
        try {
            const res = await getEVMAddressTransactions(address, params);
            setItems((prev) => [...prev, ...res.items]);
            setNextPage(res.next_page_params);
        } catch (e: any) {
            setError(e?.message || 'Failed to load more');
        } finally {
            setLoadingMore(false);
        }
    }, [address]);

    const timeGroups = useMemo(() => {
        if (viewMode !== 'timeline') return null;
        const now = new Date();
        const groups: { label: string; items: BSTransaction[] }[] = [];
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
                <p className="text-sm">No transactions found for this address.</p>
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
                            {group.items.map((tx) => (
                                <TxRow key={tx.hash} tx={tx} viewedAddress={address} />
                            ))}
                        </div>
                    ))}
                </div>
            )}

            {/* Pages View */}
            {viewMode === 'pages' && (
                <div>
                    {items.map((tx) => (
                        <TxRow key={tx.hash} tx={tx} viewedAddress={address} />
                    ))}
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

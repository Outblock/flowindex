import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import { resolveApiBaseUrl } from '../../api';
import {
    getFlowV1AccountByAddressTransaction,
    getFlowV1AccountByAddressFtTransfer,
    getFlowV1NftTransfer,
} from '../../api/gen/find';
import { Activity, ArrowDownLeft, ArrowUpRight, ArrowRightLeft, Repeat, Clock } from 'lucide-react';
import { normalizeAddress, formatShort } from './accountUtils';
import { formatRelativeTime } from '../../lib/time';
import {
    ActivityRow,
    TokenIcon,
    extractLogoUrl,
    formatTokenName,
    deriveActivityType,
    dedup,
    type TransferSummary,
} from '../TransactionRow';

type FilterMode = 'all' | 'ft' | 'nft' | 'scheduled';

interface Props {
    address: string;
    initialTransactions: any[];
    initialNextCursor?: string;
    subtab?: FilterMode;
    onSubTabChange?: (subtab: FilterMode | undefined) => void;
}

export { ActivityRow, dedup };

export function AccountActivityTab({ address, initialTransactions, initialNextCursor, subtab, onSubTabChange }: Props) {
    const normalizedAddress = normalizeAddress(address);
    const filterMode: FilterMode = subtab || 'all';
    const setFilterMode = (mode: FilterMode) => {
        onSubTabChange?.(mode === 'all' ? undefined : mode);
    };
    const [expandedTxId, setExpandedTxId] = useState<string | null>(null);
    const didFetchRef = useRef(false);

    // Transactions state
    const [transactions, setTransactions] = useState<any[]>(() => dedup(initialTransactions));
    const [currentPage, setCurrentPage] = useState(1);
    const [txLoading, setTxLoading] = useState(false);
    const [txCursors, setTxCursors] = useState<Record<number, string>>(() => {
        const init: Record<number, string> = { 1: '' };
        if (initialNextCursor) init[2] = initialNextCursor;
        return init;
    });
    const [txHasNext, setTxHasNext] = useState(!!initialNextCursor);

    // FT transfers state (lazy-loaded)
    const [ftTransfers, setFtTransfers] = useState<any[]>([]);
    const [ftCursor, setFtCursor] = useState('');
    const [ftHasMore, setFtHasMore] = useState(false);
    const [ftLoading, setFtLoading] = useState(false);

    // NFT transfers state (lazy-loaded)
    const [nftTransfers, setNftTransfers] = useState<any[]>([]);
    const [nftCursor, setNftCursor] = useState('');
    const [nftHasMore, setNftHasMore] = useState(false);
    const [nftLoading, setNftLoading] = useState(false);

    // Scheduled transactions state (lazy-loaded)
    const [scheduledTxs, setScheduledTxs] = useState<any[]>([]);
    const [scheduledCursor, setScheduledCursor] = useState('');
    const [scheduledHasMore, setScheduledHasMore] = useState(false);
    const [scheduledLoading, setScheduledLoading] = useState(false);

    // Reset only when address changes (not on every initialTransactions reference change)
    const prevAddressRef = useRef(normalizedAddress);
    useEffect(() => {
        const addressChanged = prevAddressRef.current !== normalizedAddress;
        prevAddressRef.current = normalizedAddress;

        // Always sync transaction data from loader
        const dedupedTxs = dedup(initialTransactions);
        setTransactions(dedupedTxs);
        setCurrentPage(1);
        const init: Record<number, string> = { 1: '' };
        if (initialNextCursor) init[2] = initialNextCursor;
        setTxCursors(init);
        setTxHasNext(!!initialNextCursor);
        setExpandedTxId(null);

        // Only reset subtab data when the address actually changes
        if (addressChanged) {
            setFtTransfers([]);
            setFtCursor('');
            setFtHasMore(false);
            setNftTransfers([]);
            setNftCursor('');
            setNftHasMore(false);
            setScheduledTxs([]);
            setScheduledCursor('');
            setScheduledHasMore(false);
        }

        didFetchRef.current = dedupedTxs.length > 0;
    }, [address, initialTransactions, initialNextCursor, normalizedAddress]);

    // --- Transactions ---
    const loadTransactions = useCallback(async (page: number) => {
        setTxLoading(true);
        setExpandedTxId(null);
        try {
            const offset = (page - 1) * 20;
            await ensureHeyApiConfigured();
            const txRes = await getFlowV1AccountByAddressTransaction({ path: { address: normalizedAddress }, query: { offset, limit: 20 } });
            const payload: any = txRes.data;
            const items = payload?.data ?? [];
            setTransactions(dedup(items.map((tx: any) => ({
                ...tx,
                payer: tx.payer_address || tx.payer || tx.proposer_address,
                proposer: tx.proposer_address || tx.proposer,
                blockHeight: tx.block_height,
            }))));
            if (items.length >= 20) {
                setTxCursors(prev => ({ ...prev, [page + 1]: String(offset + 20) }));
                setTxHasNext(true);
            } else {
                setTxHasNext(false);
            }
        } catch (err) {
            console.error('Failed to load transactions', err);
        } finally {
            setTxLoading(false);
        }
    }, [txCursors, normalizedAddress]);

    // Fallback: if loader didn't provide data (e.g., client-side nav failure), fetch page 1
    // Only fetch when viewing 'all' activity — subtabs have their own loaders
    useEffect(() => {
        if (!didFetchRef.current && !txLoading && filterMode === 'all') {
            didFetchRef.current = true;
            loadTransactions(1);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [normalizedAddress, filterMode]);

    useEffect(() => {
        if (currentPage > 1) loadTransactions(currentPage);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPage]);

    // --- FT Transfers (lazy) ---
    const loadFtTransfers = async (cursorValue: string, append: boolean) => {
        setFtLoading(true);
        try {
            const offset = cursorValue ? parseInt(cursorValue, 10) : 0;
            await ensureHeyApiConfigured();
            const res = await getFlowV1AccountByAddressFtTransfer({ path: { address: normalizedAddress }, query: { offset, limit: 20 } });
            const payload: any = res.data;
            const items = payload?.data ?? [];
            setFtTransfers(append ? prev => [...prev, ...items] : items);
            const nextOffset = items.length >= 20 ? String(offset + 20) : '';
            setFtCursor(nextOffset);
            setFtHasMore(!!nextOffset);
        } catch (err) {
            console.error('Failed to load FT transfers', err);
        } finally {
            setFtLoading(false);
        }
    };

    // --- NFT Transfers (lazy) ---
    const loadNftTransfers = async (cursorValue: string, append: boolean) => {
        setNftLoading(true);
        try {
            const offset = cursorValue ? parseInt(cursorValue, 10) : 0;
            await ensureHeyApiConfigured();
            const res = await getFlowV1NftTransfer({ query: { address: normalizedAddress, offset, limit: 20 } });
            const payload: any = res.data;
            const items = payload?.data ?? [];
            setNftTransfers(append ? prev => [...prev, ...items] : items);
            const nextOffset = items.length >= 20 ? String(offset + 20) : '';
            setNftCursor(nextOffset);
            setNftHasMore(!!nextOffset);
        } catch (err) {
            console.error('Failed to load NFT transfers', err);
        } finally {
            setNftLoading(false);
        }
    };

    // --- Scheduled Transactions (lazy) ---
    const loadScheduledTransactions = async (cursorValue: string, append: boolean) => {
        setScheduledLoading(true);
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
            setScheduledTxs(append ? prev => dedup([...prev, ...mapped]) : dedup(mapped));
            const next = payload?.next_cursor ?? '';
            setScheduledCursor(next);
            setScheduledHasMore(!!next);
        } catch (err) {
            console.error('Failed to load scheduled transactions', err);
        } finally {
            setScheduledLoading(false);
        }
    };

    // Auto-load dedicated transfer lists when filter switches
    useEffect(() => {
        if (filterMode === 'ft' && ftTransfers.length === 0 && !ftLoading) loadFtTransfers('', false);
        if (filterMode === 'nft' && nftTransfers.length === 0 && !nftLoading) loadNftTransfers('', false);
        if (filterMode === 'scheduled' && scheduledTxs.length === 0 && !scheduledLoading) loadScheduledTransactions('', false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filterMode, address]);

    // Filter the unified feed
    const filteredTransactions = useMemo(() => {
        if (filterMode === 'all') return transactions;
        return transactions.filter(tx => {
            const activity = deriveActivityType(tx);
            if (filterMode === 'ft') return activity.type === 'ft';
            if (filterMode === 'nft') return activity.type === 'nft';
            return true;
        });
    }, [transactions, filterMode]);

    const filters = [
        { id: 'all' as const, label: 'All Activity', icon: Activity },
        { id: 'ft' as const, label: 'FT Transfers', icon: ArrowRightLeft },
        { id: 'nft' as const, label: 'NFT Transfers', icon: Repeat },
        { id: 'scheduled' as const, label: 'Scheduled', icon: Clock },
    ];

    const isLoading = filterMode === 'all' ? txLoading : filterMode === 'ft' ? ftLoading : filterMode === 'nft' ? nftLoading : scheduledLoading;

    return (
        <div>
            {/* Filter toggles */}
            <div className="flex items-center gap-2 mb-4">
                {filters.map(({ id, label, icon: Icon }) => (
                    <button
                        key={id}
                        onClick={() => setFilterMode(id)}
                        className={`px-4 py-2 text-[10px] uppercase tracking-widest border transition-colors rounded-sm ${filterMode === id
                            ? 'border-nothing-green-dark dark:border-nothing-green text-zinc-900 dark:text-white bg-zinc-100 dark:bg-white/5'
                            : 'border-zinc-200 dark:border-white/10 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5'
                        }`}
                    >
                        <span className="flex items-center gap-2">
                            <Icon className={`h-3 w-3 ${filterMode === id ? 'text-nothing-green-dark dark:text-nothing-green' : ''}`} />
                            {label}
                        </span>
                    </button>
                ))}
            </div>

            {/* Pagination */}
            {filterMode === 'all' && (
                <div className="flex items-center justify-end mb-3">
                    <div className="flex items-center gap-2">
                        <button disabled={currentPage <= 1 || txLoading} onClick={() => setCurrentPage(prev => prev - 1)} className="px-2.5 py-1 text-[10px] border border-zinc-200 dark:border-white/10 rounded-sm disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors">Prev</button>
                        <span className="text-[10px] text-zinc-500 tabular-nums min-w-[4rem] text-center">Page {currentPage}</span>
                        <button disabled={!txHasNext || txLoading} onClick={() => setCurrentPage(prev => prev + 1)} className="px-2.5 py-1 text-[10px] border border-zinc-200 dark:border-white/10 rounded-sm disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors">Next</button>
                    </div>
                </div>
            )}

            {/* === Unified Activity Feed === */}
            <div className="overflow-x-auto min-h-[200px] relative">
                {isLoading && (filterMode === 'all' ? true : (filterMode === 'ft' ? ftTransfers.length === 0 : filterMode === 'nft' ? nftTransfers.length === 0 : scheduledTxs.length === 0)) && (
                    <div className="absolute inset-0 bg-white/50 dark:bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                        <div className="w-8 h-8 border-2 border-dashed border-zinc-900 dark:border-white rounded-full animate-spin" />
                    </div>
                )}

                {/* Dedicated FT transfer list */}
                {filterMode === 'ft' && ftTransfers.length > 0 && (
                    <div className="space-y-0">
                        {ftTransfers.map((tx: any, i: number) => {
                            const dir = tx.direction || (tx.from_address?.toLowerCase().includes(normalizedAddress.replace('0x', '')) ? 'withdraw' : 'deposit');
                            const isOut = dir === 'withdraw' || dir === 'out';
                            const tokenSymbol = tx.token?.symbol || tx.token?.name || formatTokenName(tx.token?.token || '');
                            const tokenLogo = tx.token?.logo;
                            const sender = tx.sender || tx.from_address;
                            const receiver = tx.receiver || tx.to_address;
                            const timeStr = tx.timestamp ? formatRelativeTime(tx.timestamp, Date.now()) : '';
                            return (
                                <div key={i} className="flex items-center gap-3 p-4 border-b border-zinc-100 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                                    {/* Token icon */}
                                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex items-center justify-center overflow-hidden">
                                        <TokenIcon logo={tokenLogo} symbol={tokenSymbol} size={28} />
                                        {!extractLogoUrl(tokenLogo) && <ArrowRightLeft className="h-3.5 w-3.5 text-emerald-500" />}
                                    </div>
                                    {/* Main content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${isOut ? 'text-red-500' : 'text-emerald-500'}`}>
                                                {isOut ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
                                                {isOut ? 'Sent' : 'Received'}
                                            </span>
                                            <span className="font-mono text-xs font-medium text-zinc-900 dark:text-zinc-100">
                                                {tx.amount != null ? Number(tx.amount).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '\u2014'}
                                            </span>
                                            <span className="text-xs text-zinc-500 font-medium">{tokenSymbol}</span>
                                            {tx.token?.token && (
                                                <Link to={`/contracts/${tx.token.token}` as any} className="text-[10px] text-zinc-400 hover:text-nothing-green-dark dark:hover:text-nothing-green font-mono ml-1">
                                                    {tx.token.token}
                                                </Link>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                                            {sender && (
                                                <span>From <Link to={`/accounts/${normalizeAddress(sender)}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(sender)}</Link></span>
                                            )}
                                            {sender && receiver && <span className="text-zinc-300 dark:text-zinc-600">&rarr;</span>}
                                            {receiver && (
                                                <span>To <Link to={`/accounts/${normalizeAddress(receiver)}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(receiver)}</Link></span>
                                            )}
                                            {tx.transaction_hash && (
                                                <>
                                                    <span className="text-zinc-300 dark:text-zinc-600 mx-0.5">|</span>
                                                    <Link to={`/tx/${tx.transaction_hash}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(tx.transaction_hash, 8, 6)}</Link>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    {/* Right side */}
                                    <div className="flex-shrink-0 text-right">
                                        <div className="text-[10px] text-zinc-400">{timeStr}</div>
                                        {tx.block_height && <div className="text-[10px] text-zinc-400 font-mono">#{tx.block_height}</div>}
                                    </div>
                                </div>
                            );
                        })}
                        {ftHasMore && (
                            <div className="text-center py-3">
                                <button onClick={() => loadFtTransfers(ftCursor, true)} disabled={ftLoading} className="px-4 py-2 text-xs border border-zinc-200 dark:border-white/10 rounded-sm hover:bg-zinc-100 dark:hover:bg-white/5 disabled:opacity-50">{ftLoading ? 'Loading...' : 'Load More'}</button>
                            </div>
                        )}
                    </div>
                )}

                {/* Dedicated NFT transfer list */}
                {filterMode === 'nft' && nftTransfers.length > 0 && (
                    <div className="space-y-0">
                        {nftTransfers.map((tx: any, i: number) => {
                            const dir = tx.direction || (tx.from_address?.toLowerCase().includes(normalizedAddress.replace('0x', '')) ? 'withdraw' : 'deposit');
                            const isOut = dir === 'withdraw' || dir === 'out';
                            const collectionName = tx.collection?.name || formatTokenName(tx.nft_type || '');
                            const collectionImage = tx.collection?.image;
                            const sender = tx.sender || tx.from_address;
                            const receiver = tx.receiver || tx.to_address;
                            const timeStr = tx.timestamp ? formatRelativeTime(tx.timestamp, Date.now()) : '';
                            return (
                                <div key={i} className="flex items-center gap-3 p-4 border-b border-zinc-100 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                                    {/* Collection icon */}
                                    <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 flex items-center justify-center overflow-hidden">
                                        <TokenIcon logo={collectionImage} symbol={collectionName} size={36} />
                                        {!extractLogoUrl(collectionImage) && <Repeat className="h-4 w-4 text-amber-500" />}
                                    </div>
                                    {/* Main content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${isOut ? 'text-red-500' : 'text-emerald-500'}`}>
                                                {isOut ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
                                                {isOut ? 'Sent' : 'Received'}
                                            </span>
                                            <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">{collectionName}</span>
                                            {tx.nft_id && <span className="text-xs text-zinc-500 font-mono">#{tx.nft_id}</span>}
                                        </div>
                                        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                                            {sender && (
                                                <span>From <Link to={`/accounts/${normalizeAddress(sender)}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(sender)}</Link></span>
                                            )}
                                            {sender && receiver && <span className="text-zinc-300 dark:text-zinc-600">&rarr;</span>}
                                            {receiver && (
                                                <span>To <Link to={`/accounts/${normalizeAddress(receiver)}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(receiver)}</Link></span>
                                            )}
                                            {tx.nft_type && (
                                                <>
                                                    <span className="text-zinc-300 dark:text-zinc-600 mx-0.5">|</span>
                                                    <Link to={`/contracts/${tx.nft_type}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono text-[10px]">{tx.nft_type}</Link>
                                                </>
                                            )}
                                            {tx.transaction_hash && (
                                                <>
                                                    <span className="text-zinc-300 dark:text-zinc-600 mx-0.5">|</span>
                                                    <Link to={`/tx/${tx.transaction_hash}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(tx.transaction_hash, 8, 6)}</Link>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    {/* Right side */}
                                    <div className="flex-shrink-0 text-right">
                                        <div className="text-[10px] text-zinc-400">{timeStr}</div>
                                        {tx.block_height && <div className="text-[10px] text-zinc-400 font-mono">#{tx.block_height}</div>}
                                    </div>
                                </div>
                            );
                        })}
                        {nftHasMore && (
                            <div className="text-center py-3">
                                <button onClick={() => loadNftTransfers(nftCursor, true)} disabled={nftLoading} className="px-4 py-2 text-xs border border-zinc-200 dark:border-white/10 rounded-sm hover:bg-zinc-100 dark:hover:bg-white/5 disabled:opacity-50">{nftLoading ? 'Loading...' : 'Load More'}</button>
                            </div>
                        )}
                    </div>
                )}

                {/* Scheduled transactions list */}
                {filterMode === 'scheduled' && scheduledTxs.length > 0 && (
                    <div className="space-y-0">
                        {scheduledTxs.map((tx) => (
                            <ActivityRow
                                key={tx.id}
                                tx={tx}
                                address={normalizedAddress}
                                expanded={expandedTxId === tx.id}
                                onToggle={() => setExpandedTxId(prev => prev === tx.id ? null : tx.id)}
                            />
                        ))}
                        {scheduledHasMore && (
                            <div className="text-center py-3">
                                <button onClick={() => loadScheduledTransactions(scheduledCursor, true)} disabled={scheduledLoading} className="px-4 py-2 text-xs border border-zinc-200 dark:border-white/10 rounded-sm hover:bg-zinc-100 dark:hover:bg-white/5 disabled:opacity-50">{scheduledLoading ? 'Loading...' : 'Load More'}</button>
                            </div>
                        )}
                    </div>
                )}

                {/* Empty states for dedicated views */}
                {filterMode === 'ft' && ftTransfers.length === 0 && !ftLoading && (
                    <div className="text-center text-zinc-500 italic py-8">No FT transfers found</div>
                )}
                {filterMode === 'nft' && nftTransfers.length === 0 && !nftLoading && (
                    <div className="text-center text-zinc-500 italic py-8">No NFT transfers found</div>
                )}
                {filterMode === 'scheduled' && scheduledTxs.length === 0 && !scheduledLoading && (
                    <div className="text-center text-zinc-500 italic py-8">No scheduled transactions found</div>
                )}

                {/* Unified timeline (filterMode === 'all') */}
                {filterMode === 'all' && filteredTransactions.length > 0 && (
                    <div className="space-y-0">
                        {filteredTransactions.map((tx) => (
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
                {filterMode === 'all' && filteredTransactions.length === 0 && !txLoading && (
                    <div className="text-center text-zinc-500 italic py-8">No transactions found</div>
                )}
            </div>
        </div>
    );
}

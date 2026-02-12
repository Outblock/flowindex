import { useState, useEffect, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import {
    getAccountsByAddressTransactions,
    getAccountsByAddressTokenTransfers,
    getAccountsByAddressNftTransfers,
} from '../../api/gen/core';
import { Activity, ArrowDownLeft, ArrowUpRight, ArrowRightLeft, Repeat, FileCode, Zap, Box } from 'lucide-react';
import { normalizeAddress, formatShort } from './accountUtils';
import { formatRelativeTime } from '../../lib/time';

interface Props {
    address: string;
    initialTransactions: any[];
}

type FilterMode = 'all' | 'ft' | 'nft';

interface TransferSummary {
    ft: { token: string; amount: string; direction: string }[];
    nft: { collection: string; count: number; direction: string }[];
}

function deriveActivityType(tx: any): { type: string; label: string; color: string; bgColor: string } {
    const tags: string[] = tx.tags || [];
    const imports: string[] = tx.contract_imports || [];
    const summary: TransferSummary | undefined = tx.transfer_summary;

    const tagsLower = tags.map(t => t.toLowerCase());
    const importsLower = imports.map(c => c.toLowerCase());

    if (tagsLower.some(t => t.includes('deploy') || t.includes('contract_added') || t.includes('contract_updated'))) {
        return { type: 'deploy', label: 'Deploy', color: 'text-blue-600 dark:text-blue-400', bgColor: 'border-blue-300 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/10' };
    }
    if (tagsLower.some(t => t.includes('evm')) || importsLower.some(c => c.includes('evm'))) {
        return { type: 'evm', label: 'EVM', color: 'text-purple-600 dark:text-purple-400', bgColor: 'border-purple-300 dark:border-purple-500/30 bg-purple-50 dark:bg-purple-500/10' };
    }
    if (summary?.nft && summary.nft.length > 0) {
        return { type: 'nft', label: 'NFT Transfer', color: 'text-amber-600 dark:text-amber-400', bgColor: 'border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10' };
    }
    if (summary?.ft && summary.ft.length > 0) {
        return { type: 'ft', label: 'FT Transfer', color: 'text-emerald-600 dark:text-emerald-400', bgColor: 'border-emerald-300 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10' };
    }
    if (imports.length > 0) {
        return { type: 'contract', label: 'Contract Call', color: 'text-zinc-600 dark:text-zinc-400', bgColor: 'border-zinc-300 dark:border-zinc-500/30 bg-zinc-50 dark:bg-zinc-500/10' };
    }
    return { type: 'tx', label: 'Transaction', color: 'text-zinc-500 dark:text-zinc-500', bgColor: 'border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5' };
}

function formatTokenName(identifier: string): string {
    if (!identifier) return '';
    const parts = identifier.split('.');
    return parts.length >= 3 ? parts[2] : identifier;
}

function buildSummaryLine(tx: any, normalizedAddress: string): string {
    const summary: TransferSummary | undefined = tx.transfer_summary;
    const imports: string[] = tx.contract_imports || [];
    const tags: string[] = tx.tags || [];

    // FT summary
    if (summary?.ft && summary.ft.length > 0) {
        const parts = summary.ft.map(f => {
            const name = formatTokenName(f.token);
            const direction = f.direction === 'out' ? 'Sent' : 'Received';
            return `${direction} ${Number(f.amount).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${name}`;
        });
        return parts.join(', ');
    }

    // NFT summary
    if (summary?.nft && summary.nft.length > 0) {
        const parts = summary.nft.map(n => {
            const name = formatTokenName(n.collection);
            const direction = n.direction === 'out' ? 'Sent' : 'Received';
            return `${direction} ${n.count} ${name}`;
        });
        return parts.join(', ');
    }

    // Deploy
    if (tags.some(t => t.toLowerCase().includes('deploy') || t.toLowerCase().includes('contract_added') || t.toLowerCase().includes('contract_updated'))) {
        const contractNames = imports.map(c => formatTokenName(c)).filter(Boolean);
        return contractNames.length > 0 ? `Deployed ${contractNames.join(', ')}` : 'Contract deployment';
    }

    // Contract call
    if (imports.length > 0) {
        const contractNames = imports.slice(0, 3).map(c => formatTokenName(c)).filter(Boolean);
        const suffix = imports.length > 3 ? ` +${imports.length - 3} more` : '';
        return `Called ${contractNames.join(', ')}${suffix}`;
    }

    return '';
}

export function AccountActivityTab({ address, initialTransactions }: Props) {
    const normalizedAddress = normalizeAddress(address);
    const [filterMode, setFilterMode] = useState<FilterMode>('all');

    // Transactions state
    const [transactions, setTransactions] = useState<any[]>(initialTransactions);
    const [currentPage, setCurrentPage] = useState(1);
    const [txLoading, setTxLoading] = useState(false);
    const [txCursors, setTxCursors] = useState<Record<number, string>>({ 1: '' });
    const [txHasNext, setTxHasNext] = useState(false);

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

    useEffect(() => {
        setTransactions(initialTransactions);
        setCurrentPage(1);
        setTxCursors({ 1: '' });
        setTxHasNext(false);
        setFtTransfers([]);
        setFtCursor('');
        setFtHasMore(false);
        setNftTransfers([]);
        setNftCursor('');
        setNftHasMore(false);
    }, [address, initialTransactions]);

    // --- Transactions ---
    const loadTransactions = async (page: number) => {
        setTxLoading(true);
        try {
            const cursor = txCursors[page] ?? '';
            await ensureHeyApiConfigured();
            const txRes = await getAccountsByAddressTransactions({ path: { address: normalizedAddress }, query: { cursor, limit: 20 } });
            const payload: any = txRes.data;
            const items = payload?.items ?? (Array.isArray(payload) ? payload : []);
            const nextCursor = payload?.next_cursor ?? '';
            setTransactions(items.map((tx: any) => ({
                ...tx,
                payer: tx.payer_address || tx.payer || tx.proposer_address,
                proposer: tx.proposer_address || tx.proposer,
                blockHeight: tx.block_height,
            })));
            if (nextCursor) {
                setTxCursors(prev => ({ ...prev, [page + 1]: nextCursor }));
                setTxHasNext(true);
            } else {
                setTxHasNext(false);
            }
        } catch (err) {
            console.error('Failed to load transactions', err);
        } finally {
            setTxLoading(false);
        }
    };

    useEffect(() => {
        if (currentPage > 1) loadTransactions(currentPage);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPage]);

    // --- FT Transfers (lazy) ---
    const loadFtTransfers = async (cursorValue: string, append: boolean) => {
        setFtLoading(true);
        try {
            await ensureHeyApiConfigured();
            const res = await getAccountsByAddressTokenTransfers({ path: { address: normalizedAddress }, query: { cursor: cursorValue, limit: 20 } });
            const payload: any = res.data;
            const items = payload?.items ?? (Array.isArray(payload) ? payload : []);
            setFtTransfers(append ? prev => [...prev, ...items] : items);
            const next = payload?.next_cursor ?? '';
            setFtCursor(next);
            setFtHasMore(!!next);
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
            await ensureHeyApiConfigured();
            const res = await getAccountsByAddressNftTransfers({ path: { address: normalizedAddress }, query: { cursor: cursorValue, limit: 20 } });
            const payload: any = res.data;
            const items = payload?.items ?? (Array.isArray(payload) ? payload : []);
            setNftTransfers(append ? prev => [...prev, ...items] : items);
            const next = payload?.next_cursor ?? '';
            setNftCursor(next);
            setNftHasMore(!!next);
        } catch (err) {
            console.error('Failed to load NFT transfers', err);
        } finally {
            setNftLoading(false);
        }
    };

    // Auto-load dedicated transfer lists when filter switches
    useEffect(() => {
        if (filterMode === 'ft' && ftTransfers.length === 0 && !ftLoading) loadFtTransfers('', false);
        if (filterMode === 'nft' && nftTransfers.length === 0 && !nftLoading) loadNftTransfers('', false);
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
    ];

    const isLoading = filterMode === 'all' ? txLoading : filterMode === 'ft' ? ftLoading : nftLoading;

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

            {/* === Unified Activity Feed (All / FT filter / NFT filter from unified data) === */}
            {(filterMode === 'all' || filterMode === 'ft' || filterMode === 'nft') && (
                <div className="overflow-x-auto min-h-[200px] relative">
                    {isLoading && (filterMode === 'all' ? true : (filterMode === 'ft' ? ftTransfers.length === 0 : nftTransfers.length === 0)) && (
                        <div className="absolute inset-0 bg-white/50 dark:bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                            <div className="w-8 h-8 border-2 border-dashed border-zinc-900 dark:border-white rounded-full animate-spin" />
                        </div>
                    )}

                    {/* Dedicated FT transfer list */}
                    {filterMode === 'ft' && ftTransfers.length > 0 && (
                        <>
                            <table className="w-full text-left text-xs">
                                <thead>
                                    <tr className="border-b border-zinc-200 dark:border-white/5 text-zinc-500 uppercase tracking-wider bg-zinc-50 dark:bg-white/5">
                                        <th className="p-4 font-normal">Token</th>
                                        <th className="p-4 font-normal">Amount</th>
                                        <th className="p-4 font-normal">Direction</th>
                                        <th className="p-4 font-normal">From</th>
                                        <th className="p-4 font-normal">To</th>
                                        <th className="p-4 font-normal text-right">Block</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                    {ftTransfers.map((tx: any, i: number) => {
                                        const dir = tx.direction || (tx.from_address?.toLowerCase().includes(normalizedAddress.replace('0x', '')) ? 'withdraw' : 'deposit');
                                        return (
                                            <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                                                <td className="p-4 font-mono text-xs">{tx.token?.symbol || tx.token?.name || tx.token_id || tx.type_id || '—'}</td>
                                                <td className="p-4 font-mono">{tx.amount != null ? Number(tx.amount).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—'}</td>
                                                <td className="p-4">
                                                    {dir === 'withdraw' || dir === 'out'
                                                        ? <span className="inline-flex items-center gap-1 text-red-500"><ArrowUpRight className="h-3 w-3" /> Sent</span>
                                                        : <span className="inline-flex items-center gap-1 text-emerald-500"><ArrowDownLeft className="h-3 w-3" /> Received</span>
                                                    }
                                                </td>
                                                <td className="p-4">{tx.sender || tx.from_address ? <Link to={`/accounts/${normalizeAddress(tx.sender || tx.from_address)}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(tx.sender || tx.from_address)}</Link> : '—'}</td>
                                                <td className="p-4">{tx.receiver || tx.to_address ? <Link to={`/accounts/${normalizeAddress(tx.receiver || tx.to_address)}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(tx.receiver || tx.to_address)}</Link> : '—'}</td>
                                                <td className="p-4 text-right text-zinc-500">{tx.block_height ?? '—'}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            {ftHasMore && (
                                <div className="text-center py-3">
                                    <button onClick={() => loadFtTransfers(ftCursor, true)} disabled={ftLoading} className="px-4 py-2 text-xs border border-zinc-200 dark:border-white/10 rounded-sm hover:bg-zinc-100 dark:hover:bg-white/5 disabled:opacity-50">{ftLoading ? 'Loading...' : 'Load More'}</button>
                                </div>
                            )}
                        </>
                    )}

                    {/* Dedicated NFT transfer list */}
                    {filterMode === 'nft' && nftTransfers.length > 0 && (
                        <>
                            <table className="w-full text-left text-xs">
                                <thead>
                                    <tr className="border-b border-zinc-200 dark:border-white/5 text-zinc-500 uppercase tracking-wider bg-zinc-50 dark:bg-white/5">
                                        <th className="p-4 font-normal">NFT ID</th>
                                        <th className="p-4 font-normal">Collection</th>
                                        <th className="p-4 font-normal">Direction</th>
                                        <th className="p-4 font-normal">From</th>
                                        <th className="p-4 font-normal">To</th>
                                        <th className="p-4 font-normal text-right">Block</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                    {nftTransfers.map((tx: any, i: number) => {
                                        const dir = tx.direction || (tx.from_address?.toLowerCase().includes(normalizedAddress.replace('0x', '')) ? 'withdraw' : 'deposit');
                                        return (
                                            <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                                                <td className="p-4 font-mono">{tx.nft_id}</td>
                                                <td className="p-4 font-mono text-zinc-500">{tx.nft_type || tx.type_id || '—'}</td>
                                                <td className="p-4">
                                                    {dir === 'withdraw' || dir === 'out'
                                                        ? <span className="inline-flex items-center gap-1 text-red-500"><ArrowUpRight className="h-3 w-3" /> Sent</span>
                                                        : <span className="inline-flex items-center gap-1 text-emerald-500"><ArrowDownLeft className="h-3 w-3" /> Received</span>
                                                    }
                                                </td>
                                                <td className="p-4">{tx.sender || tx.from_address ? <Link to={`/accounts/${normalizeAddress(tx.sender || tx.from_address)}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(tx.sender || tx.from_address)}</Link> : '—'}</td>
                                                <td className="p-4">{tx.receiver || tx.to_address ? <Link to={`/accounts/${normalizeAddress(tx.receiver || tx.to_address)}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(tx.receiver || tx.to_address)}</Link> : '—'}</td>
                                                <td className="p-4 text-right text-zinc-500">{tx.block_height ?? '—'}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            {nftHasMore && (
                                <div className="text-center py-3">
                                    <button onClick={() => loadNftTransfers(nftCursor, true)} disabled={nftLoading} className="px-4 py-2 text-xs border border-zinc-200 dark:border-white/10 rounded-sm hover:bg-zinc-100 dark:hover:bg-white/5 disabled:opacity-50">{nftLoading ? 'Loading...' : 'Load More'}</button>
                                </div>
                            )}
                        </>
                    )}

                    {/* Empty states for dedicated views */}
                    {filterMode === 'ft' && ftTransfers.length === 0 && !ftLoading && (
                        <div className="text-center text-zinc-500 italic py-8">No FT transfers found</div>
                    )}
                    {filterMode === 'nft' && nftTransfers.length === 0 && !nftLoading && (
                        <div className="text-center text-zinc-500 italic py-8">No NFT transfers found</div>
                    )}

                    {/* Unified timeline (filterMode === 'all') */}
                    {filterMode === 'all' && filteredTransactions.length > 0 && (
                        <div className="space-y-0">
                            {filteredTransactions.map((tx) => {
                                const activity = deriveActivityType(tx);
                                const summaryLine = buildSummaryLine(tx, normalizedAddress);
                                const timeStr = tx.timestamp ? formatRelativeTime(tx.timestamp, Date.now()) : '';

                                return (
                                    <div key={tx.id} className="flex items-start gap-4 p-4 border-b border-zinc-100 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors group">
                                        {/* Type badge */}
                                        <div className="flex-shrink-0 pt-0.5">
                                            <span className={`inline-flex items-center gap-1 px-2 py-1 border rounded-sm text-[9px] font-bold uppercase tracking-wider ${activity.bgColor} ${activity.color}`}>
                                                {activity.type === 'ft' && <ArrowRightLeft className="h-2.5 w-2.5" />}
                                                {activity.type === 'nft' && <Repeat className="h-2.5 w-2.5" />}
                                                {activity.type === 'deploy' && <FileCode className="h-2.5 w-2.5" />}
                                                {activity.type === 'evm' && <Zap className="h-2.5 w-2.5" />}
                                                {activity.type === 'contract' && <Box className="h-2.5 w-2.5" />}
                                                {activity.type === 'tx' && <Activity className="h-2.5 w-2.5" />}
                                                {activity.label}
                                            </span>
                                        </div>

                                        {/* Main content */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <Link to={`/transactions/${tx.id}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono text-xs">
                                                    {formatShort(tx.id, 12, 8)}
                                                </Link>
                                                <span className={`text-[10px] uppercase ${tx.status === 'SEALED' ? 'text-zinc-400' : tx.status === 'EXPIRED' ? 'text-red-500' : 'text-yellow-600 dark:text-yellow-500'}`}>
                                                    {tx.status}
                                                </span>
                                            </div>
                                            {summaryLine && (
                                                <p className="text-xs text-zinc-600 dark:text-zinc-400 truncate">
                                                    {summaryLine}
                                                </p>
                                            )}
                                        </div>

                                        {/* Time */}
                                        <div className="flex-shrink-0 text-right">
                                            <span className="text-[10px] text-zinc-400">{timeStr}</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {filterMode === 'all' && filteredTransactions.length === 0 && !txLoading && (
                        <div className="text-center text-zinc-500 italic py-8">No transactions found</div>
                    )}
                </div>
            )}
        </div>
    );
}

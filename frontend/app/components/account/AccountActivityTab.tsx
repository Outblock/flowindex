import { useState, useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import {
    getAccountsByAddressTransactions,
    getAccountsByAddressTokenTransfers,
    getAccountsByAddressNftTransfers,
} from '../../api/gen/core';
import { Activity, ArrowRightLeft, Repeat } from 'lucide-react';
import { normalizeAddress, formatShort } from './accountUtils';

interface Props {
    address: string;
    initialTransactions: any[];
}

type SubTab = 'transactions' | 'ft-transfers' | 'nft-transfers';

export function AccountActivityTab({ address, initialTransactions }: Props) {
    const normalizedAddress = normalizeAddress(address);
    const [subTab, setSubTab] = useState<SubTab>('transactions');

    // Transactions state
    const [transactions, setTransactions] = useState<any[]>(initialTransactions);
    const [currentPage, setCurrentPage] = useState(1);
    const [txLoading, setTxLoading] = useState(false);
    const [txCursors, setTxCursors] = useState<Record<number, string>>({ 1: '' });
    const [txHasNext, setTxHasNext] = useState(false);

    // FT transfers state
    const [ftTransfers, setFtTransfers] = useState<any[]>([]);
    const [ftCursor, setFtCursor] = useState('');
    const [ftHasMore, setFtHasMore] = useState(false);
    const [ftLoading, setFtLoading] = useState(false);

    // NFT transfers state
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
            setTransactions((items || []).map((tx: any) => ({
                ...tx,
                payer: tx.payer_address || tx.payer || tx.proposer_address,
                proposer: tx.proposer_address || tx.proposer,
                blockHeight: tx.block_height
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

    // --- FT Transfers ---
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

    // --- NFT Transfers ---
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

    // Auto-load on sub-tab switch
    useEffect(() => {
        if (subTab === 'ft-transfers' && ftTransfers.length === 0 && !ftLoading) loadFtTransfers('', false);
        if (subTab === 'nft-transfers' && nftTransfers.length === 0 && !nftLoading) loadNftTransfers('', false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subTab, address]);

    const isEvm = (tx: any) => {
        const tags: string[] = tx.tags || [];
        if (tags.some((t: string) => t.toLowerCase().includes('evm'))) return true;
        const imports: string[] = tx.contract_imports || [];
        if (imports.some((c: string) => c.toLowerCase().includes('evm'))) return true;
        return false;
    };

    const getContracts = (tx: any): string[] => (tx.contract_imports || []).filter(Boolean);

    const subTabs = [
        { id: 'transactions' as const, label: 'Transactions', icon: Activity },
        { id: 'ft-transfers' as const, label: 'FT Transfers', icon: ArrowRightLeft },
        { id: 'nft-transfers' as const, label: 'NFT Transfers', icon: Repeat },
    ];

    return (
        <div>
            {/* Sub-tab buttons */}
            <div className="flex items-center gap-2 mb-4">
                {subTabs.map(({ id, label, icon: Icon }) => (
                    <button
                        key={id}
                        onClick={() => setSubTab(id)}
                        className={`px-4 py-2 text-[10px] uppercase tracking-widest border transition-colors rounded-sm ${subTab === id
                            ? 'border-nothing-green-dark dark:border-nothing-green text-zinc-900 dark:text-white bg-zinc-100 dark:bg-white/5'
                            : 'border-zinc-200 dark:border-white/10 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5'
                        }`}
                    >
                        <span className="flex items-center gap-2">
                            <Icon className={`h-3 w-3 ${subTab === id ? 'text-nothing-green-dark dark:text-nothing-green' : ''}`} />
                            {label}
                        </span>
                    </button>
                ))}
            </div>

            {/* === Transactions === */}
            {subTab === 'transactions' && (
                <div>
                    <div className="flex items-center justify-end mb-3">
                        <div className="flex items-center gap-2">
                            <button disabled={currentPage <= 1 || txLoading} onClick={() => setCurrentPage(prev => prev - 1)} className="px-2.5 py-1 text-[10px] border border-zinc-200 dark:border-white/10 rounded-sm disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors">Prev</button>
                            <span className="text-[10px] text-zinc-500 tabular-nums min-w-[4rem] text-center">Page {currentPage}</span>
                            <button disabled={!txHasNext || txLoading} onClick={() => setCurrentPage(prev => prev + 1)} className="px-2.5 py-1 text-[10px] border border-zinc-200 dark:border-white/10 rounded-sm disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors">Next</button>
                        </div>
                    </div>
                    <div className="overflow-x-auto min-h-[200px] relative">
                        {txLoading && (
                            <div className="absolute inset-0 bg-white/50 dark:bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                                <div className="w-8 h-8 border-2 border-dashed border-zinc-900 dark:border-white rounded-full animate-spin" />
                            </div>
                        )}
                        {transactions.length > 0 ? (
                            <table className="w-full text-left text-xs">
                                <thead>
                                    <tr className="border-b border-zinc-200 dark:border-white/5 text-zinc-500 uppercase tracking-wider bg-zinc-50 dark:bg-white/5">
                                        <th className="p-4 font-normal">Tx Hash</th>
                                        <th className="p-4 font-normal">Status</th>
                                        <th className="p-4 font-normal">Role</th>
                                        <th className="p-4 font-normal">Contracts</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                    {transactions.map((tx) => {
                                        const role = tx.payer === normalizedAddress ? 'Payer' : tx.proposer === normalizedAddress ? 'Proposer' : 'Authorizer';
                                        const evm = isEvm(tx);
                                        const contracts = getContracts(tx);
                                        return (
                                            <tr key={tx.id} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                                                <td className="p-4">
                                                    <div className="flex items-center gap-2">
                                                        <Link to={`/transactions/${tx.id}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(tx.id, 12, 8)}</Link>
                                                        {evm && <span className="border border-purple-300 dark:border-purple-500/30 bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-wider">EVM</span>}
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <span className={`text-[10px] uppercase ${tx.status === 'SEALED' ? 'text-zinc-500 dark:text-zinc-400' : tx.status === 'EXPIRED' ? 'text-red-500' : 'text-yellow-600 dark:text-yellow-500'}`}>{tx.status}</span>
                                                </td>
                                                <td className="p-4"><span className="text-[10px] uppercase text-zinc-500">{role}</span></td>
                                                <td className="p-4">
                                                    {contracts.length > 0 ? (
                                                        <div className="flex flex-wrap gap-1">
                                                            {contracts.slice(0, 3).map((c, i) => {
                                                                const name = c.includes('.') ? c.split('.').pop() : formatShort(c);
                                                                return <span key={i} className="border border-zinc-200 dark:border-white/10 px-1.5 py-0.5 rounded-sm text-[10px] text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-transparent font-mono truncate max-w-[140px]" title={c}>{name}</span>;
                                                            })}
                                                            {contracts.length > 3 && <span className="text-[10px] text-zinc-400">+{contracts.length - 3}</span>}
                                                        </div>
                                                    ) : <span className="text-zinc-400">—</span>}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        ) : !txLoading ? (
                            <div className="text-center text-zinc-500 italic py-8">No transactions found</div>
                        ) : null}
                    </div>
                </div>
            )}

            {/* === FT Transfers === */}
            {subTab === 'ft-transfers' && (
                <div className="overflow-x-auto min-h-[200px] relative">
                    {ftLoading && ftTransfers.length === 0 && (
                        <div className="absolute inset-0 bg-white/50 dark:bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                            <div className="w-8 h-8 border-2 border-dashed border-zinc-900 dark:border-white rounded-full animate-spin" />
                        </div>
                    )}
                    {ftTransfers.length > 0 ? (
                        <>
                            <table className="w-full text-left text-xs">
                                <thead>
                                    <tr className="border-b border-zinc-200 dark:border-white/5 text-zinc-500 uppercase tracking-wider bg-zinc-50 dark:bg-white/5">
                                        <th className="p-4 font-normal">Token</th>
                                        <th className="p-4 font-normal">Amount</th>
                                        <th className="p-4 font-normal">From</th>
                                        <th className="p-4 font-normal">To</th>
                                        <th className="p-4 font-normal text-right">Block</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                    {ftTransfers.map((tx: any, i: number) => (
                                        <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                                            <td className="p-4 font-mono">{tx.token_id || tx.type_id || '—'}</td>
                                            <td className="p-4 font-mono">{tx.amount != null ? Number(tx.amount).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—'}</td>
                                            <td className="p-4">{tx.from_address ? <Link to={`/accounts/${normalizeAddress(tx.from_address)}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(tx.from_address)}</Link> : '—'}</td>
                                            <td className="p-4">{tx.to_address ? <Link to={`/accounts/${normalizeAddress(tx.to_address)}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(tx.to_address)}</Link> : '—'}</td>
                                            <td className="p-4 text-right text-zinc-500">{tx.block_height ?? '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {ftHasMore && (
                                <div className="text-center py-3">
                                    <button onClick={() => loadFtTransfers(ftCursor, true)} disabled={ftLoading} className="px-4 py-2 text-xs border border-zinc-200 dark:border-white/10 rounded-sm hover:bg-zinc-100 dark:hover:bg-white/5 disabled:opacity-50">{ftLoading ? 'Loading...' : 'Load More'}</button>
                                </div>
                            )}
                        </>
                    ) : !ftLoading ? (
                        <div className="text-center text-zinc-500 italic py-8">No FT transfers found</div>
                    ) : null}
                </div>
            )}

            {/* === NFT Transfers === */}
            {subTab === 'nft-transfers' && (
                <div className="overflow-x-auto min-h-[200px] relative">
                    {nftLoading && nftTransfers.length === 0 && (
                        <div className="absolute inset-0 bg-white/50 dark:bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                            <div className="w-8 h-8 border-2 border-dashed border-zinc-900 dark:border-white rounded-full animate-spin" />
                        </div>
                    )}
                    {nftTransfers.length > 0 ? (
                        <>
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
                                    {nftTransfers.map((tx: any, i: number) => (
                                        <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                                            <td className="p-4 font-mono">{tx.nft_id}</td>
                                            <td className="p-4 font-mono text-zinc-500">{tx.type_id || '—'}</td>
                                            <td className="p-4">{tx.from_address ? <Link to={`/accounts/${normalizeAddress(tx.from_address)}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(tx.from_address)}</Link> : '—'}</td>
                                            <td className="p-4">{tx.to_address ? <Link to={`/accounts/${normalizeAddress(tx.to_address)}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">{formatShort(tx.to_address)}</Link> : '—'}</td>
                                            <td className="p-4 text-right text-zinc-500">{tx.block_height ?? '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {nftHasMore && (
                                <div className="text-center py-3">
                                    <button onClick={() => loadNftTransfers(nftCursor, true)} disabled={nftLoading} className="px-4 py-2 text-xs border border-zinc-200 dark:border-white/10 rounded-sm hover:bg-zinc-100 dark:hover:bg-white/5 disabled:opacity-50">{nftLoading ? 'Loading...' : 'Load More'}</button>
                                </div>
                            )}
                        </>
                    ) : !nftLoading ? (
                        <div className="text-center text-zinc-500 italic py-8">No NFT transfers found</div>
                    ) : null}
                </div>
            )}
        </div>
    );
}

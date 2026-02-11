import { useState, useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import {
    getAccountsByAddressTransactions,
    getAccountsByAddressTokenTransfers,
    getAccountsByAddressNftTransfers,
} from '../../api/gen/core';
import { Activity, ArrowRightLeft } from 'lucide-react';
import { normalizeAddress, formatShort } from './accountUtils';

interface Props {
    address: string;
    initialTransactions: any[];
}

export function AccountActivityTab({ address, initialTransactions }: Props) {
    const normalizedAddress = normalizeAddress(address);

    const [transactions, setTransactions] = useState<any[]>(initialTransactions);
    const [currentPage, setCurrentPage] = useState(1);
    const [txLoading, setTxLoading] = useState(false);
    const [txCursors, setTxCursors] = useState<Record<number, string>>({ 1: '' });
    const [txHasNext, setTxHasNext] = useState(false);

    const [tokenTransfers, setTokenTransfers] = useState<any[]>([]);
    const [tokenCursor, setTokenCursor] = useState('');
    const [tokenHasMore, setTokenHasMore] = useState(false);
    const [tokenLoading, setTokenLoading] = useState(false);

    const [nftTransfers, setNftTransfers] = useState<any[]>([]);
    const [nftCursor, setNftCursor] = useState('');
    const [nftHasMore, setNftHasMore] = useState(false);
    const [nftLoading, setNftLoading] = useState(false);

    const [subTab, setSubTab] = useState<'activity' | 'transfers'>('activity');

    useEffect(() => {
        setTransactions(initialTransactions);
        setCurrentPage(1);
        setTxCursors({ 1: '' });
        setTxHasNext(false);
        setTokenTransfers([]);
        setTokenCursor('');
        setTokenHasMore(false);
        setNftTransfers([]);
        setNftCursor('');
        setNftHasMore(false);
    }, [address, initialTransactions]);

    const loadTransactions = async (page: number) => {
        setTxLoading(true);
        try {
            const cursor = txCursors[page] ?? '';
            await ensureHeyApiConfigured();
            const txRes = await getAccountsByAddressTransactions({ path: { address: normalizedAddress }, query: { cursor, limit: 20 } });
            const payload: any = txRes.data;
            const items = payload?.items ?? (Array.isArray(payload) ? payload : []);
            const nextCursor = payload?.next_cursor ?? '';
            const accountTxs = (items || []).map((tx: any) => ({
                ...tx,
                type: tx.status === 'SEALED' ? 'TRANSFER' : 'PENDING',
                payer: tx.payer_address || tx.proposer_address,
                proposer: tx.proposer_address,
                blockHeight: tx.block_height
            }));
            setTransactions(accountTxs);
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

    const loadTokenTransfers = async (cursorValue: string, append: boolean) => {
        setTokenLoading(true);
        try {
            await ensureHeyApiConfigured();
            const res = await getAccountsByAddressTokenTransfers({ path: { address: normalizedAddress }, query: { cursor: cursorValue, limit: 20 } });
            const payload: any = res.data;
            const items = payload?.items ?? (Array.isArray(payload) ? payload : []);
            setTokenTransfers(append ? prev => [...prev, ...items] : items);
            const next = payload?.next_cursor ?? '';
            setTokenCursor(next);
            setTokenHasMore(!!next);
        } catch (err) {
            console.error('Failed to load token transfers', err);
        } finally {
            setTokenLoading(false);
        }
    };

    const loadNFTTransfers = async (cursorValue: string, append: boolean) => {
        setNftLoading(true);
        try {
            await ensureHeyApiConfigured();
            const nftRes = await getAccountsByAddressNftTransfers({ path: { address: normalizedAddress }, query: { cursor: cursorValue, limit: 20 } });
            const payload: any = nftRes.data;
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

    useEffect(() => {
        if (subTab === 'transfers') {
            if (tokenTransfers.length === 0 && !tokenLoading) loadTokenTransfers('', false);
            if (nftTransfers.length === 0 && !nftLoading) loadNFTTransfers('', false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [subTab, address]);

    return (
        <div>
            {/* Sub-tab buttons */}
            <div className="flex items-center gap-2 mb-4">
                {[
                    { id: 'activity' as const, label: 'Transactions', icon: Activity },
                    { id: 'transfers' as const, label: 'Transfers', icon: ArrowRightLeft },
                ].map(({ id, label, icon: Icon }) => (
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

            {/* Transactions table */}
            {subTab === 'activity' && (
                <>
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
                                        <th className="p-4 font-normal">Type</th>
                                        <th className="p-4 font-normal">Role</th>
                                        <th className="p-4 font-normal">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                    {transactions.map((tx) => {
                                        const role = tx.payer === normalizedAddress ? 'Payer' :
                                            tx.proposer === normalizedAddress ? 'Proposer' : 'Authorizer';
                                        return (
                                            <tr key={tx.id} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                                                <td className="p-4">
                                                    <Link to={`/transactions/${tx.id}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">
                                                        {formatShort(tx.id, 12, 8)}
                                                    </Link>
                                                </td>
                                                <td className="p-4">
                                                    <span className="border border-zinc-200 dark:border-white/10 px-2 py-1 rounded-sm text-zinc-600 dark:text-zinc-300 text-[10px] uppercase bg-zinc-100 dark:bg-transparent">
                                                        {tx.type}
                                                    </span>
                                                </td>
                                                <td className="p-4">
                                                    <span className="text-[10px] uppercase text-zinc-500">{role}</span>
                                                </td>
                                                <td className="p-4">
                                                    <span className={`text-[10px] uppercase ${tx.status === 'SEALED' ? 'text-zinc-500 dark:text-zinc-400' : 'text-yellow-600 dark:text-yellow-500'}`}>
                                                        {tx.status}
                                                    </span>
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
                    <div className="flex justify-between items-center px-4 py-3 border-t border-zinc-200 dark:border-white/5">
                        <button disabled={currentPage <= 1 || txLoading} onClick={() => setCurrentPage(prev => prev - 1)} className="px-3 py-1 text-xs border border-zinc-200 dark:border-white/10 rounded-sm disabled:opacity-50">Previous</button>
                        <span className="text-xs text-zinc-500">Page {currentPage}</span>
                        <button disabled={!txHasNext || txLoading} onClick={() => setCurrentPage(prev => prev + 1)} className="px-3 py-1 text-xs border border-zinc-200 dark:border-white/10 rounded-sm disabled:opacity-50">Next</button>
                    </div>
                </>
            )}

            {/* Transfers tables */}
            {subTab === 'transfers' && (
                <div className="space-y-8">
                    {/* FT Transfers */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <div className="text-[10px] uppercase tracking-widest text-zinc-500">FT Transfers</div>
                            {tokenLoading && <div className="text-[10px] text-zinc-500">Loading...</div>}
                        </div>
                        <div className="overflow-x-auto">
                            {tokenTransfers.length > 0 ? (
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
                                        {tokenTransfers.map((tx: any, i: number) => (
                                            <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                                                <td className="p-4 font-mono">{tx.token_id || tx.type_id || '—'}</td>
                                                <td className="p-4 font-mono">{tx.amount != null ? Number(tx.amount).toLocaleString(undefined, { maximumFractionDigits: 8 }) : '—'}</td>
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
                            ) : !tokenLoading ? (
                                <div className="text-center text-zinc-500 italic py-4">No FT transfers found</div>
                            ) : null}
                        </div>
                        {tokenHasMore && (
                            <div className="text-center py-3">
                                <button onClick={() => loadTokenTransfers(tokenCursor, true)} disabled={tokenLoading} className="px-4 py-2 text-xs border border-zinc-200 dark:border-white/10 rounded-sm hover:bg-zinc-100 dark:hover:bg-white/5 disabled:opacity-50">
                                    {tokenLoading ? 'Loading...' : 'Load More'}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* NFT Transfers */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <div className="text-[10px] uppercase tracking-widest text-zinc-500">NFT Transfers</div>
                            {nftLoading && <div className="text-[10px] text-zinc-500">Loading...</div>}
                        </div>
                        <div className="overflow-x-auto">
                            {nftTransfers.length > 0 ? (
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
                            ) : !nftLoading ? (
                                <div className="text-center text-zinc-500 italic py-4">No NFT transfers found</div>
                            ) : null}
                        </div>
                        {nftHasMore && (
                            <div className="text-center py-3">
                                <button onClick={() => loadNFTTransfers(nftCursor, true)} disabled={nftLoading} className="px-4 py-2 text-xs border border-zinc-200 dark:border-white/10 rounded-sm hover:bg-zinc-100 dark:hover:bg-white/5 disabled:opacity-50">
                                    {nftLoading ? 'Loading...' : 'Load More'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

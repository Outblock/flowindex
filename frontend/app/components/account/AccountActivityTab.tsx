import { useState, useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import { getAccountsByAddressTransactions } from '../../api/gen/core';
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

    useEffect(() => {
        setTransactions(initialTransactions);
        setCurrentPage(1);
        setTxCursors({ 1: '' });
        setTxHasNext(false);
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
                payer: tx.payer_address || tx.payer || tx.proposer_address,
                proposer: tx.proposer_address || tx.proposer,
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

    const isEvm = (tx: any) => {
        const tags: string[] = tx.tags || [];
        if (tags.some((t: string) => t.toLowerCase().includes('evm'))) return true;
        const imports: string[] = tx.contract_imports || [];
        if (imports.some((c: string) => c.toLowerCase().includes('evm'))) return true;
        return false;
    };

    const getContracts = (tx: any): string[] => {
        const imports: string[] = tx.contract_imports || [];
        return imports.filter(Boolean);
    };

    return (
        <div>
            {/* Header with pagination top-right */}
            <div className="flex items-center justify-between mb-4 border-b border-zinc-100 dark:border-white/5 pb-2">
                <h2 className="text-zinc-900 dark:text-white text-sm uppercase tracking-widest">
                    Transactions
                </h2>
                <div className="flex items-center gap-2">
                    <button
                        disabled={currentPage <= 1 || txLoading}
                        onClick={() => setCurrentPage(prev => prev - 1)}
                        className="px-2.5 py-1 text-[10px] border border-zinc-200 dark:border-white/10 rounded-sm disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors"
                    >
                        Prev
                    </button>
                    <span className="text-[10px] text-zinc-500 tabular-nums min-w-[4rem] text-center">Page {currentPage}</span>
                    <button
                        disabled={!txHasNext || txLoading}
                        onClick={() => setCurrentPage(prev => prev + 1)}
                        className="px-2.5 py-1 text-[10px] border border-zinc-200 dark:border-white/10 rounded-sm disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors"
                    >
                        Next
                    </button>
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
                                const role = tx.payer === normalizedAddress ? 'Payer' :
                                    tx.proposer === normalizedAddress ? 'Proposer' : 'Authorizer';
                                const evm = isEvm(tx);
                                const contracts = getContracts(tx);
                                return (
                                    <tr key={tx.id} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                                        <td className="p-4">
                                            <div className="flex items-center gap-2">
                                                <Link to={`/transactions/${tx.id}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">
                                                    {formatShort(tx.id, 12, 8)}
                                                </Link>
                                                {evm && (
                                                    <span className="border border-purple-300 dark:border-purple-500/30 bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded-sm text-[9px] font-bold uppercase tracking-wider">
                                                        EVM
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <span className={`text-[10px] uppercase ${tx.status === 'SEALED' ? 'text-zinc-500 dark:text-zinc-400' : tx.status === 'EXPIRED' ? 'text-red-500' : 'text-yellow-600 dark:text-yellow-500'}`}>
                                                {tx.status}
                                            </span>
                                        </td>
                                        <td className="p-4">
                                            <span className="text-[10px] uppercase text-zinc-500">{role}</span>
                                        </td>
                                        <td className="p-4">
                                            {contracts.length > 0 ? (
                                                <div className="flex flex-wrap gap-1">
                                                    {contracts.slice(0, 3).map((c, i) => {
                                                        const name = c.includes('.') ? c.split('.').pop() : formatShort(c);
                                                        return (
                                                            <span key={i} className="border border-zinc-200 dark:border-white/10 px-1.5 py-0.5 rounded-sm text-[10px] text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-transparent font-mono truncate max-w-[140px]" title={c}>
                                                                {name}
                                                            </span>
                                                        );
                                                    })}
                                                    {contracts.length > 3 && (
                                                        <span className="text-[10px] text-zinc-400">+{contracts.length - 3}</span>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-zinc-400">—</span>
                                            )}
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
    );
}

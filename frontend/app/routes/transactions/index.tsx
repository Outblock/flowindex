import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity } from 'lucide-react';
import NumberFlow from '@number-flow/react';
import { ensureHeyApiConfigured, fetchStatus } from '../../api/heyapi';
import { getFlowV1Transaction } from '../../api/gen/find';
import { useWebSocketMessages, useWebSocketStatus } from '../../hooks/useWebSocket';
import { Pagination } from '../../components/Pagination';
import { ActivityRow } from '../../components/TransactionRow';

export const Route = createFileRoute('/transactions/')({
    component: Transactions,
    loader: async ({ location }) => {
        const page = Number(new URLSearchParams(location.search).get('page') || '1');
        try {
            // For now, load first page data on server
            await ensureHeyApiConfigured();
            const [transactionsRes, statusRes] = await Promise.all([
                getFlowV1Transaction({ query: { limit: 20, offset: 0 } }),
                fetchStatus()
            ]);
            return { transactionsRes: transactionsRes.data?.data ?? [], statusRes: statusRes, page };
        } catch (e) {
            console.error("Failed to load transactions", e);
            return { transactionsRes: [], statusRes: null, page: 1 };
        }
    }
})

function Transactions() {
    const { transactionsRes, statusRes, page } = Route.useLoaderData();
    const [transactions, setTransactions] = useState<any[]>([]); // Initialize empty, will merge in effect
    const [statusRaw, setStatusRaw] = useState<any>(statusRes);
    const [txPage, setTxPage] = useState(page);
    const [txCursors, setTxCursors] = useState({ 1: '' });
    const [txHasNext, setTxHasNext] = useState(Boolean(transactionsRes?.next_cursor));
    const [newTxIds, setNewTxIds] = useState(new Set());
    const [expandedTxId, setExpandedTxId] = useState<string | null>(null);

    const { isConnected } = useWebSocketStatus();
    const { lastMessage } = useWebSocketMessages();

    const normalizeTxId = (value) => {
        if (!value) return '';
        const lower = String(value).toLowerCase();
        return (lower.startsWith('0x') ? lower : `0x${lower}`).toLowerCase();
    };

    const getTxHeight = (tx) => Number(tx?.block_height ?? tx?.blockHeight ?? 0);
    const getTxIndex = (tx) => Number(tx?.transaction_index ?? tx?.tx_index ?? 0);
    const getTxTimestampMs = (tx) => {
        const source = tx?.timestamp || tx?.created_at || tx?.block_timestamp;
        if (!source) return 0;
        const ms = new Date(source).getTime();
        return Number.isNaN(ms) ? 0 : ms;
    };

    const compareTxDesc = (a, b) => {
        const heightDiff = getTxHeight(b) - getTxHeight(a);
        if (heightDiff !== 0) return heightDiff;
        const indexDiff = getTxIndex(b) - getTxIndex(a);
        if (indexDiff !== 0) return indexDiff;
        const timeDiff = getTxTimestampMs(b) - getTxTimestampMs(a);
        if (timeDiff !== 0) return timeDiff;
        return normalizeTxId(b?.id).localeCompare(normalizeTxId(a?.id));
    };

    const mergeTransactions = (prev, incoming, { prependNew = false } = {}) => {
        const map = new Map();
        const order = [];
        const seen = new Set();

        // existing
        for (const tx of prev || []) {
            const id = normalizeTxId(tx?.id);
            if (!id) continue;
            map.set(id, tx);
            order.push(id);
            seen.add(id);
        }

        // incoming
        for (const tx of incoming || []) {
            const id = normalizeTxId(tx?.id);
            if (!id) continue;
            const existing = map.get(id);
            // Simple merge: prefer incoming if newer status
            const merged = existing ? { ...existing, ...tx } : tx;
            map.set(id, merged);

            if (!seen.has(id)) {
                if (prependNew) order.unshift(id);
                else order.push(id);
                seen.add(id);
            }
        }

        const mergedList = [];
        const dedup = new Set();
        for (const id of order) {
            if (dedup.has(id)) continue;
            const tx = map.get(id);
            if (tx) mergedList.push(tx);
            dedup.add(id);
        }

        mergedList.sort(compareTxDesc);
        return mergedList.slice(0, 50);
    };

    // Initialize transactions from loader data
    useEffect(() => {
        const items = transactionsRes?.items ?? (Array.isArray(transactionsRes) ? transactionsRes : []);
        const transformedTxs = items.map(tx => ({
            ...tx,
            type: tx.type || (tx.status === 'SEALED' ? 'TRANSFER' : 'PENDING'),
            payer: tx.payer_address || tx.proposer_address,
            blockHeight: tx.block_height
        }));

        setTransactions(prev => (page === 1
            ? mergeTransactions(prev, transformedTxs, { prependNew: false })
            : mergeTransactions([], transformedTxs, { prependNew: false })));

        if (transactionsRes?.next_cursor) {
            setTxCursors(prev => ({ ...prev, 2: transactionsRes.next_cursor }));
        }
    }, [transactionsRes, page]);


    const loadTransactions = async (page) => {
        try {
            await ensureHeyApiConfigured();
            const offset = (page - 1) * 20;
            const res = await getFlowV1Transaction({ query: { limit: 20, offset } });
            const items = res?.data?.data ?? (Array.isArray(res?.data) ? res.data : []);
            const nextCursor = '';

            const transformedTxs = items.map(tx => ({
                ...tx,
                type: tx.type || (tx.status === 'SEALED' ? 'TRANSFER' : 'PENDING'),
                payer: tx.payer_address || tx.proposer_address,
                blockHeight: tx.block_height
            }));

            setTransactions(prev => (page === 1
                ? mergeTransactions(prev, transformedTxs, { prependNew: false })
                : mergeTransactions([], transformedTxs, { prependNew: false }))); // Reset on page change if not pg 1

            setTxHasNext(Boolean(nextCursor));
            if (nextCursor) {
                setTxCursors(prev => ({ ...prev, [page + 1]: nextCursor }));
            }
        } catch (err) {
            console.error("Failed to load transactions", err);
        }
    };

    const handleTxPageChange = (newPage) => {
        setTxPage(newPage);
        loadTransactions(newPage);
    };

    // WebSocket
    useEffect(() => {
        if (!lastMessage) return;

        if (txPage === 1 && lastMessage.type === 'new_transaction') {
            const rawTx = lastMessage.payload;
            const newTx = {
                ...rawTx,
                type: rawTx.status === 'SEALED' ? 'TRANSFER' : 'PENDING',
                payer: rawTx.payer_address || rawTx.proposer_address,
                blockHeight: rawTx.block_height
            };


            setTransactions(prev => {
                const merged = mergeTransactions(prev, [newTx], { prependNew: true });
                return merged.slice(0, 20); // Keep buffer size consistent for view
            });

            setNewTxIds(prev => new Set(prev).add(newTx.id));
            setTimeout(() => setNewTxIds(prev => {
                const next = new Set(prev);
                next.delete(newTx.id);
                return next;
            }), 3000);

            setStatusRaw(prev => prev ? {
                ...prev,
                total_transactions: (prev.total_transactions || 0) + 1
            } : prev);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lastMessage, txPage]);

    // Initial Load (Status refresh only, TXs loaded via loader/effect)
    useEffect(() => {
        const refreshStatus = async () => {
            try {
                const statusRes = await fetchStatus();
                if (statusRes) setStatusRaw(statusRes);
            } catch (e) { console.error(e); }
        };

        refreshStatus();
        const interval = setInterval(refreshStatus, 10000);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="container mx-auto px-4 py-8 space-y-8">
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-between"
            >
                <div className="flex items-center space-x-4">
                    <div className="p-3 bg-blue-500/10 rounded-lg">
                        <Activity className="h-8 w-8 text-blue-500" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-zinc-900 dark:text-white uppercase tracking-tighter">Transactions</h1>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">Network Activity Stream</p>
                    </div>
                </div>

                <div className={`flex items-center space-x-2 px-3 py-1 border rounded-full ${isConnected ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                    <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                    <span className="text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                        {isConnected ? 'Live Feed' : 'Connecting...'}
                    </span>
                </div>
            </motion.div>

            {/* Stats */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
            >
                <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm">
                    <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Total Transactions</p>
                    <p className="text-3xl font-bold font-mono text-zinc-900 dark:text-white">
                        <NumberFlow value={statusRaw?.total_transactions || 0} format={{ useGrouping: true }} />
                    </p>
                </div>

                <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm">
                    <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Latest Height</p>
                    <p className="text-xl font-bold font-mono text-zinc-900 dark:text-white">
                        #{statusRaw?.latest_height?.toLocaleString() || 0}
                    </p>
                </div>
            </motion.div>

            {/* Transaction List */}
            <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden">
                <div className="space-y-0">
                    <AnimatePresence mode='popLayout'>
                        {transactions.map((tx) => {
                            const isNew = newTxIds.has(tx.id);
                            return (
                                <motion.div
                                    layout
                                    key={tx.id}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    className={isNew ? 'bg-nothing-green/10' : ''}
                                >
                                    <ActivityRow
                                        tx={tx}
                                        expanded={expandedTxId === tx.id}
                                        onToggle={() => setExpandedTxId(prev => prev === tx.id ? null : tx.id)}
                                    />
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                </div>

                <div className="p-4 border-t border-zinc-200 dark:border-white/5">
                    <Pagination
                        currentPage={txPage}
                        onPageChange={handleTxPageChange}
                        hasNext={txHasNext}
                    />
                </div>
            </div>
        </div>
    );
}

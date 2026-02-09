import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, XCircle, CheckCircle } from 'lucide-react';
import NumberFlow from '@number-flow/react';
import { api } from '../api';
import { useWebSocketMessages, useWebSocketStatus } from '../hooks/useWebSocket';
import { Pagination } from '../components/Pagination';
import { formatRelativeTime } from '../lib/time';
import { useTimeTicker } from '../hooks/useTimeTicker';

export default function Transactions() {
    const [transactions, setTransactions] = useState([]);
    const [statusRaw, setStatusRaw] = useState(null);
    const [txPage, setTxPage] = useState(1);
    const [txCursors, setTxCursors] = useState({ 1: '' });
    const [txHasNext, setTxHasNext] = useState(false);
    const [newTxIds, setNewTxIds] = useState(new Set());

    const { isConnected } = useWebSocketStatus();
    const { lastMessage } = useWebSocketMessages();
    const nowTick = useTimeTicker(20000); // 20s tick

    const normalizeHex = (value) => {
        if (!value) return '';
        const lower = String(value).toLowerCase();
        return lower.startsWith('0x') ? lower : `0x${lower}`;
    };

    const formatMiddle = (value, head = 12, tail = 8) => {
        if (!value) return '';
        if (value.length <= head + tail + 3) return value;
        return `${value.slice(0, head)}...${value.slice(-tail)}`;
    };

    const normalizeTxId = (value) => normalizeHex(value).toLowerCase();

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

    const loadTransactions = async (page) => {
        try {
            const cursor = txCursors[page] ?? '';
            const res = await api.getTransactions(cursor, 20);
            const items = res?.items ?? (Array.isArray(res) ? res : []);
            const nextCursor = res?.next_cursor ?? '';

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

    // Initial Load
    useEffect(() => {
        const refreshStatus = async () => {
            try {
                const statusRes = await api.getStatus();
                if (statusRes) setStatusRaw(statusRes);
            } catch (e) { console.error(e); }
        };

        // eslint-disable-next-line react-hooks/set-state-in-effect
        loadTransactions(1);
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
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-white/5">
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Transaction ID</th>
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Type</th>
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Block</th>
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">Age</th>
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            <AnimatePresence mode='popLayout'>
                                {transactions.map((tx) => {
                                    const isNew = newTxIds.has(tx.id);
                                    const isSealed = tx.status === 'SEALED';
                                    const isError = Boolean(tx.error_message || tx.errorMessage);
                                    const txTimeRelative = formatRelativeTime(tx.timestamp || tx.created_at, nowTick);
                                    const txIdShort = formatMiddle(normalizeHex(tx.id), 12, 12);

                                    return (
                                        <motion.tr
                                            layout
                                            key={tx.id}
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            className={`border-b border-zinc-100 dark:border-white/5 group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors ${isNew ? 'bg-nothing-green/10' : ''
                                                }`}
                                        >
                                            <td className="p-4">
                                                <Link to={`/transactions/${tx.id}`} className="font-mono text-blue-500 hover:underline">
                                                    {txIdShort}
                                                </Link>
                                            </td>
                                            <td className="p-4">
                                                <span className="font-mono text-xs uppercase bg-white/10 border border-zinc-200 dark:border-white/10 px-2 py-1 rounded">
                                                    {tx.type}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                <Link to={`/blocks/${tx.block_height}`} className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline">
                                                    #{tx.block_height?.toLocaleString()}
                                                </Link>
                                            </td>
                                            <td className="p-4 text-right">
                                                <span className="text-sm text-zinc-500">{txTimeRelative}</span>
                                            </td>
                                            <td className="p-4 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    {isError ? (
                                                        <XCircle className="w-4 h-4 text-red-500" />
                                                    ) : isSealed ? (
                                                        <CheckCircle className="w-4 h-4 text-nothing-green" />
                                                    ) : (
                                                        <div className="w-4 h-4 rounded-full border-2 border-zinc-300 border-t-transparent animate-spin" />
                                                    )}
                                                    <span className={`text-xs font-bold uppercase ${isError ? 'text-red-500' : isSealed ? 'text-nothing-green' : 'text-zinc-500'
                                                        }`}>
                                                        {isError ? 'Failed' : isSealed ? 'Sealed' : 'Pending'}
                                                    </span>
                                                </div>
                                            </td>
                                        </motion.tr>
                                    );
                                })}
                            </AnimatePresence>
                        </tbody>
                    </table>
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

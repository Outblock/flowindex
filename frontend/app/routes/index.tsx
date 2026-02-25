import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Box, Activity, TrendingUp, Coins, Image } from 'lucide-react';
import { SafeNumberFlow } from '../components/SafeNumberFlow';
import { ensureHeyApiConfigured, fetchStatus, fetchNetworkStats } from '../api/heyapi';
import { getFlowV1Block, getFlowV1Transaction, getFlowV1Ft, getFlowV1Nft } from '../api/gen/find';
import { useWebSocketMessages, useWebSocketStatus } from '../hooks/useWebSocket';
import { FlowPriceChart } from '../components/FlowPriceChart';
import { EpochProgress } from '../components/EpochProgress';
import { NetworkStats } from '../components/NetworkStats';
import { DailyStatsChart } from '../components/DailyStatsChart';
import { IndexingStatus } from '../components/IndexingStatus';
import { formatAbsoluteTime, formatRelativeTime } from '../lib/time';
import { useTimeTicker } from '../hooks/useTimeTicker';
import { formatNumber } from '../lib/format';

export const Route = createFileRoute('/')({
    component: Home,
    loader: async () => {
        const ssrFastTimeoutMs = import.meta.env.SSR ? 2200 : 10000;
        // Only fetch fast, critical data in the SSR loader.
        // Slower endpoints (transactions, tokens, nfts) load client-side
        // so the page renders immediately.
        try {
            await ensureHeyApiConfigured();
            const [statusRes, networkStatsRes, blocksRes] = await Promise.allSettled([
                fetchStatus({ timeoutMs: ssrFastTimeoutMs }),
                fetchNetworkStats({ timeoutMs: ssrFastTimeoutMs }),
                getFlowV1Block({ query: { limit: 50, offset: 0 }, timeout: ssrFastTimeoutMs }),
            ]);
            return {
                status: statusRes.status === 'fulfilled' ? statusRes.value : null,
                networkStats: networkStatsRes.status === 'fulfilled' ? networkStatsRes.value : null,
                blocks: blocksRes.status === 'fulfilled' ? (blocksRes.value.data?.data ?? []) : [],
            };
        } catch (e) {
            console.error("Failed to load initial data", e);
            return { status: null, networkStats: null, blocks: [] };
        }
    }
})

function Home() {
    const { status, networkStats: initialNetworkStats, blocks: initialBlocks } = Route.useLoaderData();

    // Prevent SSR hydration mismatch for Date.now()-based UI (relative timestamps, etc).
    const [hydrated, setHydrated] = useState(false);
    const [blocks, setBlocks] = useState<any[]>(initialBlocks || []);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [tokens, setTokens] = useState<any[]>([]);
    const [nftCollections, setNftCollections] = useState<any[]>([]);
    const [statusRaw, setStatusRaw] = useState<any>(status);
    const [networkStats, setNetworkStats] = useState<any>(initialNetworkStats);
    const [tps, setTps] = useState(0);

    // Avoid scheduling one setTimeout per WS message (can explode under load).
    // Keep a bounded "highlight until" map and prune it via a single ticker.
    const [highlightNow, setHighlightNow] = useState(0); // kept for backward compatibility; replaced below
    const highlightTick = useTimeTicker(1000);
    const newBlockExpiryRef = useRef<Map<number, number>>(new Map());
    const newTxExpiryRef = useRef<Map<string, number>>(new Map());
    // Removed unused refs and state

    const { isConnected } = useWebSocketStatus();
    const { lastMessage } = useWebSocketMessages();
    const nowTick = useTimeTicker(20000);
    const transactionsRef = useRef<any[]>([]);
    const isConnectedRef = useRef(false);

    useEffect(() => {
        setHydrated(true);
    }, []);

    useEffect(() => {
        // Prune highlight maps periodically so they can't grow unbounded under WS load.
        const now = highlightTick;
        let changed = false;
        for (const [height, expiry] of newBlockExpiryRef.current.entries()) {
            if (expiry <= now) {
                newBlockExpiryRef.current.delete(height);
                changed = true;
            }
        }
        for (const [id, expiry] of newTxExpiryRef.current.entries()) {
            if (expiry <= now) {
                newTxExpiryRef.current.delete(id);
                changed = true;
            }
        }
        if (changed) {
            // Force a rerender so expired highlights disappear even if no new data arrives.
            setHighlightNow(now);
        }
    }, [highlightTick]);

    // Load tokens client-side (non-blocking)
    const loadTokens = async () => {
        try {
            await ensureHeyApiConfigured();
            const res = await getFlowV1Ft({ query: { limit: 5, offset: 0, sort: 'trending' } as any });
            setTokens(res.data?.data ?? []);
        } catch (err) {
            console.error("Failed to load tokens", err);
        }
    };

    // Load NFT collections client-side (non-blocking)
    const loadNftCollections = async () => {
        try {
            await ensureHeyApiConfigured();
            const res = await getFlowV1Nft({ query: { limit: 5, offset: 0, sort: 'trending' } as any });
            setNftCollections(res.data?.data ?? []);
        } catch (err) {
            console.error("Failed to load NFT collections", err);
        }
    };

    useEffect(() => {
        isConnectedRef.current = isConnected;
    }, [isConnected]);

    const normalizeHex = (value: string | null | undefined): string => {
        if (!value) return '';
        const lower = String(value).toLowerCase();
        return lower.startsWith('0x') ? lower : `0x${lower}`;
    };

    const formatMiddle = (value: string | null | undefined, head = 12, tail = 8): string => {
        if (!value) return '';
        if (value.length <= head + tail + 3) return value;
        return `${value.slice(0, head)}...${value.slice(-tail)}`;
    };

    const normalizeTxId = (value: string | null | undefined): string => normalizeHex(value).toLowerCase();

    const getTxHeight = (tx: any): number => Number(tx?.block_height ?? tx?.blockHeight ?? 0);
    const getTxIndex = (tx: any): number => Number(tx?.transaction_index ?? tx?.tx_index ?? 0);

    const getTxTimestampMs = (tx: any): number => {
        const source = tx?.timestamp || tx?.created_at || tx?.block_timestamp;
        if (!source) return 0;
        const ms = new Date(source).getTime();
        return Number.isNaN(ms) ? 0 : ms;
    };

    const statusRank = (status: string | null | undefined): number => {
        switch (String(status || '').toUpperCase()) {
            case 'SEALED':
                return 3;
            case 'EXECUTED':
                return 2;
            case 'PENDING':
                return 1;
            default:
                return 0;
        }
    };

    const mergeTx = (existing: any, incoming: any): any => {
        if (!existing) return incoming;
        const merged = { ...existing, ...incoming };

        // Preserve previous values when the incoming payload is missing fields.
        for (const [key, value] of Object.entries(existing)) {
            if (merged[key] == null) merged[key] = value;
        }

        const existingRank = statusRank(existing.status);
        const incomingRank = statusRank(incoming.status);
        merged.status = incomingRank >= existingRank ? incoming.status ?? existing.status : existing.status;

        const existingHeight = getTxHeight(existing);
        const incomingHeight = getTxHeight(incoming);
        if (incomingHeight > existingHeight) merged.block_height = incomingHeight;

        const existingTime = getTxTimestampMs(existing);
        const incomingTime = getTxTimestampMs(incoming);
        if (incomingTime >= existingTime && incomingTime > 0) {
            merged.timestamp = incoming.timestamp ?? merged.timestamp;
            merged.created_at = incoming.created_at ?? merged.created_at;
            merged.block_timestamp = incoming.block_timestamp ?? merged.block_timestamp;
        }

        return merged;
    };

    const compareTxDesc = (a: any, b: any): number => {
        const heightDiff = getTxHeight(b) - getTxHeight(a);
        if (heightDiff !== 0) return heightDiff;

        const indexDiff = getTxIndex(b) - getTxIndex(a);
        if (indexDiff !== 0) return indexDiff;

        const timeDiff = getTxTimestampMs(b) - getTxTimestampMs(a);
        if (timeDiff !== 0) return timeDiff;

        return normalizeTxId(b?.id).localeCompare(normalizeTxId(a?.id));
    };

    const mergeTransactions = (prev: any[], incoming: any[], { prependNew = false }: { prependNew?: boolean } = {}): any[] => {
        const map = new Map();
        const order = [];
        const seen = new Set();

        for (const tx of prev || []) {
            const id = normalizeTxId(tx?.id);
            if (!id) continue;
            map.set(id, tx);
            order.push(id);
            seen.add(id);
        }

        for (const tx of incoming || []) {
            const id = normalizeTxId(tx?.id);
            if (!id) continue;
            const existing = map.get(id);
            map.set(id, mergeTx(existing, tx));
            if (!seen.has(id)) {
                if (prependNew) {
                    order.unshift(id);
                } else {
                    order.push(id);
                }
                seen.add(id);
            }
        }

        const merged = [];
        const dedup = new Set();
        for (const id of order) {
            if (dedup.has(id)) continue;
            const tx = map.get(id);
            if (!tx) continue;
            merged.push(tx);
            dedup.add(id);
        }

        merged.sort(compareTxDesc);
        return merged.slice(0, 50);
    };

    // Load Blocks (client-side fallback when SSR loader fails)
    const loadBlocks = async () => {
        try {
            await ensureHeyApiConfigured();
            const res = await getFlowV1Block({ query: { limit: 50, offset: 0 } });
            const items = res?.data?.data ?? [];
            if (Array.isArray(items) && items.length) {
                setBlocks(items);
                setTps(computeTpsFromBlocks(items));
            }
        } catch (err) {
            console.error("Failed to load blocks", err);
        }
    };

    // Load Txs (Initial only, no pagination)
    const loadTransactions = async () => {
        try {
            await ensureHeyApiConfigured();
            const res = await getFlowV1Transaction({ query: { limit: 50, offset: 0 } });
            const items = res?.data?.data ?? [];
            const transformedTxs = Array.isArray(items) ? items.map((tx: any) => ({
                ...tx,
                type: tx.type || (tx.status === 'SEALED' ? 'TRANSFER' : 'PENDING'),
                payer: tx.payer_address || tx.proposer_address,
                blockHeight: tx.block_height
            })) : [];
            // Merge to avoid websocket "new tx" temporarily disappearing on periodic refresh.
            setTransactions(prev => mergeTransactions(prev, transformedTxs, { prependNew: false }));
        } catch (err) {
            console.error("Failed to load transactions", err);
        }
    };

    const computeTpsFromBlocks = (items: any[]): number => {
        const withTime = (items || []).filter(b => b?.timestamp);
        if (withTime.length < 2) return 0;
        const sorted = [...withTime].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        const newest = new Date(sorted[0].timestamp).getTime();
        const oldest = new Date(sorted[sorted.length - 1].timestamp).getTime();
        const durationSec = Math.max(1, (newest - oldest) / 1000);
        const totalTxs = sorted.reduce((sum, b) => sum + (b.tx_count ?? b.txCount ?? 0), 0);
        return totalTxs / durationSec;
    };

    const computeAvgBlockTime = (items: any[]): number => {
        const withTime = (items || []).filter(b => b?.timestamp);
        if (withTime.length < 2) return 0;
        const sorted = [...withTime].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        const newest = new Date(sorted[0].timestamp).getTime();
        const oldest = new Date(sorted[sorted.length - 1].timestamp).getTime();
        const durationSec = Math.max(1, (newest - oldest) / 1000);
        return durationSec / (sorted.length - 1);
    };

    const [avgBlockTime, setAvgBlockTime] = useState(0);

    useEffect(() => {
        setTps(computeTpsFromBlocks(blocks));
        setAvgBlockTime(computeAvgBlockTime(blocks));
    }, [blocks]);

    // Handle WebSocket messages (Real-time updates)
    useEffect(() => {
        transactionsRef.current = transactions;
    }, [transactions]);

    useEffect(() => {
        if (!lastMessage) return;

        if (lastMessage.type === 'new_block') {
            const newBlock = lastMessage.payload;
            setBlocks(prev => {
                // Dedup by height to avoid duplicates on reconnect/replay.
                const filtered = (prev || []).filter((b) => b?.height !== newBlock?.height);
                return [newBlock, ...filtered].slice(0, 50);
            });
            if (typeof newBlock?.height === 'number') {
                newBlockExpiryRef.current.set(newBlock.height, Date.now() + 3000);
                setHighlightNow(Date.now());
            }
            setStatusRaw((prev: any) => prev ? {
                ...prev,
                latest_height: Math.max(prev.latest_height || 0, newBlock.height),
                max_height: Math.max(prev.max_height || 0, newBlock.height)
            } : prev);
        }

        if (lastMessage.type === 'new_transaction') {
            const rawTx = lastMessage.payload;
            const newTx = {
                ...rawTx,
                type: rawTx.status === 'SEALED' ? 'TRANSFER' : 'PENDING',
                payer: rawTx.payer_address || rawTx.proposer_address,
                blockHeight: rawTx.block_height
            };

            const exists = transactionsRef.current.some(
                (tx) => normalizeTxId(tx?.id) === normalizeTxId(newTx.id)
            );

            setTransactions(prev => {
                const merged = mergeTransactions(prev, [newTx], { prependNew: true });
                return merged.slice(0, 50);
            });

            if (!exists) {
                const id = normalizeTxId(newTx.id);
                if (id) {
                    newTxExpiryRef.current.set(id, Date.now() + 3000);
                    setHighlightNow(Date.now());
                }
                setStatusRaw((prev: any) => prev ? {
                    ...prev,
                    total_transactions: (prev.total_transactions || 0) + 1
                } : prev);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lastMessage]);

    // Initial data load + periodic refresh
    useEffect(() => {
        const active = true;

        const refreshStatus = async () => {
            try {
                await ensureHeyApiConfigured();
                const statusRes = await fetchStatus();
                if (!active || !statusRes) return;
                setStatusRaw(statusRes);
            } catch (error) {
                console.error('Failed to fetch status:', error);
            }
        };

        const refreshNetworkStats = async () => {
            try {
                const stats = await fetchNetworkStats();
                if (!active || !stats) return;
                setNetworkStats(stats);
            } catch (error) {
                console.error('Failed to fetch network stats:', error);
            }
        };

        // Immediate fetch on mount (SSR may have failed if no local backend)
        if (!networkStats) refreshNetworkStats();
        if (!initialBlocks?.length) loadBlocks();
        loadTransactions();
        loadTokens();
        loadNftCollections();

        const statusTimer = setInterval(refreshStatus, 20000);
        const networkStatsTimer = setInterval(refreshNetworkStats, 60000);
        // Fallback polling when websocket is unavailable.
        const txRefreshTimer = setInterval(() => {
            if (!isConnectedRef.current) {
                loadTransactions();
            }
        }, 5000);

        return () => {
            clearInterval(statusTimer);
            clearInterval(networkStatsTimer);
            clearInterval(txRefreshTimer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const latestHeight = statusRaw?.latest_height || 0;
    const minHeight = statusRaw?.min_height || 0;
    const maxHeight = statusRaw?.max_height || 0;
    const coveredRange = maxHeight >= minHeight && maxHeight > 0 ? (maxHeight - minHeight + 1) : 0;
    const totalHistory = latestHeight > 0 ? (latestHeight + 1) : 0;
    const historyPercent = totalHistory > 0 ? (coveredRange / totalHistory) * 100 : 0;
    const maxTpsEstimate = 3900;
    const utilization = maxTpsEstimate > 0 ? (tps / maxTpsEstimate) * 100 : 0;
    const isHistoryComplete = historyPercent >= 99.99;

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-nothing-black text-zinc-900 dark:text-nothing-white font-mono selection:bg-nothing-green selection:text-black transition-colors duration-300">
            <div className="border-b border-zinc-200 dark:border-white/5 bg-white/50 dark:bg-nothing-dark/50">
                <div className="container mx-auto px-4 py-12 space-y-8">
                    {/* Branding / Hero Text */}
                    <div className="text-center space-y-2 mb-8">
                        <motion.div
                            initial={{ opacity: 0, y: -20 }}
                            animate={{ opacity: 1, y: 0 }}
                        >
                            <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-zinc-900 dark:text-white uppercase italic">
                                Flow<span className="text-nothing-green-dark dark:text-nothing-green">Index</span>
                            </h1>
                            <p className="text-[10px] text-gray-500 uppercase tracking-[0.4em]">Decentralized Intelligence Protocol</p>
                        </motion.div>
                    </div>

                    {/* Indexing Progress Banner */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.05 }}
                    >
                        <IndexingStatus />
                    </motion.div>

                    {/* New Premium Stats Grid (Flow Pulse) */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {/* 1. Price Chart */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, delay: 0.1 }}
                        >
                            <FlowPriceChart {...{ data: networkStats } as any} />
                        </motion.div>

                        {/* 2. Epoch Progress */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, delay: 0.15 }}
                        >
                            <EpochProgress
                                epoch={networkStats?.epoch}
                                progress={networkStats?.epoch_progress}
                                updatedAt={networkStats?.updated_at}
                            />
                        </motion.div>

                        {/* 3. Network Stats Grid */}
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, delay: 0.2 }}
                        >
                            <NetworkStats totalStaked={networkStats?.total_staked} totalSupply={networkStats?.total_supply} activeNodes={networkStats?.active_nodes} />
                        </motion.div>
                    </div>
                </div>
            </div>

            <div className="container mx-auto px-4 py-8 space-y-8">
                {/* Basic Stats Section */}
                <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.25 }}
                    >
                    <div className="group bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 hover:border-nothing-green/50 transition-all duration-300 h-full">
                        <div className="flex items-center justify-between mb-4">
                            <div className="p-2 border border-zinc-200 dark:border-white/10 rounded-sm">
                                <Box className="h-5 w-5 text-nothing-green-dark dark:text-nothing-green" />
                            </div>
                            <div className={`flex items-center space-x-2 px-3 py-1 border rounded-sm ${isConnected ? 'bg-emerald-500/10 dark:bg-nothing-green/10 border-emerald-500/30 dark:border-nothing-green/30' : 'bg-white/5 border-white/10'}`}>
                                <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-600 dark:bg-nothing-green animate-pulse' : 'bg-gray-500'}`}></div>
                                <span className={`text-[10px] uppercase tracking-wider ${isConnected ? 'text-nothing-green-dark dark:text-nothing-green' : 'text-gray-500'}`}>
                                    {isConnected ? 'System Online' : 'Offline'}
                                </span>
                            </div>
                        </div>
                        <div className="space-y-1">
                            <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest">Latest Block</p>
                            <p className="text-3xl font-bold font-mono text-zinc-900 dark:text-white group-hover:text-nothing-green-dark dark:group-hover:text-nothing-green transition-colors">
                                <SafeNumberFlow
                                    value={statusRaw?.latest_height || 0}
                                    format={{ useGrouping: true }}
                                />
                            </p>
                        </div>
                    </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.3 }}
                    >
                    <div className="group bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 hover:border-zinc-300 dark:hover:border-white/30 transition-all duration-300 h-full">
                        <div className="flex items-center justify-between mb-4">
                            <div className="p-2 border border-zinc-200 dark:border-white/10 rounded-sm">
                                <Activity className="h-5 w-5 text-zinc-900 dark:text-white" />
                            </div>
                            {!isHistoryComplete && (
                                <div
                                    className="flex items-center space-x-2 px-3 py-1 border border-yellow-500/30 bg-yellow-500/10 rounded-sm cursor-help"
                                    title="Data indexing is in progress. Historical data may be incomplete."
                                >
                                    <div className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                                    <span className="text-[10px] uppercase tracking-wider text-yellow-400">Partial Data</span>
                                </div>
                            )}
                        </div>
                        <div className="space-y-1">
                            <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest">Total TXs</p>
                            <p className="text-3xl font-bold font-mono text-zinc-900 dark:text-white">
                                <SafeNumberFlow
                                    value={statusRaw?.total_transactions || 0}
                                    format={{ useGrouping: true }}
                                />
                            </p>
                        </div>
                    </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.35 }}
                    >
                    <div className="group bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 hover:border-zinc-300 dark:hover:border-white/30 transition-all duration-300 h-full">
                        <div className="flex items-center justify-between mb-4">
                            <div className="p-2 border border-zinc-200 dark:border-white/10 rounded-sm">
                                <TrendingUp className="h-5 w-5 text-zinc-900 dark:text-white" />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest">Network TPS</p>
                            <p className="text-3xl font-bold font-mono text-zinc-900 dark:text-white">
                                <SafeNumberFlow
                                    value={tps || 0}
                                    format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
                                />
                            </p>
                            <p className="text-[10px] text-zinc-400 dark:text-gray-500 uppercase tracking-widest">
                                Utilization: {Math.min(100, utilization).toFixed(2)}% (Est. {formatNumber(maxTpsEstimate)} TPS)
                            </p>
                        </div>
                    </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.4 }}
                    >
                    <div className="group bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 hover:border-zinc-300 dark:hover:border-white/30 transition-all duration-300 h-full">
                        <div className="flex items-center justify-between mb-4">
                            <div className="p-2 border border-zinc-200 dark:border-white/10 rounded-sm">
                                <Box className="h-5 w-5 text-zinc-900 dark:text-white" />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest">Average Block Time</p>
                            <p className="text-3xl font-bold font-mono text-zinc-900 dark:text-white">
                                {avgBlockTime > 0 ? `${avgBlockTime.toFixed(2)}s` : 'N/A'}
                            </p>
                            <p className="text-[10px] text-zinc-400 dark:text-gray-500 uppercase tracking-widest">
                                Based on recent blocks
                            </p>
                        </div>
                    </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.45 }}
                    >
                    <div className="group bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 hover:border-zinc-300 dark:hover:border-white/30 transition-all duration-300 h-full">
                        <div className="flex items-center justify-between mb-4">
                            <div className="p-2 border border-zinc-200 dark:border-white/10 rounded-sm">
                                <Activity className="h-5 w-5 text-zinc-900 dark:text-white" />
                            </div>
                            {!isHistoryComplete && (
                                <div
                                    className="flex items-center space-x-2 px-3 py-1 border border-yellow-500/30 bg-yellow-500/10 rounded-sm cursor-help"
                                    title="Data indexing is in progress. Historical data may be incomplete."
                                >
                                    <div className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
                                    <span className="text-[10px] uppercase tracking-wider text-yellow-400">Partial Data</span>
                                </div>
                            )}
                        </div>
                        <div className="space-y-1">
                            <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest">Total Addresses</p>
                            <p className="text-3xl font-bold font-mono text-zinc-900 dark:text-white">
                                <SafeNumberFlow
                                    value={statusRaw?.total_addresses || 0}
                                    format={{ useGrouping: true }}
                                />
                            </p>
                        </div>
                    </div>
                    </motion.div>
                </div>

                {/* Charts Section */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.55 }}
                >
                    <DailyStatsChart />
                </motion.div>

                {/* Top Tokens & Top Collections Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Top Tokens */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.6 }}
                        className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10"
                    >
                        <div className="flex items-center justify-between p-6 pb-0">
                            <div className="flex items-center space-x-3">
                                <Coins className="h-5 w-5 text-nothing-green-dark dark:text-nothing-green" />
                                <h2 className="text-lg font-bold text-zinc-900 dark:text-white uppercase tracking-widest">Trending Tokens</h2>
                            </div>
                            <Link to="/tokens" className="text-xs text-nothing-green-dark dark:text-nothing-green uppercase tracking-widest hover:underline font-mono">
                                View All &rarr;
                            </Link>
                        </div>
                        <div className="p-6 pt-4">
                            {(tokens || []).length === 0 ? (
                                <p className="text-xs text-zinc-400 dark:text-gray-500 font-mono">No tokens found.</p>
                            ) : (
                                <div className="flex flex-col">
                                    {(tokens || []).slice(0, 5).map((token: any) => (
                                        <Link
                                            key={token.id}
                                            to={`/tokens/${token.id}` as any}
                                            className="flex items-center space-x-3 px-3 py-3 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors duration-150 border-b border-zinc-100 dark:border-white/5 last:border-b-0"
                                        >
                                            <div className="relative w-6 h-6 flex-shrink-0 bg-zinc-100 dark:bg-white/10 flex items-center justify-center overflow-hidden">
                                                {token.logo ? (
                                                    <img
                                                        src={token.logo}
                                                        alt={token.name || ''}
                                                        className="w-6 h-6 object-cover"
                                                        onError={(e) => {
                                                            (e.target as HTMLImageElement).style.display = 'none';
                                                            ((e.target as HTMLImageElement).nextElementSibling as HTMLElement)!.style.display = 'flex';
                                                        }}
                                                    />
                                                ) : null}
                                                <div
                                                    className="w-6 h-6 bg-nothing-green/20 text-nothing-green-dark dark:text-nothing-green text-[10px] font-bold font-mono items-center justify-center"
                                                    style={{ display: token.logo ? 'none' : 'flex' }}
                                                >
                                                    {(token.symbol || token.name || '?').charAt(0).toUpperCase()}
                                                </div>
                                            </div>
                                            <div className="flex flex-col min-w-0 flex-1">
                                                <div className="flex items-center space-x-2">
                                                    <span className="text-xs font-mono text-zinc-900 dark:text-white truncate">{token.name || 'Unknown'}</span>
                                                    {token.symbol && (
                                                        <span className="text-[10px] font-mono text-zinc-400 dark:text-gray-500 uppercase">{token.symbol}</span>
                                                    )}
                                                </div>
                                                <span className="text-[10px] font-mono text-zinc-400 dark:text-gray-600 truncate">
                                                    {token.address ? `A.${token.address}.${token.contract_name || ''}` : token.id}
                                                </span>
                                            </div>
                                            {token.transfer_count > 0 && (
                                                <span className="text-[10px] font-mono text-zinc-400 dark:text-gray-500 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 px-2 py-0.5 rounded-sm flex-shrink-0">
                                                    {formatNumber(token.transfer_count)} txs
                                                </span>
                                            )}
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </div>
                    </motion.div>

                    {/* Top Collections */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.65 }}
                        className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10"
                    >
                        <div className="flex items-center justify-between p-6 pb-0">
                            <div className="flex items-center space-x-3">
                                <Image className="h-5 w-5 text-nothing-green-dark dark:text-nothing-green" />
                                <h2 className="text-lg font-bold text-zinc-900 dark:text-white uppercase tracking-widest">Trending Collections</h2>
                            </div>
                            <Link to="/nfts" className="text-xs text-nothing-green-dark dark:text-nothing-green uppercase tracking-widest hover:underline font-mono">
                                View All &rarr;
                            </Link>
                        </div>
                        <div className="p-6 pt-4">
                            {(nftCollections || []).length === 0 ? (
                                <p className="text-xs text-zinc-400 dark:text-gray-500 font-mono">No collections found.</p>
                            ) : (
                                <div className="flex flex-col">
                                    {(nftCollections || []).slice(0, 5).map((nft: any) => (
                                        <Link
                                            key={nft.id}
                                            to={`/nfts/${nft.id}` as any}
                                            className="flex items-center space-x-3 px-3 py-3 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors duration-150 border-b border-zinc-100 dark:border-white/5 last:border-b-0"
                                        >
                                            <div className="relative w-6 h-6 flex-shrink-0 bg-zinc-100 dark:bg-white/10 flex items-center justify-center overflow-hidden">
                                                {(nft.square_image || nft.logo) ? (
                                                    <img
                                                        src={nft.square_image || nft.logo}
                                                        alt={nft.display_name || nft.name || ''}
                                                        className="w-6 h-6 object-cover"
                                                        onError={(e) => {
                                                            (e.target as HTMLImageElement).style.display = 'none';
                                                            ((e.target as HTMLImageElement).nextElementSibling as HTMLElement)!.style.display = 'flex';
                                                        }}
                                                    />
                                                ) : null}
                                                <div
                                                    className="w-6 h-6 bg-nothing-green/20 text-nothing-green-dark dark:text-nothing-green text-[10px] font-bold font-mono items-center justify-center"
                                                    style={{ display: (nft.square_image || nft.logo) ? 'none' : 'flex' }}
                                                >
                                                    {(nft.display_name || nft.name || '?').charAt(0).toUpperCase()}
                                                </div>
                                            </div>
                                            <div className="flex flex-col min-w-0 flex-1">
                                                <span className="text-xs font-mono text-zinc-900 dark:text-white truncate">{nft.display_name || nft.name || 'Unknown'}</span>
                                            </div>
                                            {nft.transfer_count > 0 ? (
                                                <span className="text-[10px] font-mono text-zinc-400 dark:text-gray-500 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 px-2 py-0.5 rounded-sm flex-shrink-0">
                                                    {formatNumber(nft.transfer_count)} txs
                                                </span>
                                            ) : nft.number_of_tokens != null ? (
                                                <span className="text-[10px] font-mono text-zinc-400 dark:text-gray-500 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 px-2 py-0.5 rounded-sm flex-shrink-0">
                                                    {formatNumber(nft.number_of_tokens)} items
                                                </span>
                                            ) : null}
                                        </Link>
                                    ))}
                                </div>
                            )}
                        </div>
                    </motion.div>
                </div>

                {/* Blocks & Transactions Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Recent Blocks */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.7 }}
                        className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 h-[1240px] flex flex-col overflow-hidden"
                    >
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center space-x-3">
                                <Box className="h-5 w-5 text-nothing-green-dark dark:text-nothing-green" />
                                <h2 className="text-lg font-bold text-zinc-900 dark:text-white uppercase tracking-widest">Recent Blocks</h2>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col gap-2 pr-1 relative">
                            <AnimatePresence initial={false} mode="popLayout" presenceAffectsLayout>
                                {(blocks || []).map((block) => {
                                    // highlightTick is used so highlight disappears even if no new data arrives.
                                    const _ = highlightNow; // keep in render dependency
                                    const isNew = (newBlockExpiryRef.current.get(block.height) ?? 0) > highlightTick;
                                    const blockTimeAbsolute = formatAbsoluteTime(block.timestamp);
                                    const blockTimeText = hydrated
                                        ? formatRelativeTime(block.timestamp, nowTick)
                                        : blockTimeAbsolute;
                                    const blockIdFull = normalizeHex(block.id || '');
                                    const blockIdShort = formatMiddle(blockIdFull, 12, 8);
                                    return (
                                        <motion.div
                                            key={block.height}
                                            // Animate other items shifting down when a new one is inserted at the top.
                                            // Use position-only layout animation to keep cost reasonable.
                                            layout="position"
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, scale: 0.95 }}
                                            transition={{ type: "spring", stiffness: 300, damping: 25 }}
                                        >
                                            <Link
                                                to={`/blocks/${block.height}` as any}
                                                className={`block border p-4 h-20 transition-colors duration-200 hover:bg-zinc-50 dark:hover:bg-white/5 hover:border-zinc-300 dark:hover:border-white/20 relative overflow-hidden ${isNew
                                                    ? 'bg-nothing-green/10 border-nothing-green/50'
                                                    : 'bg-white dark:bg-black/20 border-zinc-100 dark:border-white/5'
                                                    }`}
                                            >
                                                {isNew && <div className="absolute top-0 right-0 w-2 h-2 bg-nothing-green animate-ping" />}
                                                <div className="flex items-center justify-between h-full">
                                                    <div className="flex flex-col">
                                                        <span className="text-xs text-nothing-green-dark dark:text-nothing-green font-mono">#{formatNumber(block.height)}</span>
                                                        <span
                                                            className="text-[10px] text-gray-500 font-mono hidden sm:inline-block"
                                                            title={blockIdFull || ''}
                                                        >
                                                            Id: {blockIdShort || 'N/A'}
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-col items-end">
                                                        <div className="text-xs text-gray-300 font-mono bg-white/5 px-2 py-0.5 rounded-sm">
                                                            {block.tx_count ?? block.txCount ?? 0} TXs
                                                        </div>
                                                        <span
                                                            className="text-[10px] text-gray-600 font-mono uppercase mt-1"
                                                            title={blockTimeAbsolute || ''}
                                                        >
                                                            {blockTimeText || ''}
                                                        </span>
                                                    </div>
                                                </div>
                                            </Link>
                                        </motion.div>
                                    );
                                })}
                            </AnimatePresence>
                        </div>
                    </motion.div >

                    {/* Recent Transactions */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, delay: 0.75 }}
                        className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 h-[1240px] flex flex-col overflow-hidden"
                    >
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center space-x-3">
                                <Activity className="h-5 w-5 text-zinc-900 dark:text-white" />
                                <h2 className="text-lg font-bold text-zinc-900 dark:text-white uppercase tracking-widest">Recent TXs</h2>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col gap-2 pr-1 relative">
                            <AnimatePresence initial={false} mode="popLayout" presenceAffectsLayout>
                                {(transactions || []).map((tx) => {
                                    const _ = highlightNow; // keep in render dependency
                                    const isNew = (newTxExpiryRef.current.get(normalizeTxId(tx.id)) ?? 0) > highlightTick;
                                    const isSealed = tx.status === 'SEALED';
                                    const isError = Boolean(tx.error_message || tx.errorMessage);
                                    const txTimeSource = tx.timestamp || tx.created_at || tx.block_timestamp;
                                    const txTimeAbsolute = formatAbsoluteTime(txTimeSource);
                                    const txTimeText = hydrated
                                        ? formatRelativeTime(txTimeSource, nowTick)
                                        : txTimeAbsolute;
                                    const txIdFull = normalizeHex(tx.id || '');
                                    const txIdShort = formatMiddle(txIdFull, 12, 8);

                                    // Helper to determine Transaction Type & Details
                                    const getTxMetadata = (tx: any) => {
                                        let type = 'Interaction';
                                        let transferInfo = null;

                                        // Check Events for type inference
                                        if (tx.events && Array.isArray(tx.events)) {
                                            for (const evt of tx.events) {
                                                if (evt.type.includes('TokensDeposited')) {
                                                    type = 'Transfer';
                                                    if (evt.values?.value?.fields) {
                                                        const amount = evt.values.value.fields.find((f: any) => f.name === 'amount')?.value?.value;
                                                        if (amount) transferInfo = `${parseFloat(amount).toFixed(2)} FLOW`;
                                                    }
                                                } else if (evt.type.includes('AccountCreated')) {
                                                    type = 'Create Account';
                                                } else if (evt.type.includes('AccountContractAdded')) {
                                                    type = 'Deploy Contract';
                                                } else if (evt.type.includes('Mint')) {
                                                    type = 'Mint';
                                                }
                                            }
                                        }

                                        // Fallback to script/backend provided type
                                        if (type === 'Interaction' && tx.type && tx.type !== 'PENDING' && tx.type !== 'TRANSFER') {
                                            type = tx.type;
                                        }

                                        return { type, transferInfo };
                                    };

                                    const { type: txType, transferInfo } = getTxMetadata(tx);

                                    return (
                                        <motion.div
                                            key={tx.id}
                                            layout="position"
                                            initial={{ opacity: 0, x: 10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, scale: 0.95 }}
                                            transition={{ type: "spring", stiffness: 300, damping: 25 }}
                                        >
                                            <Link
                                                to={`/tx/${tx.id}` as any}
                                                className={`block border p-4 h-20 transition-colors duration-200 hover:bg-zinc-50 dark:hover:bg-white/5 hover:border-zinc-300 dark:hover:border-white/20 relative overflow-hidden ${isNew
                                                    ? 'bg-white/10 border-white/40' // Keep new highlight distinct or adjust
                                                    : 'bg-white dark:bg-black/20 border-zinc-100 dark:border-white/5'
                                                    }`}
                                            >
                                                {isNew && <div className="absolute top-0 right-0 w-2 h-2 bg-white animate-ping" />}
                                                <div className="flex items-center justify-between h-full">
                                                    <div className="flex flex-col min-w-0">
                                                        <span
                                                            className="text-xs text-gray-400 font-mono truncate w-52 sm:w-64"
                                                            title={txIdFull || ''}
                                                        >
                                                            {txIdShort || tx.id}
                                                        </span>
                                                        <div className="flex items-center space-x-2">
                                                            <span className={`text-[10px] uppercase px-1.5 py-0.5 border rounded-sm tracking-wider ${txType === 'Transfer' ? 'border-cyan-500/30 text-cyan-400 bg-cyan-500/5' :
                                                                txType === 'Mint' ? 'border-yellow-500/30 text-yellow-400 bg-yellow-500/5' :
                                                                    'border-white/20 text-gray-300 bg-white/5'
                                                                }`}>
                                                                {txType}
                                                            </span>
                                                            {transferInfo && (
                                                                <span className="text-[10px] text-white font-mono truncate">
                                                                    {transferInfo}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col items-end">
                                                        <span
                                                            className="text-[10px] text-gray-500 font-mono"
                                                            title={txTimeAbsolute || ''}
                                                        >
                                                            {txTimeText || ''}
                                                        </span>
                                                        <span className={`mt-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-sm border ${isError ? 'border-red-500/50 text-red-500 bg-red-500/10' : isSealed ? 'border-nothing-green-dark/50 dark:border-nothing-green/50 text-nothing-green-dark dark:text-nothing-green bg-nothing-green-dark/10 dark:bg-nothing-green/10' : 'border-white/20 text-gray-400 bg-white/5'
                                                            }`}>
                                                            {isError ? 'Error' : isSealed ? 'Sealed' : 'Pending'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </Link>
                                        </motion.div>
                                    );
                                })}
                            </AnimatePresence>
                        </div>
                    </motion.div >

                </div >
            </div >
        </div >
    );
}

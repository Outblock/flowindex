import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Box, Database } from 'lucide-react';
import NumberFlow from '@number-flow/react';
import { ensureHeyApiConfigured, fetchStatus } from '../../api/heyapi';
import { getFlowV1Block } from '../../api/gen/find';
import { useWebSocketMessages, useWebSocketStatus } from '../../hooks/useWebSocket';
import { Pagination } from '../../components/Pagination';
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/time';
import { useTimeTicker } from '../../hooks/useTimeTicker';

// Loader to fetch initial blocks and status
export const Route = createFileRoute('/blocks/')({
    component: Blocks,
    loader: async ({ location }) => {
        const page = Number(new URLSearchParams(location.search).get('page') || '1');
        // Note: For pagination to work optimally with SSR, we might need to adjust the API or use a search param for cursor
        // For now, we load the first page's data.
        try {
            await ensureHeyApiConfigured();
            const [blocksRes, statusRes] = await Promise.all([
                getFlowV1Block({ query: { limit: 20, offset: 0 } }),
                fetchStatus()
            ]);
            return { blocksRes: blocksRes.data?.data ?? [], statusRes: statusRes, page };
        } catch (e) {
            console.error("Failed to load blocks data", e);
            return { blocksRes: [], statusRes: null, page: 1 };
        }
    }
})

function Blocks() {
    const { blocksRes, statusRes, page } = Route.useLoaderData();
    const [blocks, setBlocks] = useState<any[]>(Array.isArray(blocksRes) ? blocksRes : []);
    const [statusRaw, setStatusRaw] = useState<any>(statusRes);
    const [blockPage, setBlockPage] = useState(page);
    const [blockCursors, setBlockCursors] = useState<Record<number, string>>({ 1: '' });
    const [blockHasNext, setBlockHasNext] = useState(blocksRes.length >= 20);
    const [newBlockIds, setNewBlockIds] = useState(new Set());

    const { isConnected } = useWebSocketStatus();
    const { lastMessage } = useWebSocketMessages();
    const nowTick = useTimeTicker(20000);

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

    const mergeBlocks = (prev: any[], incoming: any[]): any[] => {
        const byHeight = new Map();

        for (const block of prev || []) {
            if (!block || block.height == null) continue;
            byHeight.set(Number(block.height), block);
        }

        for (const block of incoming || []) {
            if (!block || block.height == null) continue;
            const height = Number(block.height);
            const existing = byHeight.get(height);
            byHeight.set(height, existing ? { ...existing, ...block } : block);
        }

        return Array.from(byHeight.values())
            .sort((a, b) => Number(b?.height ?? 0) - Number(a?.height ?? 0))
            .slice(0, 50); // Keep reasonable buffer
    };

    const loadBlocks = async (page: number) => {
        try {
            const offset = (page - 1) * 20;
            await ensureHeyApiConfigured();
            const res = await getFlowV1Block({ query: { limit: 20, offset } });
            const items = res.data?.data ?? [];
            setBlocks(prev => (page === 1 ? mergeBlocks(prev, items) : items));
            setBlockHasNext(items.length >= 20);
        } catch (err) {
            console.error("Failed to load blocks", err);
        }
    };

    const handleBlockPageChange = (newPage: number) => {
        setBlockPage(newPage);
        loadBlocks(newPage);
    };

    // Stats
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
        setAvgBlockTime(computeAvgBlockTime(blocks));
    }, [blocks]);

    // WebSocket
    useEffect(() => {
        if (!lastMessage) return;

        if (blockPage === 1 && lastMessage.type === 'new_block') {
            const newBlock = lastMessage.payload;
            setBlocks(prev => {
                const next = [newBlock, ...(prev || [])];
                return next.slice(0, 20); // Maintain page size
            });
            setNewBlockIds(prev => new Set(prev).add(newBlock.height));
            setTimeout(() => setNewBlockIds(prev => {
                const next = new Set(prev);
                next.delete(newBlock.height);
                return next;
            }), 3000);
            setStatusRaw(prev => prev ? {
                ...prev,
                latest_height: Math.max(prev.latest_height || 0, newBlock.height),
            } : prev);
        }
    }, [lastMessage, blockPage]);

    // Initial Load - handled by loader, but we keep status refresh
    useEffect(() => {
        const refreshStatus = async () => {
            try {
                await ensureHeyApiConfigured();
                const status = await fetchStatus();
                if (status) setStatusRaw(status);
            } catch (error) {
                console.error('Failed to fetch status:', error);
            }
        };

        const statusTimer = setInterval(refreshStatus, 10000);
        return () => clearInterval(statusTimer);
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
                    <div className="p-3 bg-nothing-green/10 rounded-lg">
                        <Box className="h-8 w-8 text-nothing-green-dark dark:text-nothing-green" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-zinc-900 dark:text-white uppercase tracking-tighter">Blocks</h1>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">Network Consensus History</p>
                    </div>
                </div>

                <div className={`flex items-center space-x-2 px-3 py-1 border rounded-full ${isConnected ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                    <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                    <span className="text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                        {isConnected ? 'Live Feed' : 'Connecting...'}
                    </span>
                </div>
            </motion.div>

            {/* Stats Cards */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="grid grid-cols-1 md:grid-cols-3 gap-6"
            >
                <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm">
                    <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Latest Height</p>
                    <p className="text-3xl font-bold font-mono text-zinc-900 dark:text-white">
                        <NumberFlow value={statusRaw?.latest_height || 0} format={{ useGrouping: true }} />
                    </p>
                </div>

                <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm">
                    <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Average Block Time</p>
                    <p className="text-3xl font-bold font-mono text-zinc-900 dark:text-white">
                        {avgBlockTime > 0 ? `${avgBlockTime.toFixed(2)}s` : 'Computing...'}
                    </p>
                </div>

                <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm">
                    <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Indexed Blocks</p>
                    <div className="flex items-center gap-2">
                        <Database className="w-4 h-4 text-zinc-400" />
                        <p className="text-xl font-bold font-mono text-zinc-900 dark:text-white">
                            {statusRaw?.max_height ? (statusRaw.max_height - statusRaw.min_height + 1).toLocaleString() : '...'}
                        </p>
                    </div>
                </div>
            </motion.div>

            {/* Blocks List */}
            <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-white/5">
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Height</th>
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">ID</th>
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Timestamp</th>
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">TX Count</th>
                            </tr>
                        </thead>
                        <tbody>
                            <AnimatePresence mode='popLayout'>
                                {blocks.map((block) => {
                                    const isNew = newBlockIds.has(block.height);
                                    const blockTimeRelative = formatRelativeTime(block.timestamp, nowTick);
                                    const blockTimeAbsolute = formatAbsoluteTime(block.timestamp);
                                    const blockIdFull = normalizeHex(block.id);
                                    const blockIdShort = formatMiddle(blockIdFull, 16, 16);

                                    return (
                                        <motion.tr
                                            layout
                                            key={block.height}
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            className={`border-b border-zinc-100 dark:border-white/5 group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors ${isNew ? 'bg-nothing-green/10' : ''
                                                }`}
                                        >
                                            <td className="p-4">
                                                <Link to={`/blocks/${block.height}`} className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline">
                                                    #{block.height.toLocaleString()}
                                                </Link>
                                            </td>
                                            <td className="p-4">
                                                <span className="font-mono text-sm text-zinc-600 dark:text-zinc-400" title={blockIdFull}>
                                                    {blockIdShort}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                <div className="flex flex-col">
                                                    <span className="text-sm text-zinc-900 dark:text-white">{blockTimeRelative}</span>
                                                    <span className="text-xs text-zinc-500">{blockTimeAbsolute}</span>
                                                </div>
                                            </td>
                                            <td className="p-4 text-right">
                                                <span className="font-mono text-sm bg-zinc-100 dark:bg-white/10 px-2 py-1 rounded">
                                                    {block.tx_count ?? block.txCount ?? 0}
                                                </span>
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
                        currentPage={blockPage}
                        onPageChange={handleBlockPageChange}
                        hasNext={blockHasNext}
                    />
                </div>
            </div>
        </div>
    );
}

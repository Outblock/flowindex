import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database, Activity, HardDrive, Server, Layers, Info, Square } from 'lucide-react';
import NumberFlow from '@number-flow/react';
import { api } from '../api';

const CHUNK_SIZES = [
    { label: '50K', value: 50000 },
    { label: '100K', value: 100000 },
    { label: '500K', value: 500000 },
    { label: '1M', value: 1000000 },
    { label: '5M', value: 5000000 },
];

export default function Stats() {
    const [activeTab, setActiveTab] = useState('system'); // 'system' or 'mosaic'
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);

    // State for Speed Calculations
    const [historySpeed, setHistorySpeed] = useState(0); // blocks per second
    const [forwardSpeed, setForwardSpeed] = useState(0); // blocks per second
    const lastHistoryCheckRef = useRef(null); // { time: number, height: number }
    const lastForwardCheckRef = useRef(null); // { time: number, height: number }

    // State for Indexing Map
    const [chunkSize, setChunkSize] = useState(100000); // Default 0.1M
    const [hoveredChunk, setHoveredChunk] = useState(null);

    const processStatus = useCallback((data) => {
        const now = Date.now();

        // Calculate History Speed (Backward)
        const currentHistoryHeight = (data.history_height && data.history_height > 0)
            ? data.history_height
            : (data.min_height || 0);

        if (lastHistoryCheckRef.current) {
            const timeDiff = (now - lastHistoryCheckRef.current.time) / 1000;
            // Since history goes backwards (high -> low), diff is last - current
            const blockDiff = lastHistoryCheckRef.current.height - currentHistoryHeight;
            if (timeDiff > 0 && blockDiff >= 0) {
                const instantaneousSpeed = blockDiff / timeDiff;
                setHistorySpeed(prev => (prev * 0.7) + (instantaneousSpeed * 0.3));
            }
        }
        lastHistoryCheckRef.current = { time: now, height: currentHistoryHeight };

        // Calculate Forward Speed (New blocks)
        const currentForwardHeight = data.indexed_height || 0;
        if (lastForwardCheckRef.current) {
            const timeDiff = (now - lastForwardCheckRef.current.time) / 1000;
            const blockDiff = currentForwardHeight - lastForwardCheckRef.current.height;
            if (timeDiff > 0 && blockDiff >= 0) {
                const instantaneousSpeed = blockDiff / timeDiff;
                setForwardSpeed(prev => (prev * 0.7) + (instantaneousSpeed * 0.3));
            }
        }
        lastForwardCheckRef.current = { time: now, height: currentForwardHeight };

        setStatus(data);
        setLoading(false);
    }, []);

    const fetchStatus = async () => {
        try {
            const data = await api.getStatus();
            processStatus(data);
        } catch (error) {
            console.error('Failed to fetch status:', error);
        }
    };

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 3000);

        let ws;
        try {
            const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
            const wsUrl = `${proto}://${window.location.host}/ws/status`;
            ws = new WebSocket(wsUrl);
            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    processStatus(data);
                } catch (err) {
                    console.error('Failed to parse status WS payload:', err);
                }
            };
        } catch (err) {
            console.error('Failed to open status WS:', err);
        }

        return () => {
            clearInterval(interval);
            if (ws) ws.close();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [processStatus]);

    // Derived values for System Stats
    const startHeight = status?.start_height || 0;
    const indexedHeight = status?.indexed_height || 0;
    const latestHeight = status?.latest_height || 0;
    const minHeight = status?.min_height || 0;
    const historyHeight = status?.history_height || minHeight;
    const forwardEnabled = status?.forward_enabled ?? true;
    const historyEnabled = status?.history_enabled ?? true;
    const workerEnabled = status?.worker_enabled || {};
    const checkpoints = status?.checkpoints || {};
    const workerOrder = [
        { key: 'main_ingester', label: 'Main Ingester' },
        { key: 'history_ingester', label: 'History Ingester' },
        { key: 'token_worker', label: 'Token Worker' },
        { key: 'meta_worker', label: 'Meta Worker' },
        { key: 'accounts_worker', label: 'Accounts Worker' },
        { key: 'ft_holdings_worker', label: 'FT Holdings Worker' },
        { key: 'nft_ownership_worker', label: 'NFT Ownership Worker' },
        { key: 'tx_contracts_worker', label: 'TX Contracts Worker' },
        { key: 'tx_metrics_worker', label: 'TX Metrics Worker' },
    ];
    const totalRange = latestHeight - startHeight;
    const indexedRange = indexedHeight - startHeight;
    const progressPercent = totalRange > 0 ? (indexedRange / totalRange) * 100 : 0;
    const blocksBehind = latestHeight > indexedHeight ? (latestHeight - indexedHeight) : 0;
    const blocksPerSecond = forwardSpeed || 0;
    const eta = blocksPerSecond > 0 ? Math.ceil(blocksBehind / blocksPerSecond) : 0;
    let historyEtaSeconds = 0;
    if (historySpeed > 0) {
        historyEtaSeconds = historyHeight / historySpeed;
    }
    const historyBase = latestHeight > 0 ? latestHeight : startHeight;
    const historyTotal = historyBase > 0 ? historyBase : 0;
    const historyCovered = historyBase > 0 && historyHeight > 0 ? Math.max(0, historyBase - historyHeight) : 0;
    const historyPercent = historyTotal > 0 ? (historyCovered / historyTotal) * 100 : 0;
    const forwardStatusLabel = !forwardEnabled ? 'DISABLED' : (blocksBehind > 0 ? 'SYNCING' : 'CAUGHT UP');
    const historyStatusLabel = !historyEnabled ? 'DISABLED' : (historySpeed > 0 ? 'SYNCING' : 'IDLE');
    const isForwardActive = forwardEnabled && blocksBehind > 0;
    const isHistoryActive = historyEnabled && historySpeed > 0;
    const formatDuration = (seconds) => {
        if (!isFinite(seconds) || seconds === 0) return 'N/A';
        const d = Math.floor(seconds / (3600 * 24));
        const h = Math.floor((seconds % (3600 * 24)) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (d > 0) return `${d}d ${h}h`;
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m ${Math.floor(seconds % 60)}s`;
    };

    // Derived values for Mosaic Map
    const chunks = useMemo(() => {
        if (!status) return [];
        const chainTip = Math.max(status.latest_height || 0, status.max_height || 0);
        // Ensure we have at least one chunk
        const totalChunks = Math.max(1, Math.ceil(chainTip / chunkSize));
        // Generate chunks from 0 to Tip
        const result = [];
        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min((i + 1) * chunkSize - 1, chainTip);
            result.push({ index: i, start, end });
        }
        return result;
    }, [status, chunkSize]);

    const getChunkStatus = (chunk) => {
        if (!status) return 'unknown';
        const { min_height = 0, max_height = 0 } = status;
        const chunkStart = chunk.start;
        const chunkEnd = chunk.end;

        if (chunkStart >= min_height && chunkEnd <= max_height) return 'indexed';
        if (max_height >= chunkStart && max_height <= chunkEnd) return 'indexing';
        if (chunkEnd < min_height) return 'missing';
        if (chunkStart > max_height) return 'pending';
        if (chunkStart < min_height && chunkEnd >= min_height) return 'backfilling';
        return 'unknown';
    };

    const mosaicStats = useMemo(() => {
        const total = chunks.length;
        const indexed = chunks.filter(c => getChunkStatus(c) === 'indexed').length;
        const percent = total > 0 ? (indexed / total) * 100 : 0;
        return { total, indexed, percent };
    }, [chunks, status]); // eslint-disable-line react-hooks/exhaustive-deps


    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-black flex items-center justify-center transition-colors duration-300">
                <div className="animate-pulse text-zinc-600 dark:text-white">Loading system data...</div>
            </div>
        );
    }



    return (
        <div className="min-h-screen bg-gray-50 dark:bg-black text-zinc-900 dark:text-white transition-colors duration-300 font-mono">
            <div className="max-w-7xl mx-auto px-4 py-8">
                {/* Header & Tabs */}
                <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-6">
                    <div>
                        <h1 className="text-3xl font-bold text-zinc-900 dark:text-white mb-2 flex items-center">
                            <Layers className="mr-3 h-8 w-8 text-nothing-green-dark dark:text-nothing-green" />
                            Indexing Status
                        </h1>
                        <p className="text-zinc-500 dark:text-gray-400 text-sm">
                            Real-time indexer monitoring and visualization
                        </p>
                    </div>

                    <div className="bg-zinc-100 dark:bg-nothing-dark p-1 rounded-sm border border-zinc-200 dark:border-white/10 flex">
                        <button
                            onClick={() => setActiveTab('system')}
                            className={`px-6 py-2 text-xs uppercase tracking-widest font-bold rounded-sm transition-all ${activeTab === 'system'
                                ? 'bg-white dark:bg-white/10 text-zinc-900 dark:text-white shadow-sm'
                                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                                }`}
                        >
                            System Metrics
                        </button>
                        <button
                            onClick={() => setActiveTab('mosaic')}
                            className={`px-6 py-2 text-xs uppercase tracking-widest font-bold rounded-sm transition-all ${activeTab === 'mosaic'
                                ? 'bg-white dark:bg-white/10 text-zinc-900 dark:text-white shadow-sm'
                                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                                }`}
                        >
                            Network Mosaic
                        </button>
                    </div>
                </div>

                {/* Content Area */}
                <AnimatePresence mode="wait">
                    {activeTab === 'system' ? (
                        <motion.div
                            key="system"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                        >
                            {/* Main Indexing Progress (Forward) */}
                            <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-8 mb-6 rounded-sm shadow-sm dark:shadow-none">
                                <div className="flex items-center justify-between mb-6">
                                    <div className="flex items-center space-x-3">
                                        <Database className="h-5 w-5 text-nothing-green-dark dark:text-nothing-green" />
                                        <h2 className="text-lg font-bold text-zinc-900 dark:text-white uppercase tracking-wide">Live Indexing (Forward)</h2>
                                        <div className="flex items-center space-x-2 ml-4">
                                            <span className={`flex h-2 w-2 rounded-full ${forwardStatusLabel === 'SYNCING' ? 'bg-green-500 animate-pulse' : forwardStatusLabel === 'DISABLED' ? 'bg-red-500' : 'bg-gray-500'}`}></span>
                                            <span className="text-[10px] text-zinc-500 dark:text-gray-400 font-bold uppercase">{forwardStatusLabel}</span>
                                        </div>
                                    </div>
                                    <span className="text-2xl font-bold text-nothing-green-dark dark:text-nothing-green">
                                        <NumberFlow value={progressPercent} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} />%
                                    </span>
                                </div>

                                <div className="relative h-12 bg-zinc-100 dark:bg-black/50 border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden mb-6">
                                    <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${progressPercent}%` }}
                                        transition={{ duration: 1, ease: "easeOut" }}
                                        className="absolute h-full bg-nothing-green-dark dark:bg-nothing-green"
                                    />
                                    {isForwardActive && (
                                        <div className="absolute inset-0 bg-buffering-stripe animate-buffering opacity-30 mix-blend-overlay" />
                                    )}
                                    <div className="absolute inset-0 flex items-center justify-between px-4 text-[10px] uppercase font-mono tracking-widest font-bold">
                                        <span className="text-white mix-blend-difference z-10">Start: <NumberFlow value={startHeight} /></span>
                                        <span className="text-white mix-blend-difference z-10">Latest: <NumberFlow value={latestHeight} /></span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                    <div className="bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-4 rounded-sm">
                                        <div className="text-zinc-500 dark:text-gray-400 text-[10px] uppercase tracking-wider mb-1">Blocks Behind</div>
                                        <div className="text-xl font-bold text-zinc-900 dark:text-white">
                                            <NumberFlow value={blocksBehind} format={{ useGrouping: true }} />
                                        </div>
                                    </div>
                                    <div className="bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-4 rounded-sm">
                                        <div className="text-zinc-500 dark:text-gray-400 text-[10px] uppercase tracking-wider mb-1">Blocks Indexed</div>
                                        <div className="text-xl font-bold text-nothing-green-dark dark:text-nothing-green">
                                            <NumberFlow value={indexedRange} format={{ useGrouping: true }} />
                                        </div>
                                    </div>
                                    <div className="bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-4 rounded-sm">
                                        <div className="text-zinc-500 dark:text-gray-400 text-[10px] uppercase tracking-wider mb-1">Speed</div>
                                        <div className="text-xl font-bold text-blue-600 dark:text-blue-400">
                                            <NumberFlow value={forwardEnabled ? blocksPerSecond : 0} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} />
                                            <span className="text-xs text-zinc-500 ml-1">blk/s</span>
                                        </div>
                                    </div>
                                    <div className="bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-4 rounded-sm">
                                        <div className="text-zinc-500 dark:text-gray-400 text-[10px] uppercase tracking-wider mb-1">Est. Time</div>
                                        <div className="text-xl font-bold text-zinc-900 dark:text-white">
                                            {forwardEnabled && eta > 0 ? `${Math.floor(eta / 60)}m ${eta % 60}s` : '—'}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* History Backfill */}
                            <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-8 mb-6 rounded-sm shadow-sm dark:shadow-none relative overflow-hidden">
                                <div className="flex items-center justify-between mb-6 relative z-10">
                                    <div className="flex items-center space-x-3">
                                        <HardDrive className="h-5 w-5 text-blue-500" />
                                        <h2 className="text-lg font-bold text-zinc-900 dark:text-white uppercase tracking-wide">History Backfill (Backward)</h2>
                                        <div className="flex items-center space-x-2 ml-4">
                                            <span className={`flex h-2 w-2 rounded-full ${historyStatusLabel === 'SYNCING' ? 'bg-green-500 animate-pulse' : historyStatusLabel === 'DISABLED' ? 'bg-red-500' : 'bg-gray-500'}`}></span>
                                            <span className="text-[10px] text-zinc-500 dark:text-gray-400 font-bold uppercase">{historyStatusLabel}</span>
                                        </div>
                                    </div>
                                    <span className="text-2xl font-bold text-blue-500">
                                        <NumberFlow value={historyPercent} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} />%
                                    </span>
                                </div>

                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 relative z-10 mb-6">
                                    <div className="bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-4 rounded-sm">
                                        <div className="text-zinc-500 dark:text-gray-400 text-[10px] uppercase tracking-wider mb-1">Backfilled Range</div>
                                        <div className="text-xl font-bold text-zinc-900 dark:text-white">
                                            <NumberFlow value={historyCovered} format={{ useGrouping: true }} />
                                        </div>
                                    </div>
                                    <div className="bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-4 rounded-sm">
                                        <div className="text-zinc-500 dark:text-gray-400 text-[10px] uppercase tracking-wider mb-1">Oldest Indexed</div>
                                        <div className="text-xl font-bold text-blue-500 font-mono">
                                            #<NumberFlow value={historyHeight} />
                                        </div>
                                    </div>
                                    <div className="bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-4 rounded-sm">
                                        <div className="text-zinc-500 dark:text-gray-400 text-[10px] uppercase tracking-wider mb-1">Sync Speed</div>
                                        <div className="text-xl font-bold text-zinc-900 dark:text-white">
                                            <NumberFlow value={historyEnabled ? historySpeed : 0} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} />
                                            <span className="text-xs text-zinc-500 ml-1">blk/s</span>
                                        </div>
                                    </div>
                                    <div className="bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-4 rounded-sm">
                                        <div className="text-zinc-500 dark:text-gray-400 text-[10px] uppercase tracking-wider mb-1">Est. Completion</div>
                                        <div className="text-xl font-bold text-zinc-900 dark:text-white">
                                            {historyEnabled ? formatDuration(historyEtaSeconds) : '—'}
                                        </div>
                                    </div>
                                </div>

                                <div className="relative h-2 bg-zinc-100 dark:bg-black/50 border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden z-10">
                                    <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${historyPercent}%` }}
                                        transition={{ duration: 1, ease: "easeOut" }}
                                        className="absolute h-full bg-blue-500"
                                    />
                                    {isHistoryActive && (
                                        <div className="absolute inset-0 bg-buffering-stripe animate-buffering opacity-30 mix-blend-overlay" />
                                    )}
                                </div>
                            </div>

                            {/* Worker Progress Grid */}
                            <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-8 mb-6 rounded-sm shadow-sm dark:shadow-none">
                                <h2 className="text-lg font-bold text-zinc-900 dark:text-white uppercase tracking-wide mb-6 flex items-center gap-2">
                                    <Activity className="h-4 w-4 text-zinc-500" />
                                    Worker Status
                                </h2>

                                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                    {workerOrder.map((worker) => {
                                        const height = checkpoints?.[worker.key] || 0;
                                        const enabled = workerEnabled?.[worker.key];
                                        const progress = latestHeight > 0 && height > 0 ? Math.min(100, (height / latestHeight) * 100) : 0;
                                        return (
                                            <div key={worker.key} className="bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-4 rounded-sm hover:border-zinc-300 dark:hover:border-white/30 transition-colors">
                                                <div className="flex items-center justify-between mb-2">
                                                    <span className="text-[10px] text-zinc-500 uppercase tracking-widest truncate mr-2" title={worker.label}>{worker.label}</span>
                                                    <div className={`h-1.5 w-1.5 rounded-full ${enabled === false ? 'bg-red-500' : 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]'}`} />
                                                </div>
                                                <div className="text-sm font-mono font-bold text-zinc-900 dark:text-white mb-2">
                                                    <NumberFlow value={height} />
                                                </div>
                                                <div className="h-1 bg-zinc-200 dark:bg-white/10 w-full rounded-sm overflow-hidden">
                                                    <div className="h-full bg-green-500" style={{ width: `${progress}%` }} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* DB Stats */}
                            <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-8 rounded-sm shadow-sm dark:shadow-none">
                                <h2 className="text-lg font-bold text-zinc-900 dark:text-white uppercase tracking-wide mb-6 flex items-center gap-2">
                                    <Server className="h-4 w-4 text-zinc-500" />
                                    Database Totals
                                </h2>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="p-4 bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 rounded-sm">
                                        <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Transactions</div>
                                        <div className="text-lg font-bold text-zinc-900 dark:text-white font-mono">
                                            <NumberFlow value={status?.total_transactions || 0} />
                                        </div>
                                    </div>
                                    <div className="p-4 bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 rounded-sm">
                                        <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Events</div>
                                        <div className="text-lg font-bold text-zinc-900 dark:text-white font-mono">
                                            <NumberFlow value={status?.total_events || 0} />
                                        </div>
                                    </div>
                                    <div className="p-4 bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 rounded-sm">
                                        <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Contracts</div>
                                        <div className="text-lg font-bold text-zinc-900 dark:text-white font-mono">
                                            <NumberFlow value={status?.total_contracts || 0} />
                                        </div>
                                    </div>
                                    <div className="p-4 bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 rounded-sm">
                                        <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Addresses</div>
                                        <div className="text-lg font-bold text-zinc-900 dark:text-white font-mono">
                                            <NumberFlow value={status?.total_addresses || 0} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="mosaic"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                            className="space-y-6"
                        >
                            {/* Controls */}
                            <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none flex flex-col md:flex-row items-center justify-between gap-6">
                                <div>
                                    <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-wider mb-1">Resolution Control</h3>
                                    <p className="text-xs text-zinc-500">Adjust the number of blocks each cell represents.</p>
                                </div>
                                <div className="flex bg-zinc-100 dark:bg-black/30 p-1 rounded-sm border border-zinc-200 dark:border-white/5">
                                    {CHUNK_SIZES.map((size) => (
                                        <button
                                            key={size.value}
                                            onClick={() => setChunkSize(size.value)}
                                            className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-all ${chunkSize === size.value
                                                ? 'bg-white dark:bg-white/10 text-zinc-900 dark:text-white shadow-sm'
                                                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                                                }`}
                                        >
                                            {size.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                                {/* Side Panel */}
                                <div className="lg:col-span-1 space-y-6">
                                    {/* Stats Card */}
                                    <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
                                        <div className="flex items-center gap-2 mb-4 text-zinc-500">
                                            <Info className="w-4 h-4" />
                                            <span className="text-[10px] uppercase tracking-widest font-bold">Coverage Stats</span>
                                        </div>
                                        <div className="space-y-4">
                                            <div>
                                                <p className="text-[10px] text-zinc-400 uppercase tracking-wider mb-1">Indexed Cells</p>
                                                <div className="text-3xl font-bold text-nothing-green-dark dark:text-nothing-green">
                                                    {mosaicStats.percent.toFixed(1)}%
                                                </div>
                                            </div>
                                            <div className="pt-4 border-t border-zinc-100 dark:border-white/5">
                                                <div className="flex justify-between text-xs font-mono mb-1">
                                                    <span className="text-zinc-500">Total Cells</span>
                                                    <span className="text-zinc-900 dark:text-white">{mosaicStats.total}</span>
                                                </div>
                                                <div className="flex justify-between text-xs font-mono">
                                                    <span className="text-zinc-500">Fully Indexed</span>
                                                    <span className="text-zinc-900 dark:text-white">{mosaicStats.indexed}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Legend */}
                                    <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none space-y-3">
                                        <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2">Legend</p>

                                        <div className="flex items-center gap-3">
                                            <div className="w-3 h-3 bg-nothing-green-dark dark:bg-nothing-green rounded-[1px] shadow-sm"></div>
                                            <span className="text-xs text-zinc-600 dark:text-zinc-400">Indexed (Complete)</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="w-3 h-3 bg-yellow-400 rounded-[1px] shadow-sm animate-pulse"></div>
                                            <span className="text-xs text-zinc-600 dark:text-zinc-400">Processing Tip</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="w-3 h-3 bg-blue-500/50 rounded-[1px] shadow-sm"></div>
                                            <span className="text-xs text-zinc-600 dark:text-zinc-400">Backfilling Gap</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="w-3 h-3 bg-gray-200 dark:bg-white/10 border border-zinc-300 dark:border-white/5 rounded-[1px]"></div>
                                            <span className="text-xs text-zinc-600 dark:text-zinc-400">Pending / Future</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="w-3 h-3 bg-red-500/10 border border-red-500/30 rounded-[1px]"></div>
                                            <span className="text-xs text-zinc-600 dark:text-zinc-400">Historical Missing</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Main Grid */}
                                <div className="lg:col-span-3 bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-2 rounded-sm shadow-sm dark:shadow-none min-h-[500px] relative">
                                    {/* Floating Tooltip */}
                                    <div className="absolute top-4 right-4 z-20 pointer-events-none">
                                        <AnimatePresence mode="wait">
                                            {hoveredChunk && (
                                                <motion.div
                                                    key={hoveredChunk.index}
                                                    initial={{ opacity: 0, x: 10 }}
                                                    animate={{ opacity: 1, x: 0 }}
                                                    exit={{ opacity: 0 }}
                                                    className="bg-white/95 dark:bg-black/90 text-zinc-900 dark:text-white p-4 rounded-sm shadow-xl border border-zinc-200 dark:border-white/20 text-xs backdrop-blur-md min-w-[200px]"
                                                >
                                                    <div className="flex items-center gap-2 mb-2 border-b border-zinc-200 dark:border-white/10 pb-2">
                                                        <Square className="w-3 h-3 text-zinc-500" />
                                                        <span className="uppercase tracking-widest text-[10px] font-bold">Sector #{hoveredChunk.index}</span>
                                                    </div>
                                                    <div className="space-y-1.5 font-mono">
                                                        <div className="flex justify-between">
                                                            <span className="text-zinc-500 font-sans">Range</span>
                                                            <span className="font-bold">{(chunkSize / 1000)}K</span>
                                                        </div>
                                                        <div className="flex justify-between">
                                                            <span className="text-zinc-500 font-sans">Start</span>
                                                            <span>#{hoveredChunk.start.toLocaleString()}</span>
                                                        </div>
                                                        <div className="flex justify-between">
                                                            <span className="text-zinc-500 font-sans">End</span>
                                                            <span>#{hoveredChunk.end.toLocaleString()}</span>
                                                        </div>
                                                        <div className="pt-2 mt-2 border-t border-zinc-200 dark:border-white/10 flex items-center justify-between font-sans">
                                                            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Status</span>
                                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${getChunkStatus(hoveredChunk) === 'indexed' ? 'bg-nothing-green-dark/10 text-nothing-green-dark dark:bg-nothing-green/10 dark:text-nothing-green' : 'bg-zinc-100 text-zinc-500 dark:bg-white/10 dark:text-zinc-400'
                                                                }`}>
                                                                {getChunkStatus(hoveredChunk)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>

                                    {/* Grid Container */}
                                    <div className="grid grid-cols-[repeat(auto-fill,minmax(12px,1fr))] gap-[2px] p-2 h-full content-start overflow-y-auto max-h-[80vh] custom-scrollbar">
                                        {chunks.map((chunk) => {
                                            const status = getChunkStatus(chunk);
                                            let bgClass = '';
                                            let animateClass = '';

                                            switch (status) {
                                                case 'indexed':
                                                    bgClass = 'bg-nothing-green-dark dark:bg-nothing-green hover:opacity-80';
                                                    break;
                                                case 'indexing':
                                                    bgClass = 'bg-yellow-400 z-10';
                                                    animateClass = 'animate-pulse';
                                                    break;
                                                case 'backfilling':
                                                    bgClass = 'bg-blue-500/50 hover:bg-blue-500';
                                                    break;
                                                case 'missing':
                                                    bgClass = 'bg-red-500/10 border border-red-500/20 hover:bg-red-500/30';
                                                    break;
                                                case 'pending':
                                                default:
                                                    bgClass = 'bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10';
                                                    break;
                                            }

                                            return (
                                                <div
                                                    key={chunk.index}
                                                    onMouseEnter={() => setHoveredChunk(chunk)}
                                                    onMouseLeave={() => setHoveredChunk(null)}
                                                    className={`aspect-square rounded-[1px] cursor-crosshair transition-colors duration-200 ${bgClass} ${animateClass}`}
                                                />
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}

import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database, Activity, HardDrive, Server, Layers, Info, Square } from 'lucide-react';
import NumberFlow from '@number-flow/react';
import { ensureHeyApiConfigured, fetchStatus as fetchStatusApi } from '../api/heyapi';

export const Route = createFileRoute('/stats')({
    component: Stats,
})

const CHUNK_SIZES = [
    { label: '50K', value: 50000 },
    { label: '100K', value: 100000 },
    { label: '500K', value: 500000 },
    { label: '1M', value: 1000000 },
    { label: '5M', value: 5000000 },
];

const FLOW_SPORK_BOUNDARIES = [
    { name: 'Mainnet 1', height: 7601063 },
    { name: 'Mainnet 2', height: 8742959 },
    { name: 'Mainnet 3', height: 9737133 },
    { name: 'Mainnet 4', height: 9992020 },
    { name: 'Mainnet 5', height: 12020337 },
    { name: 'Mainnet 6', height: 12609237 },
    { name: 'Mainnet 7', height: 13404174 },
    { name: 'Mainnet 8', height: 13950742 },
    { name: 'Mainnet 9', height: 14892104 },
    { name: 'Mainnet 10', height: 15791891 },
    { name: 'Mainnet 11', height: 16755602 },
    { name: 'Mainnet 12', height: 17544523 },
    { name: 'Mainnet 13', height: 18587478 },
    { name: 'Mainnet 14', height: 19050753 },
    { name: 'Mainnet 15', height: 21291692 },
    { name: 'Mainnet 16', height: 23830813 },
    { name: 'Mainnet 17', height: 27341470 },
    { name: 'Mainnet 18', height: 31735955 },
    { name: 'Mainnet 19', height: 35858811 },
    { name: 'Mainnet 20', height: 40171634 },
    { name: 'Mainnet 21', height: 44950207 },
    { name: 'Mainnet 22', height: 47169687 },
    { name: 'Mainnet 23', height: 55114467 },
    { name: 'Mainnet 24', height: 65264619 },
    { name: 'Mainnet 25', height: 85981135 },
    { name: 'Mainnet 26', height: 88226267 },
    { name: 'Mainnet 27', height: 130290659 },
    { name: 'Mainnet 28', height: 137390146 },
];

const WORKER_COLORS: Record<string, string> = {
    main_ingester: 'bg-yellow-400',
    history_ingester: 'bg-cyan-400',
    history_deriver: 'bg-pink-400',
    history_deriver_down: 'bg-pink-400',
};

function Stats() {
    const [activeTab, setActiveTab] = useState('system'); // 'system' or 'mosaic'
    const [status, setStatus] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    // State for Speed Calculations — sliding window (last 30s) for stable ETA
    const [historySpeed, setHistorySpeed] = useState(0); // blocks per second
    const [forwardSpeed, setForwardSpeed] = useState(0); // blocks per second
    const historySamplesRef = useRef<{ time: number; height: number }[]>([]);
    const forwardSamplesRef = useRef<{ time: number; height: number }[]>([]);
    const SPEED_WINDOW_MS = 30_000; // 30 second sliding window

    // State for Indexing Map
    // Initialize with 100K
    const [chunkSize, setChunkSize] = useState(100000);
    const [hoveredChunk, setHoveredChunk] = useState<any>(null);

    const processStatus = useCallback((data: any) => {
        const now = Date.now();

        // Calculate History Speed (Backward) — sliding window average
        const currentHistoryHeight = (data.history_height && data.history_height > 0)
            ? data.history_height
            : (data.min_height || 0);

        {
            const samples = historySamplesRef.current;
            samples.push({ time: now, height: currentHistoryHeight });
            // Trim samples older than the window
            const cutoff = now - SPEED_WINDOW_MS;
            while (samples.length > 0 && samples[0].time < cutoff) samples.shift();
            if (samples.length >= 2) {
                const oldest = samples[0];
                const newest = samples[samples.length - 1];
                const timeDiff = (newest.time - oldest.time) / 1000;
                // History goes backwards (high -> low)
                const blockDiff = oldest.height - newest.height;
                if (timeDiff > 0 && blockDiff >= 0) {
                    setHistorySpeed(blockDiff / timeDiff);
                }
            }
        }

        // Calculate Forward Speed (New blocks) — sliding window average
        const currentForwardHeight = data.indexed_height || 0;
        {
            const samples = forwardSamplesRef.current;
            samples.push({ time: now, height: currentForwardHeight });
            const cutoff = now - SPEED_WINDOW_MS;
            while (samples.length > 0 && samples[0].time < cutoff) samples.shift();
            if (samples.length >= 2) {
                const oldest = samples[0];
                const newest = samples[samples.length - 1];
                const timeDiff = (newest.time - oldest.time) / 1000;
                const blockDiff = newest.height - oldest.height;
                if (timeDiff > 0 && blockDiff >= 0) {
                    setForwardSpeed(blockDiff / timeDiff);
                }
            }
        }

        setStatus(data);
        setLoading(false);
    }, []);

    const loadStatus = async () => {
        try {
            await ensureHeyApiConfigured();
            const data = await fetchStatusApi();
            processStatus(data);
        } catch (error) {
            console.error('Failed to fetch status:', error);
        }
    };

    useEffect(() => {
        loadStatus();
        const interval = setInterval(loadStatus, 3000);

        let ws: WebSocket | undefined;
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
    const workerConfig = status?.worker_config || {};
    const generatedAt = status?.generated_at ? new Date(status.generated_at) : new Date();
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
        { key: 'evm_worker', label: 'EVM Worker' },
        { key: 'staking_worker', label: 'Staking Worker' },
        { key: 'defi_worker', label: 'DeFi Worker' },
        { key: 'daily_balance_worker', label: 'Daily Balance Worker' },
        { key: 'nft_item_metadata_worker', label: 'NFT Item Metadata' },
        { key: 'nft_ownership_reconciler', label: 'NFT Reconciler' },
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
    const totalBlocks = status?.total_blocks || 0;
    const historyBase = latestHeight > 0 ? latestHeight : startHeight;
    const historyTotal = historyBase > 0 ? historyBase : 0;
    const historyCovered = totalBlocks > 0 ? totalBlocks : (historyBase > 0 && historyHeight > 0 ? Math.max(0, historyBase - historyHeight) : 0);
    const historyPercent = historyTotal > 0 ? (historyCovered / historyTotal) * 100 : 0;
    const forwardStatusLabel = !forwardEnabled ? 'DISABLED' : (blocksBehind > 0 ? 'SYNCING' : 'CAUGHT UP');
    const historyStatusLabel = !historyEnabled ? 'DISABLED' : (historySpeed > 0 ? 'SYNCING' : 'IDLE');
    const isForwardActive = forwardEnabled && blocksBehind > 0;
    const isHistoryActive = historyEnabled && historySpeed > 0;
    const formatDuration = (seconds: number) => {
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
        const result: any[] = [];
        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min((i + 1) * chunkSize - 1, chainTip);
            result.push({ index: i, start, end });
        }
        return result;
    }, [status, chunkSize]); // Keep chunkSize dependency to trigger update

    const getChunkStatus = (chunk: any) => {
        if (!status) return 'unknown';
        const ranges = status.indexed_ranges || [];
        const chunkStart = chunk.start;
        const chunkEnd = chunk.end;
        const chainTip = status.latest_height || 0;

        // Check if fully covered by any indexed range
        for (const range of ranges) {
            if (chunkStart >= range.from && chunkEnd <= range.to) return 'indexed';
        }
        // Check if partially overlapping (actively being indexed)
        for (const range of ranges) {
            if (range.to >= chunkStart && range.from <= chunkEnd) return 'indexing';
        }
        // Beyond chain tip = pending
        if (chunkStart > chainTip) return 'pending';
        // Otherwise it's a gap
        return 'missing';
    };

    const mosaicStats = useMemo(() => {
        const total = chunks.length;
        const indexed = chunks.filter(c => getChunkStatus(c) === 'indexed').length;
        const percent = total > 0 ? (indexed / total) * 100 : 0;
        return { total, indexed, percent };
    }, [chunks, status]); // eslint-disable-line react-hooks/exhaustive-deps

    const getWorkersInChunk = useCallback((chunk: any) => {
        const workers: { name: string; height: number }[] = [];
        const cp = status?.checkpoints || {};
        for (const [name, height] of Object.entries(cp)) {
            if (typeof height === 'number' && height >= chunk.start && height <= chunk.end) {
                workers.push({ name, height });
            }
        }
        return workers;
    }, [status]);

    const getSporkInChunk = useCallback((chunk: any) => {
        return FLOW_SPORK_BOUNDARIES.find(s => s.height >= chunk.start && s.height <= chunk.end);
    }, []);

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
                                        {status?.oldest_block_timestamp && (
                                            <div className="text-xs text-zinc-500 dark:text-gray-400 mt-1">
                                                {new Date(status.oldest_block_timestamp).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                                            </div>
                                        )}
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
                                        const config = workerConfig?.[worker.key] || {};
                                        return (
                                            <div key={worker.key} className="bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-4 rounded-sm hover:border-zinc-300 dark:hover:border-white/30 transition-colors group">
                                                <div className="flex items-center justify-between mb-4">
                                                    <span className="text-[10px] text-zinc-500 uppercase tracking-widest truncate mr-2" title={worker.label}>{worker.label}</span>
                                                    <div className={`h-1.5 w-1.5 rounded-full ${enabled === false ? 'bg-red-500' : 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]'}`} />
                                                </div>
                                                <div className="text-2xl font-mono font-bold text-zinc-900 dark:text-white mb-2">
                                                    <NumberFlow value={height} format={{ useGrouping: true }} />
                                                </div>
                                                <div className="h-1 bg-zinc-200 dark:bg-white/10 w-full rounded-sm overflow-hidden mb-4">
                                                    <div className="h-full bg-green-500" style={{ width: `${progress}%` }} />
                                                </div>

                                                {height > 0 && (
                                                    <div className="pt-4 border-t border-zinc-200 dark:border-white/5 grid grid-cols-2 gap-y-3 gap-x-2">

                                                        {config.workers !== undefined && (
                                                            <div className="bg-white/50 dark:bg-white/5 p-1.5 rounded text-center">
                                                                <div className="text-[9px] text-zinc-500 uppercase">Workers</div>
                                                                <div className="text-xs text-zinc-900 dark:text-white font-mono">{config.workers}</div>
                                                            </div>
                                                        )}

                                                        {config.concurrency !== undefined && (
                                                            <div className="bg-white/50 dark:bg-white/5 p-1.5 rounded text-center">
                                                                <div className="text-[9px] text-zinc-500 uppercase">Concurrency</div>
                                                                <div className="text-xs text-zinc-900 dark:text-white font-mono">{config.concurrency}</div>
                                                            </div>
                                                        )}
                                                        {config.range !== undefined && config.range !== 0 && (
                                                            <div className="bg-white/50 dark:bg-white/5 p-1.5 rounded text-center">
                                                                <div className="text-[9px] text-zinc-500 uppercase">Range</div>
                                                                <div className="text-xs text-zinc-900 dark:text-white font-mono">{config.range}</div>
                                                            </div>
                                                        )}
                                                        {config.batch_size !== undefined && config.batch_size !== 0 && (
                                                            <div className="bg-white/50 dark:bg-white/5 p-1.5 rounded text-center">
                                                                <div className="text-[9px] text-zinc-500 uppercase">Batch</div>
                                                                <div className="text-xs text-zinc-900 dark:text-white font-mono">{config.batch_size}</div>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* DB Stats */}
                            <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-8 rounded-sm shadow-sm dark:shadow-none mb-6">
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

                            {/* Metadata */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-4 rounded-sm">
                                    <div className="text-zinc-500 dark:text-gray-400 text-xs uppercase tracking-wider mb-1">Last Update</div>
                                    <div className="text-zinc-900 dark:text-white">{generatedAt.toLocaleTimeString()}</div>
                                </div>
                                <div className="bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-4 rounded-sm">
                                    <div className="text-zinc-500 dark:text-gray-400 text-xs uppercase tracking-wider mb-1">Network</div>
                                    <div className="text-zinc-900 dark:text-white font-bold">Flow Mainnet</div>
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
                                <div className="flex bg-zinc-100 dark:bg-black/30 p-1 rounded-sm border border-zinc-200 dark:border-white/5 relative">
                                    {CHUNK_SIZES.map((size) => (
                                        <button
                                            key={size.value}
                                            onClick={() => setChunkSize(size.value)}
                                            className="relative z-10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-sm transition-colors duration-200"
                                            style={{
                                                color: chunkSize === size.value
                                                    ? 'var(--text-active)' // customized below via inline style or class
                                                    : 'var(--text-inactive)'
                                            }}
                                        >
                                            <span className={chunkSize === size.value ? "text-zinc-900 dark:text-white" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-white"}>
                                                {size.label}
                                            </span>
                                            {chunkSize === size.value && (
                                                <motion.div
                                                    layoutId="activeTab"
                                                    className="absolute inset-0 bg-white dark:bg-white/10 shadow-sm rounded-sm -z-10"
                                                    transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                                                />
                                            )}
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
                                            <div className="w-3 h-3 bg-purple-500/20 border border-purple-500/40 rounded-[1px]"></div>
                                            <span className="text-xs text-zinc-600 dark:text-zinc-400">Pending / Future</span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="w-3 h-3 bg-zinc-200 dark:bg-white/5 border border-zinc-300 dark:border-white/10 rounded-[1px]"></div>
                                            <span className="text-xs text-zinc-600 dark:text-zinc-400">Historical Missing</span>
                                        </div>

                                        <div className="pt-3 mt-3 border-t border-zinc-100 dark:border-white/5">
                                            <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold mb-2">Overlays</p>
                                            <div className="flex items-center gap-3 mb-2">
                                                <div className="w-3 h-3 bg-zinc-300 dark:bg-white/10 rounded-[1px] border-l-2 border-l-red-400"></div>
                                                <span className="text-xs text-zinc-600 dark:text-zinc-400">Spork Boundary</span>
                                            </div>
                                            <div className="flex items-center gap-3 mb-2">
                                                <div className="flex items-center gap-1">
                                                    <span className="w-2 h-2 rounded-full bg-yellow-400"></span>
                                                    <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                                                    <span className="w-2 h-2 rounded-full bg-pink-400"></span>
                                                </div>
                                                <span className="text-xs text-zinc-600 dark:text-zinc-400">Worker Positions</span>
                                            </div>
                                            <div className="space-y-1 pl-1 text-[10px] text-zinc-500">
                                                <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-yellow-400"></span> Main ingester</div>
                                                <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span> History ingester</div>
                                                <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-pink-400"></span> History deriver</div>
                                                <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-white/60"></span> Other workers</div>
                                            </div>
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
                                                        {(() => {
                                                            const spork = getSporkInChunk(hoveredChunk);
                                                            return spork ? (
                                                                <div className="pt-2 mt-2 border-t border-zinc-200 dark:border-white/10 font-sans">
                                                                    <span className="text-[10px] uppercase tracking-wider text-zinc-500">Spork Boundary</span>
                                                                    <div className="flex justify-between mt-1">
                                                                        <span className="text-red-400 font-bold text-[11px]">{spork.name}</span>
                                                                        <span className="font-mono text-[11px]">#{spork.height.toLocaleString()}</span>
                                                                    </div>
                                                                </div>
                                                            ) : null;
                                                        })()}
                                                        {(() => {
                                                            const workers = getWorkersInChunk(hoveredChunk);
                                                            return workers.length > 0 ? (
                                                                <div className="pt-2 mt-2 border-t border-zinc-200 dark:border-white/10 font-sans">
                                                                    <span className="text-[10px] uppercase tracking-wider text-zinc-500">Workers</span>
                                                                    {workers.map((w) => (
                                                                        <div key={w.name} className="flex justify-between mt-1">
                                                                            <span className="text-[11px] flex items-center gap-1.5">
                                                                                <span className={`inline-block w-2 h-2 rounded-full ${WORKER_COLORS[w.name] || 'bg-white/60'}`} />
                                                                                {w.name.replace(/_/g, ' ')}
                                                                            </span>
                                                                            <span className="font-mono text-[11px]">#{w.height.toLocaleString()}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            ) : null;
                                                        })()}
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>

                                    {/* Grid Container */}
                                    <div className="grid grid-cols-[repeat(auto-fill,minmax(12px,1fr))] gap-[2px] p-2 h-full content-start overflow-y-auto max-h-[80vh] custom-scrollbar">
                                        {chunks.map((chunk) => {
                                            const chunkStatus = getChunkStatus(chunk);
                                            const workers = getWorkersInChunk(chunk);
                                            const spork = getSporkInChunk(chunk);
                                            let bgClass = '';
                                            let animateClass = '';

                                            switch (chunkStatus) {
                                                case 'indexed':
                                                    bgClass = 'bg-nothing-green-dark dark:bg-nothing-green hover:opacity-80';
                                                    break;
                                                case 'indexing':
                                                    bgClass = 'bg-yellow-400 z-10';
                                                    animateClass = 'animate-pulse';
                                                    break;
                                                case 'missing':
                                                    bgClass = 'bg-zinc-200 dark:bg-white/5 border border-zinc-300 dark:border-white/10 hover:bg-zinc-300 dark:hover:bg-white/10';
                                                    break;
                                                case 'pending':
                                                default:
                                                    bgClass = 'bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20';
                                                    break;
                                            }

                                            const sporkBorder = spork ? 'border-l-2 !border-l-red-400' : '';

                                            return (
                                                <div
                                                    key={chunk.index}
                                                    onMouseEnter={() => setHoveredChunk(chunk)}
                                                    onMouseLeave={() => setHoveredChunk(null)}
                                                    className={`aspect-square rounded-[1px] cursor-crosshair transition-colors duration-200 relative overflow-hidden ${bgClass} ${animateClass} ${sporkBorder}`}
                                                >
                                                    {workers.map((w) => {
                                                        const color = WORKER_COLORS[w.name] || 'bg-white/60';
                                                        const isMain = w.name === 'main_ingester';
                                                        const isHistory = w.name === 'history_ingester';
                                                        const isDeriver = w.name.startsWith('history_deriver');
                                                        const pos = isMain
                                                            ? 'top-0 left-0'
                                                            : isHistory
                                                                ? 'bottom-0 left-0'
                                                                : isDeriver
                                                                    ? 'top-0 right-0'
                                                                    : 'bottom-0 right-0';
                                                        return (
                                                            <span
                                                                key={w.name}
                                                                className={`absolute w-[4px] h-[4px] rounded-full ${color} ${pos}`}
                                                            />
                                                        );
                                                    })}
                                                </div>
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

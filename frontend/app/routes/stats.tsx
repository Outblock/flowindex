import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database, Activity, HardDrive, Server, Layers, Info, Square, AlertTriangle } from 'lucide-react';
import NumberFlow from '@number-flow/react';
import { ensureHeyApiConfigured, fetchStatus as fetchStatusApi, fetchGcpVmStatus } from '../api/heyapi';

type StatsTab = 'system' | 'vms' | 'mosaic';
const VALID_TABS: StatsTab[] = ['system', 'vms', 'mosaic'];

export const Route = createFileRoute('/stats')({
    component: Stats,
    validateSearch: (search: Record<string, unknown>): { tab?: StatsTab } => {
        const tab = search.tab as string;
        return {
            tab: VALID_TABS.includes(tab as StatsTab) ? (tab as StatsTab) : undefined,
        };
    },
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

// GCP parallel history containers — matches gcp-parallel-index.sh
const GCP_VMS = [
    { key: 'history_s7', label: 'History S7', sporks: 'Spork 27', direction: 'backward' as const, startBlock: 137390146, stopHeight: 85981135 },
    { key: 'history_s6', label: 'History S6', sporks: 'Spork 26', direction: 'backward' as const, startBlock: 85981135, stopHeight: 65264629 },
    { key: 'history_s5', label: 'History S5', sporks: 'Spork 22-25', direction: 'backward' as const, startBlock: 65264629, stopHeight: 47169687 },
    { key: 'history_s4', label: 'History S4', sporks: 'Spork 17-21', direction: 'backward' as const, startBlock: 47169687, stopHeight: 23830813 },
    { key: 'history_s3', label: 'History S3', sporks: 'Spork 11-16', direction: 'backward' as const, startBlock: 23830813, stopHeight: 15791891 },
    { key: 'history_s2', label: 'History S2', sporks: 'Spork 6-10', direction: 'backward' as const, startBlock: 15791891, stopHeight: 12020337 },
    { key: 'history_s1', label: 'History S1', sporks: 'Spork 1-5', direction: 'backward' as const, startBlock: 12020337, stopHeight: 7601063 },
];

const VM_COLORS = [
    'bg-emerald-500', 'bg-blue-500', 'bg-violet-500', 'bg-amber-500',
    'bg-rose-500', 'bg-cyan-500', 'bg-orange-500', 'bg-pink-500',
];

// Calculate how many blocks in [from, to) are covered by indexed ranges
function coveredBlocks(from: number, to: number, ranges: { from: number; to: number }[]): number {
    let covered = 0;
    for (const r of ranges) {
        const overlapStart = Math.max(from, r.from);
        const overlapEnd = Math.min(to, r.to);
        if (overlapEnd > overlapStart) covered += overlapEnd - overlapStart;
    }
    return covered;
}

const WORKER_COLORS: Record<string, string> = {
    main_ingester: 'bg-yellow-400',
    history_ingester: 'bg-cyan-400',
    history_deriver: 'bg-pink-400',
    history_deriver_down: 'bg-pink-400',
};

function Stats() {
    const { tab: searchTab } = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });
    const activeTab: StatsTab = searchTab || 'system';
    const setActiveTab = (t: StatsTab) => navigate({ search: { tab: t } as any });

    const [status, setStatus] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    // Separate GCP status (from Cloud SQL via GCP VM proxy)
    const [gcpStatus, setGcpStatus] = useState<any>(null);

    // State for Speed Calculations — sliding window (last 30s) for stable ETA
    const [historySpeed, setHistorySpeed] = useState(0); // blocks per second
    const [forwardSpeed, setForwardSpeed] = useState(0); // blocks per second
    const historySamplesRef = useRef<{ time: number; height: number }[]>([]);
    const forwardSamplesRef = useRef<{ time: number; height: number }[]>([]);
    const SPEED_WINDOW_MS = 30_000; // 30 second sliding window

    // Per-worker speed tracking
    const [workerSpeeds, setWorkerSpeeds] = useState<Record<string, number>>({});
    const workerSamplesRef = useRef<Record<string, { time: number; height: number }[]>>({});

    // VM speed tracking
    const [vmSpeeds, setVmSpeeds] = useState<Record<string, number>>({});
    const vmSamplesRef = useRef<Record<string, { time: number; height: number }[]>>({});

    // State for Indexing Map
    // Initialize with 100K
    const [chunkSize, setChunkSize] = useState(100000);
    const [hoveredChunk, setHoveredChunk] = useState<any>(null);

    // Stable callback for grid cells — grid is memoized so this won't cause re-renders
    const updateTooltip = useCallback((chunk: any) => {
        setHoveredChunk(chunk);
    }, []);

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

        // Calculate per-worker speeds — sliding window average
        const cp = data.checkpoints || {};
        const newWorkerSpeeds: Record<string, number> = {};
        for (const [name, h] of Object.entries(cp)) {
            const height = h as number;
            if (!height) continue;
            const samples = workerSamplesRef.current[name] || [];
            samples.push({ time: now, height });
            const cutoff = now - SPEED_WINDOW_MS;
            while (samples.length > 0 && samples[0].time < cutoff) samples.shift();
            workerSamplesRef.current[name] = samples;
            if (samples.length >= 2) {
                const oldest = samples[0];
                const newest = samples[samples.length - 1];
                const timeDiff = (newest.time - oldest.time) / 1000;
                const blockDiff = newest.height - oldest.height;
                if (timeDiff > 0 && blockDiff >= 0) {
                    newWorkerSpeeds[name] = blockDiff / timeDiff;
                }
            }
        }
        setWorkerSpeeds(newWorkerSpeeds);

        setStatus(data);
        setLoading(false);
    }, []);

    const loadStatus = async (includeRanges: boolean) => {
        try {
            await ensureHeyApiConfigured();
            const data = await fetchStatusApi({ includeRanges, timeoutMs: includeRanges ? 15000 : 5000 });
            processStatus(data);
        } catch (error) {
            console.error('Failed to fetch status:', error);
        }
    };

    const processGcpStatus = useCallback((data: any) => {
        const now = Date.now();
        const cp = data.checkpoints || {};
        const newVmSpeeds: Record<string, number> = {};
        for (const vm of GCP_VMS) {
            const h = cp[vm.key];
            if (typeof h !== 'number' || h === 0) continue;
            const samples = vmSamplesRef.current[vm.key] || [];
            samples.push({ time: now, height: h });
            const cutoff = now - SPEED_WINDOW_MS;
            while (samples.length > 0 && samples[0].time < cutoff) samples.shift();
            vmSamplesRef.current[vm.key] = samples;
            if (samples.length >= 2) {
                const oldest = samples[0];
                const newest = samples[samples.length - 1];
                const timeDiff = (newest.time - oldest.time) / 1000;
                const blockDiff = vm.direction === 'backward'
                    ? oldest.height - newest.height
                    : newest.height - oldest.height;
                if (timeDiff > 0 && blockDiff >= 0) {
                    newVmSpeeds[vm.key] = blockDiff / timeDiff;
                }
            }
        }
        setVmSpeeds(prev => ({ ...prev, ...newVmSpeeds }));
        setGcpStatus(data);
    }, []);

    const loadGcpStatus = async () => {
        try {
            const data = await fetchGcpVmStatus();
            if (data) processGcpStatus(data);
        } catch (error) {
            console.error('Failed to fetch GCP status:', error);
        }
    };

    // Always load once on mount; only poll/WS when NOT on mosaic (mosaic is static)
    useEffect(() => {
        loadStatus(activeTab === 'mosaic');
        loadGcpStatus();
    }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (activeTab === 'mosaic') return; // no live updates for mosaic
        const interval = setInterval(() => loadStatus(false), 10000);
        const gcpInterval = setInterval(loadGcpStatus, 15000);

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
            clearInterval(gcpInterval);
            if (ws) ws.close();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [processStatus, activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const checkpointTimestamps = status?.checkpoint_timestamps || {};
    // Deriver phase 1: independent processors run in parallel
    const deriverPhase1 = [
        { key: 'token_worker', label: 'Token' },
        { key: 'evm_worker', label: 'EVM' },
        { key: 'tx_contracts_worker', label: 'TX Contracts' },
        { key: 'accounts_worker', label: 'Accounts' },
        { key: 'meta_worker', label: 'Meta' },
        { key: 'tx_metrics_worker', label: 'TX Metrics' },
        { key: 'staking_worker', label: 'Staking' },
        { key: 'defi_worker', label: 'DeFi' },
    ];
    // Deriver phase 2: depend on token_worker completing first
    const deriverPhase2 = [
        { key: 'ft_holdings_worker', label: 'FT Holdings' },
        { key: 'nft_ownership_worker', label: 'NFT Ownership' },
        { key: 'daily_balance_worker', label: 'Daily Balance' },
    ];
    // History deriver also runs token_metadata_worker (excluded from live)
    const historyOnlyWorkers = [
        { key: 'token_metadata_worker', label: 'Token Metadata' },
    ];
    // Queue-based workers (not block-range driven)
    const queueWorkers = [
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
    // Flow mainnet genesis is NOT block 0 — start from the first spork boundary.
    const FLOW_GENESIS = FLOW_SPORK_BOUNDARIES[0]?.height || 7601063;

    const chunks = useMemo(() => {
        if (!status) return [];
        const chainTip = Math.max(status.latest_height || 0, status.max_height || 0);
        // Align genesis to chunk boundary
        const genesisAligned = Math.floor(FLOW_GENESIS / chunkSize) * chunkSize;
        const totalChunks = Math.max(1, Math.ceil((chainTip - genesisAligned) / chunkSize));
        const result: any[] = [];
        for (let i = 0; i < totalChunks; i++) {
            const start = genesisAligned + i * chunkSize;
            const end = Math.min(start + chunkSize - 1, chainTip);
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

    // Memoize the mosaic grid so it only re-renders when chunks/status change, not on hover
    const mosaicGrid = useMemo(() => (
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
                        onMouseEnter={() => updateTooltip(chunk)}
                        onMouseLeave={() => updateTooltip(null)}
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
    ), [chunks, status, chunkSize]); // eslint-disable-line react-hooks/exhaustive-deps

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
                            onClick={() => setActiveTab('vms')}
                            className={`px-6 py-2 text-xs uppercase tracking-widest font-bold rounded-sm transition-all ${activeTab === 'vms'
                                ? 'bg-white dark:bg-white/10 text-zinc-900 dark:text-white shadow-sm'
                                : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                                }`}
                        >
                            VM Progress
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

                                <div className="relative h-12 bg-zinc-100 dark:bg-black/50 border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden mb-6 z-10">
                                    {/* Bar fills from right — history goes backward, so covered area is on the right side */}
                                    <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${historyPercent}%` }}
                                        transition={{ duration: 1, ease: "easeOut" }}
                                        className="absolute h-full bg-blue-500 right-0"
                                    />
                                    {isHistoryActive && (
                                        <div className="absolute inset-0 bg-buffering-stripe animate-buffering opacity-30 mix-blend-overlay" />
                                    )}
                                    <div className="absolute inset-0 flex items-center justify-between px-4 text-[10px] uppercase font-mono tracking-widest font-bold">
                                        <span className="text-white mix-blend-difference z-10">Target: #0</span>
                                        <span className="text-white mix-blend-difference z-10">Frontier: #<NumberFlow value={minHeight || historyHeight} /></span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 relative z-10">
                                    <div className="bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-4 rounded-sm">
                                        <div className="text-zinc-500 dark:text-gray-400 text-[10px] uppercase tracking-wider mb-1">Backfilled Range</div>
                                        <div className="text-xl font-bold text-zinc-900 dark:text-white">
                                            <NumberFlow value={historyCovered} format={{ useGrouping: true }} />
                                        </div>
                                    </div>
                                    <div className="bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-4 rounded-sm">
                                        <div className="text-zinc-500 dark:text-gray-400 text-[10px] uppercase tracking-wider mb-1">Oldest Block Date</div>
                                        <div className="text-xl font-bold text-zinc-900 dark:text-white">
                                            {status?.oldest_block_timestamp
                                                ? new Date(status.oldest_block_timestamp).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                                                : '—'}
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
                            </div>

                            {/* Pipeline Status — 4 sections */}
                            <div className="space-y-4 mb-6">
                                {/* Section 1: Ingesters */}
                                <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
                                    <h2 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                                        <Database className="h-3.5 w-3.5" />
                                        Ingesters
                                    </h2>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {/* Main Ingester */}
                                        {(() => {
                                            const h = checkpoints?.['main_ingester'] || 0;
                                            const behind = latestHeight > h && h > 0 ? latestHeight - h : 0;
                                            const speed = workerSpeeds['main_ingester'] || 0;
                                            const progress = latestHeight > 0 && h > 0 ? Math.min(100, (h / latestHeight) * 100) : 0;
                                            const statusLabel = !forwardEnabled ? 'DISABLED' : behind === 0 && h > 0 ? 'CAUGHT UP' : behind > 0 ? 'SYNCING' : 'IDLE';
                                            return (
                                                <div className="bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-5 rounded-sm">
                                                    <div className="flex items-center justify-between mb-3">
                                                        <span className="text-xs font-bold text-zinc-900 dark:text-white">Main Ingester</span>
                                                        <div className="flex items-center gap-1.5">
                                                            <span className={`text-[9px] font-bold uppercase tracking-wider ${statusLabel === 'SYNCING' ? 'text-yellow-500' : statusLabel === 'CAUGHT UP' ? 'text-green-500' : statusLabel === 'DISABLED' ? 'text-red-400' : 'text-zinc-400'}`}>{statusLabel}</span>
                                                            <div className={`h-2 w-2 rounded-full ${statusLabel === 'SYNCING' ? 'bg-yellow-500 animate-pulse' : statusLabel === 'CAUGHT UP' ? 'bg-green-500' : statusLabel === 'DISABLED' ? 'bg-red-500' : 'bg-zinc-400'}`} />
                                                        </div>
                                                    </div>
                                                    <div className="text-2xl font-mono font-bold text-zinc-900 dark:text-white mb-2">
                                                        #<NumberFlow value={h} format={{ useGrouping: true }} />
                                                    </div>
                                                    <div className="h-1.5 bg-zinc-200 dark:bg-white/10 w-full rounded-sm overflow-hidden mb-3">
                                                        <div className={`h-full ${behind === 0 && h > 0 ? 'bg-green-500' : 'bg-yellow-400'}`} style={{ width: `${progress}%` }} />
                                                    </div>
                                                    <div className="flex items-center gap-4 text-xs text-zinc-500 font-mono">
                                                        <span>Behind: <span className="text-zinc-900 dark:text-white">{behind > 0 ? behind.toLocaleString() : '0'}</span></span>
                                                        <span>Speed: <span className="text-zinc-900 dark:text-white"><NumberFlow value={speed} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} /> b/s</span></span>
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                        {/* History Ingester */}
                                        {(() => {
                                            const h = checkpoints?.['history_ingester'] || 0;
                                            const speed = workerSpeeds['history_ingester'] || 0;
                                            // Raw data may extend below ingester (e.g. archive import)
                                            const rawFloor = minHeight || h;
                                            const effectiveFloor = rawFloor > 0 && rawFloor < h ? rawFloor : h;
                                            const progress = latestHeight > 0 && effectiveFloor > 0 ? Math.min(100, ((latestHeight - effectiveFloor) / latestHeight) * 100) : 0;
                                            const statusLabel = !historyEnabled ? 'DISABLED' : speed > 0 ? 'SYNCING' : h > 0 ? 'IDLE' : 'OFFLINE';
                                            return (
                                                <div className="bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-5 rounded-sm">
                                                    <div className="flex items-center justify-between mb-3">
                                                        <span className="text-xs font-bold text-zinc-900 dark:text-white">History Ingester</span>
                                                        <div className="flex items-center gap-1.5">
                                                            <span className={`text-[9px] font-bold uppercase tracking-wider ${statusLabel === 'SYNCING' ? 'text-yellow-500' : statusLabel === 'DISABLED' ? 'text-red-400' : statusLabel === 'IDLE' ? 'text-zinc-400' : 'text-zinc-400'}`}>{statusLabel}</span>
                                                            <div className={`h-2 w-2 rounded-full ${statusLabel === 'SYNCING' ? 'bg-yellow-500 animate-pulse' : statusLabel === 'DISABLED' ? 'bg-red-500' : 'bg-zinc-400'}`} />
                                                        </div>
                                                    </div>
                                                    <div className="text-2xl font-mono font-bold text-zinc-900 dark:text-white mb-2">
                                                        #<NumberFlow value={effectiveFloor} format={{ useGrouping: true }} />
                                                        {effectiveFloor < h && (
                                                            <span className="text-xs text-zinc-400 ml-2">(RPC: #{h.toLocaleString()})</span>
                                                        )}
                                                    </div>
                                                    <div className="h-1.5 bg-zinc-200 dark:bg-white/10 w-full rounded-sm overflow-hidden mb-3">
                                                        <div className="h-full bg-cyan-400" style={{ width: `${progress}%` }} />
                                                    </div>
                                                    <div className="flex items-center gap-4 text-xs text-zinc-500 font-mono">
                                                        {checkpointTimestamps?.['history_ingester'] && (
                                                            <span>Oldest: <span className="text-zinc-900 dark:text-white">{new Date(checkpointTimestamps['history_ingester']).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}</span></span>
                                                        )}
                                                        <span>Speed: <span className="text-zinc-900 dark:text-white"><NumberFlow value={speed} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} /> b/s</span></span>
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </div>

                                {/* Section 2: Live Deriver */}
                                <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
                                    <div className="flex items-center gap-3 mb-1">
                                        <h2 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                                            <Activity className="h-3.5 w-3.5" />
                                            Live Deriver
                                        </h2>
                                        <span className="text-[9px] px-1.5 py-0.5 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded text-zinc-500 font-mono">chunk=10</span>
                                    </div>
                                    <p className="text-[10px] text-zinc-400 mb-4">Real-time processing of new blocks as they arrive</p>

                                    {/* Phase 1 */}
                                    <div className="mb-3">
                                        <span className="text-[9px] text-zinc-400 uppercase tracking-wider font-bold">Phase 1</span>
                                        <div className="flex flex-wrap gap-2 mt-1.5">
                                            {deriverPhase1.map((w) => {
                                                const h = checkpoints?.[w.key] || 0;
                                                const behind = indexedHeight > h && h > 0 ? indexedHeight - h : 0;
                                                const isCaughtUp = behind === 0 && h > 0;
                                                return (
                                                    <div
                                                        key={w.key}
                                                        className="group relative flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 rounded-sm text-xs hover:border-zinc-300 dark:hover:border-white/20 transition-colors cursor-default"
                                                        title={`#${h.toLocaleString()} | Behind: ${behind.toLocaleString()}`}
                                                    >
                                                        <div className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${isCaughtUp ? 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]' : h > 0 ? 'bg-yellow-500 animate-pulse' : 'bg-zinc-400'}`} />
                                                        <span className="text-zinc-700 dark:text-zinc-300 font-medium">{w.label}</span>
                                                        {behind > 0 && (
                                                            <span className="text-[9px] text-yellow-500 font-mono ml-0.5">-{behind > 99999 ? `${(behind / 1000).toFixed(0)}K` : behind.toLocaleString()}</span>
                                                        )}
                                                        {/* Tooltip on hover */}
                                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-30">
                                                            <div className="bg-zinc-900 dark:bg-black text-white text-[10px] font-mono px-2.5 py-1.5 rounded shadow-lg whitespace-nowrap border border-white/10">
                                                                #{h.toLocaleString()}
                                                                {workerSpeeds[w.key] ? ` | ${workerSpeeds[w.key].toFixed(1)} b/s` : ''}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Phase 2 */}
                                    <div>
                                        <span className="text-[9px] text-zinc-400 uppercase tracking-wider font-bold">Phase 2 <span className="text-zinc-300 dark:text-zinc-600 normal-case">(depends on Token)</span></span>
                                        <div className="flex flex-wrap gap-2 mt-1.5">
                                            {deriverPhase2.map((w) => {
                                                const h = checkpoints?.[w.key] || 0;
                                                const behind = indexedHeight > h && h > 0 ? indexedHeight - h : 0;
                                                const isCaughtUp = behind === 0 && h > 0;
                                                return (
                                                    <div
                                                        key={w.key}
                                                        className="group relative flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 rounded-sm text-xs hover:border-zinc-300 dark:hover:border-white/20 transition-colors cursor-default"
                                                        title={`#${h.toLocaleString()} | Behind: ${behind.toLocaleString()}`}
                                                    >
                                                        <div className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${isCaughtUp ? 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]' : h > 0 ? 'bg-yellow-500 animate-pulse' : 'bg-zinc-400'}`} />
                                                        <span className="text-zinc-700 dark:text-zinc-300 font-medium">{w.label}</span>
                                                        {behind > 0 && (
                                                            <span className="text-[9px] text-yellow-500 font-mono ml-0.5">-{behind > 99999 ? `${(behind / 1000).toFixed(0)}K` : behind.toLocaleString()}</span>
                                                        )}
                                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-30">
                                                            <div className="bg-zinc-900 dark:bg-black text-white text-[10px] font-mono px-2.5 py-1.5 rounded shadow-lg whitespace-nowrap border border-white/10">
                                                                #{h.toLocaleString()}
                                                                {workerSpeeds[w.key] ? ` | ${workerSpeeds[w.key].toFixed(1)} b/s` : ''}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>

                                {/* Section 3: History Deriver */}
                                {(() => {
                                    const upCursor = checkpoints?.['history_deriver'] || 0;
                                    const downCursor = checkpoints?.['history_deriver_down'] || 0;
                                    // Worker floor: the lowest checkpoint among core processors (same as backend findWorkerFloor)
                                    const floorWorkers = ['token_worker', 'evm_worker', 'accounts_worker', 'meta_worker'];
                                    const floorHeights = floorWorkers.map(k => checkpoints?.[k]).filter((h): h is number => typeof h === 'number' && h > 0);
                                    const workerFloor = floorHeights.length > 0 ? Math.min(...floorHeights) : indexedHeight;
                                    // Lowest raw block height — includes archive-imported data below history_ingester
                                    const historyBottom = minHeight || checkpoints?.['history_ingester'] || 0;
                                    // Total range that needs derivation: historyBottom → workerFloor
                                    const totalGap = workerFloor > historyBottom ? workerFloor - historyBottom : 0;
                                    // UP scans upward toward live tip, DOWN scans downward toward historyBottom.
                                    // Derived range = [downCursor, upCursor] (contiguous from where DOWN has reached to where UP has reached)
                                    const derivedHigh = upCursor > 0 ? Math.min(upCursor, workerFloor) : 0;
                                    const derivedLow = downCursor > 0 ? downCursor : (upCursor > 0 ? historyBottom : 0);
                                    const coveredBlocks = derivedHigh > derivedLow ? derivedHigh - derivedLow : 0;
                                    const hdProgress = totalGap > 0 ? Math.min(100, (coveredBlocks / totalGap) * 100) : (upCursor > 0 ? 100 : 0);
                                    const hdSpeed = (workerSpeeds['history_deriver'] || 0) + (workerSpeeds['history_deriver_down'] || 0);
                                    const remaining = totalGap - coveredBlocks;
                                    const hdEta = hdSpeed > 0 && remaining > 0 ? remaining / hdSpeed : 0;
                                    const hdStatus = totalGap === 0 && upCursor > 0 ? 'CAUGHT UP'
                                        : remaining === 0 && upCursor > 0 ? 'CAUGHT UP'
                                        : hdSpeed > 0 ? 'SYNCING'
                                        : upCursor > 0 || downCursor > 0 ? 'STALLED' : 'IDLE';
                                    // All processors driven by history_deriver
                                    const historyProcessors = [...deriverPhase1, ...deriverPhase2, ...historyOnlyWorkers];
                                    return (
                                        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
                                            <div className="flex items-center gap-3 mb-1">
                                                <h2 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                                                    <HardDrive className="h-3.5 w-3.5" />
                                                    History Deriver
                                                </h2>
                                                <span className="text-[9px] px-1.5 py-0.5 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded text-zinc-500 font-mono">chunk=1000</span>
                                                <div className="flex items-center gap-1.5 ml-auto">
                                                    <span className={`text-[9px] font-bold uppercase tracking-wider ${hdStatus === 'SYNCING' ? 'text-yellow-500' : hdStatus === 'CAUGHT UP' ? 'text-green-500' : 'text-zinc-400'}`}>{hdStatus}</span>
                                                    <div className={`h-2 w-2 rounded-full ${hdStatus === 'SYNCING' ? 'bg-pink-400 animate-pulse' : hdStatus === 'CAUGHT UP' ? 'bg-green-500' : 'bg-zinc-400'}`} />
                                                </div>
                                            </div>
                                            <p className="text-[10px] text-zinc-400 mb-4">
                                                Backfill: derives history blocks with same processors as live
                                                <span className="text-zinc-300 dark:text-zinc-600 mx-1">|</span>
                                                UP #{upCursor.toLocaleString()} / DOWN #{downCursor.toLocaleString()}
                                            </p>

                                            {/* Range + Progress bar */}
                                            <div className="flex items-center justify-between text-xs font-mono text-zinc-500 mb-2">
                                                <span>#{historyBottom.toLocaleString()}</span>
                                                <span>#{workerFloor.toLocaleString()}</span>
                                            </div>
                                            <div className="relative h-4 bg-zinc-100 dark:bg-black/50 border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden mb-4">
                                                <motion.div
                                                    initial={{ width: 0 }}
                                                    animate={{ width: `${hdProgress}%` }}
                                                    transition={{ duration: 1, ease: "easeOut" }}
                                                    className="absolute h-full bg-pink-400"
                                                />
                                                {hdSpeed > 0 && (
                                                    <div className="absolute inset-0 bg-buffering-stripe animate-buffering opacity-20 mix-blend-overlay" />
                                                )}
                                                <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white mix-blend-difference">
                                                    {hdProgress.toFixed(1)}%
                                                </div>
                                            </div>

                                            {/* Stats row */}
                                            <div className="flex items-center gap-6 text-xs text-zinc-500 font-mono mb-4">
                                                <span>Speed: <span className="text-zinc-900 dark:text-white"><NumberFlow value={hdSpeed} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} /> b/s</span></span>
                                                <span>Remaining: <span className="text-zinc-900 dark:text-white">{remaining.toLocaleString()}</span></span>
                                                <span>ETA: <span className="text-zinc-900 dark:text-white">{hdEta > 0 ? formatDuration(hdEta) : '—'}</span></span>
                                            </div>

                                            {/* Processor chips (same as live + token_metadata) */}
                                            <div className="pt-4 border-t border-zinc-100 dark:border-white/5">
                                                <span className="text-[9px] text-zinc-400 uppercase tracking-wider font-bold">Processors</span>
                                                <div className="flex flex-wrap gap-2 mt-1.5">
                                                    {historyProcessors.map((w) => {
                                                        const h = checkpoints?.[w.key] || 0;
                                                        // For history context: compare to workerFloor (are they caught up to the forward tip?)
                                                        const behind = indexedHeight > h && h > 0 ? indexedHeight - h : 0;
                                                        const isCaughtUp = behind === 0 && h > 0;
                                                        const isHistoryOnly = historyOnlyWorkers.some(hw => hw.key === w.key);
                                                        return (
                                                            <div
                                                                key={w.key}
                                                                className="group relative flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 rounded-sm text-xs hover:border-zinc-300 dark:hover:border-white/20 transition-colors cursor-default"
                                                                title={`#${h.toLocaleString()} | Behind: ${behind.toLocaleString()}`}
                                                            >
                                                                <div className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${isCaughtUp ? 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.6)]' : h > 0 ? 'bg-yellow-500 animate-pulse' : 'bg-zinc-400'}`} />
                                                                <span className="text-zinc-700 dark:text-zinc-300 font-medium">{w.label}</span>
                                                                {isHistoryOnly && <span className="text-[8px] text-pink-400 ml-0.5">*</span>}
                                                                {behind > 0 && (
                                                                    <span className="text-[9px] text-yellow-500 font-mono ml-0.5">-{behind > 99999 ? `${(behind / 1000).toFixed(0)}K` : behind.toLocaleString()}</span>
                                                                )}
                                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-30">
                                                                    <div className="bg-zinc-900 dark:bg-black text-white text-[10px] font-mono px-2.5 py-1.5 rounded shadow-lg whitespace-nowrap border border-white/10">
                                                                        #{h.toLocaleString()}
                                                                        {workerSpeeds[w.key] ? ` | ${workerSpeeds[w.key].toFixed(1)} b/s` : ''}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                <p className="text-[9px] text-zinc-400 mt-2"><span className="text-pink-400">*</span> history-only (excluded from live deriver)</p>
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* Section 4: Queue Workers */}
                                <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
                                    <h2 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                                        <Server className="h-3.5 w-3.5" />
                                        Queue Workers
                                    </h2>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {queueWorkers.map((w) => {
                                            const h = checkpoints?.[w.key] || 0;
                                            const speed = workerSpeeds[w.key] || 0;
                                            const enabled = workerEnabled?.[w.key];
                                            const statusLabel = enabled === false ? 'DISABLED' : speed > 0 ? 'ACTIVE' : h > 0 ? 'IDLE' : 'OFFLINE';
                                            return (
                                                <div key={w.key} className="bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-4 rounded-sm">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="text-xs font-bold text-zinc-900 dark:text-white">{w.label}</span>
                                                        <div className="flex items-center gap-1.5">
                                                            <span className={`text-[9px] font-bold uppercase tracking-wider ${statusLabel === 'ACTIVE' ? 'text-green-500' : statusLabel === 'DISABLED' ? 'text-red-400' : 'text-zinc-400'}`}>{statusLabel}</span>
                                                            <div className={`h-1.5 w-1.5 rounded-full ${statusLabel === 'ACTIVE' ? 'bg-green-500 animate-pulse' : statusLabel === 'DISABLED' ? 'bg-red-500' : 'bg-zinc-400'}`} />
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-4 text-xs text-zinc-500 font-mono">
                                                        <span>Checkpoint: <span className="text-zinc-900 dark:text-white">#{h.toLocaleString()}</span></span>
                                                        <span>Speed: <span className="text-zinc-900 dark:text-white"><NumberFlow value={speed} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} /> b/s</span></span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
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

                            {/* Error Summary */}
                            {(() => {
                                const es = status?.error_summary;
                                if (!es) return null;
                                const totalErrors = es.unresolved_errors || 0;
                                const totalDead = es.dead_leases || 0;
                                if (totalErrors === 0 && totalDead === 0) return null;
                                const errorsByWorker = es.errors_by_worker || {};
                                const deadByWorker = es.dead_leases_by_worker || {};
                                return (
                                    <div className={`border p-6 rounded-sm shadow-sm dark:shadow-none mb-6 ${totalDead > 0 ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-500/30' : 'bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-500/30'}`}>
                                        <h2 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                                            <AlertTriangle className={`h-3.5 w-3.5 ${totalDead > 0 ? 'text-red-500' : 'text-yellow-500'}`} />
                                            Indexing Errors
                                        </h2>
                                        <div className="grid grid-cols-2 gap-4 mb-4">
                                            <div className="p-3 bg-white/50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-sm">
                                                <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Unresolved Errors</div>
                                                <div className="text-xl font-bold text-yellow-600 dark:text-yellow-400 font-mono">{totalErrors}</div>
                                            </div>
                                            <div className="p-3 bg-white/50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-sm">
                                                <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Dead Leases (20+ retries)</div>
                                                <div className={`text-xl font-bold font-mono ${totalDead > 0 ? 'text-red-600 dark:text-red-400' : 'text-zinc-900 dark:text-white'}`}>{totalDead}</div>
                                            </div>
                                        </div>
                                        {/* Per-worker breakdown */}
                                        <div className="flex flex-wrap gap-2">
                                            {Object.entries(errorsByWorker).map(([worker, count]) => (
                                                <div key={`err-${worker}`} className="flex items-center gap-1.5 px-2 py-1 bg-white/50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 rounded-sm text-xs">
                                                    <span className="text-zinc-500">{worker.replace(/_/g, ' ')}</span>
                                                    <span className="text-yellow-600 dark:text-yellow-400 font-mono font-bold">{String(count)}</span>
                                                </div>
                                            ))}
                                            {Object.entries(deadByWorker).map(([worker, count]) => (
                                                <div key={`dead-${worker}`} className="flex items-center gap-1.5 px-2 py-1 bg-red-100/50 dark:bg-red-950/30 border border-red-200 dark:border-red-500/20 rounded-sm text-xs">
                                                    <span className="text-zinc-500">{worker.replace(/_/g, ' ')}</span>
                                                    <span className="text-red-600 dark:text-red-400 font-mono font-bold">{String(count)} dead</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })()}

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
                    ) : activeTab === 'vms' ? (
                        <motion.div
                            key="vms"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                            className="space-y-6"
                        >
                            {!gcpStatus && (
                                <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-600 dark:text-yellow-400 p-4 rounded-sm text-sm font-mono">
                                    Connecting to GCP status endpoint...
                                </div>
                            )}

                            {/* Overall GCP Progress */}
                            {(() => {
                                const ranges = (gcpStatus?.indexed_ranges || []) as { from: number; to: number }[];
                                const backwardVMs = GCP_VMS.filter(v => v.direction === 'backward');
                                const totalBlocks = backwardVMs.reduce((sum, v) => sum + (v.startBlock - v.stopHeight), 0);
                                const doneBlocks = backwardVMs.reduce((sum, v) => {
                                    return sum + coveredBlocks(v.stopHeight, v.startBlock, ranges);
                                }, 0);
                                const overallPct = totalBlocks > 0 ? (doneBlocks / totalBlocks) * 100 : 0;
                                const totalSpeed = backwardVMs.reduce((sum, v) => sum + (vmSpeeds[v.key] || 0), 0);
                                const remaining = totalBlocks - doneBlocks;
                                const etaSec = totalSpeed > 0 ? remaining / totalSpeed : 0;
                                return (
                                    <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-8 rounded-sm shadow-sm dark:shadow-none">
                                        <div className="flex items-center justify-between mb-4">
                                            <div className="flex items-center space-x-3">
                                                <Server className="h-5 w-5 text-violet-500" />
                                                <h2 className="text-lg font-bold text-zinc-900 dark:text-white uppercase tracking-wide">GCP History Indexing</h2>
                                                <span className="text-[10px] text-zinc-500 font-mono">7 containers on e2-standard-16</span>
                                            </div>
                                            <span className="text-2xl font-bold text-violet-500">
                                                <NumberFlow value={overallPct} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} />%
                                            </span>
                                        </div>
                                        <div className="relative h-6 bg-zinc-100 dark:bg-black/50 border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden mb-4">
                                            <motion.div
                                                initial={{ width: 0 }}
                                                animate={{ width: `${overallPct}%` }}
                                                transition={{ duration: 1, ease: "easeOut" }}
                                                className="absolute h-full bg-violet-500"
                                            />
                                            {totalSpeed > 0 && (
                                                <div className="absolute inset-0 bg-buffering-stripe animate-buffering opacity-20 mix-blend-overlay" />
                                            )}
                                            <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white mix-blend-difference">
                                                {doneBlocks.toLocaleString()} / {totalBlocks.toLocaleString()} blocks
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-3 gap-4">
                                            <div className="bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-3 rounded-sm text-center">
                                                <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Combined Speed</div>
                                                <div className="text-lg font-bold text-violet-500">
                                                    <NumberFlow value={totalSpeed} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} />
                                                    <span className="text-xs text-zinc-500 ml-1">blk/s</span>
                                                </div>
                                            </div>
                                            <div className="bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-3 rounded-sm text-center">
                                                <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Remaining</div>
                                                <div className="text-lg font-bold text-zinc-900 dark:text-white font-mono">
                                                    {remaining.toLocaleString()}
                                                </div>
                                            </div>
                                            <div className="bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-3 rounded-sm text-center">
                                                <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Est. Completion</div>
                                                <div className="text-lg font-bold text-zinc-900 dark:text-white">
                                                    {formatDuration(etaSec)}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Per-VM Cards */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                {GCP_VMS.map((vm, idx) => {
                                    const cp = gcpStatus?.checkpoints || {};
                                    const ranges = (gcpStatus?.indexed_ranges || []) as { from: number; to: number }[];
                                    const h = cp[vm.key];
                                    const height = typeof h === 'number' ? h : 0;
                                    const speed = vmSpeeds[vm.key] || 0;
                                    const color = VM_COLORS[idx % VM_COLORS.length];
                                    const colorText = color.replace('bg-', 'text-');

                                    let pct = 0;
                                    let remaining = 0;
                                    let rangeLabel = '';
                                    let isActive = false;

                                    if (vm.direction === 'backward') {
                                        const total = vm.startBlock - vm.stopHeight;
                                        const done = coveredBlocks(vm.stopHeight, vm.startBlock, ranges);
                                        pct = total > 0 ? (done / total) * 100 : 0;
                                        remaining = total - done;
                                        rangeLabel = `#${vm.startBlock.toLocaleString()} → #${vm.stopHeight.toLocaleString()}`;
                                        isActive = height > 0 && height > vm.stopHeight && speed > 0;
                                    } else {
                                        const tip = latestHeight || 1;
                                        pct = height > 0 ? Math.min(100, (height / tip) * 100) : 0;
                                        remaining = Math.max(0, tip - height);
                                        rangeLabel = `→ #${latestHeight.toLocaleString()}`;
                                        isActive = height > 0 && speed > 0;
                                    }

                                    const isDone = pct >= 99.99;
                                    const etaSec = speed > 0 ? remaining / speed : 0;

                                    return (
                                        <div key={vm.key} className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
                                            <div className="flex items-center justify-between mb-3">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-3 h-3 rounded-full ${color} ${isActive ? 'animate-pulse' : ''}`} />
                                                    <div>
                                                        <h3 className="text-sm font-bold text-zinc-900 dark:text-white">{vm.label}</h3>
                                                        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{vm.sporks}</span>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className={`text-xl font-bold ${isDone ? 'text-green-500' : colorText}`}>
                                                        <NumberFlow value={pct} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} />%
                                                    </div>
                                                    <span className={`text-[10px] font-bold uppercase tracking-wider ${isDone ? 'text-green-500' : isActive ? 'text-green-500' : height > 0 ? 'text-yellow-500' : 'text-zinc-400'}`}>
                                                        {isDone ? 'DONE' : isActive ? 'SYNCING' : height > 0 ? 'STALLED' : 'OFFLINE'}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Progress Bar */}
                                            <div className="relative h-4 bg-zinc-100 dark:bg-black/50 border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden mb-4">
                                                <motion.div
                                                    initial={{ width: 0 }}
                                                    animate={{ width: `${pct}%` }}
                                                    transition={{ duration: 1, ease: "easeOut" }}
                                                    className={`absolute h-full ${isDone ? 'bg-green-500' : color}`}
                                                />
                                                {isActive && !isDone && (
                                                    <div className="absolute inset-0 bg-buffering-stripe animate-buffering opacity-20 mix-blend-overlay" />
                                                )}
                                            </div>

                                            {/* Stats Grid */}
                                            <div className="grid grid-cols-2 gap-3 text-xs">
                                                <div className="bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-2.5 rounded-sm">
                                                    <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">Current Height</div>
                                                    <div className="font-bold font-mono text-zinc-900 dark:text-white">
                                                        {height > 0 ? `#${height.toLocaleString()}` : '—'}
                                                    </div>
                                                </div>
                                                <div className="bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-2.5 rounded-sm">
                                                    <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">Speed</div>
                                                    <div className="font-bold text-zinc-900 dark:text-white">
                                                        <NumberFlow value={speed} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} />
                                                        <span className="text-zinc-500 ml-1 font-normal">blk/s</span>
                                                    </div>
                                                </div>
                                                <div className="bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-2.5 rounded-sm">
                                                    <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">Range</div>
                                                    <div className="font-mono text-zinc-900 dark:text-white truncate" title={rangeLabel}>
                                                        {rangeLabel}
                                                    </div>
                                                </div>
                                                <div className="bg-zinc-50 dark:bg-black/30 border border-zinc-200 dark:border-white/10 p-2.5 rounded-sm">
                                                    <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-0.5">ETA</div>
                                                    <div className="font-bold text-zinc-900 dark:text-white">
                                                        {isDone ? 'Complete' : formatDuration(etaSec)}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
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
                                    {/* Floating Tooltip — no AnimatePresence, instant update */}
                                    {hoveredChunk && (
                                        <div className="absolute top-4 right-4 z-20 pointer-events-none bg-white/95 dark:bg-black/90 text-zinc-900 dark:text-white p-4 rounded-sm shadow-xl border border-zinc-200 dark:border-white/20 text-xs backdrop-blur-md min-w-[200px]">
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
                                        </div>
                                    )}

                                    {/* Grid Container — memoized cells */}
                                    {mosaicGrid}
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}

import { useState, useEffect, useRef, useCallback } from 'react';
// eslint-disable-next-line
import { motion, AnimatePresence } from 'framer-motion';
import { Database, Activity, HardDrive, Server } from 'lucide-react';
import NumberFlow from '@number-flow/react';
import { api } from '../api';

export default function Stats() {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);

    // State for Speed Calculations
    const [historySpeed, setHistorySpeed] = useState(0); // blocks per second
    const [forwardSpeed, setForwardSpeed] = useState(0); // blocks per second
    const lastHistoryCheckRef = useRef(null); // { time: number, height: number }
    const lastForwardCheckRef = useRef(null); // { time: number, height: number }

    const processStatus = useCallback((data) => {
        const now = Date.now();

        // Calculate History Speed
        const currentHistoryHeight = (data.history_height && data.history_height > 0)
            ? data.history_height
            : (data.min_height || 0);

        if (lastHistoryCheckRef.current) {
            const timeDiff = (now - lastHistoryCheckRef.current.time) / 1000;
            const blockDiff = lastHistoryCheckRef.current.height - currentHistoryHeight;
            if (timeDiff > 0 && blockDiff >= 0) {
                const instantaneousSpeed = blockDiff / timeDiff;
                setHistorySpeed(prev => (prev * 0.7) + (instantaneousSpeed * 0.3));
            }
        }

        lastHistoryCheckRef.current = { time: now, height: currentHistoryHeight };

        // Calculate Forward Speed
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

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-black via-nothing-darker to-black flex items-center justify-center">
                <div className="animate-pulse text-white">Loading statistics...</div>
            </div>
        );
    }

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
    ];

    const totalRange = latestHeight - startHeight;
    const indexedRange = indexedHeight - startHeight;
    const progressPercent = totalRange > 0 ? (indexedRange / totalRange) * 100 : 0;
    const blocksBehind = latestHeight > indexedHeight ? (latestHeight - indexedHeight) : 0;

    // Forward speed derived from status polling (backend does not provide blocks_per_second)
    const blocksPerSecond = forwardSpeed || 0;
    const eta = blocksPerSecond > 0 ? Math.ceil(blocksBehind / blocksPerSecond) : 0;

    // ETA for History Backfill
    // Target is 0. Distance = historyHeight - 0
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

    // Format ETA
    // Format ETA
    const formatDuration = (seconds) => {
        if (!isFinite(seconds) || seconds === 0) return 'N/A';
        const d = Math.floor(seconds / (3600 * 24));
        const h = Math.floor((seconds % (3600 * 24)) / 3600);
        const m = Math.floor((seconds % 3600) / 60);

        if (d > 0) return `${d}d ${h}h`;
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m ${Math.floor(seconds % 60)}s`;
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-black via-nothing-darker to-black">
            <div className="max-w-7xl mx-auto p-8">
                {/* Header */}
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-8"
                >
                    <h1 className="text-4xl font-bold text-white mb-2 flex items-center">
                        <Activity className="mr-3 h-10 w-10 text-nothing-pink" />
                        System Statistics
                    </h1>
                    <p className="text-gray-400">Real-time indexing progress and system health monitoring</p>
                </motion.div>

                {/* Main Indexing Progress (Live) */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="bg-nothing-dark border border-white/10 p-8 mb-6"
                >
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center space-x-3">
                            <Database className="h-6 w-6 text-nothing-green" />
                            <h2 className="text-2xl font-bold text-white uppercase tracking-wide">Live Indexing (Forward)</h2>
                            <div className="flex items-center space-x-2 ml-4">
                                <span className={`flex h-2 w-2 rounded-full ${forwardStatusLabel === 'SYNCING' ? 'bg-green-500 animate-pulse' : forwardStatusLabel === 'DISABLED' ? 'bg-red-500' : 'bg-gray-500'}`}></span>
                                <span className="text-xs text-gray-400">{forwardStatusLabel}</span>
                            </div>
                        </div>
                        <span className="text-3xl font-bold text-nothing-pink">
                            {progressPercent.toFixed(2)}%
                        </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="relative h-16 bg-black/50 border border-white/10 rounded-sm overflow-hidden mb-6">
                        {/* Indexed portion (solid green with glow) */}
                        <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${progressPercent}%` }}
                            transition={{ duration: 1, ease: "easeOut" }}
                            className="absolute h-full bg-nothing-green"
                            style={{ boxShadow: '0 0 30px rgba(0, 255, 127, 0.5)' }}
                        />
                        {isForwardActive && (
                            <div className="absolute inset-0 bg-buffering-stripe animate-buffering opacity-30 mix-blend-overlay" />
                        )}

                        {/* Height Labels */}
                        <div className="absolute inset-0 flex items-center justify-between px-4 text-xs font-mono drop-shadow-md">
                            <span className="text-white mix-blend-screen font-bold">Start: <NumberFlow value={startHeight} format={{ useGrouping: true }} /></span>
                            <span className="text-black font-bold mix-blend-screen bg-white/20 px-2 py-0.5 rounded">Current: <NumberFlow value={indexedHeight} format={{ useGrouping: true }} /></span>
                            <span className="text-white mix-blend-screen font-bold">Latest: <NumberFlow value={latestHeight} format={{ useGrouping: true }} /></span>
                        </div>
                    </div>

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="bg-black/30 border border-white/10 p-4">
                            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Blocks Behind</div>
                            <div className="text-2xl font-bold text-nothing-pink">
                                <NumberFlow value={blocksBehind} format={{ useGrouping: true }} />
                            </div>
                        </div>
                        <div className="bg-black/30 border border-white/10 p-4">
                            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Blocks Indexed</div>
                            <div className="text-2xl font-bold text-nothing-green">
                                <NumberFlow value={indexedRange} format={{ useGrouping: true }} />
                            </div>
                        </div>
                        <div className="bg-black/30 border border-white/10 p-4">
                            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Speed (blocks/s)</div>
                            <div className="text-2xl font-bold text-nothing-blue">
                                <NumberFlow value={forwardEnabled ? blocksPerSecond : 0} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} />
                            </div>
                        </div>
                        <div className="bg-black/30 border border-white/10 p-4">
                            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">ETA</div>
                            <div className="text-2xl font-bold text-gray-300">
                                {forwardEnabled && eta > 0 ? `${Math.floor(eta / 60)}m ${eta % 60}s` : 'N/A'}
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* History Indexing Progress (Backward) */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                    className="bg-nothing-dark dashed-border border-white/10 p-8 mb-6 relative overflow-hidden"
                >
                    <div className="absolute top-0 right-0 p-4 opacity-5">
                        <div className="text-6xl font-bold text-white">HISTORY</div>
                    </div>
                    <div className="flex items-center justify-between mb-6 relative z-10">
                        <div className="flex items-center space-x-3">
                            <HardDrive className="h-6 w-6 text-blue-400" />
                            <h2 className="text-2xl font-bold text-white uppercase tracking-wide">History Backfill</h2>
                            <div className="flex items-center space-x-2 ml-4">
                                <span className={`flex h-2 w-2 rounded-full ${historyStatusLabel === 'SYNCING' ? 'bg-green-500 animate-pulse' : historyStatusLabel === 'DISABLED' ? 'bg-red-500' : 'bg-gray-500'}`}></span>
                                <span className="text-xs text-gray-400">{historyStatusLabel}</span>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-xs text-gray-500 uppercase tracking-widest mb-1">Oldest Block Indexed</div>
                            <span className="text-3xl font-bold text-blue-400">
                                {historyHeight.toLocaleString()}
                            </span>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 relative z-10">
                        <div className="bg-black/30 border border-white/10 p-4">
                            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Indexed History</div>
                            <div className="text-xl font-bold text-blue-400">
                                {historyCovered.toLocaleString()} blocks
                            </div>
                        </div>
                        <div className="bg-black/30 border border-white/10 p-4">
                            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Sync Speed</div>
                            <div className="text-xl font-bold text-white">
                                {historyEnabled ? historySpeed.toFixed(1) : 'N/A'} <span className="text-[10px] text-gray-500">blk/s</span>
                            </div>
                        </div>
                        <div className="bg-black/30 border border-white/10 p-4">
                            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Est. Time Remaining</div>
                            <div className="text-xl font-bold text-nothing-pink">
                                {historyEnabled ? formatDuration(historyEtaSeconds) : 'N/A'}
                            </div>
                        </div>
                        <div className="bg-black/30 border border-white/10 p-4">
                            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Total Blocks in DB</div>
                            <div className="text-xl font-bold text-nothing-green">
                                {(status?.total_blocks || 0).toLocaleString()}
                            </div>
                        </div>
                    </div>

                    {/* History Progress Bar */}
                    <div className="mt-6">
                        <div className="flex items-center justify-between mb-2 text-xs uppercase tracking-wider text-gray-400">
                            <span>History Progress</span>
                            <span className="text-blue-400">{historyPercent.toFixed(2)}%</span>
                        </div>
                        <div className="relative h-3 bg-black/50 border border-white/10 rounded-sm overflow-hidden">
                            <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${historyPercent}%` }}
                                transition={{ duration: 1, ease: "easeOut" }}
                                className="absolute h-full bg-gradient-to-r from-blue-500/30 to-blue-400/60"
                            />
                            {isHistoryActive && (
                                <div className="absolute inset-0 bg-buffering-stripe animate-buffering opacity-15" />
                            )}
                        </div>
                        <div className="mt-2 text-[10px] uppercase tracking-widest text-gray-500">
                            Oldest in DB: {minHeight.toLocaleString()} · Target: 0
                        </div>
                    </div>
                </motion.div>

                {/* Worker Progress */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.18 }}
                    className="bg-nothing-dark border border-white/10 p-8 mb-6"
                >
                    <div className="flex items-center space-x-3 mb-6">
                        <Activity className="h-6 w-6 text-nothing-green" />
                        <h2 className="text-2xl font-bold text-white uppercase tracking-wide">Worker Progress</h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        {workerOrder.map((worker) => {
                            const height = checkpoints?.[worker.key] || 0;
                            const enabled = workerEnabled?.[worker.key];
                            const behind = latestHeight > 0 && height > 0 ? (latestHeight - height) : 0;
                            const progress = latestHeight > 0 && height > 0 ? Math.min(100, (height / latestHeight) * 100) : 0;
                            const config = workerConfig?.[worker.key] || {};
                            return (
                                <div key={worker.key} className="bg-black/30 border border-white/10 p-5 hover:border-nothing-green/30 transition-all group">
                                    <div className="flex items-center justify-between mb-4">
                                        <span className="text-xs text-zinc-400 uppercase tracking-widest">{worker.label}</span>
                                        <div className={`h-1.5 w-1.5 rounded-full ${enabled === false ? 'bg-red-500' : 'bg-nothing-green shadow-[0_0_8px_rgba(0,255,65,0.6)]'}`} />
                                    </div>

                                    <div className="mb-4">
                                        <div className="text-2xl font-mono font-bold text-white mb-2">
                                            <NumberFlow value={height} format={{ useGrouping: true }} />
                                        </div>
                                        <div className="h-1 bg-white/10 w-full rounded-sm overflow-hidden">
                                            <div
                                                className="h-full bg-nothing-green"
                                                style={{ width: `${progress}%` }}
                                            />
                                        </div>
                                    </div>

                                    {height > 0 && (
                                        <div className="pt-4 border-t border-white/5 grid grid-cols-2 gap-y-3 gap-x-2">
                                            <div className="col-span-2 flex items-center justify-between">
                                                <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Behind</span>
                                                <span className="text-sm font-bold text-nothing-pink font-mono">
                                                    <NumberFlow value={behind} format={{ useGrouping: true }} />
                                                </span>
                                            </div>

                                            {config.workers !== undefined && (
                                                <div className="bg-white/5 p-1.5 rounded text-center">
                                                    <div className="text-[9px] text-zinc-500 uppercase">Workers</div>
                                                    <div className="text-xs text-white font-mono">{config.workers}</div>
                                                </div>
                                            )}

                                            {config.concurrency !== undefined && (
                                                <div className="bg-white/5 p-1.5 rounded text-center">
                                                    <div className="text-[9px] text-zinc-500 uppercase">Concurrency</div>
                                                    <div className="text-xs text-white font-mono">{config.concurrency}</div>
                                                </div>
                                            )}

                                            {config.range !== undefined && config.range !== 0 && (
                                                <div className="bg-white/5 p-1.5 rounded text-center">
                                                    <div className="text-[9px] text-zinc-500 uppercase">Range</div>
                                                    <div className="text-xs text-white font-mono">{config.range}</div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </motion.div>

                {/* Database Statistics */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                    className="bg-nothing-dark border border-white/10 p-8 mb-6"
                >
                    <div className="flex items-center space-x-3 mb-6">
                        <HardDrive className="h-6 w-6 text-nothing-blue" />
                        <h2 className="text-2xl font-bold text-white uppercase tracking-wide">Database Statistics</h2>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-black/30 border border-white/10 p-4">
                            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Total Transactions</div>
                            <div className="text-xl font-bold text-white">
                                <NumberFlow value={status?.total_transactions || 0} format={{ useGrouping: true }} />
                            </div>
                        </div>
                        <div className="bg-black/30 border border-white/10 p-4">
                            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Total Events</div>
                            <div className="text-xl font-bold text-white">
                                <NumberFlow value={status?.total_events || 0} format={{ useGrouping: true }} />
                            </div>
                        </div>
                        <div className="bg-black/30 border border-white/10 p-4">
                            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Total Addresses</div>
                            <div className="text-xl font-bold text-white">
                                <NumberFlow value={status?.total_addresses || 0} format={{ useGrouping: true }} />
                            </div>
                        </div>
                        <div className="bg-black/30 border border-white/10 p-4">
                            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Smart Contracts</div>
                            <div className="text-xl font-bold text-white">
                                <NumberFlow value={status?.total_contracts || 0} format={{ useGrouping: true }} />
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* System Health */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                    className="bg-nothing-dark border border-white/10 p-8"
                >
                    <div className="flex items-center space-x-3 mb-6">
                        <Server className="h-6 w-6 text-nothing-pink" />
                        <h2 className="text-2xl font-bold text-white uppercase tracking-wide">System Health</h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-black/30 border border-white/10 p-4">
                            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Backend Status</div>
                            <div className="flex items-center space-x-2">
                                <div className="h-3 w-3 bg-nothing-green rounded-full animate-pulse" />
                                <span className="text-white font-bold">ONLINE</span>
                            </div>
                        </div>
                        <div className="bg-black/30 border border-white/10 p-4">
                            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Last Update</div>
                            <div className="text-white">{generatedAt.toLocaleTimeString()}</div>
                        </div>
                        <div className="bg-black/30 border border-white/10 p-4">
                            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Network</div>
                            <div className="text-white font-bold">Flow Mainnet</div>
                        </div>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}

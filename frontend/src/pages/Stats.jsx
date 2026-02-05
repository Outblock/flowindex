import { useState, useEffect } from 'react';
// eslint-disable-next-line
import { motion, AnimatePresence } from 'framer-motion';
import { Database, Activity, HardDrive, Server } from 'lucide-react';
import { api } from '../api';

export default function Stats() {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);

    // State for Speed Calculations
    const [historySpeed, setHistorySpeed] = useState(0); // blocks per second
    const [forwardSpeed, setForwardSpeed] = useState(0); // blocks per second
    const [lastHistoryCheck, setLastHistoryCheck] = useState(null); // { time: number, height: number }
    const [lastForwardCheck, setLastForwardCheck] = useState(null); // { time: number, height: number }

    const fetchStatus = async () => {
        try {
            const data = await api.getStatus();

            // Calculate History Speed
            const now = Date.now();
            const currentHistoryHeight = (data.history_height && data.history_height > 0)
                ? data.history_height
                : (data.min_height || 0);

            if (lastHistoryCheck) {
                const timeDiff = (now - lastHistoryCheck.time) / 1000; // Seconds
                const blockDiff = lastHistoryCheck.height - currentHistoryHeight; // Should be positive (going backwards)

                if (timeDiff > 0 && blockDiff >= 0) { // Only update if moving or same
                    // Use a simple moving average or just instantaneous
                    const instantaneousSpeed = blockDiff / timeDiff;
                    // simple weighted average for smoothness: 0.7 * new + 0.3 * old
                    setHistorySpeed(prev => (prev * 0.7) + (instantaneousSpeed * 0.3));
                }
            }

            setLastHistoryCheck({ time: now, height: currentHistoryHeight });

            // Calculate Forward Speed
            const currentForwardHeight = data.indexed_height || 0;
            if (lastForwardCheck) {
                const timeDiff = (now - lastForwardCheck.time) / 1000;
                const blockDiff = currentForwardHeight - lastForwardCheck.height;
                if (timeDiff > 0 && blockDiff >= 0) {
                    const instantaneousSpeed = blockDiff / timeDiff;
                    setForwardSpeed(prev => (prev * 0.7) + (instantaneousSpeed * 0.3));
                }
            }
            setLastForwardCheck({ time: now, height: currentForwardHeight });
            setStatus(data);
            setLoading(false);
        } catch (error) {
            console.error('Failed to fetch status:', error);
        }
    };

    useEffect(() => {
        // eslint-disable-next-line
        fetchStatus();
        const interval = setInterval(fetchStatus, 3000); // Check every 3 seconds for better rate calc
        return () => clearInterval(interval);
    }, []); // Removed fetchStatus from dependency to avoid loop, though it's inside component so it's fine.

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

    const historyBase = startHeight > 0 ? startHeight : latestHeight;
    const historyTotal = historyBase > 0 ? historyBase : 0;
    const historyCovered = historyBase > 0 && historyHeight > 0 ? Math.max(0, historyBase - historyHeight) : 0;
    const historyPercent = historyTotal > 0 ? (historyCovered / historyTotal) * 100 : 0;

    const forwardStatusLabel = !forwardEnabled ? 'DISABLED' : (blocksBehind > 0 ? 'SYNCING' : 'CAUGHT UP');
    const historyStatusLabel = !historyEnabled ? 'DISABLED' : (historySpeed > 0 ? 'SYNCING' : 'IDLE');
    const isForwardActive = forwardEnabled && blocksBehind > 0;
    const isHistoryActive = historyEnabled && historySpeed > 0;

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
                        {/* Indexed portion (green gradient) */}
                        <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${progressPercent}%` }}
                            transition={{ duration: 1, ease: "easeOut" }}
                            className="absolute h-full bg-gradient-to-r from-nothing-green/30 to-nothing-green/60 border-r-2 border-nothing-green"
                            style={{ boxShadow: '0 0 20px rgba(0, 255, 127, 0.3)' }}
                        />
                        {isForwardActive && (
                            <div className="absolute inset-0 bg-buffering-stripe animate-buffering opacity-20" />
                        )}

                        {/* Height Labels */}
                        <div className="absolute inset-0 flex items-center justify-between px-4 text-xs font-mono">
                            <span className="text-gray-400">Start: {startHeight.toLocaleString()}</span>
                            <span className="text-nothing-green font-bold">Current: {indexedHeight.toLocaleString()}</span>
                            <span className="text-gray-400">Latest: {latestHeight.toLocaleString()}</span>
                        </div>
                    </div>

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="bg-black/30 border border-white/10 p-4">
                            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Blocks Behind</div>
                            <div className="text-2xl font-bold text-nothing-pink">{blocksBehind.toLocaleString()}</div>
                        </div>
                        <div className="bg-black/30 border border-white/10 p-4">
                            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Blocks Indexed</div>
                            <div className="text-2xl font-bold text-nothing-green">{indexedRange.toLocaleString()}</div>
                        </div>
                        <div className="bg-black/30 border border-white/10 p-4">
                            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Speed (blocks/s)</div>
                            <div className="text-2xl font-bold text-nothing-blue">
                                {forwardEnabled ? blocksPerSecond.toFixed(1) : 'N/A'}
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
                            const behind = latestHeight > height ? (latestHeight - height) : 0;
                            const enabled = workerEnabled?.[worker.key];
                            return (
                                <div key={worker.key} className="bg-black/30 border border-white/10 p-4">
                                    <div className="flex items-center justify-between text-gray-400 text-xs uppercase tracking-wider mb-1">
                                        <span>{worker.label}</span>
                                        <span className={`${enabled === false ? 'text-red-400' : 'text-nothing-green'}`}>
                                            {enabled === false ? 'DISABLED' : 'ENABLED'}
                                        </span>
                                    </div>
                                    <div className="text-xl font-bold text-white">{height.toLocaleString()}</div>
                                    <div className="text-[10px] uppercase tracking-wider text-gray-500">
                                        Behind: {behind.toLocaleString()}
                                    </div>
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
                            <div className="text-xl font-bold text-white">{(status?.total_transactions || 0).toLocaleString()}</div>
                        </div>
                        <div className="bg-black/30 border border-white/10 p-4">
                            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Total Events</div>
                            <div className="text-xl font-bold text-white">{(status?.total_events || 0).toLocaleString()}</div>
                        </div>
                        <div className="bg-black/30 border border-white/10 p-4">
                            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Total Addresses</div>
                            <div className="text-xl font-bold text-white">{(status?.total_addresses || 0).toLocaleString()}</div>
                        </div>
                        <div className="bg-black/30 border border-white/10 p-4">
                            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">Smart Contracts</div>
                            <div className="text-xl font-bold text-white">{(status?.total_contracts || 0).toLocaleString()}</div>
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

import { useState, useEffect } from 'react';
// eslint-disable-next-line
import { motion, AnimatePresence } from 'framer-motion';
import { Database, Activity, HardDrive, Server } from 'lucide-react';
import { api } from '../api';

export default function Stats() {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);

    const fetchStatus = async () => {
        try {
            const data = await api.getStatus();
            setStatus(data);
            setLoading(false);
        } catch (error) {
            console.error('Failed to fetch status:', error);
        }
    };

    useEffect(() => {
        // eslint-disable-next-line
        fetchStatus();
        const interval = setInterval(fetchStatus, 2000); // Update every 2 seconds
        return () => clearInterval(interval);
    }, []);

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
    const totalRange = latestHeight - startHeight;
    const indexedRange = indexedHeight - startHeight;
    const progressPercent = totalRange > 0 ? (indexedRange / totalRange) * 100 : 0;
    const blocksBehind = latestHeight - indexedHeight;

    // Calculate blocks per second (estimate based on last update)
    const blocksPerSecond = status?.blocks_per_second || 0;
    const eta = blocksPerSecond > 0 ? Math.ceil(blocksBehind / blocksPerSecond) : 0;

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
                            <div className="text-2xl font-bold text-nothing-blue">{blocksPerSecond.toFixed(1)}</div>
                        </div>
                        <div className="bg-black/30 border border-white/10 p-4">
                            <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">ETA</div>
                            <div className="text-2xl font-bold text-gray-300">
                                {eta > 0 ? `${Math.floor(eta / 60)}m ${eta % 60}s` : 'N/A'}
                            </div>
                        </div>
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
                            <div className="text-white">{new Date().toLocaleTimeString()}</div>
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

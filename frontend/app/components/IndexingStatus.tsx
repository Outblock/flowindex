import React, { useEffect, useState } from 'react';
import { api } from '../api';

export function IndexingStatus() {
    const [status, setStatus] = useState<any>(null);

    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const res = await api.getStatus();
                setStatus(res.data);
            } catch (e) {
                console.error("Failed to fetch status", e);
            }
        };

        fetchStatus();
        const interval = setInterval(fetchStatus, 5000);
        return () => clearInterval(interval);
    }, []);

    if (!status) return null;

    // Calculate percentages relative to START block
    const latest = status.latest_height || 1;
    const start = status.start_height || 0;
    const indexed = status.indexed_height || 0;

    // Ensure we don't divide by zero
    const totalRange = Math.max(1, latest - start);
    const indexedRange = Math.max(0, indexed - start);
    // Clamp to 0-100
    const percent = Math.min(100, Math.max(0, (indexedRange / totalRange) * 100));

    // Buffering relative to "catching up" state
    const isBuffering = status.behind > 10;

    return (
        <div className="bg-black border-b border-white/10 text-white py-3 px-6 flex flex-col md:flex-row items-center justify-between gap-4 font-mono">
            {/* Left: Status Indicator */}
            <div className="flex items-center gap-3 shrink-0">
                <div className={`w-2 h-2 rounded-full ${isBuffering ? 'bg-yellow-400 animate-pulse' : 'bg-nothing-green shadow-[0_0_8px_rgba(0,255,65,0.6)]'}`}></div>
                <span className="text-xs tracking-widest uppercase text-zinc-400">
                    {isBuffering ? 'Synchronizing' : 'System Operational'}
                </span>
            </div>

            {/* Middle: Progress & Data */}
            <div className="flex flex-col w-full max-w-2xl gap-2">
                <div className="flex justify-between items-end text-[10px] text-zinc-500 uppercase tracking-wider">
                    <span>Start: {start.toLocaleString()}</span>
                    <span className="text-white font-bold">{percent.toFixed(2)}%</span>
                    <span>Head: {latest.toLocaleString()}</span>
                </div>

                {/* Ultra-thin elegant bar */}
                <div className="w-full h-[2px] bg-zinc-900 relative overflow-hidden">
                    <div
                        className={`absolute top-0 left-0 h-full bg-nothing-green transition-all duration-300 ease-out ${isBuffering ? 'w-full animate-progress-indeterminate origin-left' : ''}`}
                        style={isBuffering ? {} : { width: `${percent}%` }}
                    />
                </div>

                <div className="flex justify-between text-[10px] text-zinc-600">
                    <span>Indexed: {indexed.toLocaleString()}</span>
                    {status.behind > 0 && (
                        <span className="text-zinc-400">{status.behind.toLocaleString()} blocks remaining</span>
                    )}
                </div>
            </div>

            {/* Right: Network Status */}
            <div className="shrink-0 text-right hidden md:block">
                <div className="text-[10px] text-zinc-500 uppercase tracking-widest">Network</div>
                <div className="text-xs text-white">Flow Mainnet</div>
            </div>
        </div>
    );
}

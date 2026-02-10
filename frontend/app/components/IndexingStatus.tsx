import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Database } from 'lucide-react';
import { ensureHeyApiConfigured } from '../api/heyapi';
import { getStatus } from '../api/gen/core';
import { formatNumber } from '../lib/format';

export function IndexingStatus() {
    const [status, setStatus] = useState<any>(null);

    useEffect(() => {
        const fetchStatus = async () => {
            try {
                await ensureHeyApiConfigured();
                const res = await getStatus();
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

    const latestHeight = status.latest_height || 0;
    const minHeight = status.min_height || 0;
    const maxHeight = status.max_height || 0;
    const coveredRange = maxHeight >= minHeight && maxHeight > 0 ? (maxHeight - minHeight + 1) : 0;
    const totalHistory = latestHeight > 0 ? (latestHeight + 1) : 0;
    const historyPercent = totalHistory > 0 ? (coveredRange / totalHistory) * 100 : 0;

    return (
        <Link
            to="/stats"
            className="block border border-zinc-200 dark:border-white/10 bg-white dark:bg-nothing-dark/80 hover:border-nothing-green/40 transition-colors"
        >
            <div className="p-4 md:p-5">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="p-2 border border-zinc-200 dark:border-white/10 rounded-sm">
                            <Database className="h-4 w-4 text-nothing-green-dark dark:text-nothing-green" />
                        </div>
                        <div>
                            <p className="text-[10px] uppercase tracking-widest text-zinc-500 dark:text-gray-400">Indexing Progress</p>
                            <p className="text-sm text-zinc-900 dark:text-white">
                                {totalHistory > 0 ? `${historyPercent.toFixed(2)}% of full history` : 'Initializing...'}
                            </p>
                            {totalHistory > 0 && (
                                <p className="text-[10px] uppercase tracking-wider text-gray-500">
                                    Range: {formatNumber(minHeight)} → {formatNumber(maxHeight)} (Latest {formatNumber(latestHeight)})
                                </p>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="h-2 w-48 bg-black/50 border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden">
                            <div
                                className="h-full bg-emerald-500 dark:bg-nothing-green"
                                style={{ width: `${Math.min(100, historyPercent).toFixed(2)}%` }}
                            />
                        </div>
                        <span className="text-[10px] uppercase tracking-widest text-nothing-green-dark dark:text-nothing-green">View Details →</span>
                    </div>
                </div>
            </div>
        </Link>
    );
}

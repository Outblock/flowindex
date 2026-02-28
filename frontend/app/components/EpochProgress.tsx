import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { SafeNumberFlow } from './SafeNumberFlow';

interface EpochProgressProps {
    epoch: number | null;
    progress: number;
    updatedAt?: number | null;
    startView?: number | null;
    endView?: number | null;
    currentView?: number | null;
    phase?: number | null;
}

function splitCountdown(totalSeconds: number) {
    const d = Math.floor(totalSeconds / 86400);
    const h = Math.floor((totalSeconds % 86400) / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    return { d, h, m, s };
}

const PHASE_LABELS: Record<number, string> = {
    0: 'Staking Auction',
    1: 'Epoch Setup',
    2: 'Epoch Committed',
};

const NO_GROUPING = { useGrouping: false };

function CountdownSegments({ seconds }: { seconds: number }) {
    const { d, h, m, s } = splitCountdown(seconds);
    return (
        <>
            {d > 0 && <><SafeNumberFlow value={d} format={NO_GROUPING} /><span className="text-zinc-400 dark:text-zinc-500 text-xs">d</span><span className="w-1" /></>}
            {h > 0 && <><SafeNumberFlow value={h} format={NO_GROUPING} /><span className="text-zinc-400 dark:text-zinc-500 text-xs">h</span><span className="w-1" /></>}
            {m > 0 && <><SafeNumberFlow value={m} format={NO_GROUPING} /><span className="text-zinc-400 dark:text-zinc-500 text-xs">m</span><span className="w-1" /></>}
            <SafeNumberFlow value={s} format={NO_GROUPING} /><span className="text-zinc-400 dark:text-zinc-500 text-xs">s</span>
        </>
    );
}

export function EpochProgress({ epoch, progress, endView, currentView, phase }: EpochProgressProps) {
    const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const hasRemaining = remainingSeconds != null;

    // Sync remaining seconds from API data, then tick down client-side
    useEffect(() => {
        if (endView != null && currentView != null && endView > currentView) {
            setRemainingSeconds(endView - currentView);
        }
    }, [endView, currentView]);

    useEffect(() => {
        if (!hasRemaining) return;
        intervalRef.current = setInterval(() => {
            setRemainingSeconds(prev => (prev != null && prev > 0 ? prev - 1 : 0));
        }, 1000);
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [hasRemaining]);

    if (!epoch) {
        return (
            <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 h-full flex items-center justify-between animate-pulse">
                <div className="space-y-3">
                    <div className="h-3 w-20 bg-zinc-100 dark:bg-white/5 rounded-sm"></div>
                    <div className="h-8 w-24 bg-zinc-100 dark:bg-white/5 rounded-sm"></div>
                    <div className="h-3 w-32 bg-zinc-100 dark:bg-white/5 rounded-sm"></div>
                </div>
                <div className="w-24 h-24 rounded-full border-4 border-zinc-100 dark:border-white/5"></div>
            </div>
        );
    }

    const radius = 40;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (progress / 100) * circumference;
    const phaseLabel = phase != null ? PHASE_LABELS[phase] ?? null : null;

    return (
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 h-full flex items-center justify-between relative overflow-hidden group hover:border-nothing-green/30 transition-all duration-300">
            {/* Background Gradient */}
            <div className="absolute -right-10 -bottom-10 w-32 h-32 blur-3xl rounded-full bg-blue-500/10" />

            <div className="min-w-0">
                <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 dark:text-gray-400 mb-1">Current Epoch</h3>
                <div className="text-3xl font-mono font-bold text-zinc-900 dark:text-white tracking-tighter">
                    #{epoch}
                </div>
                <div className="mt-2 text-[10px] uppercase tracking-wider text-nothing-green animate-pulse">
                    {(100 - progress).toFixed(1)}% Remaining
                </div>
                {remainingSeconds != null && remainingSeconds > 0 && (
                    <div className="mt-1 text-sm font-mono font-semibold text-zinc-700 dark:text-zinc-200 flex items-baseline gap-0.5">
                        <CountdownSegments seconds={remainingSeconds} />
                    </div>
                )}
                {phaseLabel && (
                    <div className="mt-1.5 inline-block px-1.5 py-0.5 text-[9px] uppercase tracking-wider font-semibold rounded bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                        {phaseLabel}
                    </div>
                )}
            </div>

            <div className="relative w-24 h-24 flex-shrink-0 flex items-center justify-center">
                {/* Background Circle */}
                <svg className="transform -rotate-90 w-full h-full">
                    <circle
                        cx="50%"
                        cy="50%"
                        r={radius}
                        stroke="currentColor"
                        className="text-zinc-100 dark:text-[#333]"
                        strokeWidth="8"
                        fill="transparent"
                    />
                    {/* Progress Circle */}
                    <motion.circle
                        initial={{ strokeDashoffset: circumference }}
                        animate={{ strokeDashoffset }}
                        transition={{ duration: 1.5, ease: "easeOut" }}
                        cx="50%"
                        cy="50%"
                        r={radius}
                        stroke="#3b82f6"
                        strokeWidth="8"
                        fill="transparent"
                        strokeDasharray={circumference}
                        strokeLinecap="round"
                    />
                </svg>
                <div className="absolute text-sm font-bold text-blue-500 dark:text-blue-400 font-mono">
                    {progress.toFixed(0)}%
                </div>
            </div>
        </div>
    );
}

import { Zap } from 'lucide-react';

import { motion } from 'framer-motion';
import { formatAbsoluteTime } from '../lib/time';

export function EpochProgress({ epoch, progress, updatedAt }: { epoch: number | null; progress: number; updatedAt: number | null }) {
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
    const updatedText = updatedAt ? formatAbsoluteTime(updatedAt * 1000) : '';

    return (
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 h-full flex items-center justify-between relative overflow-hidden group hover:border-nothing-green/30 transition-all duration-300">
            {/* Background Gradient */}
            <div className="absolute -right-10 -bottom-10 w-32 h-32 blur-3xl rounded-full bg-blue-500/10" />

            <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 dark:text-gray-400 mb-1">Current Epoch</h3>
                <div className="text-3xl font-mono font-bold text-zinc-900 dark:text-white tracking-tighter">
                    #{epoch}
                </div>
                <div className="mt-2 text-[10px] uppercase tracking-wider text-nothing-green animate-pulse">
                    {(100 - progress).toFixed(1)}% Remaining
                </div>
                {updatedText && (
                    <div className="mt-2 text-[10px] uppercase tracking-wider text-zinc-400 dark:text-gray-500">
                        As of {updatedText}
                    </div>
                )}
            </div>

            <div className="relative w-24 h-24 flex items-center justify-center">
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

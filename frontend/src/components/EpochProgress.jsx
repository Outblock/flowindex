import { Zap } from 'lucide-react';
export function EpochProgress({ epoch, progress }) {
    const radius = 40;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (progress / 100) * circumference;

    return (
        <div className="bg-nothing-dark border border-white/10 p-6 flex items-center justify-between relative overflow-hidden group hover:border-nothing-green/30 transition-all duration-300">
            {/* Background Gradient */}
            <div className="absolute -right-10 -bottom-10 w-32 h-32 blur-3xl rounded-full bg-blue-500/10" />

            <div>
                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">Current Epoch</h3>
                <div className="text-3xl font-mono font-bold text-white tracking-tighter">
                    #{epoch}
                </div>
                <div className="mt-2 text-[10px] uppercase tracking-wider text-nothing-green animate-pulse">
                    {(100 - progress).toFixed(1)}% Remaining
                </div>
            </div>

            <div className="relative w-24 h-24 flex items-center justify-center">
                {/* Background Circle */}
                <svg className="transform -rotate-90 w-full h-full">
                    <circle
                        cx="50%"
                        cy="50%"
                        r={radius}
                        stroke="#333"
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
                <div className="absolute text-sm font-bold text-blue-400 font-mono">
                    {progress.toFixed(0)}%
                </div>
            </div>
        </div>
    );
}

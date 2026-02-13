import { Link } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import { Search } from 'lucide-react';

/* ── Animated grid-scan background ── */
function GridScanBg() {
    return (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {/* Grid */}
            <div
                className="absolute inset-0 opacity-[0.04] dark:opacity-[0.06]"
                style={{
                    backgroundImage: `
                        linear-gradient(rgba(0,0,0,0.3) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(0,0,0,0.3) 1px, transparent 1px)
                    `,
                    backgroundSize: '40px 40px',
                }}
            />
            {/* Horizontal scan line */}
            <div
                className="absolute left-0 right-0 h-px opacity-20"
                style={{
                    background: 'linear-gradient(90deg, transparent 0%, #4ade80 30%, #4ade80 70%, transparent 100%)',
                    animation: 'scanY 4s ease-in-out infinite',
                }}
            />
            {/* Vertical scan line */}
            <div
                className="absolute top-0 bottom-0 w-px opacity-10"
                style={{
                    background: 'linear-gradient(180deg, transparent 0%, #4ade80 30%, #4ade80 70%, transparent 100%)',
                    animation: 'scanX 6s ease-in-out infinite',
                }}
            />
            {/* Large "404" watermark */}
            <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[20vw] font-black text-zinc-200 dark:text-white/[0.02] leading-none select-none tracking-tighter">
                    404
                </span>
            </div>
            <style>{`
                @keyframes scanY {
                    0%, 100% { top: -1px; }
                    50% { top: 100%; }
                }
                @keyframes scanX {
                    0%, 100% { left: -1px; }
                    50% { left: 100%; }
                }
            `}</style>
        </div>
    );
}

interface NotFoundPageProps {
    icon: LucideIcon;
    title: string;
    description: string;
    hint?: string;
    identifier?: string;
}

export function NotFoundPage({ icon: Icon, title, description, hint, identifier }: NotFoundPageProps) {
    return (
        <div className="min-h-screen bg-gray-50 dark:bg-black flex items-center justify-center font-mono transition-colors duration-300 relative">
            <GridScanBg />
            <div className="relative z-10 border border-zinc-200 dark:border-white/10 bg-white dark:bg-nothing-dark p-10 max-w-lg w-full text-center shadow-sm">
                {/* Icon */}
                <div className="w-16 h-16 rounded-full border-2 border-zinc-200 dark:border-white/10 flex items-center justify-center mx-auto mb-6">
                    <Icon className="h-7 w-7 text-zinc-400 dark:text-zinc-500" />
                </div>

                {/* Title */}
                <h2 className="text-lg font-bold text-zinc-900 dark:text-white uppercase tracking-widest mb-3">
                    {title}
                </h2>

                {/* Identifier if provided */}
                {identifier && (
                    <p className="text-[11px] font-mono text-zinc-400 dark:text-zinc-600 break-all mb-4 px-4">
                        {identifier}
                    </p>
                )}

                {/* Description */}
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-2">{description}</p>

                {/* Hint about indexing */}
                {hint && (
                    <p className="text-xs text-zinc-400 dark:text-zinc-600 mb-6">{hint}</p>
                )}
                {!hint && <div className="mb-6" />}

                {/* Searching indicator */}
                <div className="flex items-center justify-center gap-2 text-[10px] text-zinc-400 uppercase tracking-widest mb-6">
                    <Search className="w-3 h-3 animate-pulse" />
                    <span>Not found in indexed data</span>
                </div>

                {/* Action buttons */}
                <div className="space-y-2">
                    <Link
                        to="/"
                        className="inline-block w-full border border-zinc-200 dark:border-white/10 hover:bg-zinc-50 dark:hover:bg-white/5 text-zinc-900 dark:text-white text-xs uppercase tracking-widest py-3 transition-all"
                    >
                        Return to Dashboard
                    </Link>
                    <Link
                        to="/stats"
                        className="inline-block w-full border border-nothing-green-dark/20 dark:border-nothing-green/20 hover:bg-nothing-green-dark/5 dark:hover:bg-nothing-green/10 text-nothing-green-dark dark:text-nothing-green text-xs uppercase tracking-widest py-3 transition-all"
                    >
                        View Indexing Progress
                    </Link>
                </div>
            </div>
        </div>
    );
}

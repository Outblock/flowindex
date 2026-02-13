import { Link } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import { Search, RefreshCw } from 'lucide-react';
import GridScan from '../GridScan';

interface NotFoundPageProps {
    icon: LucideIcon;
    title: string;
    description: string;
    hint?: string;
    identifier?: string;
}

export function NotFoundPage({ icon: Icon, title, description, hint, identifier }: NotFoundPageProps) {
    return (
        <div className="min-h-screen w-full flex flex-col items-center justify-center p-8 text-center bg-black relative overflow-hidden isolate font-mono">
            {/* GridScan Background */}
            <div className="absolute inset-0 z-0">
                <GridScan scanColor="#9effe2" className="w-full h-full" />
            </div>

            <div className="relative z-10 space-y-8 max-w-2xl mx-auto flex flex-col items-center">
                {/* Large 404 watermark */}
                <h1 className="text-[12rem] leading-none font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-white/5 tracking-tighter select-none">
                    404
                </h1>

                {/* Frosted glass text container */}
                <div className="space-y-4 max-w-lg bg-black/40 backdrop-blur-md border border-white/10 rounded-sm px-8 py-6">
                    {/* Icon + Title */}
                    <div className="flex items-center justify-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center bg-white/5">
                            <Icon className="h-5 w-5 text-zinc-400" />
                        </div>
                        <h2 className="text-2xl font-bold text-white uppercase tracking-widest">
                            {title}
                        </h2>
                    </div>

                    {/* Identifier */}
                    {identifier && (
                        <p className="text-sm font-mono text-zinc-400 break-all">
                            {identifier}
                        </p>
                    )}

                    {/* Description */}
                    <p className="text-base text-zinc-300 font-mono leading-relaxed">
                        {description}
                    </p>

                    {/* Hint */}
                    {hint && (
                        <div className="flex items-center justify-center gap-2 text-sm text-zinc-400">
                            <Search className="w-3.5 h-3.5 animate-pulse" />
                            <span>{hint}</span>
                        </div>
                    )}
                </div>

                {/* Action buttons — vertical stack */}
                <div className="flex flex-col gap-3 mt-4 w-full max-w-xs">
                    <button
                        onClick={() => window.location.reload()}
                        className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-white text-black font-bold uppercase tracking-widest hover:bg-[#9effe2] transition-colors duration-300 rounded-sm"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Reload Page
                    </button>
                    <Link
                        to="/"
                        className="inline-flex items-center justify-center gap-2 px-8 py-4 border border-white/10 text-white font-bold uppercase tracking-widest hover:bg-white/5 transition-colors duration-300 rounded-sm"
                    >
                        Return to Dashboard
                    </Link>
                    <Link
                        to="/stats"
                        className="inline-flex items-center justify-center gap-2 px-8 py-4 border border-white/10 text-white font-bold uppercase tracking-widest hover:bg-white/5 transition-colors duration-300 rounded-sm"
                    >
                        Indexing Progress
                    </Link>
                </div>
            </div>
        </div>
    );
}

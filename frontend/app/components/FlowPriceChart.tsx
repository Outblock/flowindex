import { TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer, YAxis, Tooltip } from 'recharts';
import { memo, useEffect, useMemo, useState } from 'react';

// Mock data generator for the sparkline (since we only have current price)
// In a real app, we'd fetch historical price data
const generateSparkline = (currentPrice) => {
    // IMPORTANT: Must be deterministic for SSR hydration.
    // Avoid Math.random() or Date-based values here.
    const base = Number.isFinite(currentPrice) ? currentPrice : 0;
    const amp = Math.max(Math.abs(base) * 0.02, 0.0005);
    const data = [];
    const total = 30;
    for (let i = 0; i < total; i++) {
        const a = i * 0.65;
        const b = i * 1.35;
        const value = base + (Math.sin(a) * amp) + (Math.sin(b) * amp * 0.25);
        const daysAgo = total - 1 - i;
        const label = daysAgo === 0 ? 'Today' : `${daysAgo}d ago`;
        data.push({ value, label });
    }
    return data;
};

export const FlowPriceChart = memo(function FlowPriceChart({ data }) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    // Hooks must be called unconditionally, even when rendering a skeleton.
    const price = data?.price ?? 0;
    // Avoid generating a new random dataset on every parent rerender (blocks/ws updates).
    const sparklineData = useMemo(() => generateSparkline(price), [price]);

    if (!data) {
        return (
            <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 h-full flex flex-col justify-between animate-pulse">
                <div className="flex justify-between items-start mb-4">
                    <div className="space-y-2">
                        <div className="h-4 w-24 bg-zinc-100 dark:bg-white/5 rounded-sm"></div>
                        <div className="h-8 w-32 bg-zinc-100 dark:bg-white/5 rounded-sm"></div>
                    </div>
                    <div className="h-6 w-16 bg-zinc-100 dark:bg-white/5 rounded-sm"></div>
                </div>
                <div className="h-16 w-full bg-zinc-100 dark:bg-white/5 rounded-sm mt-auto"></div>
                <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-white/5 flex justify-between">
                    <div className="h-3 w-16 bg-zinc-100 dark:bg-white/5 rounded-sm"></div>
                    <div className="h-3 w-16 bg-zinc-100 dark:bg-white/5 rounded-sm"></div>
                </div>
            </div>
        );
    }

    const { price_change_24h, market_cap } = data;
    const isPositive = price_change_24h >= 0;

    return (
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 relative overflow-hidden group hover:border-nothing-green/30 transition-all duration-300">
            {/* Background Gradient */}
            <div className={`absolute -right-10 -top-10 w-32 h-32 blur-3xl rounded-full opacity-10 ${isPositive ? 'bg-nothing-green' : 'bg-red-500'}`} />

            <div className="flex justify-between items-start mb-4 relative z-10">
                <div>
                    <div className="flex items-center space-x-2 mb-1">
                        <div className="p-1.5 border border-zinc-200 dark:border-white/10 rounded-sm bg-zinc-50 dark:bg-black/20">
                            <DollarSign className="w-4 h-4 text-nothing-green-dark dark:text-nothing-green" />
                        </div>
                        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 dark:text-gray-400">Flow Price</h3>
                    </div>
                    <div className="flex items-baseline space-x-3">
                        <span className="text-3xl font-mono font-bold text-zinc-900 dark:text-white tracking-tighter">
                            ${price?.toFixed(3) ?? '0.000'}
                        </span>
                        <div className={`flex items-center space-x-1 text-xs font-bold px-1.5 py-0.5 rounded-sm border ${isPositive
                            ? 'text-nothing-green-dark dark:text-nothing-green border-nothing-green-dark/30 dark:border-nothing-green/30 bg-nothing-green/5'
                            : 'text-red-500 border-red-500/30 bg-red-500/5'
                            }`}>
                            {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            <span>{Math.abs(price_change_24h ?? 0).toFixed(2)}%</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Sparkline Chart */}
            <div className="h-16 w-full -mx-2 opacity-50 group-hover:opacity-100 transition-opacity duration-500">
                {mounted ? (
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={sparklineData}>
                            <defs>
                                <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={isPositive ? "#00ff41" : "#ef4444"} stopOpacity={0.3} />
                                    <stop offset="95%" stopColor={isPositive ? "#00ff41" : "#ef4444"} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <YAxis domain={['dataMin', 'dataMax']} hide />
                            <Tooltip
                                content={({ active, payload }) => {
                                    if (!active || !payload?.length) return null;
                                    const val = payload[0].value as number;
                                    const label = payload[0].payload?.label;
                                    return (
                                        <div className="bg-zinc-900 border border-zinc-700 px-2.5 py-1.5 rounded-sm shadow-lg">
                                            <div className="text-white font-mono text-xs">${val.toFixed(4)}</div>
                                            {label && <div className="text-zinc-400 font-mono text-[10px] mt-0.5">{label}</div>}
                                        </div>
                                    );
                                }}
                                cursor={{ stroke: isPositive ? '#00ff41' : '#ef4444', strokeDasharray: '3 3', strokeWidth: 1 }}
                            />
                            <Area
                                type="monotone"
                                dataKey="value"
                                stroke={isPositive ? "#00ff41" : "#ef4444"}
                                strokeWidth={2}
                                fillOpacity={1}
                                fill="url(#colorPrice)"
                                // Recharts animations can accumulate work when rerendering frequently.
                                isAnimationActive={false}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="h-full w-full bg-zinc-100 dark:bg-white/5 rounded-sm" />
                )}
            </div>

            <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-white/5 flex justify-between items-center text-[10px] uppercase tracking-wider text-zinc-500 dark:text-gray-500">
                <span>Market Cap</span>
                <span className="text-zinc-900 dark:text-white font-mono">${((market_cap ?? 0) / 1000000).toFixed(0)}M</span>
            </div>
        </div>
    );
});

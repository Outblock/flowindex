import { TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts';

// Mock data generator for the sparkline (since we only have current price)
// In a real app, we'd fetch historical price data
const generateSparkline = (currentPrice) => {
    const data = [];
    let price = currentPrice;
    for (let i = 0; i < 20; i++) {
        data.unshift({ value: price });
        // Random walk
        const change = (Math.random() - 0.5) * (currentPrice * 0.02);
        price -= change;
    }
    return data;
};

export function FlowPriceChart({ data }) {
    if (!data) return null;

    const { price, price_change_24h, market_cap } = data;
    const isPositive = price_change_24h >= 0;
    const sparklineData = generateSparkline(price);

    return (
        <div className="bg-nothing-dark border border-white/10 p-6 relative overflow-hidden group hover:border-nothing-green/30 transition-all duration-300">
            {/* Background Gradient */}
            <div className={`absolute -right-10 -top-10 w-32 h-32 blur-3xl rounded-full opacity-10 ${isPositive ? 'bg-nothing-green' : 'bg-red-500'}`} />

            <div className="flex justify-between items-start mb-4 relative z-10">
                <div>
                    <div className="flex items-center space-x-2 mb-1">
                        <div className="p-1.5 border border-white/10 rounded-sm bg-black/20">
                            <DollarSign className="w-4 h-4 text-nothing-green" />
                        </div>
                        <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">Flow Price</h3>
                    </div>
                    <div className="flex items-baseline space-x-3">
                        <span className="text-3xl font-mono font-bold text-white tracking-tighter">
                            ${price.toFixed(3)}
                        </span>
                        <div className={`flex items-center space-x-1 text-xs font-bold px-1.5 py-0.5 rounded-sm border ${isPositive
                            ? 'text-nothing-green border-nothing-green/30 bg-nothing-green/5'
                            : 'text-red-500 border-red-500/30 bg-red-500/5'
                            }`}>
                            {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            <span>{Math.abs(price_change_24h).toFixed(2)}%</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Sparkline Chart */}
            <div className="h-16 w-full -mx-2 opacity-50 group-hover:opacity-100 transition-opacity duration-500">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={sparklineData}>
                        <defs>
                            <linearGradient id="colorPrice" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={isPositive ? "#00ff41" : "#ef4444"} stopOpacity={0.3} />
                                <stop offset="95%" stopColor={isPositive ? "#00ff41" : "#ef4444"} stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <YAxis domain={['dataMin', 'dataMax']} hide />
                        <Area
                            type="monotone"
                            dataKey="value"
                            stroke={isPositive ? "#00ff41" : "#ef4444"}
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#colorPrice)"
                            isAnimationActive={true}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            <div className="mt-4 pt-4 border-t border-white/5 flex justify-between items-center text-[10px] uppercase tracking-wider text-gray-500">
                <span>Market Cap</span>
                <span className="text-white font-mono">${(market_cap / 1000000).toFixed(0)}M</span>
            </div>
        </div>
    );
}

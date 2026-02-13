import { useState, useEffect, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { resolveApiBaseUrl } from '../../api';
import { normalizeAddress } from './accountUtils';
import { GlassCard } from '../ui/GlassCard';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface Props {
    address: string;
}

interface BalancePoint {
    date: string;
    balance: number;
}

const RANGES = [
    { label: '14D', days: 14 },
    { label: '30D', days: 30 },
    { label: '90D', days: 90 },
    { label: '180D', days: 180 },
] as const;

export function AccountBalanceTab({ address }: Props) {
    const normalizedAddress = normalizeAddress(address);
    const [data, setData] = useState<BalancePoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [days, setDays] = useState(30);
    const [currentBalance, setCurrentBalance] = useState<string>('0');

    const fetchHistory = useCallback(async (numDays: number) => {
        setLoading(true);
        setError(null);
        try {
            const baseUrl = await resolveApiBaseUrl();
            const res = await fetch(`${baseUrl}/flow/v1/flow/account/${normalizedAddress}/balance/history?days=${numDays}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            const points: BalancePoint[] = (json.data || []).map((p: { date: string; balance: string }) => ({
                date: p.date,
                balance: parseFloat(p.balance) || 0,
            }));
            setData(points);
            setCurrentBalance(json.meta?.current_balance || '0');
        } catch (err) {
            console.error('Failed to load balance history', err);
            setError('Failed to load balance history');
            setData([]);
        } finally {
            setLoading(false);
        }
    }, [normalizedAddress]);

    useEffect(() => {
        fetchHistory(days);
    }, [days, fetchHistory]);

    const handleRangeChange = (d: number) => {
        setDays(d);
    };

    const periodChange = data.length >= 2
        ? data[data.length - 1].balance - data[0].balance
        : 0;
    const periodChangePct = data.length >= 2 && data[0].balance !== 0
        ? ((periodChange / data[0].balance) * 100)
        : 0;

    if (loading) {
        return (
            <GlassCard className="p-6 h-[400px] flex items-center justify-center">
                <p className="text-zinc-500 text-xs uppercase tracking-widest animate-pulse">Loading Balance History...</p>
            </GlassCard>
        );
    }

    if (error || !data.length) {
        return (
            <GlassCard className="p-6 h-[400px] flex flex-col items-center justify-center gap-4">
                <TrendingUp className="h-12 w-12 text-zinc-400" />
                <p className="text-zinc-500 text-xs uppercase tracking-widest">
                    {error || 'No balance history available yet'}
                </p>
                <p className="text-zinc-400 text-[10px] max-w-md text-center">
                    Balance history is built from indexed token transfers. Data will appear as the worker processes blocks.
                </p>
            </GlassCard>
        );
    }

    const formatBalance = (value: number) => {
        if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
        if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
        return value.toFixed(2);
    };

    return (
        <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <GlassCard className="p-5">
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Current Balance</p>
                    <p className="text-xl font-bold">{formatBalance(parseFloat(currentBalance))} <span className="text-xs font-normal text-zinc-500">FLOW</span></p>
                </GlassCard>
                <GlassCard className="p-5">
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Period Change</p>
                    <div className="flex items-center gap-2">
                        {periodChange > 0 ? (
                            <TrendingUp className="h-4 w-4 text-nothing-green" />
                        ) : periodChange < 0 ? (
                            <TrendingDown className="h-4 w-4 text-red-500" />
                        ) : (
                            <Minus className="h-4 w-4 text-zinc-500" />
                        )}
                        <p className={`text-xl font-bold ${periodChange > 0 ? 'text-nothing-green' : periodChange < 0 ? 'text-red-500' : ''}`}>
                            {periodChange >= 0 ? '+' : ''}{formatBalance(periodChange)}
                        </p>
                    </div>
                </GlassCard>
                <GlassCard className="p-5">
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">% Change ({days}d)</p>
                    <p className={`text-xl font-bold ${periodChangePct > 0 ? 'text-nothing-green' : periodChangePct < 0 ? 'text-red-500' : ''}`}>
                        {periodChangePct >= 0 ? '+' : ''}{periodChangePct.toFixed(2)}%
                    </p>
                </GlassCard>
            </div>

            {/* Chart */}
            <GlassCard className="p-6 group hover:border-nothing-green/30 transition-all duration-300">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-widest">FLOW Balance History</h2>
                    <div className="flex items-center gap-1">
                        {RANGES.map((range) => (
                            <button
                                key={range.days}
                                onClick={() => handleRangeChange(range.days)}
                                className={`text-[9px] uppercase tracking-wider px-2 py-1 border rounded-sm transition-colors ${days === range.days
                                    ? 'text-nothing-green-dark dark:text-nothing-green border-nothing-green-dark/40 dark:border-nothing-green/40 bg-nothing-green/10'
                                    : 'text-zinc-500 border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-white/5 hover:text-zinc-900 dark:hover:text-white hover:border-zinc-300 dark:hover:border-white/20'
                                    }`}
                            >
                                {range.label}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#00ef8b" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#00ef8b" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#444" vertical={false} className="stroke-zinc-200 dark:stroke-zinc-800" />
                            <XAxis
                                dataKey="date"
                                stroke="#666"
                                fontSize={9}
                                tickLine={false}
                                axisLine={false}
                                tick={{ fill: '#666', fontFamily: 'monospace' }}
                                angle={-45}
                                textAnchor="end"
                                height={50}
                                minTickGap={20}
                            />
                            <YAxis
                                stroke="#666"
                                fontSize={9}
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={formatBalance}
                                tick={{ fill: '#666', fontFamily: 'monospace' }}
                                width={50}
                            />
                            <Tooltip
                                contentStyle={{ backgroundColor: '#111', borderColor: '#333', color: '#fff', fontSize: '12px', fontFamily: 'monospace' }}
                                itemStyle={{ color: '#00ef8b' }}
                                cursor={{ stroke: '#333', strokeDasharray: '5 5' }}
                                formatter={(value: number) => [value.toLocaleString(undefined, { maximumFractionDigits: 4 }), 'FLOW']}
                                labelFormatter={(label) => `Date: ${label}`}
                            />
                            <Area type="monotone" dataKey="balance" stroke="#00ef8b" strokeWidth={2} fillOpacity={1} fill="url(#colorBalance)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </GlassCard>
        </div>
    );
}

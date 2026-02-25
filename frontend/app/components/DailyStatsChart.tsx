import React, { useState, useEffect } from 'react';
import { AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ensureHeyApiConfigured } from '../api/heyapi';
import { getStatusV1Stat } from '../api/gen/find';

export function DailyStatsChart() {
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [rangeDays, setRangeDays] = useState(7);

    useEffect(() => {
        const loadStats = async () => {
            try {
                await ensureHeyApiConfigured();
                // getStatusV1Stat returns {data: [{metric, number, time, timescale}]}
                // We request daily transaction stats for the last 180 days.
                const fromDate = new Date();
                fromDate.setDate(fromDate.getDate() - 180);
                const res = await getStatusV1Stat({
                    query: {
                        from: fromDate.toISOString().split('T')[0],
                        metric: 'transactions',
                        timescale: 'daily',
                    },
                });
                const stats: any = (res?.data as any)?.data;

                // Handle null/empty response
                if (stats && Array.isArray(stats)) {
                    const chartData = stats.map((s: any) => ({
                        name: (s.date || s.time || '').split('T')[0],
                        txs: s.tx_count ?? s.number ?? 0,
                        evm_txs: s.evm_tx_count ?? 0,
                    })).sort((a: any, b: any) => new Date(a.name).getTime() - new Date(b.name).getTime());
                    setData(chartData);
                } else {
                    console.warn("Daily stats is empty or invalid format");
                    setData([]);  // Set empty array if no data
                }
            } catch (err) {
                console.error("Failed to load daily stats:", err);
                setData([]);  // Set empty array on error
            } finally {
                setLoading(false);
            }
        };
        loadStats();
    }, []);

    if (loading) {
        return (
            <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 h-[286px] flex items-center justify-center">
                <p className="text-zinc-500 text-xs uppercase tracking-widest animate-pulse">Loading Statistics...</p>
            </div>
        );
    }

    if (!data.length) {
        return (
            <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 h-[286px] flex items-center justify-center">
                <p className="text-zinc-500 text-xs uppercase tracking-widest">No Transaction History Available</p>
            </div>
        );
    }

    const visibleData = rangeDays >= data.length ? data : data.slice(-rangeDays);
    return (
        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 group hover:border-nothing-green/30 transition-all duration-300">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-zinc-900 dark:text-white uppercase tracking-widest">Transaction History</h2>
                <div className="flex items-center gap-1">
                    {[
                        { label: '7D', value: 7 },
                        { label: '30D', value: 30 },
                        { label: '90D', value: 90 },
                        { label: '180D', value: 180 }
                    ].map((range) => (
                        <button
                            key={range.value}
                            onClick={() => setRangeDays(range.value)}
                            className={`text-[9px] uppercase tracking-wider px-2 py-1 border rounded-sm transition-colors ${rangeDays === range.value
                                ? 'text-nothing-green-dark dark:text-nothing-green border-nothing-green-dark/40 dark:border-nothing-green/40 bg-nothing-green/10'
                                : 'text-zinc-500 border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-white/5 hover:text-zinc-900 dark:hover:text-white hover:border-zinc-300 dark:hover:border-white/20'
                                }`}
                        >
                            {range.label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="h-[200px] w-full" key={rangeDays}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                        data={visibleData}
                        margin={{
                            top: 10,
                            right: 30,
                            left: 0,
                            bottom: 0,
                        }}
                    >
                        <defs>
                            <linearGradient id="colorTxs" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#00ef8b" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#00ef8b" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#444" vertical={false} className="stroke-zinc-200 dark:stroke-zinc-800" />
                        <XAxis
                            dataKey="name"
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
                        <YAxis stroke="#666" fontSize={9} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} tick={{ fill: '#666', fontFamily: 'monospace' }} width={30} />
                        <Tooltip
                            contentStyle={{ backgroundColor: '#111', borderColor: '#333', color: '#fff', fontSize: '12px' }}
                            itemStyle={{ color: '#00ef8b', fontFamily: 'monospace' }}
                            cursor={{ stroke: '#333', strokeDasharray: '5 5' }}
                        />
                        <Area type="monotone" dataKey="txs" stroke="#00ef8b" strokeWidth={2} fillOpacity={1} fill="url(#colorTxs)" />
                        <Line type="monotone" dataKey="evm_txs" stroke="#a855f7" strokeWidth={2} dot={false} />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

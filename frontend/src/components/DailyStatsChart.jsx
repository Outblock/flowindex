import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Mock data for now (backend endpoint to be implemented)
const data = [
    { name: 'Mon', txs: 4000 },
    { name: 'Tue', txs: 3000 },
    { name: 'Wed', txs: 2000 },
    { name: 'Thu', txs: 2780 },
    { name: 'Fri', txs: 1890 },
    { name: 'Sat', txs: 2390 },
    { name: 'Sun', txs: 3490 },
];

export function DailyStatsChart() {
    return (
        <div className="bg-nothing-dark border border-white/10 p-6 group hover:border-nothing-green/30 transition-all duration-300">
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-white uppercase tracking-widest">Transaction History</h2>
                <span className="text-xs text-nothing-green border border-nothing-green/30 px-2 py-1 bg-nothing-green/10">14 DAYS</span>
            </div>
            <div className="h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                        data={data}
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
                        <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
                        <XAxis dataKey="name" stroke="#666" fontSize={10} tickLine={false} axisLine={false} tick={{ fill: '#666', fontFamily: 'monospace' }} />
                        <YAxis stroke="#666" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}`} tick={{ fill: '#666', fontFamily: 'monospace' }} />
                        <Tooltip
                            contentStyle={{ backgroundColor: '#000', borderColor: '#333', color: '#fff' }}
                            itemStyle={{ color: '#00ef8b', fontFamily: 'monospace' }}
                            cursor={{ stroke: '#333', strokeDasharray: '5 5' }}
                        />
                        <Area type="monotone" dataKey="txs" stroke="#00ef8b" strokeWidth={2} fillOpacity={1} fill="url(#colorTxs)" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

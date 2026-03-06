// ---------------------------------------------------------------------------
// ContractCharts — version timeline + holder trend placeholder
// ---------------------------------------------------------------------------

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';
import type { ContractVersion } from './api';

interface Props {
  versions: ContractVersion[];
}

// Placeholder data for future holder trend chart
const holderPlaceholder = [
  { date: '1', holders: 0 },
  { date: '2', holders: 0 },
  { date: '3', holders: 0 },
  { date: '4', holders: 0 },
  { date: '5', holders: 0 },
];

const tooltipStyle = {
  backgroundColor: '#27272a', // zinc-800
  border: '1px solid #3f3f46', // zinc-700
  borderRadius: '6px',
  color: '#d4d4d8', // zinc-300
  fontSize: '12px',
};

export default function ContractCharts({ versions }: Props) {
  const barData = versions.map((v) => ({
    version: `v${v.version}`,
    block_height: v.block_height,
  }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Version Timeline */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="text-xs font-medium text-zinc-400 mb-4">
          Version Timeline
        </h3>
        {barData.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={barData}>
              <XAxis
                dataKey="version"
                tick={{ fill: '#a1a1aa', fontSize: 11 }}
                axisLine={{ stroke: '#3f3f46' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#a1a1aa', fontSize: 11 }}
                axisLine={{ stroke: '#3f3f46' }}
                tickLine={false}
                tickFormatter={(v: number) =>
                  v >= 1_000_000
                    ? `${(v / 1_000_000).toFixed(1)}M`
                    : v >= 1_000
                      ? `${(v / 1_000).toFixed(0)}K`
                      : String(v)
                }
              />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={{ color: '#a1a1aa' }}
                formatter={(value: number) => [
                  value.toLocaleString(),
                  'Block Height',
                ]}
              />
              <Bar dataKey="block_height" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[200px] flex items-center justify-center">
            <p className="text-xs text-zinc-600">No version data</p>
          </div>
        )}
      </div>

      {/* Holder Trend Placeholder */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="text-xs font-medium text-zinc-400 mb-4">
          Holder Trend
          <span className="ml-2 text-zinc-600">(coming soon)</span>
        </h3>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={holderPlaceholder}>
            <XAxis
              dataKey="date"
              tick={{ fill: '#a1a1aa', fontSize: 11 }}
              axisLine={{ stroke: '#3f3f46' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#a1a1aa', fontSize: 11 }}
              axisLine={{ stroke: '#3f3f46' }}
              tickLine={false}
            />
            <Tooltip contentStyle={tooltipStyle} />
            <Area
              type="monotone"
              dataKey="holders"
              stroke="#3b82f6"
              fill="#3b82f620"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

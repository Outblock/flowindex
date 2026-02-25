import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useMemo } from 'react'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import {
  fetchAnalyticsDaily,
  fetchAnalyticsTransfersDaily,
  fetchNetworkStats,
  ensureHeyApiConfigured,
  getBaseURL,
} from '../api/heyapi'

export const Route = createFileRoute('/analytics')({
  component: AnalyticsPage,
})

/* ── types ── */

interface DailyRow {
  date: string
  tx_count: number
  evm_tx_count: number
  cadence_tx_count: number
  total_gas_used: number
  active_accounts: number
  new_contracts: number
  failed_tx_count: number
  error_rate: number
  avg_gas_per_tx: number
}

interface TransferRow {
  date: string
  ft_transfers: number
  nft_transfers: number
}

interface PricePoint {
  price: number
  as_of: string
}

interface EpochRow {
  epoch: number
  total_nodes: number
  total_staked: number
  total_rewarded: number
  payout_total: number
}

interface NetworkStatsData {
  price: number
  price_change_24h: number
  market_cap: number
  epoch: number | null
  total_staked: number
  total_supply: number
  active_nodes: number
}

interface Totals {
  block_count: number
  transaction_count: number
}

/* ── formatters ── */

function fmtNum(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function fmtComma(n: number): string {
  return n.toLocaleString()
}

function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`
}

function fmtPrice(n: number): string {
  return `$${n.toFixed(2)}`
}

function fmtDateTick(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return dateStr
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function yTickFmt(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return String(v)
}

/* ── constants ── */

const RANGES: { label: string; value: number }[] = [
  { label: '7D', value: 7 },
  { label: '30D', value: 30 },
  { label: '90D', value: 90 },
  { label: 'All', value: 9999 },
]

const CARD_CLS =
  'bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 hover:border-nothing-green/30 transition-all duration-300'

const TOOLTIP_STYLE = {
  backgroundColor: '#111',
  borderColor: '#333',
  color: '#fff',
  fontSize: '12px',
}

const TOOLTIP_ITEM = { color: '#00ef8b', fontFamily: 'monospace' }

const TICK_PROPS = { fill: '#666', fontFamily: 'monospace' }

/* ── reusable chart wrapper ── */

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={CARD_CLS}>
      <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-widest mb-4">
        {title}
      </h3>
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          {children as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* ── shared axis helpers ── */

function xAxisProps(dataKey = 'date') {
  return {
    dataKey,
    stroke: '#666',
    fontSize: 9,
    tickLine: false as const,
    axisLine: false as const,
    tick: TICK_PROPS,
    tickFormatter: fmtDateTick,
    angle: -45,
    textAnchor: 'end' as const,
    height: 50,
    minTickGap: 20,
  }
}

function yAxisProps(formatter?: (v: number) => string) {
  return {
    stroke: '#666',
    fontSize: 9,
    tickLine: false as const,
    axisLine: false as const,
    tick: TICK_PROPS,
    tickFormatter: formatter ?? yTickFmt,
    width: 45,
  }
}

/* ── KPI card ── */

function KpiCard({
  label,
  value,
  delta,
  deltaLabel,
  invertColor,
}: {
  label: string
  value: string
  delta?: number | null
  deltaLabel?: string
  invertColor?: boolean
}) {
  let deltaColor = 'text-zinc-400'
  let deltaText = ''
  if (delta != null && !isNaN(delta)) {
    const positive = invertColor ? delta < 0 : delta > 0
    const negative = invertColor ? delta > 0 : delta < 0
    deltaColor = positive
      ? 'text-emerald-500'
      : negative
        ? 'text-red-500'
        : 'text-zinc-400'
    const sign = delta > 0 ? '+' : ''
    deltaText = deltaLabel ?? `${sign}${fmtNum(delta)}`
  }
  return (
    <div className={CARD_CLS + ' flex flex-col justify-between min-h-[100px]'}>
      <span className="text-[10px] uppercase tracking-widest text-zinc-500">{label}</span>
      <span className="text-2xl font-bold text-zinc-900 dark:text-white font-mono">{value}</span>
      {deltaText && <span className={`text-xs font-mono ${deltaColor}`}>{deltaText}</span>}
    </div>
  )
}

/* ── skeleton ── */

function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={CARD_CLS + ' h-[100px]'}>
            <div className="h-2 w-16 bg-zinc-200 dark:bg-zinc-800 rounded mb-4" />
            <div className="h-6 w-24 bg-zinc-200 dark:bg-zinc-800 rounded" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className={CARD_CLS + ' h-[270px]'}>
            <div className="h-3 w-32 bg-zinc-200 dark:bg-zinc-800 rounded mb-6" />
            <div className="h-[200px] bg-zinc-100 dark:bg-zinc-900 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── main page ── */

function AnalyticsPage() {
  const [rangeDays, setRangeDays] = useState(30)
  const [dailyData, setDailyData] = useState<DailyRow[]>([])
  const [transferData, setTransferData] = useState<TransferRow[]>([])
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([])
  const [epochData, setEpochData] = useState<EpochRow[]>([])
  const [netStats, setNetStats] = useState<NetworkStatsData | null>(null)
  const [totals, setTotals] = useState<Totals | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await ensureHeyApiConfigured()
      const fromDate = new Date()
      fromDate.setFullYear(fromDate.getFullYear() - 1)
      const fromStr = fromDate.toISOString().split('T')[0]

      const [dailyRes, transferRes, netRes, priceRes, epochRes, totalsRes] =
        await Promise.allSettled([
          fetchAnalyticsDaily(fromStr),
          fetchAnalyticsTransfersDaily(fromStr),
          fetchNetworkStats(),
          fetch(`${getBaseURL()}/status/price/history?limit=720`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
          fetch(`${getBaseURL()}/staking/epoch/stats?limit=200`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
          fetch(`${getBaseURL()}/status/count`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
        ])

      if (cancelled) return

      if (dailyRes.status === 'fulfilled' && dailyRes.value) {
        const sorted = (dailyRes.value as DailyRow[]).sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        )
        setDailyData(sorted)
      }
      if (transferRes.status === 'fulfilled' && transferRes.value) {
        const sorted = (transferRes.value as TransferRow[]).sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
        )
        setTransferData(sorted)
      }
      if (netRes.status === 'fulfilled' && netRes.value) {
        setNetStats(netRes.value as NetworkStatsData)
      }
      if (priceRes.status === 'fulfilled' && priceRes.value?.data) {
        const pts = (priceRes.value.data as PricePoint[])
          .slice()
          .sort((a, b) => new Date(a.as_of).getTime() - new Date(b.as_of).getTime())
        setPriceHistory(pts)
      }
      if (epochRes.status === 'fulfilled' && epochRes.value?.data) {
        const rows = (epochRes.value.data as EpochRow[])
          .slice()
          .sort((a, b) => a.epoch - b.epoch)
        setEpochData(rows)
      }
      if (totalsRes.status === 'fulfilled' && totalsRes.value?.data) {
        const d = totalsRes.value.data
        const item = Array.isArray(d) ? d[0] : d
        if (item) setTotals(item as Totals)
      }

      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /* ── derived visible slices ── */

  const visibleDaily = useMemo(
    () => (rangeDays >= dailyData.length ? dailyData : dailyData.slice(-rangeDays)),
    [dailyData, rangeDays],
  )

  const visibleTransfers = useMemo(
    () =>
      rangeDays >= transferData.length ? transferData : transferData.slice(-rangeDays),
    [transferData, rangeDays],
  )

  const visiblePrice = useMemo(() => {
    const mapped = priceHistory.map((p) => ({
      date: p.as_of.split('T')[0],
      price: p.price,
    }))
    return rangeDays >= mapped.length ? mapped : mapped.slice(-rangeDays)
  }, [priceHistory, rangeDays])

  /* evm percentage data */
  const evmPctData = useMemo(
    () =>
      visibleDaily.map((d) => {
        const total = d.cadence_tx_count + d.evm_tx_count
        return {
          date: d.date,
          cadence_pct: total > 0 ? (d.cadence_tx_count / total) * 100 : 100,
          evm_pct: total > 0 ? (d.evm_tx_count / total) * 100 : 0,
        }
      }),
    [visibleDaily],
  )

  /* ── KPI helpers ── */

  const latest = dailyData.length > 0 ? dailyData[dailyData.length - 1] : null
  const prev = dailyData.length > 1 ? dailyData[dailyData.length - 2] : null

  function delta(cur?: number, prv?: number) {
    if (cur == null || prv == null) return null
    return cur - prv
  }

  /* ── render ── */

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-nothing-darker">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {/* header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-white uppercase tracking-widest">
            Analytics
          </h1>
          <div className="flex items-center gap-1">
            {RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setRangeDays(r.value)}
                className={`text-[9px] uppercase tracking-wider px-2 py-1 border rounded-sm transition-colors ${
                  rangeDays === r.value
                    ? 'text-nothing-green-dark dark:text-nothing-green border-nothing-green-dark/40 dark:border-nothing-green/40 bg-nothing-green/10'
                    : 'text-zinc-500 border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-white/5 hover:text-zinc-900 dark:hover:text-white hover:border-zinc-300 dark:hover:border-white/20'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <Skeleton rows={12} />
        ) : (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <KpiCard
                label="Total Transactions"
                value={totals ? fmtComma(totals.transaction_count) : '--'}
                delta={latest?.tx_count}
                deltaLabel={latest ? `+${fmtNum(latest.tx_count)} today` : undefined}
              />
              <KpiCard
                label="Active Accounts (24h)"
                value={latest ? fmtComma(latest.active_accounts) : '--'}
                delta={delta(latest?.active_accounts, prev?.active_accounts)}
              />
              <KpiCard
                label="Gas Burned (24h)"
                value={latest ? fmtNum(latest.total_gas_used) : '--'}
                delta={delta(latest?.total_gas_used, prev?.total_gas_used)}
              />
              <KpiCard
                label="Tx Error Rate (24h)"
                value={latest ? fmtPct(latest.error_rate) : '--'}
                delta={delta(latest?.error_rate, prev?.error_rate)}
                deltaLabel={
                  latest && prev
                    ? `${(latest.error_rate - prev.error_rate) > 0 ? '+' : ''}${(latest.error_rate - prev.error_rate).toFixed(2)}pp`
                    : undefined
                }
                invertColor
              />
              <KpiCard
                label="FLOW Price"
                value={netStats ? fmtPrice(netStats.price) : '--'}
                delta={netStats?.price_change_24h}
                deltaLabel={
                  netStats
                    ? `${netStats.price_change_24h > 0 ? '+' : ''}${netStats.price_change_24h.toFixed(2)}%`
                    : undefined
                }
              />
              <KpiCard
                label="Contracts Deployed"
                value={latest ? fmtComma(latest.new_contracts) : '--'}
                delta={delta(latest?.new_contracts, prev?.new_contracts)}
              />
            </div>

            {/* ── Network Activity ── */}
            <h2 className="text-lg font-bold uppercase tracking-widest text-zinc-900 dark:text-white mt-8 mb-4">
              Network Activity
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 1. Daily Tx Count - stacked */}
              <ChartCard title="Daily Transaction Count">
                <AreaChart data={visibleDaily} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gCadence" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00ef8b" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#00ef8b" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gEvm" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#444" vertical={false} className="stroke-zinc-200 dark:stroke-zinc-800" />
                  <XAxis {...xAxisProps()} />
                  <YAxis {...yAxisProps()} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM} cursor={{ stroke: '#333', strokeDasharray: '5 5' }} />
                  <Area type="monotone" dataKey="cadence_tx_count" stackId="1" stroke="#00ef8b" strokeWidth={2} fill="url(#gCadence)" name="Cadence" />
                  <Area type="monotone" dataKey="evm_tx_count" stackId="1" stroke="#3b82f6" strokeWidth={2} fill="url(#gEvm)" name="EVM" />
                </AreaChart>
              </ChartCard>

              {/* 2. Active Accounts */}
              <ChartCard title="Active Accounts">
                <AreaChart data={visibleDaily} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gAccounts" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00ef8b" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#00ef8b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#444" vertical={false} className="stroke-zinc-200 dark:stroke-zinc-800" />
                  <XAxis {...xAxisProps()} />
                  <YAxis {...yAxisProps()} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM} cursor={{ stroke: '#333', strokeDasharray: '5 5' }} />
                  <Area type="monotone" dataKey="active_accounts" stroke="#00ef8b" strokeWidth={2} fill="url(#gAccounts)" name="Active Accounts" />
                </AreaChart>
              </ChartCard>
            </div>

            {/* ── Gas & Fees ── */}
            <h2 className="text-lg font-bold uppercase tracking-widest text-zinc-900 dark:text-white mt-8 mb-4">
              Gas &amp; Fees
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 3. Gas Burned per Day */}
              <ChartCard title="Gas Burned per Day">
                <AreaChart data={visibleDaily} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gGas" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#444" vertical={false} className="stroke-zinc-200 dark:stroke-zinc-800" />
                  <XAxis {...xAxisProps()} />
                  <YAxis {...yAxisProps()} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: '#f59e0b', fontFamily: 'monospace' }} cursor={{ stroke: '#333', strokeDasharray: '5 5' }} />
                  <Area type="monotone" dataKey="total_gas_used" stroke="#f59e0b" strokeWidth={2} fill="url(#gGas)" name="Gas Used" />
                </AreaChart>
              </ChartCard>

              {/* 4. Avg Gas per Tx */}
              <ChartCard title="Avg Gas per Transaction">
                <AreaChart data={visibleDaily} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gAvgGas" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#444" vertical={false} className="stroke-zinc-200 dark:stroke-zinc-800" />
                  <XAxis {...xAxisProps()} />
                  <YAxis {...yAxisProps()} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: '#f59e0b', fontFamily: 'monospace' }} cursor={{ stroke: '#333', strokeDasharray: '5 5' }} />
                  <Area type="monotone" dataKey="avg_gas_per_tx" stroke="#f59e0b" strokeWidth={2} fill="url(#gAvgGas)" name="Avg Gas/Tx" />
                </AreaChart>
              </ChartCard>
            </div>

            {/* ── Transaction Health ── */}
            <h2 className="text-lg font-bold uppercase tracking-widest text-zinc-900 dark:text-white mt-8 mb-4">
              Transaction Health
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 5. Error Rate */}
              <ChartCard title="Error Rate (%)">
                <AreaChart data={visibleDaily} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gErr" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#444" vertical={false} className="stroke-zinc-200 dark:stroke-zinc-800" />
                  <XAxis {...xAxisProps()} />
                  <YAxis {...yAxisProps((v) => `${v}%`)} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: '#ef4444', fontFamily: 'monospace' }} cursor={{ stroke: '#333', strokeDasharray: '5 5' }} formatter={(v: number) => [`${v.toFixed(2)}%`, 'Error Rate']} />
                  <Area type="monotone" dataKey="error_rate" stroke="#ef4444" strokeWidth={2} fill="url(#gErr)" name="Error Rate" />
                </AreaChart>
              </ChartCard>

              {/* 6. Failed Transactions - bar */}
              <ChartCard title="Failed Transactions">
                <BarChart data={visibleDaily} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#444" vertical={false} className="stroke-zinc-200 dark:stroke-zinc-800" />
                  <XAxis {...xAxisProps()} />
                  <YAxis {...yAxisProps()} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: '#ef4444', fontFamily: 'monospace' }} cursor={{ fill: 'rgba(239,68,68,0.08)' }} />
                  <Bar dataKey="failed_tx_count" fill="#ef4444" name="Failed Txs" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ChartCard>
            </div>

            {/* ── Token Economy ── */}
            <h2 className="text-lg font-bold uppercase tracking-widest text-zinc-900 dark:text-white mt-8 mb-4">
              Token Economy
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 7. FT Transfers */}
              <ChartCard title="FT Transfers per Day">
                <AreaChart data={visibleTransfers} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gFt" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#444" vertical={false} className="stroke-zinc-200 dark:stroke-zinc-800" />
                  <XAxis {...xAxisProps()} />
                  <YAxis {...yAxisProps()} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: '#8b5cf6', fontFamily: 'monospace' }} cursor={{ stroke: '#333', strokeDasharray: '5 5' }} />
                  <Area type="monotone" dataKey="ft_transfers" stroke="#8b5cf6" strokeWidth={2} fill="url(#gFt)" name="FT Transfers" />
                </AreaChart>
              </ChartCard>

              {/* 8. NFT Transfers */}
              <ChartCard title="NFT Transfers per Day">
                <AreaChart data={visibleTransfers} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gNft" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ec4899" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#444" vertical={false} className="stroke-zinc-200 dark:stroke-zinc-800" />
                  <XAxis {...xAxisProps()} />
                  <YAxis {...yAxisProps()} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: '#ec4899', fontFamily: 'monospace' }} cursor={{ stroke: '#333', strokeDasharray: '5 5' }} />
                  <Area type="monotone" dataKey="nft_transfers" stroke="#ec4899" strokeWidth={2} fill="url(#gNft)" name="NFT Transfers" />
                </AreaChart>
              </ChartCard>

              {/* 9. FLOW Price History */}
              <ChartCard title="FLOW Price History">
                <LineChart data={visiblePrice} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#444" vertical={false} className="stroke-zinc-200 dark:stroke-zinc-800" />
                  <XAxis {...xAxisProps()} />
                  <YAxis {...yAxisProps((v) => `$${v.toFixed(2)}`)} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM} cursor={{ stroke: '#333', strokeDasharray: '5 5' }} formatter={(v: number) => [`$${v.toFixed(4)}`, 'Price']} />
                  <Line type="monotone" dataKey="price" stroke="#00ef8b" strokeWidth={2} dot={false} name="FLOW" />
                </LineChart>
              </ChartCard>
            </div>

            {/* ── EVM Adoption ── */}
            <h2 className="text-lg font-bold uppercase tracking-widest text-zinc-900 dark:text-white mt-8 mb-4">
              EVM Adoption
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 10. EVM vs Cadence % */}
              <ChartCard title="EVM vs Cadence Transactions (%)">
                <AreaChart data={evmPctData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gCadPct" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00ef8b" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#00ef8b" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gEvmPct" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#444" vertical={false} className="stroke-zinc-200 dark:stroke-zinc-800" />
                  <XAxis {...xAxisProps()} />
                  <YAxis {...yAxisProps((v) => `${v}%`)} domain={[0, 100]} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM} cursor={{ stroke: '#333', strokeDasharray: '5 5' }} formatter={(v: number) => [`${v.toFixed(1)}%`]} />
                  <Area type="monotone" dataKey="cadence_pct" stackId="1" stroke="#00ef8b" strokeWidth={2} fill="url(#gCadPct)" name="Cadence %" />
                  <Area type="monotone" dataKey="evm_pct" stackId="1" stroke="#3b82f6" strokeWidth={2} fill="url(#gEvmPct)" name="EVM %" />
                </AreaChart>
              </ChartCard>
            </div>

            {/* ── Staking & Epochs ── */}
            {epochData.length > 0 && (
              <>
                <h2 className="text-lg font-bold uppercase tracking-widest text-zinc-900 dark:text-white mt-8 mb-4">
                  Staking &amp; Epochs
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* 11. Total Staked per Epoch */}
                  <ChartCard title="Total Staked per Epoch">
                    <LineChart data={epochData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#444" vertical={false} className="stroke-zinc-200 dark:stroke-zinc-800" />
                      <XAxis dataKey="epoch" stroke="#666" fontSize={9} tickLine={false} axisLine={false} tick={TICK_PROPS} minTickGap={20} />
                      <YAxis {...yAxisProps()} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={TOOLTIP_ITEM} cursor={{ stroke: '#333', strokeDasharray: '5 5' }} formatter={(v: number) => [fmtNum(v), 'Staked']} />
                      <Line type="monotone" dataKey="total_staked" stroke="#00ef8b" strokeWidth={2} dot={false} name="Total Staked" />
                    </LineChart>
                  </ChartCard>

                  {/* 12. Node Count per Epoch */}
                  <ChartCard title="Node Count per Epoch">
                    <LineChart data={epochData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#444" vertical={false} className="stroke-zinc-200 dark:stroke-zinc-800" />
                      <XAxis dataKey="epoch" stroke="#666" fontSize={9} tickLine={false} axisLine={false} tick={TICK_PROPS} minTickGap={20} />
                      <YAxis {...yAxisProps()} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: '#3b82f6', fontFamily: 'monospace' }} cursor={{ stroke: '#333', strokeDasharray: '5 5' }} />
                      <Line type="monotone" dataKey="total_nodes" stroke="#3b82f6" strokeWidth={2} dot={false} name="Nodes" />
                    </LineChart>
                  </ChartCard>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

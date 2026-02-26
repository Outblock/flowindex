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
  Legend,
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
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
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
  { label: 'ALL', value: 9999 },
]

/* ── color palette ── */
const C = {
  green: '#00ef8b',
  greenDim: 'rgba(0,239,139,0.15)',
  blue: '#3b82f6',
  blueDim: 'rgba(59,130,246,0.15)',
  amber: '#f59e0b',
  amberDim: 'rgba(245,158,11,0.15)',
  red: '#ef4444',
  redDim: 'rgba(239,68,68,0.15)',
  purple: '#8b5cf6',
  purpleDim: 'rgba(139,92,246,0.15)',
  pink: '#ec4899',
  pinkDim: 'rgba(236,72,153,0.15)',
  grid: 'rgba(255,255,255,0.06)',
  gridLight: 'rgba(0,0,0,0.06)',
  tick: '#71717a',
}

const TOOLTIP_STYLE = {
  backgroundColor: 'rgba(9,9,11,0.95)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '6px',
  color: '#fff',
  fontSize: '12px',
  fontFamily: 'monospace',
  padding: '8px 12px',
}

const TICK_PROPS = { fill: C.tick, fontFamily: 'monospace' }

/* ── tab types ── */

type AnalyticsTab = 'all' | 'transactions' | 'tokens' | 'network' | 'price'

const TABS: { label: string; value: AnalyticsTab }[] = [
  { label: 'All', value: 'all' },
  { label: 'Transactions', value: 'transactions' },
  { label: 'Tokens', value: 'tokens' },
  { label: 'Network', value: 'network' },
  { label: 'Price', value: 'price' },
]

/* ── chart skeleton ── */

function ChartSkeleton() {
  return (
    <div className="h-full w-full flex items-end gap-1 px-4 pb-4 animate-pulse">
      {Array.from({ length: 20 }).map((_, i) => (
        <div
          key={i}
          className="flex-1 bg-zinc-200 dark:bg-zinc-800 rounded-t"
          style={{ height: `${30 + Math.sin(i * 0.7) * 25 + Math.random() * 20}%` }}
        />
      ))}
    </div>
  )
}

/* ── empty state ── */

function EmptyState({ message = 'No data available' }: { message?: string }) {
  return (
    <div className="h-full flex items-center justify-center text-zinc-400 dark:text-zinc-600 text-sm font-mono">
      {message}
    </div>
  )
}

/* ── reusable chart wrapper ── */

function ChartCard({
  title,
  children,
  className = '',
  loading = false,
  empty = false,
  emptyMessage,
}: {
  title: string
  children: React.ReactNode
  className?: string
  loading?: boolean
  empty?: boolean
  emptyMessage?: string
}) {
  return (
    <div className={`bg-white dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 hover:border-nothing-green/30 transition-colors ${className}`}>
      <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-4">
        {title}
      </h3>
      <div className="h-[220px]">
        {loading ? (
          <ChartSkeleton />
        ) : empty ? (
          <EmptyState message={emptyMessage} />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {children as React.ReactElement}
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

/* ── shared axis helpers ── */

function xAxisProps(dataKey = 'date') {
  return {
    dataKey,
    stroke: 'transparent',
    fontSize: 10,
    tickLine: false as const,
    axisLine: false as const,
    tick: TICK_PROPS,
    tickFormatter: fmtDateTick,
    height: 40,
    minTickGap: 30,
  }
}

function yAxisProps(formatter?: (v: number) => string) {
  return {
    stroke: 'transparent',
    fontSize: 10,
    tickLine: false as const,
    axisLine: false as const,
    tick: TICK_PROPS,
    tickFormatter: formatter ?? yTickFmt,
    width: 50,
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
      ? 'text-emerald-400'
      : negative
        ? 'text-red-400'
        : 'text-zinc-400'
    const sign = delta > 0 ? '+' : ''
    deltaText = deltaLabel ?? `${sign}${fmtNum(delta)}`
  }
  return (
    <div className="bg-white dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 flex flex-col justify-between min-h-[100px] hover:border-nothing-green/30 transition-colors">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-500 font-medium">{label}</span>
      <span className="text-xl font-bold text-zinc-900 dark:text-white font-mono mt-2">{value}</span>
      {deltaText && <span className={`text-xs font-mono mt-1 ${deltaColor}`}>{deltaText}</span>}
    </div>
  )
}

/* ── skeleton ── */

function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4 h-[100px]">
            <div className="h-2 w-16 bg-zinc-200 dark:bg-zinc-700 rounded mb-4" />
            <div className="h-5 w-20 bg-zinc-200 dark:bg-zinc-700 rounded" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="bg-white dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-800 rounded-lg p-5 h-[280px]">
            <div className="h-2.5 w-32 bg-zinc-200 dark:bg-zinc-700 rounded mb-6" />
            <div className="h-[200px] bg-zinc-100 dark:bg-zinc-800/50 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── section header ── */

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-900 dark:text-zinc-300 mt-10 mb-4 flex items-center gap-2">
      <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      <span>{title}</span>
      <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
    </h2>
  )
}

/* ── main page ── */

function AnalyticsPage() {
  const [rangeDays, setRangeDays] = useState(30)
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('all')
  const [dailyData, setDailyData] = useState<DailyRow[]>([])
  const [transferData, setTransferData] = useState<TransferRow[]>([])
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([])
  const [epochData, setEpochData] = useState<EpochRow[]>([])
  const [netStats, setNetStats] = useState<NetworkStatsData | null>(null)
  const [totals, setTotals] = useState<Totals | null>(null)

  // Per-source loading flags
  const [dailyLoading, setDailyLoading] = useState(true)
  const [transferLoading, setTransferLoading] = useState(true)
  const [priceLoading, setPriceLoading] = useState(true)
  const [epochLoading, setEpochLoading] = useState(true)
  const [netStatsLoading, setNetStatsLoading] = useState(true)
  const [totalsLoading, setTotalsLoading] = useState(true)

  // Each data source loads independently so fast ones render immediately
  useEffect(() => {
    let cancelled = false
    ensureHeyApiConfigured().then(() => {
      if (cancelled) return
      const fromDate = new Date()
      fromDate.setFullYear(fromDate.getFullYear() - 1)
      const fromStr = fromDate.toISOString().split('T')[0]

      fetchAnalyticsDaily(fromStr).then((data) => {
        if (cancelled || !data) return
        setDailyData((data as DailyRow[]).sort((a, b) => a.date.localeCompare(b.date)))
      }).catch(() => {}).finally(() => { if (!cancelled) setDailyLoading(false) })

      fetchAnalyticsTransfersDaily(fromStr).then((data) => {
        if (cancelled || !data) return
        setTransferData((data as TransferRow[]).sort((a, b) => a.date.localeCompare(b.date)))
      }).catch(() => {}).finally(() => { if (!cancelled) setTransferLoading(false) })

      fetchNetworkStats().then((data) => {
        if (cancelled || !data) return
        setNetStats(data as NetworkStatsData)
      }).catch(() => {}).finally(() => { if (!cancelled) setNetStatsLoading(false) })

      fetch(`${getBaseURL()}/status/price/history?limit=8760`)
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => {
          if (cancelled || !json?.data) return
          setPriceHistory(
            (json.data as PricePoint[]).slice().sort((a, b) => new Date(a.as_of).getTime() - new Date(b.as_of).getTime()),
          )
        }).catch(() => {}).finally(() => { if (!cancelled) setPriceLoading(false) })

      fetch(`${getBaseURL()}/staking/epoch/stats?limit=200`)
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => {
          if (cancelled || !json?.data) return
          setEpochData((json.data as EpochRow[]).slice().sort((a, b) => a.epoch - b.epoch))
        }).catch(() => {}).finally(() => { if (!cancelled) setEpochLoading(false) })

      fetch(`${getBaseURL()}/status/count`)
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => {
          if (cancelled || !json?.data) return
          const d = json.data
          const item = Array.isArray(d) ? d[0] : d
          if (item) setTotals(item as Totals)
        }).catch(() => {}).finally(() => { if (!cancelled) setTotalsLoading(false) })
    })
    return () => { cancelled = true }
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
    // Aggregate hourly data to daily (use last price of each day)
    const byDay = new Map<string, number>()
    for (const p of priceHistory) {
      const day = p.as_of.split('T')[0]
      byDay.set(day, p.price)
    }
    const daily = Array.from(byDay, ([date, price]) => ({ date, price }))
      .sort((a, b) => a.date.localeCompare(b.date))
    return rangeDays >= daily.length ? daily : daily.slice(-rangeDays)
  }, [priceHistory, rangeDays])

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

  const gridStroke = 'rgba(113,113,122,0.15)'

  function showChart(...categories: AnalyticsTab[]) {
    return activeTab === 'all' || categories.includes(activeTab)
  }

  /* ── render ── */

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        {/* header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <h1 className="text-xl font-bold text-zinc-900 dark:text-white tracking-tight">
            Analytics
          </h1>
          <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-900 rounded-lg p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setRangeDays(r.value)}
                className={`text-xs font-medium px-3 py-1.5 rounded-md transition-all ${
                  rangeDays === r.value
                    ? 'text-white bg-nothing-green shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-900 rounded-lg p-0.5 w-fit">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setActiveTab(t.value)}
              className={`text-xs font-medium px-3 py-1.5 rounded-md transition-all ${
                activeTab === t.value
                  ? 'text-white bg-zinc-800 dark:bg-zinc-700 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content renders progressively as each API responds */}
          <>
            {/* KPI cards row */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
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

            {/* ── Bento Grid ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">

              {/* Hero: Daily Tx Count — spans 2 cols */}
              {showChart('transactions') && (
              <ChartCard title="Daily Transaction Count" className="lg:col-span-2" loading={dailyLoading} empty={visibleDaily.length === 0}>
                <AreaChart data={visibleDaily} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gCadence" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.green} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={C.green} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gEvm" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.blue} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={C.blue} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={gridStroke} vertical={false} />
                  <XAxis {...xAxisProps()} />
                  <YAxis {...yAxisProps()} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} />
                  <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace' }} />
                  <Area type="monotone" dataKey="cadence_tx_count" stackId="1" stroke={C.green} strokeWidth={1.5} fill="url(#gCadence)" name="Cadence" />
                  <Area type="monotone" dataKey="evm_tx_count" stackId="1" stroke={C.blue} strokeWidth={1.5} fill="url(#gEvm)" name="EVM" />
                </AreaChart>
              </ChartCard>
              )}

              {/* Active Accounts — 1 col */}
              {showChart('network') && (
              <ChartCard title="Active Accounts" loading={dailyLoading} empty={visibleDaily.length === 0}>
                <AreaChart data={visibleDaily} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gAccounts" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.green} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={C.green} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={gridStroke} vertical={false} />
                  <XAxis {...xAxisProps()} />
                  <YAxis {...yAxisProps()} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} />
                  <Area type="monotone" dataKey="active_accounts" stroke={C.green} strokeWidth={1.5} fill="url(#gAccounts)" name="Active Accounts" />
                </AreaChart>
              </ChartCard>
              )}

              {/* EVM vs Cadence % — 1 col */}
              {showChart('transactions') && (
              <ChartCard title="EVM vs Cadence (%)" loading={dailyLoading} empty={evmPctData.length === 0}>
                <AreaChart data={evmPctData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gCadPct" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.green} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={C.green} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gEvmPct" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.blue} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={C.blue} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={gridStroke} vertical={false} />
                  <XAxis {...xAxisProps()} />
                  <YAxis {...yAxisProps((v) => `${v}%`)} domain={[0, 100]} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} formatter={(v: number) => [`${v.toFixed(1)}%`]} />
                  <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace' }} />
                  <Area type="monotone" dataKey="cadence_pct" stackId="1" stroke={C.green} strokeWidth={1.5} fill="url(#gCadPct)" name="Cadence" />
                  <Area type="monotone" dataKey="evm_pct" stackId="1" stroke={C.blue} strokeWidth={1.5} fill="url(#gEvmPct)" name="EVM" />
                </AreaChart>
              </ChartCard>
              )}

              {/* FLOW Price — spans 2 cols */}
              {showChart('price') && (
              <ChartCard title="FLOW Price History" className="md:col-span-2" loading={priceLoading} empty={visiblePrice.length === 0}>
                <LineChart data={visiblePrice} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={gridStroke} vertical={false} />
                  <XAxis {...xAxisProps()} />
                  <YAxis {...yAxisProps((v) => `$${v.toFixed(2)}`)} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: C.green }} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} formatter={(v: number) => [`$${v.toFixed(4)}`, 'Price']} />
                  <Line type="monotone" dataKey="price" stroke={C.green} strokeWidth={1.5} dot={false} name="FLOW" />
                </LineChart>
              </ChartCard>
              )}

              {/* Gas Burned — 1 col */}
              {showChart('transactions') && (
              <ChartCard title="Gas Burned per Day" loading={dailyLoading} empty={visibleDaily.length === 0}>
                <AreaChart data={visibleDaily} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gGas" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.amber} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={C.amber} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={gridStroke} vertical={false} />
                  <XAxis {...xAxisProps()} />
                  <YAxis {...yAxisProps()} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: C.amber }} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} />
                  <Area type="monotone" dataKey="total_gas_used" stroke={C.amber} strokeWidth={1.5} fill="url(#gGas)" name="Gas Used" />
                </AreaChart>
              </ChartCard>
              )}

              {/* Avg Gas per Tx — 1 col */}
              {showChart('transactions') && (
              <ChartCard title="Avg Gas per Tx" loading={dailyLoading} empty={visibleDaily.length === 0}>
                <AreaChart data={visibleDaily} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gAvgGas" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.amber} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={C.amber} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={gridStroke} vertical={false} />
                  <XAxis {...xAxisProps()} />
                  <YAxis {...yAxisProps()} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: C.amber }} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} />
                  <Area type="monotone" dataKey="avg_gas_per_tx" stroke={C.amber} strokeWidth={1.5} fill="url(#gAvgGas)" name="Avg Gas/Tx" />
                </AreaChart>
              </ChartCard>
              )}

              {/* Error Rate — 1 col */}
              {showChart('transactions') && (
              <ChartCard title="Error Rate (%)" loading={dailyLoading} empty={visibleDaily.length === 0}>
                <AreaChart data={visibleDaily} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gErr" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.red} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={C.red} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={gridStroke} vertical={false} />
                  <XAxis {...xAxisProps()} />
                  <YAxis {...yAxisProps((v) => `${v}%`)} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: C.red }} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} formatter={(v: number) => [`${v.toFixed(2)}%`, 'Error Rate']} />
                  <Area type="monotone" dataKey="error_rate" stroke={C.red} strokeWidth={1.5} fill="url(#gErr)" name="Error Rate" />
                </AreaChart>
              </ChartCard>
              )}

              {/* FT Transfers — 1 col */}
              {showChart('tokens') && (
              <ChartCard title="FT Transfers" loading={transferLoading} empty={visibleTransfers.length === 0}>
                <AreaChart data={visibleTransfers} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gFt" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.purple} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={C.purple} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={gridStroke} vertical={false} />
                  <XAxis {...xAxisProps()} />
                  <YAxis {...yAxisProps()} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: C.purple }} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} />
                  <Area type="monotone" dataKey="ft_transfers" stroke={C.purple} strokeWidth={1.5} fill="url(#gFt)" name="FT Transfers" />
                </AreaChart>
              </ChartCard>
              )}

              {/* NFT Transfers — 1 col */}
              {showChart('tokens') && (
              <ChartCard title="NFT Transfers" loading={transferLoading} empty={visibleTransfers.length === 0}>
                <AreaChart data={visibleTransfers} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gNft" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.pink} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={C.pink} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={gridStroke} vertical={false} />
                  <XAxis {...xAxisProps()} />
                  <YAxis {...yAxisProps()} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: C.pink }} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} />
                  <Area type="monotone" dataKey="nft_transfers" stroke={C.pink} strokeWidth={1.5} fill="url(#gNft)" name="NFT Transfers" />
                </AreaChart>
              </ChartCard>
              )}

              {/* Failed Transactions — 1 col */}
              {showChart('transactions') && (
              <ChartCard title="Failed Transactions" loading={dailyLoading} empty={visibleDaily.length === 0}>
                <BarChart data={visibleDaily} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={gridStroke} vertical={false} />
                  <XAxis {...xAxisProps()} />
                  <YAxis {...yAxisProps()} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: C.red }} cursor={{ fill: 'rgba(239,68,68,0.06)' }} />
                  <Bar dataKey="failed_tx_count" fill={C.red} fillOpacity={0.7} name="Failed Txs" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ChartCard>
              )}

              {/* Staking — spans 2 cols if data exists */}
              {showChart('network') && (
                <>
                  <ChartCard title="Total Staked per Epoch" className="md:col-span-2" loading={epochLoading} empty={epochData.length === 0}>
                    <LineChart data={epochData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={gridStroke} vertical={false} />
                      <XAxis dataKey="epoch" stroke="transparent" fontSize={10} tickLine={false} axisLine={false} tick={TICK_PROPS} minTickGap={30} />
                      <YAxis {...yAxisProps()} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: C.green }} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} formatter={(v: number) => [fmtNum(v), 'Staked']} />
                      <Line type="monotone" dataKey="total_staked" stroke={C.green} strokeWidth={1.5} dot={false} name="Total Staked" />
                    </LineChart>
                  </ChartCard>

                  <ChartCard title="Node Count per Epoch" loading={epochLoading} empty={epochData.length === 0}>
                    <LineChart data={epochData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={gridStroke} vertical={false} />
                      <XAxis dataKey="epoch" stroke="transparent" fontSize={10} tickLine={false} axisLine={false} tick={TICK_PROPS} minTickGap={30} />
                      <YAxis {...yAxisProps()} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: C.blue }} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} />
                      <Line type="monotone" dataKey="total_nodes" stroke={C.blue} strokeWidth={1.5} dot={false} name="Nodes" />
                    </LineChart>
                  </ChartCard>
                </>
              )}
            </div>
          </>
      </div>
    </div>
  )
}

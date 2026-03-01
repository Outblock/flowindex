import { createFileRoute, useSearch, useNavigate, Link } from '@tanstack/react-router'
import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react'
import type { Layout } from 'react-grid-layout'
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
import { ResponsiveGridLayout, useContainerWidth, verticalCompactor } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import '../styles/grid-overrides.css'
import { GripVertical, RotateCcw, CalendarIcon } from 'lucide-react'
import { motion } from 'framer-motion'
import { Popover, PopoverTrigger, PopoverContent } from '../components/ui/popover'
import { Calendar } from '../components/ui/calendar'
import {
  fetchAnalyticsDaily,
  fetchAnalyticsDailyModule,
  fetchAnalyticsTransfersDaily,
  fetchNetworkStats,
  fetchBigTransfers,
  fetchTopContracts,
  fetchTokenVolume,
  ensureHeyApiConfigured,
  getBaseURL,
  type BigTransfer,
  type TopContract,
  type TokenVolume as TokenVolumeType,
} from '../api/heyapi'
import { BigTransfersFull } from '../components/BigTransfersCard'
import { CARD_DEFS, KPI_DEFS, DEFAULT_KPI_LAYOUTS } from './analytics-layout'
import { useGridLayout } from '../hooks/useGridLayout'
import { SafeNumberFlow } from '../components/SafeNumberFlow'

export const Route = createFileRoute('/analytics')({
  component: AnalyticsPage,
  validateSearch: (search: Record<string, unknown>) => ({
    tab: (search.tab as string) || undefined,
  }),
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
  contract_updates: number
  failed_tx_count: number
  error_rate: number
  avg_gas_per_tx: number
  new_accounts: number
  coa_new_accounts: number
  evm_active_addresses: number
  defi_swap_count: number
  defi_unique_traders: number
  epoch_payout_total: string
  epoch?: number | null
  bridge_to_evm_txs: number
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

function toNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  if (Array.isArray(v) && v.length > 0) return toNum(v[0])
  return 0
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

function formatShortDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDisplayDate(d: Date): string {
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`
}

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

/** Default tooltip formatter — adds comma separators to numbers */
function fmtTooltipValue(v: unknown, name: string): [string, string] {
  const n = toNum(v)
  return [n.toLocaleString(), name]
}

/* ── tab types ── */

type AnalyticsTab = 'all' | 'transactions' | 'tokens' | 'network' | 'price' | 'whales'

const TABS: { label: string; value: AnalyticsTab }[] = [
  { label: 'All', value: 'all' },
  { label: 'Transactions', value: 'transactions' },
  { label: 'Tokens', value: 'tokens' },
  { label: 'Network', value: 'network' },
  { label: 'Price', value: 'price' },
  { label: 'Whales', value: 'whales' },
]

/* ── chart skeleton ── */

function ChartSkeleton() {
  return (
    <div className="h-full w-full flex items-end gap-1 px-4 pb-4 animate-pulse">
      {Array.from({ length: 20 }).map((_, i) => (
        <div
          key={i}
          className="flex-1 bg-zinc-200 dark:bg-white/10 rounded-t"
          style={{ height: `${30 + Math.sin(i * 0.7) * 25 + ((i * 7 + 3) % 20)}%` }}
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
  draggable = false,
}: {
  title: string
  children: React.ReactNode
  className?: string
  loading?: boolean
  empty?: boolean
  emptyMessage?: string
  draggable?: boolean
}) {
  return (
    <div className={`bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-lg p-5 hover:border-nothing-green/30 transition-colors h-full flex flex-col ${className}`}>
      <div className="flex items-center gap-2 mb-4">
        {draggable && (
          <GripVertical className="drag-handle w-3.5 h-3.5 text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 flex-shrink-0" />
        )}
        <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
          {title}
        </h3>
      </div>
      <div className="flex-1 min-h-0">
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

/* ── KPI card (compact + expanded) ── */

type KpiFormat = 'comma' | 'compact' | 'percent' | 'price'

const KPI_NUMBER_FORMATS: Record<KpiFormat, Intl.NumberFormatOptions> = {
  comma: { useGrouping: true, maximumFractionDigits: 0 },
  compact: { notation: 'compact', maximumFractionDigits: 1 },
  percent: { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  price: { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 },
}

function KpiCard({
  label,
  value,
  numericValue,
  kpiFormat,
  delta,
  deltaLabel,
  invertColor,
  loading,
  draggable,
  expanded,
  chartNode,
  chartLoading,
  chartEmpty,
}: {
  label: string
  value: string
  numericValue?: number | null
  kpiFormat?: KpiFormat
  delta?: number | null
  deltaLabel?: string
  invertColor?: boolean
  loading?: boolean
  draggable?: boolean
  expanded?: boolean
  chartNode?: ReactNode
  chartLoading?: boolean
  chartEmpty?: boolean
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

  const fmt = kpiFormat ? KPI_NUMBER_FORMATS[kpiFormat] : undefined
  const renderValue = (cls: string) => {
    if (numericValue != null && Number.isFinite(numericValue) && fmt) {
      return (
        <span className={cls}>
          {kpiFormat === 'percent' && <SafeNumberFlow value={numericValue} format={fmt} className="" />}
          {kpiFormat === 'percent' && '%'}
          {kpiFormat !== 'percent' && <SafeNumberFlow value={numericValue} format={fmt} className="" />}
        </span>
      )
    }
    return <span className={cls}>{value}</span>
  }

  if (expanded && chartNode) {
    return (
      <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-lg p-4 h-full flex flex-col hover:border-nothing-green/30 transition-colors">
        <div className="flex items-center gap-2 mb-2">
          {draggable && (
            <GripVertical className="drag-handle w-3 h-3 text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 flex-shrink-0" />
          )}
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">{label}</span>
          {loading ? (
            <div className="h-4 w-16 bg-zinc-200 dark:bg-white/10 rounded animate-pulse ml-auto" />
          ) : (
            renderValue("text-sm font-bold text-zinc-900 dark:text-white font-mono ml-auto")
          )}
          {deltaText && !loading && <span className={`text-xs font-mono ${deltaColor}`}>{deltaText}</span>}
        </div>
        <div className="flex-1 min-h-0">
          {chartLoading ? (
            <ChartSkeleton />
          ) : chartEmpty ? (
            <EmptyState />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              {chartNode as React.ReactElement}
            </ResponsiveContainer>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-lg p-4 flex flex-col justify-between h-full hover:border-nothing-green/30 transition-colors">
      <div className="flex items-center gap-2">
        {draggable && (
          <GripVertical className="drag-handle w-3 h-3 text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400 flex-shrink-0" />
        )}
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-500 font-medium">{label}</span>
      </div>
      {loading ? (
        <div className="h-5 w-20 bg-zinc-200 dark:bg-white/10 rounded animate-pulse mt-2" />
      ) : (
        renderValue("text-xl font-bold text-zinc-900 dark:text-white font-mono mt-2")
      )}
      {deltaText && !loading && <span className={`text-xs font-mono mt-1 ${deltaColor}`}>{deltaText}</span>}
    </div>
  )
}

/* ── skeleton ── */

function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-lg p-4 h-[100px]">
            <div className="h-2 w-16 bg-zinc-200 dark:bg-white/10 rounded mb-4" />
            <div className="h-5 w-20 bg-zinc-200 dark:bg-white/10 rounded" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-lg p-5 h-[280px]">
            <div className="h-2.5 w-32 bg-zinc-200 dark:bg-white/10 rounded mb-6" />
            <div className="h-[200px] bg-zinc-100 dark:bg-white/5 rounded" />
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
      <span className="h-px flex-1 bg-zinc-200 dark:bg-white/10" />
      <span>{title}</span>
      <span className="h-px flex-1 bg-zinc-200 dark:bg-white/10" />
    </h2>
  )
}

/* ── main page ── */

function AnalyticsPage() {
  const { tab: urlTab } = useSearch({ from: '/analytics' })
  const navigate = useNavigate()
  const VALID_TABS: AnalyticsTab[] = ['all', 'transactions', 'tokens', 'network', 'price', 'whales']
  const initialTab = VALID_TABS.includes(urlTab as AnalyticsTab) ? (urlTab as AnalyticsTab) : 'all'
  const [rangeDays, setRangeDays] = useState(30)
  const [customRange, setCustomRange] = useState<{ from: Date; to: Date } | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [pendingRange, setPendingRange] = useState<{ from?: Date; to?: Date } | undefined>(undefined)
  const [activeTab, setActiveTabState] = useState<AnalyticsTab>(initialTab)
  const setActiveTab = (tab: AnalyticsTab) => {
    setActiveTabState(tab)
    navigate({ search: tab === 'all' ? {} : { tab }, replace: true } as any)
  }

  const selectPreset = (days: number) => {
    setRangeDays(days)
    setCustomRange(null)
    setPendingRange(undefined)
  }
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
  const [whaleTransfers, setWhaleTransfers] = useState<BigTransfer[] | null>(null)
  const [whaleLoading, setWhaleLoading] = useState(true)
  const [topContracts, setTopContracts] = useState<TopContract[] | null>(null)
  const [topContractsLoading, setTopContractsLoading] = useState(true)
  const [tokenVolume, setTokenVolume] = useState<TokenVolumeType[] | null>(null)
  const [tokenVolumeLoading, setTokenVolumeLoading] = useState(true)

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
        const sortedBase = (data as DailyRow[]).slice().sort((a, b) => a.date.localeCompare(b.date))
        setDailyData(sortedBase)
        setDailyLoading(false)

        const modules = ['accounts', 'evm', 'defi', 'epoch', 'bridge', 'contracts'] as const
        for (const module of modules) {
          fetchAnalyticsDailyModule(module, fromStr)
            .then((rows) => {
              if (cancelled || !rows || rows.length === 0) return
              const modByDate = new Map((rows as DailyRow[]).map((r) => [r.date, r]))
              setDailyData((prev) => prev.map((row) => {
                const mod = modByDate.get(row.date)
                if (!mod) return row
                if (module === 'accounts') {
                  return {
                    ...row,
                    new_accounts: mod.new_accounts,
                    coa_new_accounts: mod.coa_new_accounts,
                  }
                }
                if (module === 'evm') {
                  return {
                    ...row,
                    evm_active_addresses: mod.evm_active_addresses,
                  }
                }
                if (module === 'defi') {
                  return {
                    ...row,
                    defi_swap_count: mod.defi_swap_count,
                    defi_unique_traders: mod.defi_unique_traders,
                  }
                }
                if (module === 'epoch') {
                  return {
                    ...row,
                    epoch_payout_total: mod.epoch_payout_total,
                    epoch: mod.epoch,
                  }
                }
                if (module === 'bridge') {
                  return {
                    ...row,
                    bridge_to_evm_txs: mod.bridge_to_evm_txs,
                  }
                }
                if (module === 'contracts') {
                  return {
                    ...row,
                    contract_updates: mod.contract_updates,
                  }
                }
                return row
              }))
            })
            .catch(() => {})
        }
      }).catch(() => { if (!cancelled) setDailyLoading(false) })

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

      fetchBigTransfers({ limit: 8 }).then((data) => {
        if (cancelled) return
        setWhaleTransfers(data)
      }).catch(() => { if (!cancelled) setWhaleTransfers([]) })
        .finally(() => { if (!cancelled) setWhaleLoading(false) })

      fetchTopContracts({ limit: 10 }).then((data) => {
        if (cancelled) return
        setTopContracts(data)
      }).catch(() => { if (!cancelled) setTopContracts([]) })
        .finally(() => { if (!cancelled) setTopContractsLoading(false) })

      fetchTokenVolume({ limit: 10 }).then((data) => {
        if (cancelled) return
        setTokenVolume(data)
      }).catch(() => { if (!cancelled) setTokenVolume([]) })
        .finally(() => { if (!cancelled) setTokenVolumeLoading(false) })
    })
    return () => { cancelled = true }
  }, [])

  /* ── derived visible slices ── */

  // Filter by actual calendar date, not record count — sparse data could span months
  const dateCutoff = useMemo(() => {
    if (rangeDays >= 9999) return ''
    const d = new Date()
    d.setDate(d.getDate() - rangeDays)
    return d.toISOString().split('T')[0]
  }, [rangeDays])

  // Helper: filter array of {date: string} by custom range or date cutoff
  const filterByRange = useCallback(<T extends { date: string }>(data: T[]): T[] => {
    if (customRange) {
      const fromStr = formatShortDate(customRange.from)
      const toStr = formatShortDate(customRange.to)
      return data.filter((d) => d.date >= fromStr && d.date <= toStr)
    }
    if (!dateCutoff) return data
    const filtered = data.filter((d) => d.date >= dateCutoff)
    return filtered.length > 0 ? filtered : data.slice(-rangeDays)
  }, [customRange, rangeDays, dateCutoff])

  const visibleDaily = useMemo(
    () => filterByRange(dailyData),
    [dailyData, filterByRange],
  )

  const visibleTransfers = useMemo(
    () => filterByRange(transferData),
    [transferData, filterByRange],
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
    if (customRange) {
      const fromStr = formatShortDate(customRange.from)
      const toStr = formatShortDate(customRange.to)
      return daily.filter((d) => d.date >= fromStr && d.date <= toStr)
    }
    if (!dateCutoff) return daily
    const filtered = daily.filter((d) => d.date >= dateCutoff)
    return filtered.length > 0 ? filtered : daily.slice(-rangeDays)
  }, [priceHistory, rangeDays, dateCutoff, customRange])

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

  function hasMetricData(key: keyof DailyRow): boolean {
    return visibleDaily.some((d) => toNum(d[key]) > 0)
  }

  const showNewAccounts = hasMetricData('new_accounts')
  const showCOANewAccounts = hasMetricData('coa_new_accounts')
  const showEVMActiveAddrs = hasMetricData('evm_active_addresses')
  const showDefiMetrics = hasMetricData('defi_swap_count') || hasMetricData('defi_unique_traders')
  const showBridgeMetrics = hasMetricData('bridge_to_evm_txs')
  const showEpochPayout = hasMetricData('epoch_payout_total')

  /* ── KPI helpers ── */

  const latest = dailyData.length > 0 ? dailyData[dailyData.length - 1] : null
  const prev = dailyData.length > 1 ? dailyData[dailyData.length - 2] : null

  function delta(cur?: number, prv?: number) {
    if (cur == null || prv == null) return null
    return cur - prv
  }

  const gridStroke = 'rgba(113,113,122,0.15)'

  /* ── grid layout ── */

  const { layouts, onLayoutChange, resetLayout, isMobile } = useGridLayout()
  const { layouts: kpiLayouts, onLayoutChange: kpiOnLayoutChangeBase, resetLayout: resetKpiLayout } =
    useGridLayout('flowscan-analytics-kpi-layout', DEFAULT_KPI_LAYOUTS)
  const { width, containerRef, mounted } = useContainerWidth()

  /* ── KPI size tracking for expand-to-chart ── */

  const [kpiSizes, setKpiSizes] = useState<Map<string, { w: number; h: number }>>(new Map())

  const onKpiLayoutChange = useCallback((layout: Layout, allLayouts: ResponsiveLayouts) => {
    kpiOnLayoutChangeBase(layout, allLayouts)
    const sizes = new Map<string, { w: number; h: number }>()
    for (const item of layout) {
      sizes.set(item.i, { w: item.w, h: item.h })
    }
    setKpiSizes(sizes)
  }, [kpiOnLayoutChangeBase])

  const resetAllLayouts = useCallback(() => {
    resetLayout()
    resetKpiLayout()
    setKpiSizes(new Map())
  }, [resetLayout, resetKpiLayout])

  /* ── visibility map for conditional cards ── */

  const visibilityMap = useMemo<Record<string, boolean>>(() => ({
    showNewAccounts,
    showDefiMetrics,
    showBridgeMetrics,
    showEpochPayout,
    showCOANewAccounts,
    showEVMActiveAddrs,
  }), [showNewAccounts, showDefiMetrics, showBridgeMetrics, showEpochPayout, showCOANewAccounts, showEVMActiveAddrs])

  /* ── KPI data map ── */

  const kpiDataMap = useMemo(() => {
    const m = new Map<string, { value: string; numericValue?: number | null; kpiFormat?: KpiFormat; delta?: number | null; deltaLabel?: string; invertColor?: boolean; loading?: boolean }>()

    m.set('kpi-total-tx', {
      value: totals ? fmtComma(totals.transaction_count) : '--',
      numericValue: totals?.transaction_count,
      kpiFormat: 'comma',
      delta: latest?.tx_count,
      deltaLabel: latest ? `+${fmtNum(latest.tx_count)} today` : undefined,
      loading: totalsLoading,
    })
    m.set('kpi-active-accounts', {
      value: latest ? fmtComma(latest.active_accounts) : '--',
      numericValue: latest?.active_accounts,
      kpiFormat: 'comma',
      delta: delta(latest?.active_accounts, prev?.active_accounts),
    })
    m.set('kpi-gas-burned', {
      value: latest ? fmtNum(latest.total_gas_used) : '--',
      numericValue: latest?.total_gas_used,
      kpiFormat: 'compact',
      delta: delta(latest?.total_gas_used, prev?.total_gas_used),
    })
    m.set('kpi-error-rate', {
      value: latest ? fmtPct(latest.error_rate) : '--',
      numericValue: latest?.error_rate,
      kpiFormat: 'percent',
      delta: delta(latest?.error_rate, prev?.error_rate),
      deltaLabel:
        latest && prev
          ? `${latest.error_rate - prev.error_rate > 0 ? '+' : ''}${(latest.error_rate - prev.error_rate).toFixed(2)}pp`
          : undefined,
      invertColor: true,
    })
    m.set('kpi-flow-price', {
      value: netStats ? fmtPrice(netStats.price) : '--',
      numericValue: netStats?.price,
      kpiFormat: 'price',
      delta: netStats?.price_change_24h,
      deltaLabel: netStats
        ? `${netStats.price_change_24h > 0 ? '+' : ''}${netStats.price_change_24h.toFixed(2)}%`
        : undefined,
      loading: netStatsLoading,
    })
    m.set('kpi-contracts', {
      value: latest ? fmtComma(latest.new_contracts) : '--',
      numericValue: latest?.new_contracts,
      kpiFormat: 'comma',
      delta: delta(latest?.new_contracts, prev?.new_contracts),
    })
    m.set('kpi-new-accounts', {
      value: latest ? fmtComma(latest.new_accounts) : '--',
      numericValue: latest?.new_accounts,
      kpiFormat: 'comma',
      delta: delta(latest?.new_accounts, prev?.new_accounts),
    })
    m.set('kpi-coa-new', {
      value: latest ? fmtComma(latest.coa_new_accounts) : '--',
      numericValue: latest?.coa_new_accounts,
      kpiFormat: 'comma',
      delta: delta(latest?.coa_new_accounts, prev?.coa_new_accounts),
    })
    m.set('kpi-evm-active', {
      value: latest ? fmtComma(latest.evm_active_addresses) : '--',
      numericValue: latest?.evm_active_addresses,
      kpiFormat: 'comma',
      delta: delta(latest?.evm_active_addresses, prev?.evm_active_addresses),
    })
    m.set('kpi-defi-swaps', {
      value: latest ? fmtComma(latest.defi_swap_count) : '--',
      numericValue: latest?.defi_swap_count,
      kpiFormat: 'comma',
      delta: delta(latest?.defi_swap_count, prev?.defi_swap_count),
    })
    m.set('kpi-bridge-evm', {
      value: latest ? fmtComma(latest.bridge_to_evm_txs) : '--',
      numericValue: latest?.bridge_to_evm_txs,
      kpiFormat: 'comma',
      delta: delta(latest?.bridge_to_evm_txs, prev?.bridge_to_evm_txs),
    })
    m.set('kpi-epoch-payout', (() => {
      // Show the most recent non-zero payout (payouts are weekly, most days are 0)
      const recentPayout = [...dailyData].reverse().find((d) => toNum(d.epoch_payout_total) > 0)
      const epochTotal = recentPayout ? Math.round(toNum(recentPayout.epoch_payout_total)) : null
      // Find the payout before the most recent one for delta
      const recentIdx = recentPayout ? dailyData.indexOf(recentPayout) : -1
      const prevPayout = recentIdx > 0 ? [...dailyData].slice(0, recentIdx).reverse().find((d) => toNum(d.epoch_payout_total) > 0) : null
      const d = recentPayout && prevPayout ? toNum(recentPayout.epoch_payout_total) - toNum(prevPayout.epoch_payout_total) : null
      const sign = d != null && d > 0 ? '+' : ''
      return {
        value: epochTotal != null ? fmtComma(epochTotal) : '--',
        numericValue: epochTotal,
        kpiFormat: 'comma' as KpiFormat,
        delta: d,
        deltaLabel: d != null ? `${sign}${fmtComma(Math.round(d))}` : undefined,
      }
    })())

    m.set('kpi-whale-txs', {
      value: whaleTransfers ? fmtComma(whaleTransfers.length) : '--',
      numericValue: whaleTransfers?.length,
      kpiFormat: 'comma' as KpiFormat,
      loading: whaleLoading,
    })
    m.set('kpi-total-staked', {
      value: netStats ? fmtNum(netStats.total_staked) : '--',
      numericValue: netStats?.total_staked,
      kpiFormat: 'compact' as KpiFormat,
      loading: netStatsLoading,
    })
    m.set('kpi-node-count', {
      value: netStats ? fmtComma(netStats.active_nodes) : '--',
      numericValue: netStats?.active_nodes,
      kpiFormat: 'comma' as KpiFormat,
      loading: netStatsLoading,
    })

    return m
  }, [totals, latest, prev, netStats, totalsLoading, netStatsLoading, whaleTransfers, whaleLoading])

  /* ── chart map — maps card key to chart JSX ── */

  const chartMap = useMemo(() => {
    const m = new Map<string, { node: ReactNode; loading: boolean; empty: boolean }>()

    m.set('daily-tx-count', {
      loading: dailyLoading,
      empty: visibleDaily.length === 0,
      node: (
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
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} formatter={fmtTooltipValue} />
          <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace' }} />
          <Area type="monotone" dataKey="cadence_tx_count" stroke={C.green} strokeWidth={1.5} fill="url(#gCadence)" name="Cadence" />
          <Area type="monotone" dataKey="evm_tx_count" stroke={C.blue} strokeWidth={1.5} fill="url(#gEvm)" name="EVM" />
        </AreaChart>
      ),
    })

    m.set('active-accounts', {
      loading: dailyLoading,
      empty: visibleDaily.length === 0,
      node: (
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
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} formatter={fmtTooltipValue} />
          <Area type="monotone" dataKey="active_accounts" stroke={C.green} strokeWidth={1.5} fill="url(#gAccounts)" name="Active Accounts" />
        </AreaChart>
      ),
    })

    m.set('new-accounts', {
      loading: dailyLoading,
      empty: visibleDaily.length === 0,
      node: (
        <AreaChart data={visibleDaily} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gNewAccounts" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.blue} stopOpacity={0.25} />
              <stop offset="100%" stopColor={C.blue} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={gridStroke} vertical={false} />
          <XAxis {...xAxisProps()} />
          <YAxis {...yAxisProps()} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} formatter={fmtTooltipValue} />
          <Area type="monotone" dataKey="new_accounts" stroke={C.blue} strokeWidth={1.5} fill="url(#gNewAccounts)" name="New Accounts" />
        </AreaChart>
      ),
    })

    m.set('evm-vs-cadence', {
      loading: dailyLoading,
      empty: evmPctData.length === 0,
      node: (
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
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} formatter={(v) => [`${toNum(v).toFixed(1)}%`]} />
          <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace' }} />
          <Area type="monotone" dataKey="cadence_pct" stroke={C.green} strokeWidth={1.5} fill="url(#gCadPct)" name="Cadence" />
          <Area type="monotone" dataKey="evm_pct" stroke={C.blue} strokeWidth={1.5} fill="url(#gEvmPct)" name="EVM" />
        </AreaChart>
      ),
    })

    m.set('flow-price', {
      loading: priceLoading,
      empty: visiblePrice.length === 0,
      node: (
        <LineChart data={visiblePrice} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={gridStroke} vertical={false} />
          <XAxis {...xAxisProps()} />
          <YAxis {...yAxisProps((v) => `$${v.toFixed(2)}`)} />
          <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: C.green }} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} formatter={(v) => [`$${toNum(v).toFixed(4)}`, 'Price']} />
          <Line type="monotone" dataKey="price" stroke={C.green} strokeWidth={1.5} dot={false} name="FLOW" />
        </LineChart>
      ),
    })

    m.set('defi-swaps', {
      loading: dailyLoading,
      empty: visibleDaily.length === 0,
      node: (
        <LineChart data={visibleDaily} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={gridStroke} vertical={false} />
          <XAxis {...xAxisProps()} />
          <YAxis {...yAxisProps()} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} formatter={fmtTooltipValue} />
          <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace' }} />
          <Line type="monotone" dataKey="defi_swap_count" stroke={C.purple} strokeWidth={1.5} dot={false} name="Swaps" />
          <Line type="monotone" dataKey="defi_unique_traders" stroke={C.pink} strokeWidth={1.5} dot={false} name="Unique Traders" />
        </LineChart>
      ),
    })

    // Filter to only days with actual epoch payouts (non-zero) so there are no empty gaps
    const epochPayoutData = visibleDaily
      .filter((d) => toNum(d.epoch_payout_total) > 0)
      .map((d) => ({ date: d.date, epoch_payout: toNum(d.epoch_payout_total), epoch: d.epoch }))

    m.set('epoch-payout', {
      loading: dailyLoading,
      empty: epochPayoutData.length === 0,
      node: (
        <BarChart
          data={epochPayoutData}
          margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
        >
          <CartesianGrid stroke={gridStroke} vertical={false} />
          <XAxis {...xAxisProps()} dataKey="epoch" tickFormatter={(v) => v ? `#${v}` : ''} />
          <YAxis {...yAxisProps()} tickFormatter={(v) => fmtNum(v)} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(59,130,246,0.06)' }} labelFormatter={(_, payload) => { const d = payload?.[0]?.payload; return d?.epoch ? `Epoch #${d.epoch} (${d.date})` : d?.date ?? '' }} formatter={(v) => [fmtComma(Math.round(toNum(v))), 'Epoch Payout']} />
          <Bar dataKey="epoch_payout" fill={C.blue} fillOpacity={0.7} name="Epoch Payout" radius={[3, 3, 0, 0]} />
        </BarChart>
      ),
    })

    m.set('bridge-evm', {
      loading: dailyLoading,
      empty: visibleDaily.length === 0,
      node: (
        <BarChart data={visibleDaily} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={gridStroke} vertical={false} />
          <XAxis {...xAxisProps()} />
          <YAxis {...yAxisProps()} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(59,130,246,0.06)' }} formatter={fmtTooltipValue} />
          <Bar dataKey="bridge_to_evm_txs" fill={C.blue} fillOpacity={0.7} name="Bridge Txs" radius={[3, 3, 0, 0]} />
        </BarChart>
      ),
    })

    m.set('gas-burned', {
      loading: dailyLoading,
      empty: visibleDaily.length === 0,
      node: (
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
          <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: C.amber }} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} formatter={fmtTooltipValue} />
          <Area type="monotone" dataKey="total_gas_used" stroke={C.amber} strokeWidth={1.5} fill="url(#gGas)" name="Gas Used" />
        </AreaChart>
      ),
    })

    m.set('avg-gas-tx', {
      loading: dailyLoading,
      empty: visibleDaily.length === 0,
      node: (
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
          <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: C.amber }} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} formatter={fmtTooltipValue} />
          <Area type="monotone" dataKey="avg_gas_per_tx" stroke={C.amber} strokeWidth={1.5} fill="url(#gAvgGas)" name="Avg Gas/Tx" />
        </AreaChart>
      ),
    })

    m.set('error-rate', {
      loading: dailyLoading,
      empty: visibleDaily.length === 0,
      node: (
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
          <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: C.red }} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} formatter={(v) => [`${toNum(v).toFixed(2)}%`, 'Error Rate']} />
          <Area type="monotone" dataKey="error_rate" stroke={C.red} strokeWidth={1.5} fill="url(#gErr)" name="Error Rate" />
        </AreaChart>
      ),
    })

    m.set('ft-transfers', {
      loading: transferLoading,
      empty: visibleTransfers.length === 0,
      node: (
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
          <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: C.purple }} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} formatter={fmtTooltipValue} />
          <Area type="monotone" dataKey="ft_transfers" stroke={C.purple} strokeWidth={1.5} fill="url(#gFt)" name="FT Transfers" />
        </AreaChart>
      ),
    })

    m.set('nft-transfers', {
      loading: transferLoading,
      empty: visibleTransfers.length === 0,
      node: (
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
          <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: C.pink }} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} formatter={fmtTooltipValue} />
          <Area type="monotone" dataKey="nft_transfers" stroke={C.pink} strokeWidth={1.5} fill="url(#gNft)" name="NFT Transfers" />
        </AreaChart>
      ),
    })

    m.set('failed-txs', {
      loading: dailyLoading,
      empty: visibleDaily.length === 0,
      node: (
        <BarChart data={visibleDaily} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={gridStroke} vertical={false} />
          <XAxis {...xAxisProps()} />
          <YAxis {...yAxisProps()} />
          <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: C.red }} cursor={{ fill: 'rgba(239,68,68,0.06)' }} formatter={fmtTooltipValue} />
          <Bar dataKey="failed_tx_count" fill={C.red} fillOpacity={0.7} name="Failed Txs" radius={[3, 3, 0, 0]} />
        </BarChart>
      ),
    })

    m.set('total-staked', {
      loading: epochLoading,
      empty: epochData.length === 0,
      node: (
        <LineChart data={epochData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={gridStroke} vertical={false} />
          <XAxis dataKey="epoch" stroke="transparent" fontSize={10} tickLine={false} axisLine={false} tick={TICK_PROPS} minTickGap={30} />
          <YAxis {...yAxisProps()} />
          <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: C.green }} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} formatter={(v) => [fmtNum(toNum(v)), 'Staked']} />
          <Line type="monotone" dataKey="total_staked" stroke={C.green} strokeWidth={1.5} dot={false} name="Total Staked" />
        </LineChart>
      ),
    })

    m.set('node-count', {
      loading: epochLoading,
      empty: epochData.length === 0,
      node: (
        <LineChart data={epochData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={gridStroke} vertical={false} />
          <XAxis dataKey="epoch" stroke="transparent" fontSize={10} tickLine={false} axisLine={false} tick={TICK_PROPS} minTickGap={30} />
          <YAxis {...yAxisProps()} />
          <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: C.blue }} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} formatter={fmtTooltipValue} />
          <Line type="monotone" dataKey="total_nodes" stroke={C.blue} strokeWidth={1.5} dot={false} name="Nodes" />
        </LineChart>
      ),
    })

    m.set('contract-activity', {
      loading: dailyLoading,
      empty: visibleDaily.length === 0,
      node: (
        <BarChart data={visibleDaily} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={gridStroke} vertical={false} />
          <XAxis {...xAxisProps()} />
          <YAxis {...yAxisProps()} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(0,239,139,0.06)' }} formatter={fmtTooltipValue} />
          <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'monospace' }} />
          <Bar dataKey="new_contracts" fill={C.green} fillOpacity={0.7} name="New Contracts" radius={[3, 3, 0, 0]} stackId="contracts" />
          <Bar dataKey="contract_updates" fill={C.blue} fillOpacity={0.7} name="Contract Updates" radius={[3, 3, 0, 0]} stackId="contracts" />
        </BarChart>
      ),
    })

    m.set('coa-new-accounts', {
      loading: dailyLoading,
      empty: visibleDaily.length === 0,
      node: (
        <AreaChart data={visibleDaily} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gCoa" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.purple} stopOpacity={0.25} />
              <stop offset="100%" stopColor={C.purple} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={gridStroke} vertical={false} />
          <XAxis {...xAxisProps()} />
          <YAxis {...yAxisProps()} />
          <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: C.purple }} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} formatter={fmtTooltipValue} />
          <Area type="monotone" dataKey="coa_new_accounts" stroke={C.purple} strokeWidth={1.5} fill="url(#gCoa)" name="COA New Accounts" />
        </AreaChart>
      ),
    })

    m.set('evm-active-addresses', {
      loading: dailyLoading,
      empty: visibleDaily.length === 0,
      node: (
        <AreaChart data={visibleDaily} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gEvmActive" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.blue} stopOpacity={0.25} />
              <stop offset="100%" stopColor={C.blue} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={gridStroke} vertical={false} />
          <XAxis {...xAxisProps()} />
          <YAxis {...yAxisProps()} />
          <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: C.blue }} cursor={{ stroke: 'rgba(255,255,255,0.1)' }} formatter={fmtTooltipValue} />
          <Area type="monotone" dataKey="evm_active_addresses" stroke={C.blue} strokeWidth={1.5} fill="url(#gEvmActive)" name="EVM Active Addresses" />
        </AreaChart>
      ),
    })

    m.set('whale-recent', {
      loading: whaleLoading,
      empty: !whaleTransfers || whaleTransfers.length === 0,
      node: (
        <div className="flex flex-col h-full overflow-y-auto">
          {(whaleTransfers ?? []).map((tx, i) => (
            <Link
              key={`${tx.tx_id}-${i}`}
              to={`/tx/0x${tx.tx_id}` as any}
              className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors border-b border-zinc-100 dark:border-white/5 last:border-b-0"
            >
              {tx.token_logo ? (
                <img src={tx.token_logo} alt={tx.token_symbol} className="w-5 h-5 rounded-full flex-shrink-0" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-nothing-green/20 text-nothing-green text-[9px] font-bold font-mono flex items-center justify-center flex-shrink-0">
                  {(tx.token_symbol || '?').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-[11px] font-mono text-zinc-900 dark:text-white font-bold truncate">
                    {fmtNum(parseFloat(tx.amount) || 0)} {tx.token_symbol}
                  </span>
                  <span className="text-[10px] font-mono font-bold text-nothing-green-dark dark:text-nothing-green">
                    ${fmtNum(tx.usd_value)}
                  </span>
                </div>
              </div>
              <span className={`text-[8px] font-mono font-bold uppercase px-1 py-0.5 rounded-sm ${
                tx.type === 'mint' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                tx.type === 'burn' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                tx.type === 'swap' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                tx.type === 'bridge' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' :
                'bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-gray-400'
              }`}>
                {tx.type}
              </span>
            </Link>
          ))}
        </div>
      ),
    })

    m.set('top-contracts', {
      loading: topContractsLoading,
      empty: !topContracts || topContracts.length === 0,
      node: (
        <div className="flex flex-col h-full overflow-y-auto text-[11px] font-mono">
          <div className="flex items-center gap-2 px-3 py-1.5 text-[9px] uppercase tracking-wider text-zinc-400 dark:text-gray-500 border-b border-zinc-100 dark:border-white/5">
            <span className="flex-1">Contract</span>
            <span className="w-16 text-right">Txs</span>
            <span className="w-16 text-right">Callers</span>
          </div>
          {(topContracts ?? []).map((c, i) => (
            <Link
              key={c.contract_identifier}
              to={`/accounts/${c.address.replace(/^0x/, '')}` as any}
              className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors border-b border-zinc-100 dark:border-white/5 last:border-b-0"
            >
              <span className="w-4 text-zinc-400 dark:text-gray-500 text-[9px]">{i + 1}</span>
              <span className="flex-1 truncate text-zinc-900 dark:text-white">{c.contract_name}</span>
              <span className="w-16 text-right text-zinc-600 dark:text-gray-300">{fmtNum(c.tx_count)}</span>
              <span className="w-16 text-right text-zinc-400 dark:text-gray-500">{fmtNum(c.unique_callers)}</span>
            </Link>
          ))}
        </div>
      ),
    })

    m.set('token-volume', {
      loading: tokenVolumeLoading,
      empty: !tokenVolume || tokenVolume.length === 0,
      node: (
        <div className="flex flex-col h-full overflow-y-auto text-[11px] font-mono">
          <div className="flex items-center gap-2 px-3 py-1.5 text-[9px] uppercase tracking-wider text-zinc-400 dark:text-gray-500 border-b border-zinc-100 dark:border-white/5">
            <span className="flex-1">Token</span>
            <span className="w-20 text-right">Volume</span>
            <span className="w-16 text-right">Txs</span>
          </div>
          {(tokenVolume ?? []).map((tv, i) => (
            <div
              key={tv.symbol + tv.contract_name}
              className="flex items-center gap-2 px-3 py-2 border-b border-zinc-100 dark:border-white/5 last:border-b-0"
            >
              <span className="w-4 text-zinc-400 dark:text-gray-500 text-[9px]">{i + 1}</span>
              {tv.logo ? (
                <img src={tv.logo} alt={tv.symbol} className="w-4 h-4 rounded-full" />
              ) : (
                <div className="w-4 h-4 rounded-full bg-nothing-green/20 text-nothing-green text-[8px] font-bold flex items-center justify-center">
                  {(tv.symbol || '?').charAt(0)}
                </div>
              )}
              <span className="flex-1 truncate text-zinc-900 dark:text-white font-bold">{tv.symbol}</span>
              <span className="w-20 text-right text-nothing-green-dark dark:text-nothing-green font-bold">${fmtNum(tv.usd_volume)}</span>
              <span className="w-16 text-right text-zinc-400 dark:text-gray-500">{fmtNum(tv.transfer_count)}</span>
            </div>
          ))}
        </div>
      ),
    })

    return m
  }, [visibleDaily, visibleTransfers, visiblePrice, evmPctData, epochData, dailyLoading, transferLoading, priceLoading, epochLoading, gridStroke, whaleTransfers, whaleLoading, topContracts, topContractsLoading, tokenVolume, tokenVolumeLoading])

  /* ── filter visible cards by tab + conditional visibility ── */

  const visibleCards = useMemo(() => {
    return CARD_DEFS.filter((card) => {
      // Tab filter
      if (activeTab !== 'all' && !card.tabs.includes(activeTab)) return false
      // Conditional visibility
      if (card.visibleKey && !visibilityMap[card.visibleKey]) return false
      return true
    })
  }, [activeTab, visibilityMap])

  /* ── filtered layouts: reflow visible cards to fill grid properly ── */

  const filteredLayouts = useMemo(() => {
    const visibleKeys = new Set(visibleCards.map((c) => c.key))
    const result: Record<string, Layout[]> = {}
    for (const [bp, items] of Object.entries(layouts)) {
      const cols = bp === 'lg' ? 3 : bp === 'md' ? 2 : 1
      // Keep only visible items, then re-pack positions
      const visible = (items as Layout[]).filter((item) => visibleKeys.has(item.i))
      let x = 0
      let y = 0
      const packed: Layout[] = visible.map((item) => {
        const w = Math.min(item.w, cols)
        if (x + w > cols) { x = 0; y++ }
        const placed = { ...item, x, y, w }
        x += w
        if (x >= cols) { x = 0; y++ }
        return placed
      })
      result[bp] = packed
    }
    return result as unknown as typeof layouts
  }, [layouts, visibleCards])

  /* ── render ── */

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-nothing-black">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        {/* header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <h1 className="text-xl font-bold text-zinc-900 dark:text-white tracking-tight">
            Analytics
          </h1>
          <div className="flex items-center gap-2">
            <button
              onClick={resetAllLayouts}
              className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md text-zinc-500 hover:text-zinc-900 dark:hover:text-white bg-zinc-100 dark:bg-nothing-dark hover:bg-zinc-200 dark:hover:bg-white/10 transition-all"
              title="Reset layout"
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
            <div className="flex items-center gap-0.5 bg-zinc-100 dark:bg-nothing-dark rounded-lg p-0.5">
              {RANGES.map((r) => {
                const isActive = rangeDays === r.value && !customRange
                return (
                  <button
                    key={r.value}
                    onClick={() => selectPreset(r.value)}
                    className={`relative text-xs font-medium px-3 py-1.5 rounded-md transition-colors z-10 ${
                      isActive
                        ? 'text-white dark:text-zinc-900'
                        : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="analyticsRange"
                        className="absolute inset-0 bg-zinc-900 dark:bg-white rounded-md -z-10 shadow-sm"
                        transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
                      />
                    )}
                    {r.label}
                  </button>
                )
              })}
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger asChild>
                  <button
                    className={`relative text-xs font-medium px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 z-10 ${
                      customRange
                        ? 'text-white dark:text-zinc-900'
                        : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    {customRange && (
                      <motion.div
                        layoutId="analyticsRange"
                        className="absolute inset-0 bg-zinc-900 dark:bg-white rounded-md -z-10 shadow-sm"
                        transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
                      />
                    )}
                    <CalendarIcon className="w-3 h-3" />
                    {customRange
                      ? `${formatDisplayDate(customRange.from)} – ${formatDisplayDate(customRange.to)}`
                      : 'Custom'}
                  </button>
                </PopoverTrigger>
                {/* @ts-expect-error - shadcn popover JSX component */}
                <PopoverContent className="w-auto p-0 bg-zinc-900 border-zinc-700" align="end" sideOffset={8}>
                  <div className="p-3 space-y-3">
                    {/* @ts-expect-error - shadcn calendar JSX component */}
                    <Calendar
                      mode="range"
                      selected={pendingRange}
                      onSelect={(range: { from?: Date; to?: Date } | undefined) => {
                        setPendingRange(range ?? undefined)
                        if (range?.from && range?.to) {
                          setCustomRange({ from: range.from, to: range.to })
                          setRangeDays(-1)
                          setCalendarOpen(false)
                        }
                      }}
                      numberOfMonths={2}
                      disabled={{ after: new Date() }}
                      defaultMonth={new Date(new Date().getFullYear(), new Date().getMonth() - 1)}
                      className="[--cell-size:2rem]"
                    />
                    {pendingRange?.from && !pendingRange?.to && (
                      <p className="text-[10px] text-zinc-400 text-center">Select an end date</p>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex items-center gap-0.5 bg-zinc-100 dark:bg-nothing-dark rounded-lg p-0.5 w-fit">
          {TABS.map((t) => {
            const isActive = activeTab === t.value
            return (
              <button
                key={t.value}
                onClick={() => setActiveTab(t.value)}
                className={`relative text-xs font-medium px-3 py-1.5 rounded-md transition-colors z-10 ${
                  isActive
                    ? 'text-white dark:text-zinc-900'
                    : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="analyticsTab"
                    className="absolute inset-0 bg-zinc-900 dark:bg-white rounded-md -z-10 shadow-sm"
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.5 }}
                  />
                )}
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Content renders progressively as each API responds */}
        {activeTab === 'whales' ? (
          <BigTransfersFull />
        ) : (
        <div ref={containerRef}>
          {mounted && (
            <>
              {/* KPI cards grid (draggable + resizable, expand to chart) */}
              <ResponsiveGridLayout
                width={width}
                layouts={kpiLayouts}
                breakpoints={{ lg: 1024, md: 768, sm: 0 }}
                cols={{ lg: 6, md: 3, sm: 2 }}
                rowHeight={100}
                margin={[10, 10]}
                onLayoutChange={onKpiLayoutChange}
                dragConfig={isMobile ? { enabled: false, bounded: false, threshold: 3 } : { enabled: true, bounded: false, handle: '.drag-handle', threshold: 3 }}
                resizeConfig={isMobile ? { enabled: false, handles: ['se'] } : { enabled: true, handles: ['se'] }}
                compactor={verticalCompactor}
              >
                {KPI_DEFS.map((kpi) => {
                  const data = kpiDataMap.get(kpi.key)
                  const size = kpiSizes.get(kpi.key)
                  const isExpanded = (size?.h ?? 1) >= 2
                  const chart = kpi.chartKey ? chartMap.get(kpi.chartKey) : undefined
                  return (
                    <div key={kpi.key}>
                      <KpiCard
                        label={kpi.label}
                        value={data?.value ?? '--'}
                        numericValue={data?.numericValue}
                        kpiFormat={data?.kpiFormat}
                        delta={data?.delta}
                        deltaLabel={data?.deltaLabel}
                        invertColor={data?.invertColor}
                        loading={data?.loading}
                        draggable={!isMobile}
                        expanded={isExpanded}
                        chartNode={chart?.node}
                        chartLoading={chart?.loading}
                        chartEmpty={chart?.empty}
                      />
                    </div>
                  )
                })}
              </ResponsiveGridLayout>

              {/* ── Bento Grid (draggable + resizable) ── */}
              <div className="mt-4">
                <ResponsiveGridLayout
                  width={width}
                  layouts={filteredLayouts}
                  breakpoints={{ lg: 1024, md: 768, sm: 0 }}
                  cols={{ lg: 3, md: 2, sm: 1 }}
                  rowHeight={280}
                  margin={[12, 12]}
                  onLayoutChange={onLayoutChange}
                  dragConfig={isMobile ? { enabled: false, bounded: false, threshold: 3 } : { enabled: true, bounded: false, handle: '.drag-handle', threshold: 3 }}
                  resizeConfig={isMobile ? { enabled: false, handles: ['se'] } : { enabled: true, handles: ['se'] }}
                  compactor={verticalCompactor}
                >
                  {visibleCards.map((card) => {
                    const chart = chartMap.get(card.key)
                    return (
                      <div key={card.key}>
                        <ChartCard
                          title={card.title}
                          draggable={!isMobile}
                          loading={chart?.loading ?? false}
                          empty={chart?.empty ?? true}
                        >
                          {chart?.node}
                        </ChartCard>
                      </div>
                    )
                  })}
                </ResponsiveGridLayout>
              </div>
            </>
          )}
        </div>
        )}
      </div>
    </div>
  )
}

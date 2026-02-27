import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { resolveApiBaseUrl } from '../../api';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import { getFlowV1Ft } from '../../api/gen/find';
import { normalizeAddress, getTokenLogoURL } from './accountUtils';
import { GlassCard } from '../ui/GlassCard';
import { TrendingUp, TrendingDown, Minus, ChevronDown, Coins, Award, Clock, Wallet, Download } from 'lucide-react';
import type { FTVaultInfo, StakingInfo } from '../../../cadence/cadence.gen';

interface Props {
    address: string;
    staking?: StakingInfo;
    tokens?: FTVaultInfo[];
}

interface BalancePoint {
    date: string;
    balance: number;
}

 
interface FtMeta {
    id?: string;
    name?: string;
    symbol?: string;
    logo?: string;
    address?: string;
    contract_name?: string;
}

const RANGES = [
    { label: '14D', days: 14 },
    { label: '30D', days: 30 },
    { label: '90D', days: 90 },
    { label: '180D', days: 180 },
] as const;

const FLOW_TOKEN_IDENTIFIER = 'A.1654653399040a61.FlowToken';

/** Build a token identifier from FTVaultInfo: A.{hex without 0x}.{ContractName} */
function buildTokenIdentifier(token: FTVaultInfo): string {
    const addr = token.contractAddress.replace(/^0x/, '');
    return `A.${addr}.${token.contractName}`;
}

function isFlowToken(identifier: string): boolean {
    return identifier === FLOW_TOKEN_IDENTIFIER;
}

const formatBalance = (value: number) => {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return value.toFixed(2);
};

function downloadCsv(filename: string, headers: string[], rows: string[][]) {
    const csv = [
        headers.join(','),
        ...rows.map(r => r.map(cell => {
            const s = String(cell ?? '');
            return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export function AccountBalanceTab({ address, staking, tokens }: Props) {
    const normalizedAddress = normalizeAddress(address);
    const [selectedToken, setSelectedToken] = useState(FLOW_TOKEN_IDENTIFIER);
    const [days, setDays] = useState(30);
    const [data, setData] = useState<BalancePoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currentBalance, setCurrentBalance] = useState<string>('0');
    const [ftMeta, setFtMeta] = useState<Map<string, FtMeta>>(new Map());
    const [sparklines, setSparklines] = useState<Map<string, BalancePoint[]>>(new Map());
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [exportOpen, setExportOpen] = useState(false);
    const [exporting, setExporting] = useState(false);
    const exportRef = useRef<HTMLDivElement>(null);

    // Close dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // Close export dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
                setExportOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // Fetch backend FT metadata
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                await ensureHeyApiConfigured();
                const res = await getFlowV1Ft({ query: { limit: 200 } });
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const items = (res.data as any)?.data || [];
                const map = new Map<string, FtMeta>();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                items.forEach((item: any) => {
                    if (item.id) {
                        map.set(item.id, item);
                    }
                });
                if (!cancelled) setFtMeta(map);
            } catch (e) {
                console.debug('Failed to fetch FT metadata', e);
            }
        };
        load();
        return () => { cancelled = true; };
    }, []);

    // Merged token list: on-chain tokens enriched with backend metadata
    const tokenList = useMemo(() => {
        if (!tokens || tokens.length === 0) return [];
        return tokens
            .map((t) => {
                const identifier = buildTokenIdentifier(t);
                const meta = ftMeta.get(identifier);
                return {
                    identifier,
                    name: t.name || meta?.name || t.contractName,
                    symbol: t.symbol || meta?.symbol || t.contractName,
                    balance: parseFloat(t.balance) || 0,
                    logo: getTokenLogoURL(t) || meta?.logo || '',
                    contractName: t.contractName,
                };
            })
            .sort((a, b) => b.balance - a.balance);
    }, [tokens, ftMeta]);

    // Staking summary (FLOW only)
    const stakingSummary = useMemo(() => {
        if (!staking) return null;
        const allInfos = [
            ...(staking.nodeInfos || []),
            ...(staking.delegatorInfos || []),
        ];
        if (allInfos.length === 0) return null;
        const totalStaked = allInfos.reduce((s, i) => s + Number(i.tokensStaked || 0), 0);
        const totalRewards = allInfos.reduce((s, i) => s + Number(i.tokensRewarded || 0), 0);
        const totalUnstaking = allInfos.reduce((s, i) => s + Number(i.tokensUnstaking || 0), 0);
        const totalCommitted = allInfos.reduce((s, i) => s + Number(i.tokensCommitted || 0), 0);
        return { totalStaked, totalRewards, totalUnstaking, totalCommitted };
    }, [staking]);

    // Fetch balance history for selected token + days
    const fetchHistory = useCallback(async (token: string, numDays: number) => {
        setLoading(true);
        setError(null);
        try {
            const baseUrl = await resolveApiBaseUrl();
            const params = new URLSearchParams({ days: String(numDays), token });
            const res = await fetch(`${baseUrl}/flow/v1/account/${normalizedAddress}/balance/history?${params}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            const points: BalancePoint[] = (json.data || []).map((p: { date: string; balance: string }) => ({
                date: p.date,
                balance: parseFloat(p.balance) || 0,
            }));
            setData(points);
            setCurrentBalance(json._meta?.current_balance || json.meta?.current_balance || '0');
        } catch (err) {
            console.error('Failed to load balance history', err);
            setError('Failed to load balance history');
            setData([]);
        } finally {
            setLoading(false);
        }
    }, [normalizedAddress]);

    useEffect(() => {
        fetchHistory(selectedToken, days);
    }, [selectedToken, days, fetchHistory]);

    // Lazy-load sparklines for token overview list
    useEffect(() => {
        if (tokenList.length === 0) return;
        let cancelled = false;
        const loadSparklines = async () => {
            const baseUrl = await resolveApiBaseUrl();
            const newSparklines = new Map<string, BalancePoint[]>();
            // Fetch in parallel, batched
            await Promise.all(
                tokenList.map(async (t) => {
                    try {
                        const params = new URLSearchParams({ days: '14', token: t.identifier });
                        const res = await fetch(`${baseUrl}/flow/v1/account/${normalizedAddress}/balance/history?${params}`);
                        if (!res.ok) return;
                        const json = await res.json();
                        const points: BalancePoint[] = (json.data || []).map((p: { date: string; balance: string }) => ({
                            date: p.date,
                            balance: parseFloat(p.balance) || 0,
                        }));
                        newSparklines.set(t.identifier, points);
                    } catch {
                        // silently skip
                    }
                })
            );
            if (!cancelled) setSparklines(newSparklines);
        };
        loadSparklines();
        return () => { cancelled = true; };
    }, [tokenList, normalizedAddress]);

    const periodChange = data.length >= 2
        ? data[data.length - 1].balance - data[0].balance
        : 0;
    const periodChangePct = data.length >= 2 && data[0].balance !== 0
        ? ((periodChange / data[0].balance) * 100)
        : 0;

    // Find selected token info
    const selectedTokenInfo = tokenList.find((t) => t.identifier === selectedToken);
    const selectedLabel = selectedTokenInfo?.symbol || (isFlowToken(selectedToken) ? 'FLOW' : selectedToken.split('.').pop() || selectedToken);

    const exportDailyBalances = () => {
        if (data.length === 0) return;
        downloadCsv(
            `${normalizedAddress}-${selectedLabel}-daily-balances.csv`,
            ['date', 'token', 'balance'],
            data.map(p => [p.date, selectedLabel, p.balance.toString()])
        );
    };

    const exportTransfers = async () => {
        setExporting(true);
        try {
            const baseUrl = await resolveApiBaseUrl();
            const allTransfers: any[] = [];
            let offset = 0;
            const limit = 200;
            let hasMore = true;
            while (hasMore) {
                const res = await fetch(
                    `${baseUrl}/flow/v1/account/${normalizedAddress}/ft/transfer?limit=${limit}&offset=${offset}`
                );
                if (!res.ok) break;
                const json = await res.json();
                const items = json.data || [];
                allTransfers.push(...items);
                hasMore = (json._meta?.has_more === true || json._meta?.has_more === 1) && items.length === limit;
                offset += limit;
                if (offset > 50000) break; // safety limit
            }
            downloadCsv(
                `${normalizedAddress}-transfers.csv`,
                ['date', 'tx_id', 'block_height', 'token', 'from', 'to', 'amount'],
                allTransfers.map((t: any) => [
                    t.timestamp || t.block_time || '',
                    t.transaction_id || t.tx_id || '',
                    String(t.block_height || ''),
                    t.contract_name || '',
                    t.from_address || '',
                    t.to_address || '',
                    t.amount || '0',
                ])
            );
        } catch (err) {
            console.error('Export transfers failed', err);
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header: Token Selector + Range Buttons */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                {/* Token Dropdown */}
                <div className="relative" ref={dropdownRef}>
                    <button
                        onClick={() => setDropdownOpen(!dropdownOpen)}
                        className="flex items-center gap-2 px-3 py-2 text-sm font-bold border border-zinc-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-zinc-300 dark:hover:border-white/20 transition-colors"
                    >
                        {selectedTokenInfo?.logo && (
                            <img src={selectedTokenInfo.logo} alt="" className="w-4 h-4 rounded-full" />
                        )}
                        <span className="uppercase tracking-wider">{selectedLabel}</span>
                        <ChevronDown className={`h-3.5 w-3.5 text-zinc-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {dropdownOpen && tokenList.length > 0 && (
                        <div className="absolute top-full left-0 mt-1 z-50 min-w-[200px] max-h-[300px] overflow-y-auto border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-xl">
                            {tokenList.map((t) => (
                                <button
                                    key={t.identifier}
                                    onClick={() => { setSelectedToken(t.identifier); setDropdownOpen(false); }}
                                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors ${selectedToken === t.identifier ? 'bg-nothing-green/10 text-nothing-green-dark dark:text-nothing-green' : 'text-zinc-700 dark:text-zinc-300'}`}
                                >
                                    {t.logo ? (
                                        <img src={t.logo} alt="" className="w-4 h-4 rounded-full" />
                                    ) : (
                                        <div className="w-4 h-4 rounded-full bg-zinc-300 dark:bg-zinc-700" />
                                    )}
                                    <span className="font-bold uppercase tracking-wider">{t.symbol}</span>
                                    <span className="ml-auto text-zinc-400 font-mono">{formatBalance(t.balance)}</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {/* Range Buttons */}
                    <div className="flex items-center gap-1">
                        {RANGES.map((range) => (
                            <button
                                key={range.days}
                                onClick={() => setDays(range.days)}
                                className={`text-[9px] uppercase tracking-wider px-2 py-1 border rounded-sm transition-colors ${days === range.days
                                    ? 'text-nothing-green-dark dark:text-nothing-green border-nothing-green-dark/40 dark:border-nothing-green/40 bg-nothing-green/10'
                                    : 'text-zinc-500 border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-white/5 hover:text-zinc-900 dark:hover:text-white hover:border-zinc-300 dark:hover:border-white/20'
                                    }`}
                            >
                                {range.label}
                            </button>
                        ))}
                    </div>

                    {/* Export Dropdown */}
                    <div className="relative" ref={exportRef}>
                        <button
                            onClick={() => setExportOpen(!exportOpen)}
                            className="flex items-center gap-1.5 px-2.5 py-1 text-[9px] uppercase tracking-wider border border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-white/5 text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:border-zinc-300 dark:hover:border-white/20 rounded-sm transition-colors"
                        >
                            <Download size={10} />
                            Export
                            <ChevronDown size={8} />
                        </button>
                        {exportOpen && (
                            <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-xl rounded-sm overflow-hidden">
                                <button
                                    onClick={() => { exportDailyBalances(); setExportOpen(false); }}
                                    disabled={data.length === 0}
                                    className="w-full text-left px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors disabled:opacity-30"
                                >
                                    Daily Balances (CSV)
                                </button>
                                <button
                                    onClick={() => { exportTransfers(); setExportOpen(false); }}
                                    disabled={exporting}
                                    className="w-full text-left px-3 py-2 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors disabled:opacity-30 flex items-center gap-2"
                                >
                                    {exporting ? (
                                        <>
                                            <span className="inline-block w-3 h-3 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                                            Exporting...
                                        </>
                                    ) : (
                                        'Transfer History (CSV)'
                                    )}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Staking Summary Cards (FLOW only) */}
            {isFlowToken(selectedToken) && stakingSummary && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <GlassCard className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Wallet className="h-3.5 w-3.5 text-zinc-400" />
                            <p className="text-[10px] uppercase tracking-widest text-zinc-500">Vault Balance</p>
                        </div>
                        <p className="text-xl font-bold">{formatBalance(parseFloat(currentBalance))}</p>
                    </GlassCard>
                    <GlassCard className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Coins className="h-3.5 w-3.5 text-zinc-400" />
                            <p className="text-[10px] uppercase tracking-widest text-zinc-500">Staked</p>
                        </div>
                        <p className="text-xl font-bold">{formatBalance(stakingSummary.totalStaked)}</p>
                    </GlassCard>
                    <GlassCard className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Award className="h-3.5 w-3.5 text-zinc-400" />
                            <p className="text-[10px] uppercase tracking-widest text-zinc-500">Rewards</p>
                        </div>
                        <p className="text-xl font-bold text-nothing-green">{formatBalance(stakingSummary.totalRewards)}</p>
                    </GlassCard>
                    <GlassCard className="p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Clock className="h-3.5 w-3.5 text-zinc-400" />
                            <p className="text-[10px] uppercase tracking-widest text-zinc-500">Unstaking</p>
                        </div>
                        <p className="text-xl font-bold">{formatBalance(stakingSummary.totalUnstaking)}</p>
                    </GlassCard>
                </div>
            )}

            {/* Balance History Chart */}
            <GlassCard className="p-6 group hover:border-nothing-green/30 transition-all duration-300">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-widest">
                        {selectedLabel} Balance History
                    </h2>
                </div>

                {loading ? (
                    <div className="h-[280px] flex items-center justify-center">
                        <p className="text-zinc-500 text-xs uppercase tracking-widest animate-pulse">Loading Balance History...</p>
                    </div>
                ) : error || !data.length ? (
                    <div className="h-[280px] flex flex-col items-center justify-center gap-4">
                        <TrendingUp className="h-12 w-12 text-zinc-400" />
                        <p className="text-zinc-500 text-xs uppercase tracking-widest">
                            {error || 'No balance history available yet'}
                        </p>
                        <p className="text-zinc-400 text-[10px] max-w-md text-center">
                            Balance history is built from indexed token transfers. Data will appear as the worker processes blocks.
                        </p>
                    </div>
                ) : (
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
                                    formatter={((value: string | number) => [(typeof value === 'number' ? value : Number(value)).toLocaleString(undefined, { maximumFractionDigits: 4 }), selectedLabel]) as any}
                                    labelFormatter={(label) => `Date: ${label}`}
                                />
                                <Area type="monotone" dataKey="balance" stroke="#00ef8b" strokeWidth={2} fillOpacity={1} fill="url(#colorBalance)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </GlassCard>

            {/* Summary Cards: Current / Change / %Change */}
            {!loading && data.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <GlassCard className="p-5">
                        <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Current Balance</p>
                        <p className="text-xl font-bold">{formatBalance(parseFloat(currentBalance))} <span className="text-xs font-normal text-zinc-500">{selectedLabel}</span></p>
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
            )}

            {/* All Token Balances Overview */}
            {tokenList.length > 0 && (
                <GlassCard className="p-6">
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-white uppercase tracking-widest mb-4">All Token Balances</h3>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="border-b border-zinc-200 dark:border-white/10">
                                    <th className="text-[10px] uppercase tracking-widest text-zinc-500 pb-2 pr-4">Token</th>
                                    <th className="text-[10px] uppercase tracking-widest text-zinc-500 pb-2 pr-4 text-right">Balance</th>
                                    <th className="text-[10px] uppercase tracking-widest text-zinc-500 pb-2 pr-4 text-right hidden sm:table-cell">14D Change</th>
                                    <th className="text-[10px] uppercase tracking-widest text-zinc-500 pb-2 text-right hidden md:table-cell">Sparkline</th>
                                </tr>
                            </thead>
                            <tbody>
                                {tokenList.map((t) => {
                                    const spark = sparklines.get(t.identifier);
                                    const sparkChange = spark && spark.length >= 2
                                        ? spark[spark.length - 1].balance - spark[0].balance
                                        : 0;
                                    return (
                                        <tr
                                            key={t.identifier}
                                            className="border-b border-zinc-100 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
                                            onClick={() => { setSelectedToken(t.identifier); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                        >
                                            <td className="py-3 pr-4">
                                                <div className="flex items-center gap-2">
                                                    {t.logo ? (
                                                        <img src={t.logo} alt="" className="w-5 h-5 rounded-full" />
                                                    ) : (
                                                        <div className="w-5 h-5 rounded-full bg-zinc-300 dark:bg-zinc-700 flex items-center justify-center">
                                                            <span className="text-[8px] font-bold text-zinc-500">{t.symbol.charAt(0)}</span>
                                                        </div>
                                                    )}
                                                    <div>
                                                        <p className="text-xs font-bold">{t.symbol}</p>
                                                        <p className="text-[10px] text-zinc-400">{t.name}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-3 pr-4 text-right">
                                                <p className="text-xs font-bold font-mono">{formatBalance(t.balance)}</p>
                                            </td>
                                            <td className="py-3 pr-4 text-right hidden sm:table-cell">
                                                {spark && spark.length >= 2 ? (
                                                    <p className={`text-xs font-mono ${sparkChange > 0 ? 'text-nothing-green' : sparkChange < 0 ? 'text-red-500' : 'text-zinc-400'}`}>
                                                        {sparkChange >= 0 ? '+' : ''}{formatBalance(sparkChange)}
                                                    </p>
                                                ) : (
                                                    <p className="text-[10px] text-zinc-400">--</p>
                                                )}
                                            </td>
                                            <td className="py-3 text-right hidden md:table-cell">
                                                {spark && spark.length >= 2 ? (
                                                    <div className="inline-block w-[60px] h-[28px]">
                                                        <ResponsiveContainer width="100%" height="100%">
                                                            <AreaChart data={spark} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
                                                                <defs>
                                                                    <linearGradient id={`spark-${t.identifier.replace(/\./g, '-')}`} x1="0" y1="0" x2="0" y2="1">
                                                                        <stop offset="5%" stopColor={sparkChange >= 0 ? '#00ef8b' : '#ef4444'} stopOpacity={0.3} />
                                                                        <stop offset="95%" stopColor={sparkChange >= 0 ? '#00ef8b' : '#ef4444'} stopOpacity={0} />
                                                                    </linearGradient>
                                                                </defs>
                                                                <Area
                                                                    type="monotone"
                                                                    dataKey="balance"
                                                                    stroke={sparkChange >= 0 ? '#00ef8b' : '#ef4444'}
                                                                    strokeWidth={1.5}
                                                                    fillOpacity={1}
                                                                    fill={`url(#spark-${t.identifier.replace(/\./g, '-')})`}
                                                                />
                                                            </AreaChart>
                                                        </ResponsiveContainer>
                                                    </div>
                                                ) : (
                                                    <span className="text-[10px] text-zinc-400">--</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </GlassCard>
            )}
        </div>
    );
}

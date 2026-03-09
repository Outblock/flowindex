import { useState, useEffect, useCallback, useRef } from 'react';
import { Landmark, Server, Users, Lock, Gift, ArrowDownToLine, ArrowUpFromLine, Clock, History, ExternalLink, Loader2 } from 'lucide-react';
import { resolveApiBaseUrl } from '../../api';
import { normalizeAddress } from './accountUtils';
import { GlassCard } from '@flowindex/flow-ui';
import { AddressLink } from '../AddressLink';
import type { StakingInfo, NodeInfo, DelegatorInfo, LockedAccountInfo } from '../../../cadence/cadence.gen';

interface Props {
    address: string;
}

const ROLE_LABELS: Record<number, string> = {
    1: 'Collection',
    2: 'Consensus',
    3: 'Execution',
    4: 'Verification',
    5: 'Access',
};

const ROLE_COLORS: Record<number, string> = {
    1: 'text-blue-500 bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30',
    2: 'text-purple-500 bg-purple-50 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/30',
    3: 'text-orange-500 bg-orange-50 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/30',
    4: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30',
    5: 'text-cyan-500 bg-cyan-50 dark:bg-cyan-500/10 border-cyan-200 dark:border-cyan-500/30',
};

const EVENT_LABELS: Record<string, string> = {
    // Staking
    TokensCommitted: 'Staked',
    DelegatorTokensCommitted: 'Staked',
    TokensStaked: 'Restaked',
    DelegatorTokensStaked: 'Restaked',
    // Unstaking
    TokensUnstaking: 'Unstaking',
    DelegatorTokensUnstaking: 'Unstaking',
    TokensUnstaked: 'Unstaked',
    DelegatorTokensUnstaked: 'Unstaked',
    NodeTokensRequestedToUnstake: 'Unstake Requested',
    DelegatorTokensRequestedToUnstake: 'Unstake Requested',
    // Withdrawals
    UnstakedTokensWithdrawn: 'Withdrawn',
    DelegatorUnstakedTokensWithdrawn: 'Withdrawn',
    RewardTokensWithdrawn: 'Reward Claimed',
    DelegatorRewardTokensWithdrawn: 'Reward Claimed',
    // Rewards
    RewardsPaid: 'Reward',
    DelegatorRewardsPaid: 'Reward',
    // Node/Delegator lifecycle
    NewNodeCreated: 'Node Created',
    NewDelegatorCreated: 'Delegator Created',
    NodeRemovedAndRefunded: 'Node Removed',
};

const EVENT_COLORS: Record<string, string> = {
    Staked: 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30',
    Restaked: 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30',
    Unstaking: 'text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30',
    Unstaked: 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-500/10 border-red-200 dark:border-red-500/30',
    'Unstake Requested': 'text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30',
    Withdrawn: 'text-sky-600 bg-sky-50 dark:text-sky-400 dark:bg-sky-500/10 border-sky-200 dark:border-sky-500/30',
    'Reward Claimed': 'text-violet-600 bg-violet-50 dark:text-violet-400 dark:bg-violet-500/10 border-violet-200 dark:border-violet-500/30',
    Reward: 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30',
    'Node Created': 'text-zinc-500 bg-zinc-50 dark:text-zinc-400 dark:bg-white/5 border-zinc-200 dark:border-white/10',
    'Delegator Created': 'text-zinc-500 bg-zinc-50 dark:text-zinc-400 dark:bg-white/5 border-zinc-200 dark:border-white/10',
    'Node Removed': 'text-red-500 bg-red-50 dark:text-red-400 dark:bg-red-500/10 border-red-200 dark:border-red-500/30',
};

function formatFlow(value: string | number | undefined): string {
    if (value == null) return '0';
    const num = Number(value);
    if (num === 0) return '0';
    return num.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function StakingStatCard({ label, value, icon: Icon, suffix = 'FLOW' }: {
    label: string; value: string | number; icon: any; suffix?: string;
}) {
    return (
        <div className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-black/40 border border-zinc-200 dark:border-white/5 rounded-sm">
            <Icon className="h-4 w-4 text-zinc-400 flex-shrink-0" />
            <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500">{label}</div>
                <div className="text-sm font-mono font-bold text-zinc-900 dark:text-white">
                    {formatFlow(value)} <span className="text-[10px] font-normal text-zinc-500">{suffix}</span>
                </div>
            </div>
        </div>
    );
}

function NodeInfoCard({ node, index }: { node: NodeInfo; index: number }) {
    const roleName = ROLE_LABELS[node.role] || `Role ${node.role}`;
    const roleColor = ROLE_COLORS[node.role] || 'text-zinc-500 bg-zinc-50 dark:bg-white/5 border-zinc-200 dark:border-white/10';
    const totalTokens = Number(node.tokensStaked || 0) + Number(node.tokensCommitted || 0)
        + Number(node.tokensUnstaking || 0) + Number(node.tokensUnstaked || 0) + Number(node.tokensRewarded || 0);

    return (
        <GlassCard className="p-0 overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-100 dark:border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-nothing-green/10 flex items-center justify-center">
                        <Server className="h-4 w-4 text-nothing-green-dark dark:text-nothing-green" />
                    </div>
                    <div>
                        <div className="text-xs font-bold text-zinc-900 dark:text-white">Node Operator #{index + 1}</div>
                        <div className="text-[10px] font-mono text-zinc-500 truncate max-w-[300px]" title={node.id}>
                            {node.id}
                        </div>
                    </div>
                </div>
                <span className={`text-[10px] uppercase tracking-widest font-bold border px-2 py-0.5 rounded-sm ${roleColor}`}>
                    {roleName}
                </span>
            </div>

            <div className="p-5">
                {/* Summary row */}
                <div className="flex items-baseline gap-2 mb-4">
                    <span className="text-2xl font-mono font-bold text-zinc-900 dark:text-white">{formatFlow(totalTokens)}</span>
                    <span className="text-xs text-zinc-500">FLOW Total</span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <StakingStatCard label="Staked" value={node.tokensStaked} icon={Lock} />
                    <StakingStatCard label="Committed" value={node.tokensCommitted} icon={ArrowDownToLine} />
                    <StakingStatCard label="Unstaking" value={node.tokensUnstaking} icon={Clock} />
                    <StakingStatCard label="Unstaked" value={node.tokensUnstaked} icon={ArrowUpFromLine} />
                    <StakingStatCard label="Rewarded" value={node.tokensRewarded} icon={Gift} />
                    <StakingStatCard label="Request Unstake" value={node.tokensRequestedToUnstake} icon={ArrowUpFromLine} />
                </div>

                {/* Extra details */}
                <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[10px] text-zinc-500">
                    {node.networkingAddress && (
                        <span>Network: <span className="text-zinc-700 dark:text-zinc-300 font-mono">{node.networkingAddress}</span></span>
                    )}
                    <span>Delegators: <span className="text-zinc-700 dark:text-zinc-300 font-mono">{node.delegatorIDCounter}</span></span>
                    <span>Initial Weight: <span className="text-zinc-700 dark:text-zinc-300 font-mono">{node.initialWeight}</span></span>
                </div>
            </div>
        </GlassCard>
    );
}

function DelegatorInfoCard({ delegator, index }: { delegator: DelegatorInfo; index: number }) {
    const nodeRole = delegator.nodeInfo?.role;
    const roleName = nodeRole ? (ROLE_LABELS[nodeRole] || `Role ${nodeRole}`) : '';
    const roleColor = nodeRole ? (ROLE_COLORS[nodeRole] || 'text-zinc-500 bg-zinc-50 dark:bg-white/5 border-zinc-200 dark:border-white/10') : '';
    const totalTokens = Number(delegator.tokensStaked || 0) + Number(delegator.tokensCommitted || 0)
        + Number(delegator.tokensUnstaking || 0) + Number(delegator.tokensUnstaked || 0) + Number(delegator.tokensRewarded || 0);

    return (
        <GlassCard className="p-0 overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-100 dark:border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                        <Users className="h-4 w-4 text-blue-500" />
                    </div>
                    <div>
                        <div className="text-xs font-bold text-zinc-900 dark:text-white">Delegation #{index + 1}</div>
                        <div className="text-[10px] font-mono text-zinc-500">
                            Delegator ID: {delegator.id} → Node: <span className="truncate inline-block max-w-[200px] align-bottom" title={delegator.nodeID}>{delegator.nodeID?.slice(0, 16)}...</span>
                        </div>
                    </div>
                </div>
                {roleName && (
                    <span className={`text-[10px] uppercase tracking-widest font-bold border px-2 py-0.5 rounded-sm ${roleColor}`}>
                        {roleName}
                    </span>
                )}
            </div>

            <div className="p-5">
                <div className="flex items-baseline gap-2 mb-4">
                    <span className="text-2xl font-mono font-bold text-zinc-900 dark:text-white">{formatFlow(totalTokens)}</span>
                    <span className="text-xs text-zinc-500">FLOW Total</span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <StakingStatCard label="Staked" value={delegator.tokensStaked} icon={Lock} />
                    <StakingStatCard label="Committed" value={delegator.tokensCommitted} icon={ArrowDownToLine} />
                    <StakingStatCard label="Unstaking" value={delegator.tokensUnstaking} icon={Clock} />
                    <StakingStatCard label="Unstaked" value={delegator.tokensUnstaked} icon={ArrowUpFromLine} />
                    <StakingStatCard label="Rewarded" value={delegator.tokensRewarded} icon={Gift} />
                    <StakingStatCard label="Request Unstake" value={delegator.tokensRequestedToUnstake} icon={ArrowUpFromLine} />
                </div>
            </div>
        </GlassCard>
    );
}

const ACTIVITY_FILTERS = [
    { label: 'All', value: '' },
    { label: 'Staked', value: 'staked' },
    { label: 'Unstake', value: 'unstake' },
    { label: 'Rewards', value: 'rewards' },
    { label: 'Withdrawn', value: 'withdrawn' },
];

/** Map filter values to matching resolved label prefixes */
const FILTER_MATCH: Record<string, string[]> = {
    staked: ['Staked', 'Restaked'],
    unstake: ['Unstaking', 'Unstaked', 'Unstake Requested'],
    rewards: ['Reward', 'Reward Claimed'],
    withdrawn: ['Withdrawn'],
};

function StakingActivitySection({ address }: { address: string }) {
    const [events, setEvents] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const loadingRef = useRef(false);
    const [filter, setFilter] = useState('');

    const loadMore = useCallback(async () => {
        if (loadingRef.current || !hasMore) return;
        loadingRef.current = true;
        setLoading(true);
        try {
            const baseUrl = await resolveApiBaseUrl();
            const res = await fetch(`${baseUrl}/flow/account/${encodeURIComponent(address)}/staking/activity?limit=50&offset=${offset}`);
            if (!res.ok) throw new Error('Failed to load staking activity');
            const json = await res.json();
            const items: any[] = json?.data ?? [];
            setEvents(prev => [...prev, ...items]);
            setOffset(prev => prev + items.length);
            setHasMore(items.length >= 50);
        } catch (err) {
            console.error('Failed to load staking activity', err);
        } finally {
            loadingRef.current = false;
            setLoading(false);
        }
    }, [address, offset, hasMore]);

    useEffect(() => {
        loadMore();
    }, []);  // eslint-disable-line react-hooks/exhaustive-deps

    if (events.length === 0 && !loading) return null;

    // Resolve labels for all events (needed for filtering)
    const resolveLabel = (eventType: string) =>
        EVENT_LABELS[eventType] || eventType?.replace(/([A-Z])/g, ' $1').trim() || eventType;

    // Filter events
    const filteredEvents = filter
        ? events.filter(evt => {
            const label = resolveLabel(evt.event_type);
            return FILTER_MATCH[filter]?.some(m => label === m) ?? false;
        })
        : events;

    // Group filtered events by epoch
    const grouped = new Map<number | string, { epoch: number | null; epochStart?: string; epochEnd?: string; events: any[] }>();
    for (const evt of filteredEvents) {
        const epoch = evt.epoch ?? null;
        const key = epoch ?? 'unknown';
        if (!grouped.has(key)) {
            grouped.set(key, { epoch, epochStart: evt.epoch_start, epochEnd: evt.epoch_end, events: [] });
        }
        grouped.get(key)!.events.push(evt);
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
                <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                    <History className="w-3.5 h-3.5" />
                    Staking Activity
                </h4>
                <div className="flex items-center gap-1">
                    {ACTIVITY_FILTERS.map(f => (
                        <button
                            key={f.value}
                            onClick={() => setFilter(f.value)}
                            className={`text-[10px] px-2 py-0.5 rounded-sm border transition-colors ${
                                filter === f.value
                                    ? 'bg-zinc-800 text-white border-zinc-700 dark:bg-white dark:text-black dark:border-white/80'
                                    : 'text-zinc-500 border-zinc-200 dark:border-white/10 hover:bg-zinc-50 dark:hover:bg-white/5'
                            }`}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>
            </div>

            {[...grouped.entries()].map(([key, group]) => (
                <div key={String(key)}>
                    <div className="flex items-center gap-2 mb-2">
                        <div className="h-px flex-1 bg-zinc-200 dark:bg-white/10" />
                        <span className="text-[10px] font-mono text-zinc-400 whitespace-nowrap">
                            {group.epoch != null ? `Epoch #${group.epoch}` : 'Unknown Epoch'}
                            {group.epochStart && group.epochEnd &&
                              new Date(group.epochStart).getFullYear() > 1970 &&
                              new Date(group.epochEnd).getFullYear() > 1970 && (
                                <> &middot; {new Date(group.epochStart).toLocaleDateString()} – {new Date(group.epochEnd).toLocaleDateString()}</>
                            )}
                        </span>
                        <div className="h-px flex-1 bg-zinc-200 dark:bg-white/10" />
                    </div>

                    <div className="space-y-1">
                        {group.events.map((evt: any, i: number) => {
                            const label = resolveLabel(evt.event_type);
                            const colorClass = EVENT_COLORS[label] || EVENT_COLORS['Node Created'];
                            const amount = parseFloat(evt.amount) || 0;
                            return (
                                <div key={`${evt.block_height}-${evt.event_index}-${i}`}
                                    className="flex items-center gap-3 px-3 py-2 bg-white dark:bg-black/20 border border-zinc-100 dark:border-white/5 rounded-sm hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                                >
                                    {amount > 0 && (
                                        <span className="text-sm font-mono font-bold text-zinc-900 dark:text-white shrink-0 w-32 text-right tabular-nums">
                                            {amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                                            <span className="text-[10px] font-normal text-zinc-500 ml-1">FLOW</span>
                                        </span>
                                    )}

                                    <span className="text-[10px] text-zinc-400 font-mono truncate">
                                        {evt.node_id ? `Node ${evt.node_id.slice(0, 12)}...` : ''}
                                        {evt.delegator_id > 0 ? ` · Delegator #${evt.delegator_id}` : ''}
                                    </span>

                                    <div className="flex-1" />

                                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm border shrink-0 ${colorClass}`}>
                                        {label}
                                    </span>

                                    <span className="text-[10px] text-zinc-400 shrink-0 tabular-nums">
                                        {new Date(evt.timestamp).toLocaleString()}
                                    </span>
                                    <a href={`/txs/${evt.transaction_id}`}
                                        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <ExternalLink className="w-3 h-3" />
                                    </a>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}

            {filteredEvents.length === 0 && !loading && (
                <p className="text-xs text-zinc-400 text-center py-4">No matching events</p>
            )}

            {loading && (
                <div className="flex justify-center py-4">
                    <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />
                </div>
            )}
            {hasMore && !loading && events.length > 0 && (
                <button
                    onClick={loadMore}
                    className="w-full py-2 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 border border-zinc-200 dark:border-white/10 rounded-sm hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                >
                    Load more
                </button>
            )}
        </div>
    );
}

export function AccountStakingTab({ address }: Props) {
    const normalizedAddress = normalizeAddress(address);
    const [staking, setStaking] = useState<StakingInfo | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setStaking(null);
        setError(null);
        setLoading(true);
        (async () => {
            try {
                const { cadenceService } = await import('../../fclConfig');
                const res = await cadenceService.getStakingInfo(normalizedAddress);
                setStaking(res?.stakingInfo || null);
            } catch (err) {
                console.error('Failed to load staking info', err);
                setError('Failed to load staking information');
            } finally {
                setLoading(false);
            }
        })();
    }, [normalizedAddress]);

    const nodeInfos = staking?.nodeInfos || [];
    const delegatorInfos = staking?.delegatorInfos || [];
    const lockedInfo = staking?.lockedAccountInfo;
    const epochInfo = staking?.epochInfo;

    const totalStaked = [...nodeInfos, ...delegatorInfos].reduce((sum, info) => sum + Number(info.tokensStaked || 0), 0);
    const totalRewarded = [...nodeInfos, ...delegatorInfos].reduce((sum, info) => sum + Number(info.tokensRewarded || 0), 0);
    const totalCommitted = [...nodeInfos, ...delegatorInfos].reduce((sum, info) => sum + Number(info.tokensCommitted || 0), 0);
    const totalUnstaking = [...nodeInfos, ...delegatorInfos].reduce((sum, info) => sum + Number(info.tokensUnstaking || 0), 0);

    const hasStaking = nodeInfos.length > 0 || delegatorInfos.length > 0;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                    <Landmark className="w-4 h-4" />
                    Staking
                </h3>
                {epochInfo && (
                    <span className="text-[10px] text-zinc-500 font-mono">
                        Epoch #{epochInfo.currentEpochCounter} · Phase {epochInfo.currentEpochPhase}
                    </span>
                )}
            </div>

            {loading && (
                <div className="flex flex-col gap-4">
                    {[1, 2].map(i => (
                        <GlassCard key={i} className="p-6">
                            <div className="space-y-3">
                                <div className="h-5 w-48 bg-zinc-200 dark:bg-white/5 animate-pulse rounded" />
                                <div className="h-8 w-32 bg-zinc-200 dark:bg-white/5 animate-pulse rounded" />
                                <div className="grid grid-cols-3 gap-3">
                                    {[1, 2, 3].map(j => (
                                        <div key={j} className="h-16 bg-zinc-200 dark:bg-white/5 animate-pulse rounded" />
                                    ))}
                                </div>
                            </div>
                        </GlassCard>
                    ))}
                </div>
            )}

            {error && (
                <GlassCard className="border-red-200 dark:border-red-900/30 bg-red-50/50 dark:bg-red-900/10">
                    <div className="text-xs text-red-500 dark:text-red-400">{error}</div>
                </GlassCard>
            )}

            {!loading && !error && (
                <>
                    {/* Overview summary */}
                    {hasStaking && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <GlassCard className="p-4">
                                <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Total Staked</div>
                                <div className="text-xl font-mono font-bold text-zinc-900 dark:text-white">{formatFlow(totalStaked)}</div>
                                <div className="text-[10px] text-zinc-400">FLOW</div>
                            </GlassCard>
                            <GlassCard className="p-4">
                                <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Total Rewarded</div>
                                <div className="text-xl font-mono font-bold text-emerald-600 dark:text-emerald-400">{formatFlow(totalRewarded)}</div>
                                <div className="text-[10px] text-zinc-400">FLOW</div>
                            </GlassCard>
                            <GlassCard className="p-4">
                                <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Committed</div>
                                <div className="text-xl font-mono font-bold text-zinc-900 dark:text-white">{formatFlow(totalCommitted)}</div>
                                <div className="text-[10px] text-zinc-400">FLOW</div>
                            </GlassCard>
                            <GlassCard className="p-4">
                                <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Unstaking</div>
                                <div className="text-xl font-mono font-bold text-zinc-900 dark:text-white">{formatFlow(totalUnstaking)}</div>
                                <div className="text-[10px] text-zinc-400">FLOW</div>
                            </GlassCard>
                        </div>
                    )}

                    {/* Locked Account Info */}
                    {lockedInfo && (
                        <GlassCard className="p-5">
                            <div className="flex items-center gap-2 mb-3">
                                <Lock className="h-4 w-4 text-zinc-400" />
                                <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Locked Account</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Locked Address</div>
                                    <AddressLink address={lockedInfo.lockedAddress} prefixLen={20} suffixLen={0} />
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Locked Balance</div>
                                    <div className="text-sm font-mono font-bold text-zinc-900 dark:text-white">{formatFlow(lockedInfo.lockedBalance)} <span className="text-[10px] font-normal text-zinc-500">FLOW</span></div>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Unlock Limit</div>
                                    <div className="text-sm font-mono font-bold text-zinc-900 dark:text-white">{formatFlow(lockedInfo.unlockLimit)} <span className="text-[10px] font-normal text-zinc-500">FLOW</span></div>
                                </div>
                            </div>
                        </GlassCard>
                    )}

                    {/* Node Operators */}
                    {nodeInfos.length > 0 && (
                        <div className="space-y-4">
                            <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                                <Server className="w-3.5 h-3.5" />
                                Node Operators ({nodeInfos.length})
                            </h4>
                            {nodeInfos.map((node, i) => (
                                <NodeInfoCard key={node.id || i} node={node} index={i} />
                            ))}
                        </div>
                    )}

                    {/* Delegations */}
                    {delegatorInfos.length > 0 && (
                        <div className="space-y-4">
                            <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                                <Users className="w-3.5 h-3.5" />
                                Delegations ({delegatorInfos.length})
                            </h4>
                            {delegatorInfos.map((del, i) => (
                                <DelegatorInfoCard key={`${del.nodeID}-${del.id}`} delegator={del} index={i} />
                            ))}
                        </div>
                    )}

                    {/* Empty state */}
                    {!hasStaking && !lockedInfo && (
                        <GlassCard className="text-center py-12">
                            <Landmark className="w-12 h-12 text-zinc-300 dark:text-zinc-700 mx-auto mb-4" />
                            <div className="text-zinc-500 italic">No staking activity found</div>
                            <div className="text-[10px] text-zinc-400 mt-1">This account is not running a node or delegating tokens</div>
                        </GlassCard>
                    )}

                    {/* Staking Activity History */}
                    <StakingActivitySection address={normalizedAddress} />
                </>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// ContractDetail — full detail page for a single contract
// Sidebar navigation layout with sections: Overview (+ Dependencies),
// Source, Events, NFT Items, Transactions, Deployment
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Loader2,
  Zap,
  Package,
  BadgeCheck,
  ExternalLink,
  Globe,
  Twitter,
  Instagram,
  MessageCircle,
  Send,
  Github,
  BarChart3,
  Rocket,
  Code2,
  Activity,
  Users,
  Image,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  fetchContractDetail,
  fetchContractVersions,
  fetchContractEvents,
  fetchContractDependencies,
  fetchTokenMetadata,
  fetchContractTransactions,
  fetchTokenHolders,
  fetchNFTItems,
} from './api';
import type {
  ContractInfo,
  ContractVersion,
  ContractEvent,
  ContractTransaction,
  ContractHolder,
  NFTItem,
  TokenMetadata,
  DependencyData,
} from './api';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import ContractStats from './ContractStats';
import ContractCharts from './ContractCharts';
import DependencyGraph from './DependencyGraph';
import SourceTab from './SourceTab';
import DeploySection from './DeploySection';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function flowIndexContractUrl(identifier: string, network: string): string {
  const base = network === 'testnet' ? 'https://testnet.flowindex.io' : 'https://flowindex.io';
  return `${base}/contracts/${identifier}`;
}

function flowIndexTxUrl(txId: string, network: string): string {
  const base = network === 'testnet' ? 'https://testnet.flowindex.io' : 'https://flowindex.io';
  return `${base}/txs/${txId}`;
}

function flowIndexAddressUrl(address: string, network: string): string {
  const base = network === 'testnet' ? 'https://testnet.flowindex.io' : 'https://flowindex.io';
  const addr = address.startsWith('0x') ? address : `0x${address}`;
  return `${base}/account/${addr}`;
}

/** FlowIndex NFT item URL — uses format without 0x */
function flowIndexNftItemUrl(identifier: string, itemId: string, network: string): string {
  const base = network === 'testnet' ? 'https://testnet.flowindex.io' : 'https://flowindex.io';
  const id = identifier.replace(/\.0x/i, '.');
  return `${base}/nfts/${id}/item/${itemId}`;
}

function truncAddr(addr: string): string {
  const full = addr.startsWith('0x') ? addr : `0x${addr}`;
  if (full.length <= 13) return full;
  return `${full.slice(0, 6)}...${full.slice(-4)}`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

const socialMeta: Record<string, { icon: LucideIcon; label: string }> = {
  twitter: { icon: Twitter, label: 'X' },
  discord: { icon: MessageCircle, label: 'Discord' },
  instagram: { icon: Instagram, label: 'Instagram' },
  telegram: { icon: Send, label: 'Telegram' },
  github: { icon: Github, label: 'GitHub' },
};

// ---------------------------------------------------------------------------
// Tab config
// ---------------------------------------------------------------------------

type TabId = 'overview' | 'source' | 'events' | 'holders' | 'nfts' | 'transactions' | 'deployment';

interface TabDef {
  id: TabId;
  label: string;
  icon: LucideIcon;
  condition?: (contract: ContractInfo | null) => boolean;
}

const ALL_TABS: TabDef[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'source', label: 'Source', icon: Code2 },
  { id: 'events', label: 'Events', icon: Zap },
  { id: 'holders', label: 'Holders', icon: Users, condition: (c) => c?.kind === 'FT' || c?.kind === 'NFT' },
  { id: 'nfts', label: 'NFT Items', icon: Image, condition: (c) => c?.kind === 'NFT' },
  { id: 'transactions', label: 'Transactions', icon: Activity },
  { id: 'deployment', label: 'Deployment', icon: Rocket },
];

// NFT page size
const NFT_PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ContractDetail() {
  const { contractId } = useParams<{ contractId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  // Tab from URL
  const rawTab = searchParams.get('tab') as TabId | null;
  const setActiveTab = useCallback((tab: TabId) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tab === 'overview') next.delete('tab');
      else next.set('tab', tab);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Core data
  const [contract, setContract] = useState<ContractInfo | null>(null);
  const [versions, setVersions] = useState<ContractVersion[]>([]);
  const [events, setEvents] = useState<ContractEvent[]>([]);
  const [depData, setDepData] = useState<DependencyData>({ imports: [], dependents: [] });
  const [tokenMeta, setTokenMeta] = useState<TokenMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Lazy-loaded tab data
  const [transactions, setTransactions] = useState<ContractTransaction[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [holders, setHolders] = useState<ContractHolder[]>([]);
  const [holdersLoading, setHoldersLoading] = useState(false);
  const [holdersHasMore, setHoldersHasMore] = useState(false);
  const [holdersPage, setHoldersPage] = useState(0);
  // Chart holders — cached separately to avoid re-fetching
  const [chartHolders, setChartHolders] = useState<ContractHolder[]>([]);
  const [chartHoldersLoading, setChartHoldersLoading] = useState(false);
  const [chartTopN, setChartTopN] = useState<50 | 100 | 200>(50);
  const [nftItems, setNftItems] = useState<NFTItem[]>([]);
  const [nftsLoading, setNftsLoading] = useState(false);
  const [nftsHasMore, setNftsHasMore] = useState(false);
  const [nftsPage, setNftsPage] = useState(0);
  const [eventsLoading, setEventsLoading] = useState(false);

  const network: string = 'mainnet';

  // Resolve active tab (validate against available tabs)
  const visibleTabs = ALL_TABS.filter((t) => !t.condition || t.condition(contract));
  const validTabIds = visibleTabs.map((t) => t.id);
  const activeTab: TabId = rawTab && validTabIds.includes(rawTab) ? rawTab : 'overview';

  // Initial data load
  useEffect(() => {
    if (!contractId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const identifier = contractId!;
        const [detail, vers, deps] = await Promise.all([
          fetchContractDetail(identifier, network),
          fetchContractVersions(identifier, network),
          fetchContractDependencies(identifier, network),
        ]);
        if (cancelled) return;
        setContract(detail);
        setVersions(vers);
        setDepData(deps);

        if (detail.kind === 'FT' || detail.kind === 'NFT') {
          const meta = await fetchTokenMetadata(identifier, detail.kind, network);
          if (!cancelled) setTokenMeta(meta);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load contract');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [contractId]);

  // Load holders page (table)
  const HOLDER_PAGE_SIZE = 50;
  const loadHolders = useCallback(async (page: number) => {
    if (!contractId || !contract) return;
    setHoldersLoading(true);
    try {
      const result = await fetchTokenHolders(contractId, contract.kind || 'NFT', network, HOLDER_PAGE_SIZE, page * HOLDER_PAGE_SIZE);
      setHolders(result.holders);
      setHoldersHasMore(result.hasMore);
      setHoldersPage(page);
    } finally {
      setHoldersLoading(false);
    }
  }, [contractId, contract]);

  // Load chart holders (up to 200, cached)
  const loadChartHolders = useCallback(async (topN: 50 | 100 | 200) => {
    if (!contractId || !contract) return;
    setChartTopN(topN);
    // If we already have enough data, don't refetch
    if (chartHolders.length >= topN) return;
    setChartHoldersLoading(true);
    try {
      const result = await fetchTokenHolders(contractId, contract.kind || 'NFT', network, 200, 0);
      setChartHolders(result.holders);
    } finally {
      setChartHoldersLoading(false);
    }
  }, [contractId, contract, chartHolders.length]);

  // Load NFT page
  const loadNfts = useCallback(async (page: number) => {
    if (!contractId) return;
    setNftsLoading(true);
    try {
      const result = await fetchNFTItems(contractId, network, NFT_PAGE_SIZE, page * NFT_PAGE_SIZE);
      setNftItems(result.items);
      setNftsHasMore(result.hasMore);
      setNftsPage(page);
    } finally {
      setNftsLoading(false);
    }
  }, [contractId]);

  // Lazy load tab data
  useEffect(() => {
    if (!contractId || loading) return;
    if (activeTab === 'events' && events.length === 0 && !eventsLoading) {
      setEventsLoading(true);
      fetchContractEvents(contractId, network)
        .then(setEvents)
        .finally(() => setEventsLoading(false));
    }
    if (activeTab === 'transactions' && transactions.length === 0 && !txLoading) {
      setTxLoading(true);
      fetchContractTransactions(contractId, network, 25)
        .then(setTransactions)
        .finally(() => setTxLoading(false));
    }
    if (activeTab === 'holders' && holders.length === 0 && !holdersLoading && contract) {
      loadHolders(0);
      if (chartHolders.length === 0 && !chartHoldersLoading) {
        loadChartHolders(50);
      }
    }
    if (activeTab === 'nfts' && nftItems.length === 0 && !nftsLoading) {
      loadNfts(0);
    }
  }, [activeTab, contractId, loading]);

  const parts = contractId?.split('.') ?? [];
  const contractName = parts.length >= 3 ? parts.slice(2).join('.') : contractId;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-400">{error}</p>
          <Link to="/deploy" className="mt-3 inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
            <ArrowLeft className="w-3 h-3" /> Back to Deploy
          </Link>
        </div>
      </div>
    );
  }

  const displayName = tokenMeta?.name || contract?.token_name || contractName;
  const logo = tokenMeta?.logo || contract?.token_logo;
  const isVerified = tokenMeta?.is_verified || contract?.is_verified;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Compact header */}
      <div className="shrink-0 border-b border-zinc-800 bg-zinc-900/50">
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            <Link to="/deploy" className="text-zinc-500 hover:text-zinc-300 transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="w-8 h-8 rounded-lg shrink-0 overflow-hidden flex items-center justify-center bg-zinc-700/50">
              {logo ? (
                <img src={logo} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              ) : (
                <Package className="w-4 h-4 text-zinc-400" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-semibold text-zinc-100 truncate">{displayName}</h1>
                {isVerified && <BadgeCheck className="w-3.5 h-3.5 text-blue-400 shrink-0" />}
                {contract?.kind && (
                  <span className={`px-1.5 py-0.5 text-[9px] font-medium rounded ${
                    contract.kind === 'FT' ? 'bg-amber-500/15 text-amber-400'
                    : contract.kind === 'NFT' ? 'bg-purple-500/15 text-purple-400'
                    : 'bg-zinc-700 text-zinc-400'
                  }`}>{contract.kind}</span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <a
                  href={flowIndexContractUrl(contractId || '', network)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-zinc-500 hover:text-blue-400 font-mono transition-colors flex items-center gap-1"
                >
                  {contractId} <ExternalLink className="w-2.5 h-2.5" />
                </a>
                {tokenMeta?.external_url && (
                  <a href={tokenMeta.external_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1">
                    <Globe className="w-2.5 h-2.5" />
                    {tokenMeta.external_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                  </a>
                )}
                {tokenMeta?.socials && Object.entries(tokenMeta.socials).map(([key, url]) => {
                  const meta = socialMeta[key];
                  const Icon = meta?.icon || ExternalLink;
                  return (
                    <a key={key} href={url} target="_blank" rel="noopener noreferrer" className="text-zinc-600 hover:text-zinc-300 transition-colors">
                      <Icon className="w-3 h-3" />
                    </a>
                  );
                })}
              </div>
            </div>
            {/* Quick stats */}
            <div className="hidden lg:flex items-center gap-4">
              {tokenMeta && tokenMeta.holder_count > 0 && (
                <div className="text-right">
                  <div className="text-[10px] text-zinc-500">Holders</div>
                  <div className="text-xs font-medium text-zinc-200">{formatNumber(tokenMeta.holder_count)}</div>
                </div>
              )}
              {contract && contract.dependent_count > 0 && (
                <div className="text-right">
                  <div className="text-[10px] text-zinc-500">Imports</div>
                  <div className="text-xs font-medium text-zinc-200">{formatNumber(contract.dependent_count)}</div>
                </div>
              )}
              <div className="text-right">
                <div className="text-[10px] text-zinc-500">Version</div>
                <div className="text-xs font-medium text-zinc-200">v{contract?.version ?? 1}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main area: sidebar + content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar navigation */}
        <nav className="w-44 shrink-0 border-r border-zinc-800 bg-zinc-900/30 overflow-y-auto py-2">
          {visibleTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-2.5 px-4 py-2 text-left text-xs transition-colors ${
                  isActive
                    ? 'bg-zinc-800 text-zinc-100 border-r-2 border-blue-400'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 border-r-2 border-transparent'
                }`}
              >
                <tab.icon className="w-3.5 h-3.5 shrink-0" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* ---- OVERVIEW ---- */}
          {activeTab === 'overview' && (
            <div className="p-6 space-y-6">
              {/* Banner */}
              {tokenMeta?.banner && (
                <div className="relative rounded-xl overflow-hidden min-h-[160px]">
                  <img src={tokenMeta.banner} alt="" className="absolute inset-0 w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/20" />
                  {tokenMeta.description && (
                    <div className="relative z-10 flex items-end h-full p-6">
                      <p className="text-sm text-zinc-200/90 leading-relaxed max-w-2xl">{tokenMeta.description}</p>
                    </div>
                  )}
                </div>
              )}
              {!tokenMeta?.banner && tokenMeta?.description && (
                <p className="text-sm text-zinc-400 leading-relaxed">{tokenMeta.description}</p>
              )}

              <ContractStats
                holders={tokenMeta?.holder_count ?? 0}
                dependents={contract?.dependent_count ?? 0}
                version={contract?.version ?? 1}
                firstDeployed={contract?.first_seen_height ? `Block #${contract.first_seen_height.toLocaleString()}` : 'Unknown'}
                totalSupply={tokenMeta?.total_supply}
                kind={contract?.kind}
              />
              <ContractCharts versions={versions} />

              {/* Dependencies inline under Overview */}
              {(depData.imports.length > 0 || depData.dependents.length > 0 || depData.graph) && (
                <div>
                  <h3 className="text-xs font-medium text-zinc-400 mb-3">Dependencies</h3>
                  <DependencyGraph
                    contractName={contractName || ''}
                    contractIdentifier={contractId || ''}
                    imports={depData.imports}
                    dependents={depData.dependents}
                    graph={depData.graph}
                    onNodeClick={(identifier) => {
                      window.open(flowIndexContractUrl(identifier, network), '_blank');
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* ---- SOURCE ---- */}
          {activeTab === 'source' && (
            <div className="p-6">
              <SourceTab
                contract={contract}
                contractName={contractName || ''}
                contractId={contractId || ''}
                versions={versions}
                network={network}
              />
            </div>
          )}

          {/* ---- EVENTS ---- */}
          {activeTab === 'events' && (
            <div className="p-6">
              {eventsLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
                  <span className="ml-2 text-xs text-zinc-500">Loading events (this may take a moment)...</span>
                </div>
              ) : events.length > 0 ? (
                <div>
                  <div className="text-xs text-zinc-500 mb-3">{events.length} event type{events.length !== 1 ? 's' : ''}</div>
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-500">
                        <th className="pb-2 font-normal">Event Name</th>
                        <th className="pb-2 font-normal text-right">Count</th>
                        <th className="pb-2 font-normal text-right">Last Seen</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50">
                      {events.map((e) => (
                        <tr key={e.type} className="hover:bg-zinc-800/30 transition-colors">
                          <td className="py-2 pr-4">
                            <span className="text-zinc-200 font-mono">{e.event_name}</span>
                            <span className="text-zinc-600 font-mono text-[10px] ml-2">{e.type}</span>
                          </td>
                          <td className="py-2 text-right text-zinc-300 font-medium">{formatNumber(e.count)}</td>
                          <td className="py-2 text-right text-zinc-500">{e.last_seen ? timeAgo(e.last_seen) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
                  <Zap className="w-8 h-8 mb-3 opacity-30" />
                  <p className="text-xs">No events found</p>
                  <p className="text-[10px] text-zinc-600 mt-1">Events may still be loading from the database</p>
                </div>
              )}
            </div>
          )}

          {/* ---- HOLDERS ---- */}
          {activeTab === 'holders' && (
            <div className="p-6">
              {holdersLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
                </div>
              ) : holders.length > 0 ? (
                <div className="space-y-6">
                  {/* Pie chart with Top N selector */}
                  {(() => {
                    const PIE_COLORS = [
                      '#22c55e', '#16a34a', '#15803d', '#166534', '#14532d',
                      '#10b981', '#059669', '#047857', '#065f46', '#064e3b',
                      '#34d399', '#6ee7b7', '#a7f3d0', '#d1fae5', '#ecfdf5',
                      '#4ade80', '#86efac', '#bbf7d0',
                    ];
                    const dataSource = chartHolders.length > 0 ? chartHolders : holders;
                    const sliced = dataSource.slice(0, chartTopN);
                    const topPct = sliced.reduce((s, h) => s + (h.percentage || 0), 0);
                    const othersPct = Math.max(0, 1 - topPct);

                    // For the pie chart: group into top 10 individually + "Rest of top N" + "Others"
                    const top10 = sliced.slice(0, 10);
                    const restOfTopN = sliced.slice(10);
                    const restPct = restOfTopN.reduce((s, h) => s + (h.percentage || 0), 0);
                    const pieData = [
                      ...top10.map((h, i) => ({
                        name: truncAddr(h.address),
                        value: +(((h.percentage || 0) * 100).toFixed(2)),
                        fill: PIE_COLORS[i % PIE_COLORS.length],
                      })),
                      ...(restPct > 0.001 ? [{
                        name: `Top ${chartTopN} (rest)`,
                        value: +((restPct * 100).toFixed(2)),
                        fill: '#065f46',
                      }] : []),
                      ...(othersPct > 0.001 ? [{
                        name: 'Others',
                        value: +((othersPct * 100).toFixed(2)),
                        fill: '#3f3f46',
                      }] : []),
                    ];

                    return (
                      <div>
                        {/* Top N tabs */}
                        <div className="flex items-center gap-1 mb-4">
                          <span className="text-xs text-zinc-500 mr-2">Distribution</span>
                          {([50, 100, 200] as const).map((n) => (
                            <button
                              key={n}
                              onClick={() => loadChartHolders(n)}
                              className={`px-2.5 py-1 text-[10px] font-medium rounded-full transition-colors ${
                                chartTopN === n
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                  : 'text-zinc-500 hover:text-zinc-300 border border-zinc-700 hover:border-zinc-600'
                              }`}
                            >
                              Top {n}
                            </button>
                          ))}
                          {chartHoldersLoading && <Loader2 className="w-3 h-3 text-zinc-500 animate-spin ml-2" />}
                        </div>

                        <div className="flex items-start gap-6">
                          <div className="w-[260px] h-[260px] shrink-0">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={pieData}
                                  dataKey="value"
                                  nameKey="name"
                                  cx="50%"
                                  cy="50%"
                                  innerRadius={60}
                                  outerRadius={110}
                                  paddingAngle={1}
                                  stroke="none"
                                >
                                  {pieData.map((entry, idx) => (
                                    <Cell key={idx} fill={entry.fill} />
                                  ))}
                                </Pie>
                                <Tooltip
                                  contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 11 }}
                                  itemStyle={{ color: '#d4d4d8' }}
                                  formatter={(value: number | undefined) => `${value ?? 0}%`}
                                />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="flex-1 space-y-1.5 pt-2">
                            <div className="text-[10px] text-zinc-600 mb-2">
                              Top {chartTopN} holders: {((topPct) * 100).toFixed(1)}% of supply
                            </div>
                            {pieData.map((entry, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs">
                                <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: entry.fill }} />
                                <span className="text-zinc-400 font-mono truncate">{entry.name}</span>
                                <span className="text-zinc-500 ml-auto">{entry.value}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Holder table */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-xs text-zinc-500">
                        Top holders
                        {tokenMeta?.holder_count ? ` — ${formatNumber(tokenMeta.holder_count)} total` : ''}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => loadHolders(holdersPage - 1)}
                          disabled={holdersPage === 0}
                          className="p-1 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronLeft className="w-3 h-3" />
                        </button>
                        <span className="text-[10px] text-zinc-600">Page {holdersPage + 1}</span>
                        <button
                          onClick={() => loadHolders(holdersPage + 1)}
                          disabled={!holdersHasMore}
                          className="p-1 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-zinc-800 text-zinc-500">
                          <th className="pb-2 font-normal w-8">#</th>
                          <th className="pb-2 font-normal">Address</th>
                          <th className="pb-2 font-normal text-right">Amount</th>
                          <th className="pb-2 font-normal text-right">%</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/50">
                        {holders.map((h, i) => {
                          const fullAddr = h.address.startsWith('0x') ? h.address : `0x${h.address}`;
                          return (
                            <tr key={h.address} className="hover:bg-zinc-800/30 transition-colors">
                              <td className="py-2 text-zinc-600">{holdersPage * HOLDER_PAGE_SIZE + i + 1}</td>
                              <td className="py-2">
                                <a
                                  href={flowIndexAddressUrl(h.address, network)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-2 text-emerald-400 hover:text-emerald-300 font-mono transition-colors"
                                >
                                  <img
                                    src={`https://source.boringavatars.com/beam/20/${fullAddr}?colors=22c55e,16a34a,15803d,166534,14532d`}
                                    alt=""
                                    className="w-5 h-5 rounded-full shrink-0"
                                  />
                                  {truncAddr(h.address)}
                                </a>
                              </td>
                              <td className="py-2 text-right text-zinc-300 font-medium">
                                {h.balance != null ? formatNumber(h.balance) : '—'}
                              </td>
                              <td className="py-2 text-right text-zinc-500">
                                {h.percentage != null && h.percentage > 0 ? `${(h.percentage * 100).toFixed(2)}%` : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
                  <Users className="w-8 h-8 mb-3 opacity-30" />
                  <p className="text-xs">No holders found</p>
                </div>
              )}
            </div>
          )}

          {/* ---- NFT ITEMS ---- */}
          {activeTab === 'nfts' && (
            <div className="p-6">
              {nftsLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
                </div>
              ) : nftItems.length > 0 ? (
                <div>
                  {/* Pagination header */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="text-xs text-zinc-500">
                      Page {nftsPage + 1}
                      {tokenMeta?.total_supply ? ` — ${formatNumber(tokenMeta.total_supply)} total items` : ''}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => loadNfts(nftsPage - 1)}
                        disabled={nftsPage === 0}
                        className="p-1.5 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => loadNfts(nftsPage + 1)}
                        disabled={!nftsHasMore}
                        className="p-1.5 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {nftItems.map((item) => (
                      <a
                        key={item.id}
                        href={flowIndexNftItemUrl(contractId || '', item.id, network)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden hover:border-zinc-600 transition-colors"
                      >
                        {item.image ? (
                          <div className="aspect-square bg-zinc-800">
                            <img src={item.image} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          </div>
                        ) : (
                          <div className="aspect-square bg-zinc-800 flex items-center justify-center">
                            <Image className="w-8 h-8 text-zinc-700" />
                          </div>
                        )}
                        <div className="p-2">
                          <div className="text-[10px] text-zinc-300 truncate group-hover:text-blue-400 transition-colors">
                            {item.name || `#${item.id}`}
                          </div>
                          {item.name && (
                            <div className="text-[9px] font-mono text-zinc-600 truncate">#{item.id}</div>
                          )}
                          {item.owner && (
                            <div className="text-[9px] text-zinc-600 font-mono mt-0.5 truncate">
                              {truncAddr(item.owner)}
                            </div>
                          )}
                        </div>
                      </a>
                    ))}
                  </div>

                  {/* Pagination footer */}
                  {(nftsPage > 0 || nftsHasMore) && (
                    <div className="flex items-center justify-center gap-2 mt-4">
                      <button
                        onClick={() => loadNfts(nftsPage - 1)}
                        disabled={nftsPage === 0}
                        className="px-3 py-1.5 rounded border border-zinc-700 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        Previous
                      </button>
                      <span className="text-xs text-zinc-600">Page {nftsPage + 1}</span>
                      <button
                        onClick={() => loadNfts(nftsPage + 1)}
                        disabled={!nftsHasMore}
                        className="px-3 py-1.5 rounded border border-zinc-700 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
                  <Image className="w-8 h-8 mb-3 opacity-30" />
                  <p className="text-xs">No NFT items found</p>
                </div>
              )}
            </div>
          )}

          {/* ---- TRANSACTIONS ---- */}
          {activeTab === 'transactions' && (
            <div className="p-6">
              {txLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
                </div>
              ) : transactions.length > 0 ? (
                <div>
                  <div className="text-xs text-zinc-500 mb-3">Recent transactions</div>
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-500">
                        <th className="pb-2 font-normal">Transaction</th>
                        <th className="pb-2 font-normal">Status</th>
                        <th className="pb-2 font-normal">Payer</th>
                        <th className="pb-2 font-normal text-right">Events</th>
                        <th className="pb-2 font-normal text-right">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50">
                      {transactions.map((tx) => (
                        <tr key={tx.id} className="hover:bg-zinc-800/30 transition-colors">
                          <td className="py-2">
                            <a
                              href={flowIndexTxUrl(tx.id, network)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-zinc-300 hover:text-blue-400 font-mono transition-colors"
                            >
                              {tx.id.slice(0, 10)}...
                            </a>
                          </td>
                          <td className="py-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              tx.status === 'Sealed' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-700 text-zinc-400'
                            }`}>{tx.status}</span>
                          </td>
                          <td className="py-2">
                            <a
                              href={flowIndexAddressUrl(tx.payer, network)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-zinc-400 hover:text-blue-400 font-mono transition-colors"
                            >
                              {truncAddr(tx.payer)}
                            </a>
                          </td>
                          <td className="py-2 text-right text-zinc-400">{tx.event_count}</td>
                          <td className="py-2 text-right text-zinc-500">
                            {tx.timestamp ? timeAgo(tx.timestamp) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
                  <Activity className="w-8 h-8 mb-3 opacity-30" />
                  <p className="text-xs">No transactions found</p>
                </div>
              )}
            </div>
          )}

          {/* ---- DEPLOYMENT ---- */}
          {activeTab === 'deployment' && (
            <div className="p-6">
              <DeploySection projectId={contractId || ''} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

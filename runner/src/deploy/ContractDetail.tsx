// ---------------------------------------------------------------------------
// ContractDetail — full detail page for a single contract
// Sidebar navigation layout with sections: Overview (+ Dependencies),
// Source, Events, NFT Items, Transactions, Deployment
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  FileCode,
  Play,
  Shield,
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
  fetchContractScripts,
  fetchScriptText,
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
  ContractScript,
} from './api';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import ContractStats from './ContractStats';
import ContractCharts from './ContractCharts';
import DependencyGraph from './DependencyGraph';
import SourceTab from './SourceTab';
import DeploySection from './DeploySection';
import AuditTab from './AuditTab';
import { useShikiHighlighter, highlightCode } from '../hooks/useShiki';
import Avatar from 'boring-avatars';

// ---------------------------------------------------------------------------
// Helpers

/** Derive 5 colors from an address (matches frontend AddressLink). */
function colorsFromAddress(addr: string): string[] {
  let hex = addr.replace(/^0x/, '');
  if (hex.length > 16) hex = hex.replace(/^0+/, '') || hex;
  hex = hex.padEnd(16, '0').slice(0, 16);
  const c1 = `#${hex.slice(0, 6)}`;
  const c2 = `#${hex.slice(5, 11)}`;
  const c3 = `#${hex.slice(10, 16)}`;
  const c4 = `#${hex[1]}${hex[3]}${hex[7]}${hex[9]}${hex[13]}${hex[15]}`;
  const c5 = `#${hex[0]}${hex[4]}${hex[8]}${hex[12]}${hex[2]}${hex[6]}`;
  return [c1, c2, c3, c4, c5];
}
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
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
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

type TabId = 'overview' | 'source' | 'audit' | 'events' | 'holders' | 'nfts' | 'scripts' | 'transactions' | 'deployment';

interface TabDef {
  id: TabId;
  label: string;
  icon: LucideIcon;
  condition?: (contract: ContractInfo | null) => boolean;
}

const ALL_TABS: TabDef[] = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'source', label: 'Source', icon: Code2 },
  { id: 'audit', label: 'AI Audit', icon: Shield },
  { id: 'events', label: 'Events', icon: Zap },
  { id: 'holders', label: 'Holders', icon: Users, condition: (c) => c?.kind === 'FT' || c?.kind === 'NFT' },
  { id: 'nfts', label: 'NFT Items', icon: Image, condition: (c) => c?.kind === 'NFT' },
  { id: 'scripts', label: 'Common Tx', icon: FileCode },
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
  const [liveTx, setLiveTx] = useState(false);
  // Track which tx IDs are "new" (arrived via live polling) for highlight animation
  const knownTxIdsRef = useRef<Set<string>>(new Set());
  const newTxExpiryRef = useRef<Map<string, number>>(new Map());
  const [highlightTick, setHighlightTick] = useState(0);
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
  // Scripts tab
  const [scripts, setScripts] = useState<ContractScript[]>([]);
  const [scriptsLoading, setScriptsLoading] = useState(false);
  const [scriptsHasMore, setScriptsHasMore] = useState(false);
  const [selectedScriptHash, setSelectedScriptHash] = useState<string | null>(null);
  const [selectedScriptText, setSelectedScriptText] = useState('');
  const [scriptTextLoading, setScriptTextLoading] = useState(false);

  const network: string = 'mainnet';
  const shikiHighlighter = useShikiHighlighter();

  // Syntax-highlighted script HTML
  const scriptHighlightedHtml = useMemo(() => {
    if (!shikiHighlighter || !selectedScriptText) return '';
    return highlightCode(shikiHighlighter, selectedScriptText, 'cadence', 'cadence-editor');
  }, [shikiHighlighter, selectedScriptText]);

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
    if (activeTab === 'scripts' && scripts.length === 0 && !scriptsLoading) {
      setScriptsLoading(true);
      fetchContractScripts(contractId, network).then(({ scripts: items, hasMore }) => {
        setScripts(items);
        setScriptsHasMore(hasMore);
        // Auto-select first script
        if (items.length > 0) {
          setSelectedScriptHash(items[0].script_hash);
          setScriptTextLoading(true);
          fetchScriptText(items[0].script_hash, network)
            .then(setSelectedScriptText)
            .finally(() => setScriptTextLoading(false));
        }
      }).finally(() => setScriptsLoading(false));
    }
  }, [activeTab, contractId, loading]);

  // Highlight tick — cleans up expired "new" highlights every second
  useEffect(() => {
    if (!liveTx) return;
    const interval = setInterval(() => {
      const now = Date.now();
      for (const [id, expiry] of newTxExpiryRef.current.entries()) {
        if (expiry < now) newTxExpiryRef.current.delete(id);
      }
      setHighlightTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [liveTx]);

  // Seed known IDs from initial (non-live) load so they don't flash on first poll
  useEffect(() => {
    if (transactions.length > 0 && knownTxIdsRef.current.size === 0) {
      for (const tx of transactions) knownTxIdsRef.current.add(tx.id);
    }
  }, [transactions]);

  // Live polling for transactions
  useEffect(() => {
    if (!liveTx || !contractId || activeTab !== 'transactions') return;
    const interval = setInterval(() => {
      fetchContractTransactions(contractId, network, 25).then((fresh) => {
        // Mark truly new tx IDs for highlight
        for (const tx of fresh) {
          if (!knownTxIdsRef.current.has(tx.id)) {
            knownTxIdsRef.current.add(tx.id);
            newTxExpiryRef.current.set(tx.id, Date.now() + 3000);
          }
        }
        setTransactions(fresh);
      });
    }, 8000);
    return () => clearInterval(interval);
  }, [liveTx, contractId, activeTab]);

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
                <div className="text-xs font-medium text-zinc-200">v{versions.length > 0 ? versions.length : (contract?.version ?? 1)}</div>
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
                {tab.id === 'audit' && (
                  <span className="text-[8px] px-1 py-px rounded bg-amber-500/15 text-amber-400 font-medium ml-auto">
                    Beta
                  </span>
                )}
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
                version={versions.length > 0 ? Math.max(...versions.map(v => v.version)) : (contract?.version ?? 1)}
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

          {/* ---- AI AUDIT ---- */}
          {activeTab === 'audit' && (
            <div className="p-6">
              <AuditTab
                code={contract?.code || ''}
                contractName={contractName || ''}
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
                      <div className="flex items-stretch gap-4" style={{ height: 200 }}>
                        {/* KPI cards — 2x2 grid, 2/3 width */}
                        <div className="grid grid-cols-2 gap-3 flex-[2]">
                          {tokenMeta?.holder_count != null && tokenMeta.holder_count > 0 && (
                            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 flex flex-col justify-center">
                              <div className="text-[10px] text-zinc-500 mb-1">Total Holders</div>
                              <div className="text-2xl font-semibold text-zinc-100">{formatNumber(tokenMeta.holder_count)}</div>
                            </div>
                          )}
                          {tokenMeta?.total_supply != null && tokenMeta.total_supply > 0 && (
                            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 flex flex-col justify-center">
                              <div className="text-[10px] text-zinc-500 mb-1">Total Supply</div>
                              <div className="text-2xl font-semibold text-zinc-100">{formatNumber(tokenMeta.total_supply)}</div>
                            </div>
                          )}
                          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 flex flex-col justify-center">
                            <div className="text-[10px] text-zinc-500 mb-1">Top {chartTopN} Concentration</div>
                            <div className="text-2xl font-semibold text-emerald-400">{((topPct) * 100).toFixed(1)}%</div>
                          </div>
                          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 flex flex-col justify-center">
                            <div className="text-[10px] text-zinc-500 mb-1">Others</div>
                            <div className="text-2xl font-semibold text-zinc-400">{((othersPct) * 100).toFixed(1)}%</div>
                          </div>
                        </div>

                        {/* Pie chart — 1/3 width, same height */}
                        <div className="flex-1 flex items-center gap-3 min-w-0">
                          <div className="w-[200px] h-[200px] shrink-0">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={pieData}
                                  dataKey="value"
                                  nameKey="name"
                                  cx="50%"
                                  cy="50%"
                                  innerRadius={45}
                                  outerRadius={90}
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

                          {/* Distribution legend */}
                          <div className="flex-1 min-w-0 self-stretch flex flex-col">
                            <div className="flex items-center gap-1 mb-1.5">
                              <span className="text-[10px] text-zinc-500 mr-1">Distribution</span>
                              {([50, 100, 200] as const).map((n) => (
                                <button
                                  key={n}
                                  onClick={() => loadChartHolders(n)}
                                  className={`px-2 py-0.5 text-[9px] font-medium rounded-full transition-colors ${
                                    chartTopN === n
                                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                      : 'text-zinc-500 hover:text-zinc-300 border border-zinc-700 hover:border-zinc-600'
                                  }`}
                                >
                                  Top {n}
                                </button>
                              ))}
                              {chartHoldersLoading && <Loader2 className="w-3 h-3 text-zinc-500 animate-spin ml-1" />}
                            </div>
                            <div className="space-y-0.5 flex-1 overflow-y-auto">
                              {pieData.map((entry, i) => (
                                <div key={i} className="flex items-center gap-1.5 text-[11px]">
                                  <div className="w-2 h-2 rounded-sm shrink-0" style={{ background: entry.fill }} />
                                  <span className="text-zinc-400 font-mono truncate">{entry.name}</span>
                                  <span className="text-zinc-500 ml-auto shrink-0">{entry.value}%</span>
                                </div>
                              ))}
                            </div>
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
                                  <Avatar size={20} name={fullAddr} variant="beam" colors={colorsFromAddress(fullAddr)} />
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

          {/* ---- SCRIPTS (Common Transactions) ---- */}
          {activeTab === 'scripts' && (
            <div className="flex-1 flex overflow-hidden" style={{ minHeight: 400 }}>
              {scriptsLoading && scripts.length === 0 ? (
                <div className="flex items-center justify-center flex-1 py-16">
                  <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
                </div>
              ) : scripts.length > 0 ? (
                <>
                  {/* Left sidebar — script list */}
                  <div className="w-[260px] shrink-0 border-r border-zinc-800 overflow-y-auto">
                    <div className="divide-y divide-zinc-800/50">
                      {scripts.map((sc) => (
                        <button
                          key={sc.script_hash}
                          onClick={() => {
                            setSelectedScriptHash(sc.script_hash);
                            setScriptTextLoading(true);
                            fetchScriptText(sc.script_hash, network)
                              .then(setSelectedScriptText)
                              .finally(() => setScriptTextLoading(false));
                          }}
                          className={`w-full text-left px-3 py-2.5 transition-colors ${
                            selectedScriptHash === sc.script_hash
                              ? 'bg-emerald-500/10 border-l-2 border-emerald-500'
                              : 'hover:bg-zinc-800/50 border-l-2 border-transparent'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span className={`text-[11px] font-mono truncate ${
                              selectedScriptHash === sc.script_hash
                                ? 'text-white font-semibold'
                                : 'text-zinc-300'
                            }`}>
                              {sc.label || sc.script_hash.substring(0, 12) + '...'}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {sc.category && (
                              <span className="text-[8px] px-1 py-0.5 rounded-sm bg-zinc-800 text-zinc-500 uppercase tracking-wider">
                                {sc.category}
                              </span>
                            )}
                            <span className="text-[10px] text-zinc-500 font-mono ml-auto">
                              {sc.tx_count?.toLocaleString()} txs
                            </span>
                          </div>
                          {sc.description && (
                            <p className="text-[9px] text-zinc-500 mt-0.5 truncate">{sc.description}</p>
                          )}
                        </button>
                      ))}
                    </div>
                    {scriptsHasMore && (
                      <div className="text-center py-2 border-t border-zinc-800">
                        <button
                          onClick={() => {
                            setScriptsLoading(true);
                            fetchContractScripts(contractId!, network, 20, scripts.length).then(({ scripts: more, hasMore }) => {
                              setScripts((prev) => [...prev, ...more]);
                              setScriptsHasMore(hasMore);
                            }).finally(() => setScriptsLoading(false));
                          }}
                          disabled={scriptsLoading}
                          className="px-3 py-1.5 text-[10px] border border-zinc-700 rounded hover:bg-zinc-800 disabled:opacity-50 text-zinc-400 uppercase tracking-wider"
                        >
                          {scriptsLoading ? 'Loading...' : 'Load More'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Right panel — script code */}
                  <div className="flex-1 flex flex-col overflow-hidden bg-[#1e1e1e]">
                    {scriptTextLoading ? (
                      <div className="flex items-center justify-center h-full">
                        <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
                      </div>
                    ) : selectedScriptText ? (
                      <>
                        {/* Toolbar */}
                        <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-700 bg-[#252526] shrink-0">
                          <span className="text-[11px] text-zinc-400 font-medium truncate">
                            {scripts.find((s) => s.script_hash === selectedScriptHash)?.label || `${selectedScriptHash?.slice(0, 16)}...`}
                          </span>
                          <a
                            href={`/?code=${btoa(selectedScriptText)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium text-emerald-400 hover:bg-emerald-400/10 transition-colors"
                          >
                            <Play className="w-3 h-3" />
                            Open in Editor
                          </a>
                        </div>
                        {/* Code */}
                        <div className="flex-1 overflow-auto">
                          {scriptHighlightedHtml ? (
                            <div
                              className="shiki-source-view [&_pre]:!bg-transparent [&_pre]:!m-0 [&_pre]:!p-4 [&_code]:!text-[11px] [&_code]:leading-relaxed"
                              dangerouslySetInnerHTML={{ __html: scriptHighlightedHtml }}
                            />
                          ) : (
                            <pre className="p-4 text-[11px] leading-relaxed font-mono text-zinc-300 whitespace-pre-wrap">
                              {selectedScriptText}
                            </pre>
                          )}
                        </div>
                      </>
                    ) : selectedScriptHash ? (
                      <div className="flex items-center justify-center h-full text-zinc-500 text-xs">
                        Select a script to view
                      </div>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center flex-1 py-16 text-zinc-500">
                  <FileCode className="w-8 h-8 mb-3 opacity-30" />
                  <p className="text-xs">No common scripts found</p>
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
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-zinc-500">Recent transactions</span>
                      <button
                        onClick={() => setLiveTx(!liveTx)}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium transition-colors ${
                          liveTx
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:text-zinc-300'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${liveTx ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
                        Live
                      </button>
                    </div>
                    <a
                      href={`${network === 'testnet' ? 'https://testnet.flowindex.io' : 'https://flowindex.io'}/contracts/${contractId?.replace(/\.0x/i, '.')}?tab=transactions`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-zinc-500 hover:text-blue-400 transition-colors flex items-center gap-1"
                    >
                      View on FlowIndex <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <AnimatePresence initial={false} mode="popLayout">
                    {transactions.map((tx) => {
                      const isSuccess = !tx.error && tx.status === 'SEALED';
                      const _ = highlightTick; // keep in render dependency
                      const isNew = (newTxExpiryRef.current.get(tx.id) ?? 0) > Date.now();
                      // Current contract name from identifier (A.addr.Name → Name)
                      const currentContractName = contractId ? contractId.split('.').slice(2).join('.') : '';
                      // Well-known standard interfaces to filter out
                      const STANDARD_CONTRACTS = new Set([
                        'NonFungibleToken', 'FungibleToken', 'MetadataViews', 'ViewResolver',
                        'NFTStorefrontV2', 'NFTStorefront', 'TokenForwarding', 'FungibleTokenMetadataViews',
                        'Burner', 'FlowToken', 'FungibleTokenSwitchboard',
                      ]);
                      // Extract contract names, filter out current contract and standards
                      const tags = (tx.contract_imports || [])
                        .map((imp) => {
                          const parts = imp.split('.');
                          return parts.length >= 3 ? parts.slice(2).join('.') : imp;
                        })
                        .filter((name) => name !== currentContractName && !STANDARD_CONTRACTS.has(name));
                      // Color palette for tags
                      const TAG_COLORS = [
                        'bg-blue-500/15 text-blue-400',
                        'bg-purple-500/15 text-purple-400',
                        'bg-cyan-500/15 text-cyan-400',
                        'bg-amber-500/15 text-amber-400',
                        'bg-pink-500/15 text-pink-400',
                        'bg-teal-500/15 text-teal-400',
                        'bg-orange-500/15 text-orange-400',
                        'bg-indigo-500/15 text-indigo-400',
                      ];
                      return (
                        <motion.div
                          key={tx.id}
                          layout="position"
                          initial={liveTx ? { opacity: 0, x: 20 } : false}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                          className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                            isNew
                              ? 'bg-emerald-500/10 ring-1 ring-emerald-500/20'
                              : 'hover:bg-zinc-800/50'
                          }`}
                        >
                          {/* Status dot */}
                          <div className={`w-2 h-2 rounded-full shrink-0 ${isSuccess ? 'bg-emerald-400' : 'bg-red-400'}`} />

                          {/* Tx ID */}
                          <a
                            href={flowIndexTxUrl(tx.id, network)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-zinc-300 hover:text-blue-400 font-mono transition-colors shrink-0"
                          >
                            {tx.id.slice(0, 6)}...{tx.id.slice(-4)}
                          </a>

                          {/* Status badge */}
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium shrink-0 ${
                            isSuccess
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-red-500/15 text-red-400'
                          }`}>
                            {isSuccess ? 'Success' : 'Error'}
                          </span>

                          {/* Tags */}
                          <div className="flex items-center gap-1 flex-wrap flex-1 min-w-0">
                            {tags.slice(0, 4).map((tag, i) => (
                              <span
                                key={tag}
                                className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${TAG_COLORS[i % TAG_COLORS.length]}`}
                              >
                                {tag}
                              </span>
                            ))}
                            {tags.length > 4 && (
                              <span className="text-[9px] text-zinc-600">+{tags.length - 4}</span>
                            )}
                          </div>

                          {/* Block height */}
                          {tx.block_height > 0 && (
                            <span className="text-[10px] text-zinc-600 font-mono shrink-0">
                              #{tx.block_height.toLocaleString()}
                            </span>
                          )}

                          {/* Gas */}
                          {tx.gas_used > 0 && (
                            <span className="text-[10px] text-zinc-500 shrink-0">
                              {tx.gas_used.toLocaleString()} gas
                            </span>
                          )}

                          {/* Events count */}
                          <div className="flex items-center gap-1 shrink-0">
                            <Zap className="w-3 h-3 text-amber-500/60" />
                            <span className="text-[10px] text-zinc-400">{tx.event_count}</span>
                          </div>

                          {/* Time */}
                          <span className="text-[10px] text-zinc-600 shrink-0 w-14 text-right">
                            {tx.timestamp ? timeAgo(tx.timestamp) : '—'}
                          </span>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
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

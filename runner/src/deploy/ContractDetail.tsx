// ---------------------------------------------------------------------------
// ContractDetail — full detail page for a single contract
// ---------------------------------------------------------------------------

import { useState, useEffect } from 'react';
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
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  fetchContractDetail,
  fetchContractVersions,
  fetchContractEvents,
  fetchContractDependencies,
  fetchTokenMetadata,
} from './api';
import type {
  ContractInfo,
  ContractVersion,
  ContractEvent,
  TokenMetadata,
  DependencyData,
} from './api';
import ContractStats from './ContractStats';
import ContractCharts from './ContractCharts';
import DependencyGraph from './DependencyGraph';
import SourceTab from './SourceTab';
import DeploySection from './DeploySection';

// FlowIndex explorer link helpers
function flowIndexContractUrl(identifier: string, network: string): string {
  const base = network === 'testnet' ? 'https://testnet.flowindex.io' : 'https://flowindex.io';
  return `${base}/contracts/${identifier}`;
}

function flowIndexAddressUrl(address: string, network: string): string {
  const base = network === 'testnet' ? 'https://testnet.flowindex.io' : 'https://flowindex.io';
  const addr = address.startsWith('0x') ? address : `0x${address}`;
  return `${base}/account/${addr}`;
}

// Social icon + label mapping
const socialMeta: Record<string, { icon: LucideIcon; label: string }> = {
  twitter: { icon: Twitter, label: 'X' },
  discord: { icon: MessageCircle, label: 'Discord' },
  instagram: { icon: Instagram, label: 'Instagram' },
  telegram: { icon: Send, label: 'Telegram' },
  github: { icon: Github, label: 'GitHub' },
};

// ---------------------------------------------------------------------------

type TabId = 'insight' | 'source' | 'deployment';
const VALID_TABS: TabId[] = ['insight', 'source', 'deployment'];

export default function ContractDetail() {
  const { contractId } = useParams<{ contractId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  // Tab from URL query, default to 'insight'
  const rawTab = searchParams.get('tab') as TabId | null;
  const activeTab: TabId = rawTab && VALID_TABS.includes(rawTab) ? rawTab : 'insight';
  const setActiveTab = (tab: TabId) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tab === 'insight') next.delete('tab');
      else next.set('tab', tab);
      return next;
    }, { replace: true });
  };

  const [contract, setContract] = useState<ContractInfo | null>(null);
  const [versions, setVersions] = useState<ContractVersion[]>([]);
  const [events, setEvents] = useState<ContractEvent[]>([]);
  const [depData, setDepData] = useState<DependencyData>({ imports: [], dependents: [] });
  const [tokenMeta, setTokenMeta] = useState<TokenMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Default network — could be extracted from context later
  const network: string = 'mainnet';

  useEffect(() => {
    if (!contractId) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const identifier = contractId!;

        const [detail, vers, evts, deps] = await Promise.all([
          fetchContractDetail(identifier, network),
          fetchContractVersions(identifier, network),
          fetchContractEvents(identifier, network),
          fetchContractDependencies(identifier, network),
        ]);

        if (cancelled) return;

        setContract(detail);
        setVersions(vers);
        setEvents(evts);
        setDepData(deps);

        // Fetch token metadata if FT or NFT
        if (detail.kind === 'FT' || detail.kind === 'NFT') {
          const meta = await fetchTokenMetadata(identifier, detail.kind, network);
          if (!cancelled) setTokenMeta(meta);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load contract',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [contractId]);

  // Parse contract name from identifier (e.g., "A.0x1234.MyToken" -> "MyToken")
  const parts = contractId?.split('.') ?? [];
  const contractName = parts.length >= 3 ? parts.slice(2).join('.') : contractId;

  // Loading state
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-400">{error}</p>
          <Link
            to="/deploy"
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to Deploy
          </Link>
        </div>
      </div>
    );
  }

  const displayName = tokenMeta?.name || contract?.token_name || contractName;
  const logo = tokenMeta?.logo || contract?.token_logo;
  const isVerified = tokenMeta?.is_verified || contract?.is_verified;

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <Link
          to="/deploy"
          className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors mb-4"
        >
          <ArrowLeft className="w-3 h-3" />
          Back to Deploy
        </Link>

        {/* Banner + hero */}
        <div className={`relative rounded-xl overflow-hidden mb-4 ${tokenMeta?.banner ? 'min-h-[200px]' : ''} ${tokenMeta?.banner ? 'bg-zinc-800' : 'bg-gradient-to-r from-zinc-800/80 to-zinc-900'}`}>
          {tokenMeta?.banner && (
            <>
              <img
                src={tokenMeta.banner}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              {/* Dark gradient overlay for readability */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/60 to-black/30" />
            </>
          )}
          <div className={`relative z-10 px-6 ${tokenMeta?.banner ? 'pt-14 pb-6' : 'py-5'}`}>
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 rounded-xl shrink-0 ring-2 ring-white/10 shadow-lg overflow-hidden flex items-center justify-center bg-zinc-700/50">
                {logo ? (
                  <img
                    src={logo}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <Package className="w-7 h-7 text-zinc-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-bold text-white">
                    {displayName}
                  </h1>
                  {isVerified && (
                    <BadgeCheck className="w-5 h-5 text-blue-400" />
                  )}
                  {contract?.kind && (
                    <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                      {contract.kind}
                    </span>
                  )}
                  <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-white/10 text-zinc-300 border border-white/10">
                    {network}
                  </span>
                </div>
                {displayName !== contractName && (
                  <p className="text-xs text-zinc-300/70 font-mono mt-1">
                    {contractName}
                  </p>
                )}
                <a
                  href={flowIndexContractUrl(contractId || '', network)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-blue-400 font-mono mt-0.5 transition-colors"
                >
                  {contractId}
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>

                {/* Description — right next to title */}
                {tokenMeta?.description && (
                  <p className="mt-2 text-sm text-zinc-300/80 leading-relaxed max-w-2xl">
                    {tokenMeta.description}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Links & socials */}
        {(tokenMeta?.external_url || (tokenMeta?.socials && Object.keys(tokenMeta.socials).length > 0)) && (
          <div className="flex items-center gap-3 mt-3">
            {tokenMeta?.external_url && (
              <a
                href={tokenMeta.external_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <Globe className="w-3.5 h-3.5" />
                {tokenMeta.external_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              </a>
            )}
            {tokenMeta?.socials && Object.entries(tokenMeta.socials).map(([key, url]) => {
              const meta = socialMeta[key];
              const Icon = meta?.icon || ExternalLink;
              const label = meta?.label || key;
              return (
                <a
                  key={key}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-200 transition-colors"
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </a>
              );
            })}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-800/50 w-fit">
        {([
          { id: 'insight' as const, label: 'Insight', icon: BarChart3 },
          { id: 'source' as const, label: 'Source', icon: Code2 },
          { id: 'deployment' as const, label: 'Deployment', icon: Rocket },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === tab.id
                ? 'bg-zinc-700 text-zinc-100 shadow-sm'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'insight' ? (
        <>
          {/* Stats */}
          <ContractStats
            holders={tokenMeta?.holder_count ?? 0}
            dependents={contract?.dependent_count ?? 0}
            version={contract?.version ?? 1}
            firstDeployed={
              contract?.first_seen_height
                ? `Block #${contract.first_seen_height.toLocaleString()}`
                : 'Unknown'
            }
            totalSupply={tokenMeta?.total_supply}
            kind={contract?.kind}
          />

          {/* Charts */}
          <ContractCharts versions={versions} />

          {/* Events */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-3.5 h-3.5 text-zinc-500" />
              <h3 className="text-xs font-medium text-zinc-400">
                Event Types
                <span className="ml-2 text-zinc-600">({events.length})</span>
              </h3>
            </div>
            {events.length > 0 ? (
              <div className="space-y-1.5">
                {events.map((e) => (
                  <div
                    key={e.type}
                    className="flex items-center gap-2 px-3 py-1.5 rounded bg-zinc-800/50 text-xs"
                  >
                    <span className="text-zinc-300 font-mono">{e.name}</span>
                    <span className="text-zinc-600 font-mono text-[10px] truncate">
                      {e.type}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-600">No events defined</p>
            )}
          </div>

          {/* Dependencies — ReactFlow graph */}
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
        </>
      ) : activeTab === 'source' ? (
        <SourceTab
          contract={contract}
          contractName={contractName || ''}
          contractId={contractId || ''}
          versions={versions}
          network={network}
        />
      ) : (
        /* Deployment tab */
        <DeploySection projectId={contractId || ''} />
      )}
    </div>
  );
}

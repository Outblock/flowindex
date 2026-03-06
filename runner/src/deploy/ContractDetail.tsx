// ---------------------------------------------------------------------------
// ContractDetail — full detail page for a single contract
// ---------------------------------------------------------------------------

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Loader2,
  Zap,
  Package,
} from 'lucide-react';
import {
  fetchContractDetail,
  fetchContractVersions,
  fetchContractEvents,
  fetchContractDependencies,
  fetchHolderCount,
} from './api';
import type {
  ContractInfo,
  ContractVersion,
  ContractEvent,
  ContractDependency,
} from './api';
import ContractStats from './ContractStats';
import ContractCharts from './ContractCharts';
import DeploySection from './DeploySection';

// ---------------------------------------------------------------------------

export default function ContractDetail() {
  const { contractId } = useParams<{ contractId: string }>();

  const [contract, setContract] = useState<ContractInfo | null>(null);
  const [versions, setVersions] = useState<ContractVersion[]>([]);
  const [events, setEvents] = useState<ContractEvent[]>([]);
  const [dependencies, setDependencies] = useState<ContractDependency[]>([]);
  const [holders, setHolders] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Default network — could be extracted from context later
  const network = 'mainnet';

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
        setDependencies(deps);

        // Fetch holder count if FT or NFT
        if (detail.kind === 'FT' || detail.kind === 'NFT') {
          const count = await fetchHolderCount(identifier, detail.kind, network);
          if (!cancelled) setHolders(count);
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

        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-zinc-100">
            {contractName}
          </h1>
          {contract?.kind && (
            <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
              {contract.kind}
            </span>
          )}
          <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-zinc-700/50 text-zinc-400 border border-zinc-700">
            {network}
          </span>
        </div>

        <p className="mt-1 text-xs text-zinc-500 font-mono">{contractId}</p>
      </div>

      {/* Stats */}
      <ContractStats
        holders={holders}
        dependents={contract?.dependent_count ?? 0}
        version={contract?.version ?? 1}
        firstDeployed={
          contract?.first_seen_height
            ? `Block #${contract.first_seen_height.toLocaleString()}`
            : 'Unknown'
        }
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

      {/* Dependencies */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Package className="w-3.5 h-3.5 text-zinc-500" />
          <h3 className="text-xs font-medium text-zinc-400">
            Dependencies
            <span className="ml-2 text-zinc-600">
              ({dependencies.length})
            </span>
          </h3>
        </div>
        {dependencies.length > 0 ? (
          <div className="space-y-1.5">
            {dependencies.map((d) => (
              <div
                key={`${d.address}.${d.name}`}
                className="flex items-center gap-2 px-3 py-1.5 rounded bg-zinc-800/50 text-xs"
              >
                <span className="text-zinc-300">{d.name}</span>
                <span className="text-zinc-600 font-mono text-[10px]">
                  A.{d.address}.{d.name}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-600">No dependencies</p>
        )}
      </div>

      {/* CD Pipeline */}
      <DeploySection projectId={contractId || ''} />
    </div>
  );
}

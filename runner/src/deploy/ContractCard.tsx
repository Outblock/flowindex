// ---------------------------------------------------------------------------
// ContractCard — Vercel-style project card for a single contract
// ---------------------------------------------------------------------------

import { Link } from 'react-router-dom';
import {
  Box,
  Coins,
  Image,
  CheckCircle,
  XCircle,
  Clock,
  BadgeCheck,
  GitBranch,
  Package,
} from 'lucide-react';
import type { ContractInfo, TokenMetadata } from './api';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  contract: ContractInfo;
  network: string;
  tokenMetadata?: TokenMetadata;
  lastDeployStatus?: 'success' | 'failed' | 'running' | null;
  lastDeployTime?: string;
  hasCD: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kindIcon(kind?: string) {
  switch (kind) {
    case 'FT':
      return <Coins className="w-8 h-8 text-amber-400" />;
    case 'NFT':
      return <Image className="w-8 h-8 text-purple-400" />;
    default:
      return <Box className="w-8 h-8 text-zinc-500" />;
  }
}

function statusDot(status?: 'success' | 'failed' | 'running' | null) {
  switch (status) {
    case 'success':
      return <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />;
    case 'failed':
      return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    case 'running':
      return <Clock className="w-3.5 h-3.5 text-amber-400 animate-pulse" />;
    default:
      return null;
  }
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ContractCard({
  contract,
  network,
  tokenMetadata,
  lastDeployStatus,
  lastDeployTime,
  hasCD,
}: Props) {
  const identifier = `A.${contract.address}.${contract.name}`;
  const displayName = tokenMetadata?.name || contract.token_name || contract.name;
  const logo = tokenMetadata?.logo || contract.token_logo;
  const isVerified = tokenMetadata?.is_verified || contract.is_verified;

  // Collect inline stats
  const stats: { label: string; value: string }[] = [];
  if (tokenMetadata && tokenMetadata.holder_count > 0) {
    stats.push({ label: 'Holders', value: formatNumber(tokenMetadata.holder_count) });
  }
  if (tokenMetadata?.total_supply != null && tokenMetadata.total_supply > 0) {
    stats.push({
      label: contract.kind === 'NFT' ? 'Minted' : 'Supply',
      value: formatNumber(tokenMetadata.total_supply),
    });
  }
  if (contract.dependent_count > 0) {
    stats.push({ label: 'Imports', value: formatNumber(contract.dependent_count) });
  }

  return (
    <Link
      to={`/deploy/${identifier}`}
      className="flex flex-col border border-zinc-800 rounded-lg bg-zinc-900/50 hover:border-zinc-700 transition-colors"
    >
      {/* Top section */}
      <div className="p-4 flex-1">
        {/* Row 1: Logo + name */}
        <div className="flex items-center gap-3">
          {logo ? (
            <img
              src={logo}
              alt=""
              className="w-9 h-9 rounded-lg shrink-0 object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            kindIcon(contract.kind)
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-semibold text-zinc-100 truncate">
                {displayName}
              </h3>
              {isVerified && (
                <BadgeCheck className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              )}
              {statusDot(lastDeployStatus)}
            </div>
            {displayName !== contract.name && (
              <p className="text-[11px] text-zinc-500 font-mono truncate mt-0.5">
                {contract.name}
              </p>
            )}
          </div>
        </div>

        {/* Row 2: Inline stats */}
        {stats.length > 0 && (
          <div className="flex items-center gap-4 mt-3">
            {stats.map((s) => (
              <div key={s.label} className="flex items-center gap-1.5">
                <span className="text-[10px] text-zinc-500">{s.label}</span>
                <span className="text-xs font-medium text-zinc-300">{s.value}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom section — separated by border */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-zinc-800/60 text-[11px]">
        <div className="flex items-center gap-3">
          {/* Kind badge */}
          <span className={`px-1.5 py-0.5 rounded font-medium ${
            contract.kind === 'FT'
              ? 'bg-amber-500/15 text-amber-400'
              : contract.kind === 'NFT'
                ? 'bg-purple-500/15 text-purple-400'
                : 'text-zinc-400'
          }`}>
            {contract.kind || 'Contract'}
          </span>

          {/* CD status */}
          {hasCD ? (
            <span className="flex items-center gap-1 text-zinc-500">
              <GitBranch className="w-3 h-3" />
              {lastDeployTime || 'Connected'}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-zinc-600">
              <Package className="w-3 h-3" />
              No CD
            </span>
          )}
        </div>

        {/* Network dot */}
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${
              network === 'mainnet' ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
          />
          <span className="text-zinc-500">{network}</span>
        </div>
      </div>
    </Link>
  );
}

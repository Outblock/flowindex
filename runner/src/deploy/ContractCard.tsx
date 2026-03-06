// ---------------------------------------------------------------------------
// ContractCard — card component for a single contract in the grid
// ---------------------------------------------------------------------------

import { Link } from 'react-router-dom';
import {
  Box,
  Coins,
  Image,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
} from 'lucide-react';
import type { ContractInfo } from './api';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  contract: ContractInfo;
  network: string;
  holderCount?: number;
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
      return <Coins className="w-5 h-5 text-amber-400" />;
    case 'NFT':
      return <Image className="w-5 h-5 text-purple-400" />;
    default:
      return <Box className="w-5 h-5 text-zinc-400" />;
  }
}

function kindBorderColor(kind?: string) {
  switch (kind) {
    case 'FT':
      return 'border-l-amber-500/40';
    case 'NFT':
      return 'border-l-purple-500/40';
    default:
      return 'border-l-zinc-600/40';
  }
}

function statusIcon(status?: 'success' | 'failed' | 'running' | null) {
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

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ContractCard({
  contract,
  network,
  holderCount,
  lastDeployStatus,
  lastDeployTime,
  hasCD,
}: Props) {
  const identifier = `A.${contract.address}.${contract.name}`;

  return (
    <Link
      to={`/deploy/${identifier}`}
      className={`block border border-zinc-800 ${kindBorderColor(contract.kind)} border-l-2 rounded-lg bg-zinc-900/50 hover:bg-zinc-800/50 transition-colors p-4`}
    >
      {/* Header: icon + name + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {kindIcon(contract.kind)}
          <h3 className="text-sm font-medium text-zinc-100 truncate">
            {contract.name}
          </h3>
        </div>
        {statusIcon(lastDeployStatus)}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 mt-3">
        <div>
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
            Kind
          </span>
          <p className="text-xs text-zinc-300">
            {contract.kind || 'Contract'}
            {contract.version > 1 && (
              <span className="text-zinc-500 ml-1">v{contract.version}</span>
            )}
          </p>
        </div>

        {(holderCount ?? 0) > 0 && (
          <div>
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
              Holders
            </span>
            <p className="text-xs text-zinc-300">
              {(holderCount ?? 0).toLocaleString()}
            </p>
          </div>
        )}

        {contract.dependent_count > 0 && (
          <div>
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
              Dependents
            </span>
            <p className="text-xs text-zinc-300">
              {contract.dependent_count.toLocaleString()}
            </p>
          </div>
        )}

        {lastDeployTime && (
          <div>
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
              Last Deploy
            </span>
            <p className="text-xs text-zinc-300">
              {formatTimeAgo(lastDeployTime)}
            </p>
          </div>
        )}
      </div>

      {/* CD warning */}
      {!hasCD && (
        <div className="flex items-center gap-1.5 mt-3 pt-2.5 border-t border-zinc-800/50">
          <AlertTriangle className="w-3 h-3 text-amber-500/70 shrink-0" />
          <span className="text-[10px] text-zinc-500">No CD pipeline</span>
        </div>
      )}

      {/* Network badge */}
      <div className="flex items-center gap-1.5 mt-2">
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${
            network === 'mainnet' ? 'bg-emerald-500' : 'bg-amber-500'
          }`}
        />
        <span className="text-[10px] text-zinc-500">{network}</span>
      </div>
    </Link>
  );
}

import { Link } from '@tanstack/react-router';
import { MapPin, ArrowRightLeft, Sparkles, Flame } from 'lucide-react';
import { AddressLink } from './AddressLink';
import { normalizeAddress } from './account/accountUtils';
import {
  Timeline,
  TimelineItem,
  TimelineConnector,
  TimelineDot,
  TimelineContent,
} from './ui/Timeline';

interface NFTTimelineProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transfers: any[];
  currentOwner?: string;
  loading?: boolean;
}

function isNullAddress(addr: string | null | undefined): boolean {
  if (!addr) return true;
  const normalized = addr.toLowerCase().replace(/^0x/, '');
  return normalized === '' || normalized === '0' || /^0+$/.test(normalized);
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getEventType(t: any): 'mint' | 'burn' | 'transfer' {
  if (isNullAddress(t?.sender)) return 'mint';
  if (isNullAddress(t?.receiver)) return 'burn';
  return 'transfer';
}

const EVENT_CONFIG = {
  mint: { label: 'Minted', icon: Sparkles, variant: 'success' as const },
  burn: { label: 'Burned', icon: Flame, variant: 'destructive' as const },
  transfer: { label: 'Transferred', icon: ArrowRightLeft, variant: 'info' as const },
};

export function NFTTimeline({ transfers, currentOwner, loading }: NFTTimelineProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-dashed border-zinc-900 dark:border-white rounded-full animate-spin" />
      </div>
    );
  }

  if (!transfers || transfers.length === 0) {
    return (
      <div className="text-center text-zinc-500 italic py-12 text-sm">
        No transfer history available.
      </div>
    );
  }

  const owner = currentOwner ? normalizeAddress(currentOwner) : null;

  return (
    <Timeline>
      {/* Current Owner — always at top */}
      {owner && (
        <TimelineItem>
          <TimelineConnector />
          <TimelineDot variant="success">
            <MapPin className="w-3 h-3" />
          </TimelineDot>
          <TimelineContent>
            <p className="text-[10px] uppercase tracking-wider font-bold text-emerald-600 dark:text-emerald-400 mb-0.5">
              Current Owner
            </p>
            <AddressLink address={owner} prefixLen={20} suffixLen={0} className="text-sm" />
          </TimelineContent>
        </TimelineItem>
      )}

      {/* Transfer events (newest first from API) */}
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {transfers.map((t: any, i: number) => {
        const eventType = getEventType(t);
        const config = EVENT_CONFIG[eventType];
        const Icon = config.icon;
        const tx = t?.transaction_hash ? normalizeAddress(t.transaction_hash) : '';
        const from = t?.sender ? normalizeAddress(t.sender) : '';
        const to = t?.receiver ? normalizeAddress(t.receiver) : '';
        const timestamp = t?.timestamp || t?.block_timestamp || '';
        const height = Number(t?.block_height || 0);
        const isLast = i === transfers.length - 1;

        return (
          <TimelineItem key={`${tx}-${from}-${to}-${i}`}>
            {!isLast && <TimelineConnector />}
            <TimelineDot variant={config.variant}>
              <Icon className="w-3 h-3" />
            </TimelineDot>
            <TimelineContent>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-bold uppercase tracking-wider ${
                  config.variant === 'success' ? 'text-emerald-600 dark:text-emerald-400' :
                  config.variant === 'destructive' ? 'text-red-600 dark:text-red-400' :
                  'text-blue-600 dark:text-blue-400'
                }`}>
                  {config.label}
                </span>
                {timestamp && (
                  <span className="text-[10px] text-zinc-400">{timeAgo(timestamp)}</span>
                )}
              </div>

              <div className="mt-1 text-sm">
                {eventType === 'mint' ? (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-zinc-500 text-xs">to</span>
                    <AddressLink address={to} className="text-xs" />
                  </div>
                ) : eventType === 'burn' ? (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-zinc-500 text-xs">from</span>
                    <AddressLink address={from} className="text-xs" />
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <AddressLink address={from} className="text-xs" />
                    <span className="text-zinc-400 text-xs">&rarr;</span>
                    <AddressLink address={to} className="text-xs" />
                  </div>
                )}
              </div>

              {/* Tx link + block */}
              <div className="mt-1 flex items-center gap-3 text-[10px] text-zinc-400">
                {tx && (
                  <Link
                    to="/txs/$txId"
                    params={{ txId: tx }}
                    search={{ tab: undefined }}
                    className="font-mono text-nothing-green-dark dark:text-nothing-green hover:underline"
                  >
                    {tx.slice(0, 16)}...
                  </Link>
                )}
                {height > 0 && (
                  <span className="font-mono">Block {height.toLocaleString()}</span>
                )}
              </div>
            </TimelineContent>
          </TimelineItem>
        );
      })}
    </Timeline>
  );
}

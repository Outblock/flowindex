import { useState, useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { Whale, ArrowRight, ArrowDown, ArrowUp, Repeat, Zap } from 'lucide-react';
import { fetchBigTransfers, type BigTransfer } from '../api/heyapi';

const TYPE_CONFIG: Record<string, { label: string; icon: typeof Whale; color: string }> = {
  mint: { label: 'Mint', icon: ArrowDown, color: 'text-green-500' },
  burn: { label: 'Burn', icon: ArrowUp, color: 'text-red-500' },
  transfer: { label: 'Transfer', icon: ArrowRight, color: 'text-blue-500' },
  swap: { label: 'Swap', icon: Repeat, color: 'text-purple-500' },
  bridge: { label: 'Bridge', icon: Zap, color: 'text-orange-500' },
};

function formatUSD(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatAmount(amount: string): string {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return num.toFixed(2);
}

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatAddr(addr: string, len = 6): string {
  if (!addr) return '—';
  const hex = addr.startsWith('0x') ? addr : `0x${addr}`;
  if (hex.length <= len * 2 + 4) return hex;
  return `${hex.slice(0, len + 2)}…${hex.slice(-len)}`;
}

function TransferRow({ tx, compact = false }: { tx: BigTransfer; compact?: boolean }) {
  const cfg = TYPE_CONFIG[tx.type] || TYPE_CONFIG.transfer;
  const Icon = cfg.icon;
  return (
    <Link
      to={`/tx/0x${tx.tx_id}` as any}
      className="flex items-center gap-3 px-3 py-3 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors border-b border-zinc-100 dark:border-white/5 last:border-b-0"
    >
      <div className={`p-1.5 border border-zinc-200 dark:border-white/10 rounded-sm ${cfg.color}`}>
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-mono font-bold uppercase ${cfg.color}`}>{cfg.label}</span>
          <span className="text-xs font-mono text-zinc-900 dark:text-white font-bold">
            {formatAmount(tx.amount)} {tx.token_symbol}
          </span>
          <span className="text-xs font-mono font-bold text-nothing-green-dark dark:text-nothing-green">
            {formatUSD(tx.usd_value)}
          </span>
        </div>
        {!compact && (
          <div className="flex items-center gap-1 mt-0.5 text-[10px] font-mono text-zinc-400 dark:text-gray-500">
            <span>{formatAddr(tx.from_address)}</span>
            <ArrowRight className="h-2.5 w-2.5" />
            <span>{formatAddr(tx.to_address)}</span>
          </div>
        )}
      </div>
      <span className="text-[10px] font-mono text-zinc-400 dark:text-gray-500 flex-shrink-0">
        {timeAgo(tx.timestamp)}
      </span>
    </Link>
  );
}

export function BigTransfersCompact() {
  const [transfers, setTransfers] = useState<BigTransfer[] | null>(null);

  useEffect(() => {
    fetchBigTransfers({ limit: 5 }).then(setTransfers).catch(() => setTransfers([]));
    const interval = setInterval(() => {
      fetchBigTransfers({ limit: 5 }).then(setTransfers);
    }, 120_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10">
      <div className="flex items-center justify-between p-6 pb-0">
        <div className="flex items-center space-x-3">
          <Whale className="h-5 w-5 text-nothing-green-dark dark:text-nothing-green" />
          <h2 className="text-lg font-bold text-zinc-900 dark:text-white uppercase tracking-widest">Whale Alert</h2>
        </div>
        <Link to="/analytics" search={{ tab: 'whales' } as any} className="text-xs text-nothing-green-dark dark:text-nothing-green uppercase tracking-widest hover:underline font-mono">
          View All &rarr;
        </Link>
      </div>
      <div className="p-6 pt-4">
        {transfers === null ? (
          <div className="flex flex-col">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-3 border-b border-zinc-100 dark:border-white/5 last:border-b-0">
                <div className="w-7 h-7 bg-zinc-200 dark:bg-white/10 animate-pulse rounded-sm" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-32 bg-zinc-200 dark:bg-white/10 rounded-sm animate-pulse" />
                  <div className="h-2.5 w-48 bg-zinc-100 dark:bg-white/5 rounded-sm animate-pulse" />
                </div>
                <div className="h-3 w-10 bg-zinc-100 dark:bg-white/5 rounded-sm animate-pulse" />
              </div>
            ))}
          </div>
        ) : transfers.length === 0 ? (
          <p className="text-xs text-zinc-400 dark:text-gray-500 font-mono">No large transfers in the last 7 days.</p>
        ) : (
          <div className="flex flex-col">
            {transfers.map((tx, i) => (
              <TransferRow key={`${tx.tx_id}-${i}`} tx={tx} compact />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const TYPE_FILTERS = [
  { label: 'All', value: '' },
  { label: 'Mint', value: 'mint' },
  { label: 'Burn', value: 'burn' },
  { label: 'Transfer', value: 'transfer' },
  { label: 'Swap', value: 'swap' },
];

export function BigTransfersFull() {
  const [transfers, setTransfers] = useState<BigTransfer[] | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 25;

  useEffect(() => {
    setTransfers(null);
    fetchBigTransfers({
      limit: pageSize + 1,
      offset: page * pageSize,
      type: typeFilter || undefined,
    }).then(setTransfers).catch(() => setTransfers([]));
  }, [typeFilter, page]);

  const hasMore = (transfers?.length ?? 0) > pageSize;
  const displayTransfers = transfers?.slice(0, pageSize) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {TYPE_FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => { setTypeFilter(f.value); setPage(0); }}
            className={`px-3 py-1 text-xs font-mono uppercase tracking-wider border transition-colors ${
              typeFilter === f.value
                ? 'bg-zinc-900 dark:bg-white text-white dark:text-black border-zinc-900 dark:border-white'
                : 'bg-transparent text-zinc-600 dark:text-gray-400 border-zinc-200 dark:border-white/10 hover:border-zinc-400 dark:hover:border-white/30'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10">
        {transfers === null ? (
          <div className="p-6">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-3 border-b border-zinc-100 dark:border-white/5 last:border-b-0">
                <div className="w-7 h-7 bg-zinc-200 dark:bg-white/10 animate-pulse rounded-sm" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-40 bg-zinc-200 dark:bg-white/10 rounded-sm animate-pulse" />
                  <div className="h-2.5 w-56 bg-zinc-100 dark:bg-white/5 rounded-sm animate-pulse" />
                </div>
                <div className="h-3 w-12 bg-zinc-100 dark:bg-white/5 rounded-sm animate-pulse" />
              </div>
            ))}
          </div>
        ) : displayTransfers.length === 0 ? (
          <div className="p-6">
            <p className="text-xs text-zinc-400 dark:text-gray-500 font-mono">No large transfers found.</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {displayTransfers.map((tx, i) => (
              <TransferRow key={`${tx.tx_id}-${i}`} tx={tx} />
            ))}
          </div>
        )}
      </div>

      {(page > 0 || hasMore) && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-4 py-1.5 text-xs font-mono uppercase border border-zinc-200 dark:border-white/10 disabled:opacity-30 hover:border-zinc-400 dark:hover:border-white/30 transition-colors"
          >
            Prev
          </button>
          <span className="text-xs font-mono text-zinc-400 dark:text-gray-500">Page {page + 1}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={!hasMore}
            className="px-4 py-1.5 text-xs font-mono uppercase border border-zinc-200 dark:border-white/10 disabled:opacity-30 hover:border-zinc-400 dark:hover:border-white/30 transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

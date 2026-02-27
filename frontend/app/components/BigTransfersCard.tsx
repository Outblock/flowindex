import { useState, useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import Avatar from 'boring-avatars';
import { Fish, ArrowRight } from 'lucide-react';
import { fetchBigTransfers, type BigTransfer } from '../api/heyapi';
import { colorsFromAddress } from './AddressLink';

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(2);
}

function formatUSD(value: number): string {
  return '$' + formatCompact(value);
}

function formatAmount(amount: string): string {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  return formatCompact(num);
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

function formatAddr(addr: string): string {
  if (!addr) return '';
  const hex = addr.startsWith('0x') ? addr : `0x${addr}`;
  if (hex.length <= 16) return hex;
  return `${hex.slice(0, 8)}...${hex.slice(-4)}`;
}

function avatarVariant(addr: string): 'beam' | 'bauhaus' | 'pixel' {
  const hex = addr.replace(/^0x/, '');
  if (hex.length <= 16) return 'beam';
  if (/^0{10,}/.test(hex)) return 'bauhaus';
  return 'pixel';
}

function TokenIcon({ logo, symbol, size = 24 }: { logo?: string; symbol: string; size?: number }) {
  if (logo) {
    return (
      <img
        src={logo}
        alt={symbol}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }
  return (
    <div
      className="rounded-full bg-nothing-green/20 text-nothing-green-dark dark:text-nothing-green text-[10px] font-bold font-mono flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {(symbol || '?').charAt(0).toUpperCase()}
    </div>
  );
}

function AddressWithAvatar({ address }: { address: string }) {
  if (!address) return <span className="text-zinc-400 dark:text-gray-500">—</span>;
  const normalized = address.startsWith('0x') ? address : `0x${address}`;
  const colors = colorsFromAddress(normalized);
  return (
    <Link
      to={`/accounts/${address}` as any}
      className="inline-flex items-center gap-1 hover:underline"
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
    >
      <Avatar size={10} name={normalized} variant={avatarVariant(normalized)} colors={colors} />
      <span>{formatAddr(address)}</span>
    </Link>
  );
}

function TransferRow({ tx, compact = false }: { tx: BigTransfer; compact?: boolean }) {
  return (
    <Link
      to={`/tx/0x${tx.tx_id}` as any}
      className="flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors border-b border-zinc-100 dark:border-white/5 last:border-b-0"
    >
      <TokenIcon logo={tx.token_logo} symbol={tx.token_symbol} size={compact ? 20 : 24} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-mono text-zinc-900 dark:text-white font-bold">
            {formatAmount(tx.amount)}
          </span>
          <span className="text-xs font-mono text-zinc-500 dark:text-gray-400 uppercase">
            {tx.token_symbol}
          </span>
          <span className="text-[10px] font-mono text-zinc-400 dark:text-gray-500">≈</span>
          <span className="text-xs font-mono font-bold text-nothing-green-dark dark:text-nothing-green">
            {formatUSD(tx.usd_value)}
          </span>
        </div>
        <div className="flex items-center gap-1 mt-0.5 text-[10px] font-mono text-zinc-400 dark:text-gray-500">
          <span>From</span>
          <AddressWithAvatar address={tx.from_address} />
          <ArrowRight className="h-2.5 w-2.5 mx-0.5" />
          <span>To</span>
          <AddressWithAvatar address={tx.to_address} />
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
        <span className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded-sm ${
          tx.type === 'mint' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
          tx.type === 'burn' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
          tx.type === 'swap' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
          tx.type === 'stake' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
          'bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-gray-400'
        }`}>
          {tx.type}
        </span>
        <span className="text-[9px] font-mono text-zinc-400 dark:text-gray-500">
          {timeAgo(tx.timestamp)}
        </span>
      </div>
    </Link>
  );
}

// ============================================
// Compact variant for Home page (last 5 items)
// ============================================
export function BigTransfersCompact({ initialData }: { initialData?: BigTransfer[] | null } = {}) {
  const [transfers, setTransfers] = useState<BigTransfer[] | null>(initialData ?? null);

  useEffect(() => {
    if (!initialData?.length) {
      fetchBigTransfers({ limit: 5 }).then(setTransfers).catch(() => setTransfers([]));
    }
    const interval = setInterval(() => {
      fetchBigTransfers({ limit: 5 }).then(setTransfers);
    }, 120_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 h-full">
      <div className="flex items-center justify-between p-6 pb-0">
        <div className="flex items-center space-x-3">
          <Fish className="h-5 w-5 text-nothing-green-dark dark:text-nothing-green" />
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
              <div key={i} className="flex items-center gap-3 px-3 py-2.5 border-b border-zinc-100 dark:border-white/5 last:border-b-0">
                <div className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-white/10 animate-pulse flex-shrink-0" />
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

// ============================================
// Full variant for Analytics page (paginated, filterable)
// ============================================
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
              <div key={i} className="flex items-center gap-3 py-2.5 border-b border-zinc-100 dark:border-white/5 last:border-b-0">
                <div className="w-6 h-6 rounded-full bg-zinc-200 dark:bg-white/10 animate-pulse" />
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

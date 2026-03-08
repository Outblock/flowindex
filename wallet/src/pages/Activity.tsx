import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  cn,
  formatShort,
  deriveActivityType,
  buildSummaryLine,
  formatRelativeTime,
} from '@flowindex/flow-ui';
import {
  ArrowRightLeft,
  ArrowDownLeft,
  ShoppingBag,
  UserPlus,
  Key,
  FileCode,
  Zap,
  Coins,
  Clock,
  ExternalLink,
  Loader2,
  History,
} from 'lucide-react';
import { useWallet } from '@/hooks/useWallet';
import {
  getAccountTransactions,
  getAccountFtTransfers,
  type AccountTransaction,
  type FtTransfer,
} from '@/api/flow';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20;

type FilterTab = 'all' | 'ft' | 'nft';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function activityIcon(type: string) {
  const iconMap: Record<string, React.ElementType> = {
    ft: ArrowRightLeft,
    nft: ShoppingBag,
    account: UserPlus,
    key: Key,
    deploy: FileCode,
    evm: Zap,
    swap: ArrowRightLeft,
    staking: Coins,
    marketplace: ShoppingBag,
    scheduled: Clock,
    contract: FileCode,
    tx: ArrowRightLeft,
  };
  return iconMap[type] ?? ArrowRightLeft;
}

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded-2xl bg-wallet-surface', className)} />
  );
}

// ---------------------------------------------------------------------------
// Skeleton row
// ---------------------------------------------------------------------------

function TransactionSkeleton() {
  return (
    <div className="flex items-center gap-3 py-3.5 border-b border-wallet-border/50">
      <Skeleton className="w-10 h-10 rounded-2xl shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-28 rounded-xl" />
        <Skeleton className="h-3 w-40 rounded-xl" />
      </div>
      <Skeleton className="h-3 w-14 shrink-0 rounded-xl" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transaction row
// ---------------------------------------------------------------------------

function TransactionRow({ tx }: { tx: AccountTransaction }) {
  const activity = deriveActivityType(tx);
  const Icon = activityIcon(activity.type);
  const summary = buildSummaryLine(tx);
  const time = formatRelativeTime(tx.timestamp);

  return (
    <a
      href={`https://flowindex.io/tx/${tx.id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 py-3.5 border-b border-wallet-border/50 last:border-0 hover:bg-wallet-surface-hover rounded-2xl px-3 -mx-3 transition-colors group"
    >
      <div
        className={cn(
          'w-10 h-10 rounded-2xl flex items-center justify-center shrink-0',
          activity.bgColor,
        )}
      >
        <Icon className={cn('w-[18px] h-[18px]', activity.color)} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white">{activity.label}</p>
        <p className="text-xs text-wallet-muted truncate mt-0.5">
          {summary || formatShort(tx.id ?? '')}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-xs text-wallet-muted">{time}</span>
        <ExternalLink className="w-3.5 h-3.5 text-wallet-muted/50 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </a>
  );
}

// ---------------------------------------------------------------------------
// FT Transfer row
// ---------------------------------------------------------------------------

function FtTransferRow({ transfer }: { transfer: FtTransfer }) {
  const isSend = transfer.direction === 'out' || transfer.classifier === 'sender';
  const time = formatRelativeTime(transfer.timestamp);
  const symbol = transfer.token?.symbol ?? transfer.token?.name ?? '';
  const amount = transfer.amount ?? 0;
  const counterparty = isSend ? transfer.receiver : transfer.sender;

  return (
    <a
      href={`https://flowindex.io/tx/${transfer.transaction_hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 py-3.5 border-b border-wallet-border/50 last:border-0 hover:bg-wallet-surface-hover rounded-2xl px-3 -mx-3 transition-colors group"
    >
      <div
        className={cn(
          'w-10 h-10 rounded-2xl flex items-center justify-center shrink-0',
          isSend ? 'bg-red-500/10' : 'bg-emerald-500/10',
        )}
      >
        {isSend ? (
          <ArrowRightLeft className="w-[18px] h-[18px] text-red-400" />
        ) : (
          <ArrowDownLeft className="w-[18px] h-[18px] text-emerald-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-white">
            {isSend ? 'Sent' : 'Received'}
          </p>
          {symbol && (
            <span className="text-xs text-wallet-muted">{symbol}</span>
          )}
        </div>
        <p className="text-xs text-wallet-muted truncate mt-0.5">
          {counterparty
            ? `${isSend ? 'To' : 'From'} 0x${formatShort(counterparty, 6, 4)}`
            : formatShort(transfer.transaction_hash ?? '')}
        </p>
      </div>
      <div className="flex flex-col items-end shrink-0 gap-0.5">
        <span
          className={cn(
            'text-sm font-mono font-medium',
            isSend ? 'text-red-400' : 'text-emerald-400',
          )}
        >
          {isSend ? '-' : '+'}
          {amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-wallet-muted">{time}</span>
          <ExternalLink className="w-3.5 h-3.5 text-wallet-muted/50 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Filter tabs
// ---------------------------------------------------------------------------

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'ft', label: 'FT Transfers' },
  { key: 'nft', label: 'NFT Transfers' },
];

function FilterTabs({
  active,
  onChange,
}: {
  active: FilterTab;
  onChange: (tab: FilterTab) => void;
}) {
  return (
    <div className="flex gap-1.5 bg-wallet-surface rounded-2xl p-1">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            'px-3.5 py-2 rounded-xl text-sm font-medium transition-colors',
            active === tab.key
              ? 'bg-wallet-surface-hover text-white'
              : 'text-wallet-muted hover:text-white',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Activity() {
  const { activeAccount, network, loading: walletLoading } = useWallet();

  const address =
    network === 'testnet'
      ? activeAccount?.flowAddressTestnet
      : activeAccount?.flowAddress;

  const [tab, setTab] = useState<FilterTab>('all');
  const [transactions, setTransactions] = useState<AccountTransaction[]>([]);
  const [ftTransfers, setFtTransfers] = useState<FtTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInitial = useCallback(async () => {
    if (!address) {
      setTransactions([]);
      setFtTransfers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setHasMore(false);

    try {
      if (tab === 'all' || tab === 'nft') {
        const page = await getAccountTransactions(address, { limit: PAGE_SIZE, offset: 0 });
        setTransactions(page.data);
        setHasMore(page.hasMore);
        setFtTransfers([]);
      } else {
        const page = await getAccountFtTransfers(address, { limit: PAGE_SIZE, offset: 0 });
        setFtTransfers(page.data);
        setHasMore(page.hasMore);
        setTransactions([]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load activity';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [address, tab]);

  useEffect(() => {
    fetchInitial();
  }, [fetchInitial]);

  const loadMore = useCallback(async () => {
    if (!address || loadingMore) return;

    setLoadingMore(true);
    try {
      if (tab === 'all' || tab === 'nft') {
        const offset = transactions.length;
        const page = await getAccountTransactions(address, { limit: PAGE_SIZE, offset });
        setTransactions((prev) => [...prev, ...page.data]);
        setHasMore(page.hasMore);
      } else {
        const offset = ftTransfers.length;
        const page = await getAccountFtTransfers(address, { limit: PAGE_SIZE, offset });
        setFtTransfers((prev) => [...prev, ...page.data]);
        setHasMore(page.hasMore);
      }
    } catch {
      // silently fail on load more
    } finally {
      setLoadingMore(false);
    }
  }, [address, tab, transactions.length, ftTransfers.length, loadingMore]);

  const handleTabChange = useCallback((newTab: FilterTab) => {
    setTab(newTab);
    setTransactions([]);
    setFtTransfers([]);
    setHasMore(false);
  }, []);

  // No account
  if (!walletLoading && !address) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-white">Activity</h1>
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="w-14 h-14 rounded-2xl bg-wallet-surface flex items-center justify-center">
            <History className="w-7 h-7 text-wallet-muted" />
          </div>
          <span className="text-base font-semibold text-white">No Account</span>
          <span className="text-sm text-wallet-muted">
            Connect a Flow account to view transaction history
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header + tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl font-semibold text-white">Activity</h1>
        <FilterTabs active={tab} onChange={handleTabChange} />
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div>
          {Array.from({ length: 6 }).map((_, i) => (
            <TransactionSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="text-center py-16 text-red-400 text-sm">{error}</div>
      )}

      {/* Empty state */}
      {!loading &&
        !error &&
        transactions.length === 0 &&
        ftTransfers.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-wallet-surface flex items-center justify-center">
              <History className="w-7 h-7 text-wallet-muted" />
            </div>
            <span className="text-base font-semibold text-white">No activity yet</span>
            <span className="text-sm text-wallet-muted">
              {tab === 'ft'
                ? 'No token transfers found for this account'
                : tab === 'nft'
                  ? 'No NFT transfers found for this account'
                  : 'Transactions for this account will appear here'}
            </span>
          </div>
        )}

      {/* Transaction list (All / NFT tabs) */}
      {!loading && !error && transactions.length > 0 && (
        <div>
          {transactions.map((tx) => (
            <TransactionRow key={tx.id} tx={tx} />
          ))}
        </div>
      )}

      {/* FT Transfer list */}
      {!loading && !error && ftTransfers.length > 0 && (
        <div>
          {ftTransfers.map((t, i) => (
            <FtTransferRow
              key={`${t.transaction_hash}-${t.address}-${i}`}
              transfer={t}
            />
          ))}
        </div>
      )}

      {/* Load More */}
      {!loading && hasMore && (
        <div className="flex justify-center pt-2 pb-4">
          <Button
            variant="outline"
            size="sm"
            onClick={loadMore}
            disabled={loadingMore}
            className="gap-2 rounded-2xl border-wallet-border hover:bg-wallet-surface"
          >
            {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
            {loadingMore ? 'Loading...' : 'Load More'}
          </Button>
        </div>
      )}
    </div>
  );
}

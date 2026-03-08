import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { TokenIcon, cn, formatShort } from '@flowindex/flow-ui';
import { deriveActivityType, buildSummaryLine } from '@flowindex/flow-ui';
import {
  Copy,
  Check,
  Wallet,
  ArrowRightLeft,
  ArrowUpRight,
  ArrowDownLeft,
  FileCode,
  UserPlus,
  Key,
  Zap,
  Coins,
  ShoppingBag,
  Clock,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { useWallet } from '@/hooks/useWallet';
import {
  getAccount,
  getAccountFtHoldings,
  getAccountTransactions,
  getTokenPrices,
} from '@/api/flow';
import type { AccountData, FtHolding, AccountTransaction } from '@/api/flow';

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

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded-2xl bg-wallet-surface', className)} />
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface VaultWithMeta {
  token: string;
  name: string;
  symbol: string;
  logo?: string;
  balance: number;
  usdValue: number;
}

type DashTab = 'crypto' | 'activity';

function TabBar({ active, onChange }: { active: DashTab; onChange: (t: DashTab) => void }) {
  const tabs: { key: DashTab; label: string }[] = [
    { key: 'crypto', label: 'Crypto' },
    { key: 'activity', label: 'Transactions' },
  ];

  return (
    <div className="flex gap-6 border-b border-wallet-border">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={cn(
            'pb-3 text-sm font-semibold transition-colors relative',
            active === tab.key
              ? 'text-wallet-accent'
              : 'text-wallet-muted hover:text-white',
          )}
        >
          {tab.label}
          {active === tab.key && (
            <span className="absolute bottom-0 inset-x-0 h-0.5 bg-wallet-accent rounded-full" />
          )}
        </button>
      ))}
    </div>
  );
}

function TokenRow({ vault }: { vault: VaultWithMeta }) {
  return (
    <div className="flex items-center gap-3 py-3.5 cursor-pointer hover:bg-wallet-surface-hover rounded-2xl px-3 -mx-3 transition-colors">
      <TokenIcon
        logoUrl={vault.logo}
        name={vault.name}
        symbol={vault.symbol}
        size={40}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white">{vault.name || vault.symbol}</p>
        <p className="text-xs text-wallet-muted mt-0.5">
          {vault.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })} {vault.symbol}
        </p>
      </div>
      <div className="text-right">
        {vault.usdValue > 0 ? (
          <p className="text-sm font-semibold text-white">
            ${vault.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        ) : (
          <p className="text-sm text-wallet-muted">--</p>
        )}
      </div>
    </div>
  );
}

function TxRow({ tx }: { tx: AccountTransaction }) {
  const activity = deriveActivityType(tx);
  const Icon = activityIcon(activity.type);
  const summary = buildSummaryLine(tx);

  return (
    <a
      href={`https://flowindex.io/tx/${tx.id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 py-3.5 hover:bg-wallet-surface-hover rounded-2xl px-3 -mx-3 transition-colors group"
    >
      <div
        className={cn(
          'w-10 h-10 rounded-2xl flex items-center justify-center flex-shrink-0',
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
      <span className="text-xs text-wallet-muted flex-shrink-0">{timeAgo(tx.timestamp)}</span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const { activeAccount, network, loading: walletLoading } = useWallet();

  const [account, setAccount] = useState<AccountData | null>(null);
  const [holdings, setHoldings] = useState<FtHolding[]>([]);
  const [transactions, setTransactions] = useState<AccountTransaction[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [dataLoading, setDataLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<DashTab>('crypto');

  const address =
    network === 'testnet'
      ? activeAccount?.flowAddressTestnet
      : activeAccount?.flowAddress;

  const fetchData = useCallback(async () => {
    if (!address) return;
    setDataLoading(true);
    try {
      const [acct, ftHoldings, txPage, tokenPrices] = await Promise.allSettled([
        getAccount(address),
        getAccountFtHoldings(address),
        getAccountTransactions(address, { limit: 10 }),
        getTokenPrices(),
      ]);

      if (acct.status === 'fulfilled') setAccount(acct.value);
      if (ftHoldings.status === 'fulfilled') setHoldings(ftHoldings.value);
      if (txPage.status === 'fulfilled') setTransactions(txPage.value.data);
      if (tokenPrices.status === 'fulfilled') setPrices(tokenPrices.value);
    } finally {
      setDataLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const copyAddress = useCallback(() => {
    if (!address) return;
    navigator.clipboard.writeText(`0x${address}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [address]);

  // Build enriched vault list
  const flowBalance = account?.flowBalance ?? 0;
  const flowPrice = prices['FLOW'] ?? prices['flow'] ?? 0;

  const enrichedHoldings: VaultWithMeta[] = (() => {
    const result: VaultWithMeta[] = [];

    // FLOW always first
    result.push({
      token: 'FLOW',
      name: 'Flow',
      symbol: 'FLOW',
      logo: undefined,
      balance: flowBalance,
      usdValue: flowBalance * flowPrice,
    });

    const vaults = account?.vaults;
    if (vaults && Object.keys(vaults).length > 0) {
      const others = Object.entries(vaults)
        .filter(([, v]) => v.symbol !== 'FLOW')
        .map(([, v]) => {
          const balance = v.balance ?? 0;
          const symbol = v.symbol ?? '';
          const price = prices[symbol] ?? prices[symbol.toUpperCase()] ?? 0;
          return {
            token: v.token ?? v.path ?? '',
            name: v.name ?? symbol,
            symbol,
            logo: v.logo,
            balance,
            usdValue: balance * price,
          };
        })
        .filter((v) => v.balance > 0)
        .sort((a, b) => b.usdValue - a.usdValue || b.balance - a.balance);
      result.push(...others);
    } else {
      const others = holdings
        .filter((h) => !h.token?.includes('FlowToken'))
        .map((h) => {
          const balance = Number(h.balance ?? 0);
          const tokenName = h.token?.split('.').pop() ?? '';
          return {
            token: h.token ?? '',
            name: tokenName,
            symbol: tokenName,
            logo: undefined,
            balance,
            usdValue: 0,
          };
        })
        .filter((v) => v.balance > 0)
        .sort((a, b) => b.balance - a.balance);
      result.push(...others);
    }

    return result;
  })();

  const totalUsd = enrichedHoldings.reduce((sum, h) => sum + h.usdValue, 0);

  // No account state
  if (!walletLoading && !address) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
        <div className="w-16 h-16 rounded-2xl bg-wallet-surface flex items-center justify-center mb-5">
          <Wallet className="w-8 h-8 text-wallet-muted" />
        </div>
        <h2 className="text-xl font-semibold text-white mb-2">No Account Found</h2>
        <p className="text-sm text-wallet-muted max-w-xs">
          Create or connect a Flow account to view your wallet.
        </p>
      </div>
    );
  }

  const loading = walletLoading || dataLoading;

  return (
    <div className="space-y-6">
      {/* ---- Balance Header (Coinbase style) ---- */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm text-wallet-muted font-medium">Balance</p>
          {address && (
            <button
              onClick={copyAddress}
              className="flex items-center gap-1.5 text-xs text-wallet-muted hover:text-white transition-colors rounded-xl px-2 py-1 hover:bg-wallet-surface"
            >
              <span className="font-mono">0x{formatShort(address, 4, 4)}</span>
              {copied ? (
                <Check className="w-3 h-3 text-wallet-accent" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          )}
        </div>

        {loading ? (
          <Skeleton className="h-12 w-48" />
        ) : (
          <h1 className="text-4xl font-extrabold text-white tracking-tight">
            US${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </h1>
        )}

        {/* Quick Actions */}
        <div className="flex gap-2 mt-4">
          <Link
            to="/send"
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-wallet-surface hover:bg-wallet-surface-hover border border-wallet-border text-sm font-medium text-white transition-colors"
          >
            <ArrowUpRight className="w-4 h-4" />
            Send
          </Link>
          <button
            onClick={copyAddress}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-wallet-surface hover:bg-wallet-surface-hover border border-wallet-border text-sm font-medium text-white transition-colors"
          >
            <ArrowDownLeft className="w-4 h-4" />
            Receive
          </button>
          {address && (
            <a
              href={`https://flowindex.io/account/0x${address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-wallet-surface hover:bg-wallet-surface-hover border border-wallet-border text-sm font-medium text-white transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              Explorer
            </a>
          )}
        </div>
      </div>

      {/* ---- Tabs (Crypto / Transactions) ---- */}
      <TabBar active={tab} onChange={setTab} />

      {/* ---- Tab Content ---- */}
      {tab === 'crypto' && (
        <div>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-3">
                  <Skeleton className="w-10 h-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-24 rounded-xl" />
                    <Skeleton className="h-3 w-16 rounded-xl" />
                  </div>
                  <Skeleton className="h-4 w-16 rounded-xl" />
                </div>
              ))}
            </div>
          ) : enrichedHoldings.filter(h => h.balance > 0).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-wallet-surface flex items-center justify-center mb-4">
                <Wallet className="w-7 h-7 text-wallet-muted" />
              </div>
              <p className="text-base font-semibold text-white mb-1">Add crypto to get started</p>
              <p className="text-sm text-wallet-muted">
                Send some crypto to your wallet to get started
              </p>
            </div>
          ) : (
            <div className="divide-y divide-wallet-border/50">
              {enrichedHoldings
                .filter(h => h.balance > 0)
                .map((vault) => (
                  <TokenRow key={vault.token} vault={vault} />
                ))}
            </div>
          )}
        </div>
      )}

      {tab === 'activity' && (
        <div>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 py-3">
                  <Skeleton className="w-10 h-10 rounded-2xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-28 rounded-xl" />
                    <Skeleton className="h-3 w-40 rounded-xl" />
                  </div>
                  <Skeleton className="h-3 w-14 rounded-xl" />
                </div>
              ))}
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-wallet-surface flex items-center justify-center mb-4">
                <Clock className="w-7 h-7 text-wallet-muted" />
              </div>
              <p className="text-base font-semibold text-white mb-1">No transactions yet</p>
              <p className="text-sm text-wallet-muted">
                Transactions for this account will appear here
              </p>
            </div>
          ) : (
            <>
              <div className="divide-y divide-wallet-border/50">
                {transactions.map((tx) => (
                  <TxRow key={tx.id} tx={tx} />
                ))}
              </div>
              <Link
                to="/activity"
                className="flex items-center justify-center gap-1.5 mt-4 py-3 rounded-2xl bg-wallet-surface hover:bg-wallet-surface-hover border border-wallet-border text-sm font-medium text-wallet-muted hover:text-white transition-colors"
              >
                View all transactions
                <ChevronRight className="w-4 h-4" />
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Activity, ArrowRightLeft, Coins, Wallet, ExternalLink, FileCode2, ImageIcon } from 'lucide-react';
import Avatar from 'boring-avatars';
import { colorsFromAddress, avatarVariant } from '@/components/AddressLink';
import { CopyButton } from '@/components/animate-ui/components/buttons/copy';
import { PageHeader } from '@/components/ui/PageHeader';
import { GlassCard } from '@flowindex/flow-ui';
import { getEVMAddress } from '@/api/evm';
import { formatWei } from '@/lib/evmUtils';
import { EVMTransactionList } from './EVMTransactionList';
import { EVMInternalTxList } from './EVMInternalTxList';
import { EVMTokenTransfers } from './EVMTokenTransfers';
import { EVMTokenHoldings } from './EVMTokenHoldings';
import { AccountTokensTab } from '@/components/account/AccountTokensTab';
import { EVMNFTsTab } from './EVMNFTsTab';
import type { BSAddress } from '@/types/blockscout';

interface EVMAccountPageProps {
  address: string;
  flowAddress?: string;
  isCOA: boolean;
  initialTab?: string;
}

type EVMTab = 'transactions' | 'internal' | 'transfers' | 'tokens' | 'nfts';

const VALID_TABS: EVMTab[] = ['transactions', 'internal', 'transfers', 'tokens', 'nfts'];

export function EVMAccountPage({ address, flowAddress, isCOA, initialTab }: EVMAccountPageProps) {
  const navigate = useNavigate();
  const [addressInfo, setAddressInfo] = useState<BSAddress | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<EVMTab>(
    VALID_TABS.includes(initialTab as EVMTab) ? (initialTab as EVMTab) : 'transactions'
  );

  const handleTabChange = (tab: EVMTab) => {
    setActiveTab(tab);
    navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, tab }) } as any);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    getEVMAddress(address)
      .then((res) => {
        if (!cancelled) setAddressInfo(res);
      })
      .catch((err) => {
        console.warn('[EVMAccountPage] Failed to load address info:', err?.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [address]);

  const balance = addressInfo?.coin_balance ? formatWei(addressInfo.coin_balance) : '0';
  const txCount = addressInfo?.transactions_count ?? 0;

  const tabs: { id: EVMTab; label: string; icon: typeof Activity }[] = [
    { id: 'transactions', label: 'Transactions', icon: Activity },
    { id: 'internal', label: 'Internal Txs', icon: ArrowRightLeft },
    { id: 'transfers', label: 'Token Transfers', icon: Coins },
    { id: 'tokens', label: 'Tokens', icon: Wallet },
    { id: 'nfts', label: 'NFTs', icon: ImageIcon },
  ];

  return (
    <div className="min-h-screen bg-gray-50/50 dark:bg-black text-zinc-900 dark:text-white font-mono transition-colors duration-300 selection:bg-nothing-green selection:text-black">
      <div className="max-w-7xl mx-auto px-4 pt-12 pb-24">

        <button onClick={() => window.history.back()} className="inline-flex items-center gap-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors mb-6 group">
          <ArrowLeft className="h-4 w-4 transform group-hover:-translate-x-1 transition-transform" />
          <span className="text-xs uppercase tracking-widest">Back</span>
        </button>

        <PageHeader
          title={
            <div className="flex items-center gap-3">
              <div className="shrink-0 w-8 h-8 sm:w-10 sm:h-10 md:w-14 md:h-14 [&>svg]:w-full [&>svg]:h-full">
                <Avatar
                  size={56}
                  name={address}
                  variant={avatarVariant(address)}
                  colors={colorsFromAddress(address)}
                />
              </div>
              <span>{addressInfo?.name || 'EVM Account'}</span>
              {isCOA && (
                <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-800/40 uppercase tracking-wider">
                  COA
                </span>
              )}
              {addressInfo?.is_contract && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800/40 uppercase tracking-wider">
                  <FileCode2 className="w-3 h-3" />
                  Contract
                </span>
              )}
              {addressInfo?.is_verified && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold bg-green-100 dark:bg-nothing-green/20 text-green-700 dark:text-nothing-green border border-green-200 dark:border-nothing-green/30 uppercase tracking-wider">
                  Verified
                </span>
              )}
            </div>
          }
          subtitle={
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-1 group min-w-0">
                <span className="truncate text-xs sm:text-sm md:text-base">{address}</span>
                <CopyButton
                  content={address}
                  variant="ghost"
                  size="xs"
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity"
                />
              </div>
              {isCOA && flowAddress && (
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-zinc-500">Linked Flow Account:</span>
                  <Link
                    to={`/accounts/${flowAddress}` as any}
                    className="text-nothing-green-dark dark:text-nothing-green hover:underline inline-flex items-center gap-1"
                  >
                    {flowAddress}
                    <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
              )}
            </div>
          }
        >
          <div className="text-left md:text-right">
            <div className="text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1">Balance</div>
            {loading ? (
              <div className="h-8 w-32 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
            ) : (
              <div className="text-xl md:text-3xl font-bold">
                {balance} <span className="text-sm text-zinc-500 font-normal">FLOW</span>
              </div>
            )}
          </div>
        </PageHeader>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-8 md:mb-12">
          <GlassCard className="p-3 md:p-6 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <Activity className="h-12 w-12" />
            </div>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Transactions</p>
            {loading ? (
              <div className="h-7 w-16 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
            ) : (
              <p className="text-2xl font-bold">{txCount.toLocaleString()}</p>
            )}
          </GlassCard>

          <GlassCard className="p-3 md:p-6 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <Coins className="h-12 w-12" />
            </div>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Token Transfers</p>
            {loading ? (
              <div className="h-7 w-16 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
            ) : (
              <p className="text-2xl font-bold">{(addressInfo?.token_transfers_count ?? 0).toLocaleString()}</p>
            )}
          </GlassCard>

          <GlassCard className="p-3 md:p-6 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <Wallet className="h-12 w-12" />
            </div>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Balance</p>
            {loading ? (
              <div className="h-7 w-24 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
            ) : (
              <p className="text-2xl font-bold truncate">{balance} <span className="text-xs font-normal text-zinc-500">FLOW</span></p>
            )}
          </GlassCard>

          <GlassCard className="p-3 md:p-6 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <FileCode2 className="h-12 w-12" />
            </div>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Type</p>
            <p className="text-2xl font-bold">
              {addressInfo?.is_contract ? 'Contract' : isCOA ? 'COA' : 'EOA'}
            </p>
          </GlassCard>
        </div>

        {/* Tabs */}
        <div className="space-y-6">
          {/* Mobile Tab Selector */}
          <div className="md:hidden sticky top-2 z-50">
            <select
              value={activeTab}
              onChange={(e) => handleTabChange(e.target.value as EVMTab)}
              className="w-full px-4 py-3 text-sm font-bold uppercase tracking-wider bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md border border-zinc-200 dark:border-white/10 shadow-lg rounded-sm appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_12px_center] bg-no-repeat text-zinc-900 dark:text-white"
            >
              {tabs.map(({ id, label }) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </div>

          {/* Desktop Tab Bar */}
          <div className="hidden md:block sticky top-4 z-50">
            <div className="bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md shadow-lg border border-zinc-200 dark:border-white/10 p-1.5 inline-flex flex-wrap gap-1 max-w-full overflow-x-auto">
              {tabs.map(({ id, label, icon: Icon }) => {
                const isActive = activeTab === id;
                return (
                  <button
                    key={id}
                    onClick={() => handleTabChange(id)}
                    className={`relative px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-2 whitespace-nowrap ${
                      isActive
                        ? 'text-white dark:text-zinc-900 bg-zinc-900 dark:bg-white shadow-md'
                        : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tab Content */}
          <div className="min-h-[500px]">
            {activeTab === 'transactions' && <EVMTransactionList address={address} />}
            {activeTab === 'internal' && <EVMInternalTxList address={address} />}
            {activeTab === 'transfers' && <EVMTokenTransfers address={address} />}
            {activeTab === 'tokens' && (
              isCOA && flowAddress ? (
                <AccountTokensTab address={flowAddress} coaAddress={address} subtab="evm" />
              ) : (
                <EVMTokenHoldings address={address} />
              )
            )}
            {activeTab === 'nfts' && <EVMNFTsTab address={address} />}
          </div>
        </div>
      </div>
    </div>
  );
}

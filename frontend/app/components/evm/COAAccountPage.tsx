import { useState, useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Activity, ArrowRightLeft, Coins, Wallet, ExternalLink, FileText, Image as ImageIcon } from 'lucide-react';
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
import { AccountActivityTab } from '@/components/account/AccountActivityTab';
import { AccountTokensTab } from '@/components/account/AccountTokensTab';
import { AccountNFTsTab } from '@/components/account/AccountNFTsTab';
import { AccountContractsTab } from '@/components/account/AccountContractsTab';
import { ensureHeyApiConfigured } from '@/api/heyapi';
import { getFlowV1AccountByAddress } from '@/api/gen/find';
import type { BSAddress } from '@/types/blockscout';

interface COAAccountPageProps {
  evmAddress: string;
  flowAddress: string;
}

type ViewMode = 'cadence' | 'evm';
type CadenceTab = 'activity' | 'tokens' | 'nfts' | 'contracts';
type EVMTab = 'transactions' | 'internal' | 'transfers' | 'holdings';

export function COAAccountPage({ evmAddress, flowAddress }: COAAccountPageProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('cadence');
  const [cadenceTab, setCadenceTab] = useState<CadenceTab>('activity');
  const [evmTab, setEvmTab] = useState<EVMTab>('transactions');

  // EVM address info (for balance)
  const [addressInfo, setAddressInfo] = useState<BSAddress | null>(null);
  const [evmLoading, setEvmLoading] = useState(true);

  // Cadence account info (for contracts list)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [cadenceAccount, setCadenceAccount] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    setEvmLoading(true);

    getEVMAddress(evmAddress)
      .then((res) => {
        if (!cancelled) setAddressInfo(res);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setEvmLoading(false);
      });

    return () => { cancelled = true; };
  }, [evmAddress]);

  // Fetch Cadence account data for contracts
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        await ensureHeyApiConfigured();
        const res = await getFlowV1AccountByAddress({ path: { address: flowAddress } });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const payload: any = (res.data as any)?.data?.[0] ?? null;
        if (!cancelled && payload) {
          setCadenceAccount({
            contracts: payload.contracts || [],
          });
        }
      } catch {
        // Non-critical — contracts tab will just show empty
      }
    };
    load();
    return () => { cancelled = true; };
  }, [flowAddress]);

  const balance = addressInfo?.coin_balance ? formatWei(addressInfo.coin_balance) : '0';

  const cadenceTabs: { id: CadenceTab; label: string; icon: typeof Activity }[] = [
    { id: 'activity', label: 'Activity', icon: Activity },
    { id: 'tokens', label: 'Tokens', icon: Coins },
    { id: 'nfts', label: 'NFTs', icon: ImageIcon },
    { id: 'contracts', label: 'Contracts', icon: FileText },
  ];

  const evmTabs: { id: EVMTab; label: string; icon: typeof Activity }[] = [
    { id: 'transactions', label: 'Transactions', icon: Activity },
    { id: 'internal', label: 'Internal Txs', icon: ArrowRightLeft },
    { id: 'transfers', label: 'Token Transfers', icon: Coins },
    { id: 'holdings', label: 'Token Holdings', icon: Wallet },
  ];

  const activeTabs = viewMode === 'cadence' ? cadenceTabs : evmTabs;
  const activeTabId = viewMode === 'cadence' ? cadenceTab : evmTab;
  const setActiveTabId = viewMode === 'cadence'
    ? (id: string) => setCadenceTab(id as CadenceTab)
    : (id: string) => setEvmTab(id as EVMTab);

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
                  name={evmAddress}
                  variant={avatarVariant(evmAddress)}
                  colors={colorsFromAddress(evmAddress)}
                />
              </div>
              <span>COA Account</span>
              <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-800/40 uppercase tracking-wider">
                COA
              </span>
            </div>
          }
          subtitle={
            <div className="space-y-1.5 min-w-0">
              {/* Flow address */}
              <div className="flex items-center gap-1.5 group min-w-0">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500 shrink-0">Flow</span>
                <Link
                  to={`/accounts/${flowAddress}` as any}
                  className="text-nothing-green-dark dark:text-nothing-green hover:underline truncate text-xs sm:text-sm"
                >
                  {flowAddress}
                </Link>
                <CopyButton
                  content={flowAddress}
                  variant="ghost"
                  size="xs"
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity"
                />
              </div>
              {/* EVM address */}
              <div className="flex items-center gap-1.5 group min-w-0">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500 shrink-0">EVM</span>
                <span className="truncate text-xs sm:text-sm">{evmAddress}</span>
                <CopyButton
                  content={evmAddress}
                  variant="ghost"
                  size="xs"
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity"
                />
              </div>
            </div>
          }
        >
          <div className="text-left md:text-right">
            <div className="text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1">EVM Balance</div>
            {evmLoading ? (
              <div className="h-8 w-32 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
            ) : (
              <div className="text-xl md:text-3xl font-bold">
                {balance} <span className="text-sm text-zinc-500 font-normal">FLOW</span>
              </div>
            )}
          </div>
        </PageHeader>

        {/* View Mode Switcher + Tabs */}
        <div className="space-y-6 mt-8 md:mt-12">
          {/* View Mode Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode('cadence')}
              className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border transition-colors ${
                viewMode === 'cadence'
                  ? 'border-green-500 dark:border-green-500 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30'
                  : 'border-zinc-200 dark:border-white/10 text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-50 dark:hover:bg-white/5'
              }`}
            >
              Cadence
            </button>
            <button
              onClick={() => setViewMode('evm')}
              className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border transition-colors ${
                viewMode === 'evm'
                  ? 'border-green-500 dark:border-green-500 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30'
                  : 'border-zinc-200 dark:border-white/10 text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-50 dark:hover:bg-white/5'
              }`}
            >
              EVM
            </button>
          </div>

          {/* Mobile Tab Selector */}
          <div className="md:hidden sticky top-2 z-50">
            <select
              value={activeTabId}
              onChange={(e) => setActiveTabId(e.target.value)}
              className="w-full px-4 py-3 text-sm font-bold uppercase tracking-wider bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md border border-zinc-200 dark:border-white/10 shadow-lg rounded-sm appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_12px_center] bg-no-repeat text-zinc-900 dark:text-white"
            >
              {activeTabs.map(({ id, label }) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </div>

          {/* Desktop Tab Bar */}
          <div className="hidden md:block sticky top-4 z-50">
            <div className="bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md shadow-lg border border-zinc-200 dark:border-white/10 p-1.5 inline-flex flex-wrap gap-1 max-w-full overflow-x-auto">
              {activeTabs.map(({ id, label, icon: Icon }) => {
                const isActive = activeTabId === id;
                return (
                  <button
                    key={id}
                    onClick={() => setActiveTabId(id)}
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
            {/* Cadence tabs */}
            {viewMode === 'cadence' && cadenceTab === 'activity' && (
              <AccountActivityTab address={flowAddress} initialTransactions={[]} initialNextCursor="" />
            )}
            {viewMode === 'cadence' && cadenceTab === 'tokens' && (
              <AccountTokensTab address={flowAddress} />
            )}
            {viewMode === 'cadence' && cadenceTab === 'nfts' && (
              <AccountNFTsTab address={flowAddress} />
            )}
            {viewMode === 'cadence' && cadenceTab === 'contracts' && (
              <AccountContractsTab address={flowAddress} contracts={cadenceAccount?.contracts || []} />
            )}

            {/* EVM tabs */}
            {viewMode === 'evm' && evmTab === 'transactions' && (
              <EVMTransactionList address={evmAddress} />
            )}
            {viewMode === 'evm' && evmTab === 'internal' && (
              <EVMInternalTxList address={evmAddress} />
            )}
            {viewMode === 'evm' && evmTab === 'transfers' && (
              <EVMTokenTransfers address={evmAddress} />
            )}
            {viewMode === 'evm' && evmTab === 'holdings' && (
              <EVMTokenHoldings address={evmAddress} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

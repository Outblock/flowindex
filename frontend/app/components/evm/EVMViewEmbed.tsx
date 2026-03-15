import { useState, useEffect } from 'react';
import { Activity, ArrowRightLeft, Coins, Wallet, Image as ImageIcon, FileCode2, ExternalLink } from 'lucide-react';
import { cn, GlassCard } from '@flowindex/flow-ui';
import { getEVMAddress } from '@/api/evm';
import { formatWei } from '@/lib/evmUtils';
import { CopyButton } from '@/components/animate-ui/components/buttons/copy';
import { EVMTransactionList } from './EVMTransactionList';
import { EVMInternalTxList } from './EVMInternalTxList';
import { EVMTokenTransfers } from './EVMTokenTransfers';
import { AccountTokensTab } from '@/components/account/AccountTokensTab';
import { AccountNFTsTab } from '@/components/account/AccountNFTsTab';
import type { BSAddress } from '@/types/blockscout';

type EVMSubTab = 'transactions' | 'internal' | 'transfers' | 'tokens' | 'nfts';

interface EVMViewEmbedProps {
    evmAddress: string;
    flowAddress: string;
    viewSwitcher?: React.ReactNode;
}

export function EVMViewEmbed({ evmAddress, flowAddress, viewSwitcher }: EVMViewEmbedProps) {
    const [addressInfo, setAddressInfo] = useState<BSAddress | null>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<EVMSubTab>('transactions');
    const [tokensSubTab, setTokensSubTab] = useState<string | undefined>('evm');

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        getEVMAddress(evmAddress)
            .then((res) => { if (!cancelled) setAddressInfo(res); })
            .catch((err) => { console.warn('[EVMViewEmbed]', err?.message); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [evmAddress]);

    const balance = addressInfo?.coin_balance ? formatWei(addressInfo.coin_balance) : '0';
    const txCount = addressInfo?.transactions_count ?? 0;

    const tabs: { id: EVMSubTab; label: string; icon: typeof Activity }[] = [
        { id: 'transactions', label: 'Transactions', icon: Activity },
        { id: 'internal', label: 'Internal Txs', icon: ArrowRightLeft },
        { id: 'transfers', label: 'Token Transfers', icon: Coins },
        { id: 'tokens', label: 'Tokens', icon: Wallet },
        { id: 'nfts', label: 'NFTs', icon: ImageIcon },
    ];

    return (
        <>
            {/* COA Address Info Bar */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 border border-violet-200 dark:border-violet-800/40 bg-violet-50/50 dark:bg-violet-900/10 mb-6">
                <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[10px] uppercase tracking-wider text-violet-600 dark:text-violet-400 font-bold shrink-0">COA Address</span>
                    <span className="font-mono text-xs text-violet-700 dark:text-violet-300 truncate">{evmAddress}</span>
                    <CopyButton content={evmAddress} variant="ghost" size="xs" className="text-violet-400 hover:text-violet-600 dark:hover:text-violet-200 shrink-0" />
                    <a
                        href={`https://evm.flowindex.io/address/${evmAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open in Blockscout"
                        className="text-violet-400 hover:text-violet-600 dark:hover:text-violet-200 shrink-0"
                    >
                        <ExternalLink className="w-3 h-3" />
                    </a>
                </div>
            </div>

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
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">EVM Balance</p>
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
                        {addressInfo?.is_contract ? 'Contract' : 'COA'}
                    </p>
                </GlassCard>
            </div>

            {/* VM View Switcher */}
            {viewSwitcher}

            {/* Tabs & Content */}
            <div className="space-y-6">
                {/* Mobile Tab Selector */}
                <div className="md:hidden sticky top-2 z-50">
                    <select
                        value={activeTab}
                        onChange={(e) => setActiveTab(e.target.value as EVMSubTab)}
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
                                    onClick={() => setActiveTab(id)}
                                    className={cn(
                                        "relative px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-2 whitespace-nowrap",
                                        isActive
                                            ? 'text-white dark:text-zinc-900 bg-zinc-900 dark:bg-white shadow-md'
                                            : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-white'
                                    )}
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
                    {activeTab === 'transactions' && <EVMTransactionList address={evmAddress} />}
                    {activeTab === 'internal' && <EVMInternalTxList address={evmAddress} />}
                    {activeTab === 'transfers' && <EVMTokenTransfers address={evmAddress} />}
                    {activeTab === 'tokens' && (
                        <AccountTokensTab address={flowAddress} coaAddress={evmAddress} subtab={tokensSubTab} onSubTabChange={setTokensSubTab} />
                    )}
                    {activeTab === 'nfts' && (
                        <AccountNFTsTab address={flowAddress} />
                    )}
                </div>
            </div>
        </>
    );
}

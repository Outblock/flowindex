import { createFileRoute, Link, redirect, isRedirect } from '@tanstack/react-router'
import { useState, useEffect } from 'react';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import { getFlowV1AccountByAddress, getFlowV1AccountByAddressTransaction } from '../../api/gen/find';
import { resolveApiBaseUrl } from '../../api';
import {
    ArrowLeft, User, Activity, Key, Coins, Image as ImageIcon,
    FileText, HardDrive, Link2, Lock, Database, Check, TrendingUp, Landmark, AlertTriangle, QrCode
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { SafeNumberFlow } from '../../components/SafeNumberFlow';
import Avatar from 'boring-avatars';
import { colorsFromAddress } from '../../components/AddressLink';
import { normalizeAddress, backfillCOAMapping } from '../../components/account/accountUtils';
import { NotFoundPage } from '../../components/ui/NotFoundPage';
import type { StakingInfo, StorageInfo } from '../../../cadence/cadence.gen';
import { AccountActivityTab, loadTokenMetaCache } from '../../components/account/AccountActivityTab';
import { AccountTokensTab } from '../../components/account/AccountTokensTab';
import { AccountNFTsTab } from '../../components/account/AccountNFTsTab';
import { AccountKeysTab } from '../../components/account/AccountInfoTab';
import { AccountContractsTab } from '../../components/account/AccountContractsTab';
import { AccountStorageTab } from '../../components/account/AccountStorageTab';
import { AccountLinkedAccountsTab } from '../../components/account/AccountLinkedAccountsTab';
import { AccountStakingTab } from '../../components/account/AccountStakingTab';
import { AccountBalanceTab } from '../../components/account/AccountBalanceTab';
import { PageHeader } from '../../components/ui/PageHeader';
import { CopyButton } from '@/components/animate-ui/components/buttons/copy';
import { GlassCard } from '../../components/ui/GlassCard';
import { COABadge } from '../../components/ui/COABadge';
import { cn } from '../../lib/utils';
import { QRCodeSVG } from 'qrcode.react';
import { useTheme } from '../../contexts/ThemeContext';

const VALID_TABS = ['activity', 'balance', 'tokens', 'nfts', 'staking', 'keys', 'contracts', 'storage', 'linked'] as const;
type AccountTab = (typeof VALID_TABS)[number];

const VALID_SUBTABS = ['all', 'ft', 'nft', 'scheduled'] as const;
type AccountSubTab = (typeof VALID_SUBTABS)[number];

export const Route = createFileRoute('/accounts/$address')({
    component: AccountDetail,
    pendingComponent: AccountDetailPending,
    validateSearch: (search: Record<string, unknown>): { tab?: AccountTab; subtab?: AccountSubTab } => {
        const tab = search.tab as string;
        const subtab = search.subtab as string;
        return {
            tab: VALID_TABS.includes(tab as AccountTab) ? (tab as AccountTab) : undefined,
            subtab: VALID_SUBTABS.includes(subtab as AccountSubTab) ? (subtab as AccountSubTab) : undefined,
        };
    },
    loader: async ({ params, search }: any) => {
        try {
            const address = params.address;
            const normalized = address.toLowerCase().startsWith('0x') ? address.toLowerCase() : `0x${address.toLowerCase()}`;

            // Detect COA (EVM) addresses: longer than Flow's 18 chars (0x + 16 hex)
            // and have 10+ leading zeros after 0x — redirect to the linked Flow address.
            const hexOnly = normalized.replace(/^0x/, '');
            const isCOA = hexOnly.length > 16 && /^0{10,}/.test(hexOnly);
            if (isCOA) {
                const base = await resolveApiBaseUrl();
                const coaRes = await fetch(`${base}/flow/v1/coa/${normalized}`).catch(() => null);
                if (coaRes?.ok) {
                    const json = await coaRes.json().catch(() => null);
                    const flowAddr = json?.data?.[0]?.flow_address;
                    if (flowAddr) {
                        throw redirect({ to: '/accounts/$address', params: { address: flowAddr }, search: search as any });
                    }
                }
                // COA address with no known Flow mapping — return early with helpful state
                return { account: null, initialTransactions: [], initialNextCursor: '', isCOA: true };
            }

            await ensureHeyApiConfigured();
            // Kick off token meta cache load in parallel — no await needed, fires and fills module cache
            loadTokenMetaCache();
            const accountRes = await getFlowV1AccountByAddress({ path: { address: normalized } });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const accountPayload: any = (accountRes.data as any)?.data?.[0] ?? null;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const normalizedKeys = (accountPayload?.keys || []).map((key: any) => ({
                keyIndex: key.keyIndex ?? key.key_index ?? key.index,
                publicKey: key.publicKey ?? key.public_key ?? key.key ?? '',
                signingAlgorithm: key.signingAlgorithm ?? key.signatureAlgorithm ?? key.sign_algo ?? key.signing_algorithm ?? '',
                hashingAlgorithm: key.hashingAlgorithm ?? key.hashAlgorithm ?? key.hash_algo ?? key.hashing_algorithm ?? '',
                weight: key.weight ?? 0,
                sequenceNumber: key.sequenceNumber ?? key.sequence_number ?? 0,
                revoked: Boolean(key.revoked),
            }));

            const initialAccount = {
                address: normalized,
                balance: accountPayload?.flowBalance ?? accountPayload?.balance,
                createdAt: null,
                contracts: accountPayload?.contracts || [],
                keys: normalizedKeys,
                _rpcUnavailable: accountPayload?._rpcUnavailable || false,
            };

            // Transactions are loaded client-side by AccountActivityTab to avoid
            // blocking the entire page render on a potentially slow query.
            return { account: initialAccount, initialTransactions: [], initialNextCursor: '', isCOA: false };
        } catch (e) {
            // Re-throw redirects (e.g. COA → Flow address redirect)
            if (isRedirect(e)) throw e;
            console.error("Failed to load account data", e);
            return { account: null, initialTransactions: [], initialNextCursor: '', isCOA: false };
        }
    }
})

function AccountDetailPending() {
    return (
        <div className="min-h-screen bg-gray-50 dark:bg-black text-zinc-900 dark:text-zinc-300 font-mono transition-colors duration-300">
            <div className="fixed inset-x-0 top-0 z-[9999] h-[3px] overflow-hidden bg-nothing-green/10">
                <div className="h-full w-1/2 bg-nothing-green" style={{ animation: 'route-pending-bar 1s ease-in-out infinite' }} />
            </div>
            <div className="max-w-7xl mx-auto px-4 pt-8 pb-16">
                <div className="h-64 rounded-2xl bg-zinc-200 dark:bg-white/5 animate-pulse mb-8" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="h-32 rounded-xl bg-zinc-200 dark:bg-white/5 animate-pulse" />
                    ))}
                </div>
                <div className="h-96 rounded-xl bg-zinc-200 dark:bg-white/5 animate-pulse" />
            </div>
        </div>
    );
}

function AccountDetail() {
    const { address } = Route.useParams();
    const { tab: searchTab, subtab: searchSubTab } = Route.useSearch();
    const { account: initialAccount, initialTransactions, initialNextCursor, isCOA } = Route.useLoaderData();
    const navigate = Route.useNavigate();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [account, setAccount] = useState<any>(initialAccount);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [error, setError] = useState<any>(initialAccount ? null : 'Account not found');
    const [showQR, setShowQR] = useState(false);
    const activeTab: AccountTab = searchTab || 'activity';
    const activeSubTab: AccountSubTab | undefined = searchSubTab;
    const setActiveTab = (tab: AccountTab) => {
        navigate({ search: { tab }, replace: true });
    };
    const setActiveSubTab = (subtab: AccountSubTab | undefined) => {
        navigate({ search: { tab: activeTab, subtab }, replace: true });
    };

    const normalizedAddress = normalizeAddress(address);
    const { theme } = useTheme();

    const [onChainData, setOnChainData] = useState<{
        balance?: number; storage?: StorageInfo; staking?: StakingInfo; coaAddress?: string;
    } | null>(null);



    // Client-side on-chain data (balance, staking, storage, COA)
    useEffect(() => {
        setOnChainData(null);
        const load = async () => {
            try {
                const { cadenceService } = await import('../../fclConfig');
                const [tokenRes, stakingRes, accountInfoRes] = await Promise.all([
                    cadenceService.getToken(normalizedAddress).catch(() => null),
                    cadenceService.getStakingInfo(normalizedAddress).catch(() => null),
                    cadenceService.getAccountInfo(normalizedAddress).catch(() => null),
                ]);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const flowToken = tokenRes?.tokens?.find((t: any) =>
                    t.contractName === 'FlowToken' || t.symbol === 'FLOW'
                );
                setOnChainData({
                    balance: flowToken ? Number(flowToken.balance) : undefined,
                    storage: tokenRes?.storage || undefined,
                    staking: stakingRes?.stakingInfo || undefined,
                    coaAddress: accountInfoRes?.coaAddress || undefined,
                });
                // Backfill COA mapping so future COA address visits redirect
                if (accountInfoRes?.coaAddress) {
                    backfillCOAMapping(normalizedAddress, accountInfoRes.coaAddress);
                }
            } catch (e) {
                console.error('Failed to load on-chain data', e);
            }
        };
        load();
    }, [normalizedAddress]);

    // Refresh account on route change
    useEffect(() => {
        if (account?.address === normalizedAddress) return;

        let cancelled = false;
        const refresh = async () => {
            try {
                await ensureHeyApiConfigured();
                const res = await getFlowV1AccountByAddress({ path: { address: normalizedAddress } });
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const payload: any = (res.data as any)?.data?.[0] ?? null;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const keys = (payload?.keys || []).map((key: any) => ({
                    keyIndex: key.keyIndex ?? key.key_index ?? key.index,
                    publicKey: key.publicKey ?? key.public_key ?? key.key ?? '',
                    signingAlgorithm: key.signingAlgorithm ?? key.signatureAlgorithm ?? key.sign_algo ?? key.signing_algorithm ?? '',
                    hashingAlgorithm: key.hashingAlgorithm ?? key.hashAlgorithm ?? key.hash_algo ?? key.hashing_algorithm ?? '',
                    weight: key.weight ?? 0,
                    sequenceNumber: key.sequenceNumber ?? key.sequence_number ?? 0,
                    revoked: Boolean(key.revoked),
                }));
                if (cancelled) return;
                setAccount({ address: normalizedAddress, balance: payload?.flowBalance ?? payload?.balance, createdAt: null, contracts: payload?.contracts || [], keys, _rpcUnavailable: payload?._rpcUnavailable || false });
                setError(null);
            } catch (e) {
                if (cancelled) return;
                console.error('Failed to refresh account', e);
                setError('Account not found');
            }
        };
        refresh();
        return () => { cancelled = true; };
    }, [address, normalizedAddress, account?.address]);

    if (error || !account) {
        return (
            <NotFoundPage
                icon={isCOA ? Link2 : User}
                title={isCOA ? 'COA Address (EVM)' : 'Account Not Found'}
                identifier={normalizedAddress}
                description={isCOA
                    ? 'This is a Cadence-Owned Account (COA) address on Flow EVM. The linked Flow account has not been indexed yet.'
                    : 'This account could not be located on the network.'}
                hint={isCOA
                    ? 'COA mappings are discovered as blocks are indexed. The owner account will appear here once the creation transaction is processed.'
                    : 'It may not have been indexed yet, or the address may be invalid. Our indexer is continuously processing blocks — try again shortly.'}
            />
        );
    }

    const tabs = [
        { id: 'activity' as const, label: 'Activity', icon: Activity },
        { id: 'tokens' as const, label: 'Tokens', icon: Coins },
        { id: 'nfts' as const, label: 'NFTs', icon: ImageIcon },
        { id: 'staking' as const, label: 'Staking', icon: Landmark },
        { id: 'keys' as const, label: 'Public Keys', icon: Key },
        { id: 'contracts' as const, label: `Contracts (${account.contracts?.length || 0})`, icon: FileText },
        { id: 'storage' as const, label: 'Storage', icon: HardDrive },
        { id: 'linked' as const, label: 'Linked Accounts', icon: Link2 },
        { id: 'balance' as const, label: 'Balance', icon: TrendingUp },
    ];

    const balanceValue = onChainData?.balance != null ? onChainData.balance : (account.balance != null && account.balance >= 0 ? Number(account.balance) : 0);
    const stakedValue = [...(onChainData?.staking?.nodeInfos || []), ...(onChainData?.staking?.delegatorInfos || [])]
        .reduce((sum, info) => sum + Number(info.tokensStaked || 0), 0);

    return (
        <div className="min-h-screen bg-gray-50/50 dark:bg-black text-zinc-900 dark:text-white font-mono transition-colors duration-300 selection:bg-nothing-green selection:text-black">
            <div className="max-w-7xl mx-auto px-4 pt-12 pb-24">

                <Link to="/" className="inline-flex items-center gap-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors mb-6 group">
                    <ArrowLeft className="h-4 w-4 transform group-hover:-translate-x-1 transition-transform" />
                    <span className="text-xs uppercase tracking-widest">Back to Dashboard</span>
                </Link>

                <PageHeader
                    title={
                        <div className="flex items-center gap-3 md:gap-4">
                            <div className="shrink-0 w-10 h-10 md:w-16 md:h-16">
                                <Avatar
                                    size={64}
                                    name={normalizedAddress}
                                    variant="beam"
                                    colors={colorsFromAddress(normalizedAddress)}
                                />
                            </div>
                            <span>Account</span>
                            <button
                                onClick={() => setShowQR(true)}
                                className="p-1.5 rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
                            >
                                <QrCode className="h-4 w-4 text-zinc-400" />
                            </button>
                        </div>
                    }
                    subtitle={
                        <div className="space-y-1.5 min-w-0">
                            <div className="flex items-center gap-1 group min-w-0">
                                <span className="truncate">{normalizedAddress}</span>
                                <CopyButton
                                    content={normalizedAddress}
                                    variant="ghost"
                                    size="xs"
                                    className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity"
                                />
                            </div>
                            {onChainData?.coaAddress && (
                                <div className="flex items-center gap-1.5 group">
                                    <COABadge evmAddress={onChainData.coaAddress} />
                                    <CopyButton
                                        content={`0x${onChainData.coaAddress}`}
                                        variant="ghost"
                                        size="xs"
                                        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity"
                                    />
                                </div>
                            )}
                        </div>
                    }
                >
                    <div className="text-left md:text-right">
                        <div className="text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-400 mb-1">Balance</div>
                        <div className="text-xl md:text-3xl font-bold">
                            <SafeNumberFlow value={balanceValue} /> <span className="text-sm text-zinc-500 font-normal">FLOW</span>
                        </div>
                    </div>
                </PageHeader>

                {/* QR Code Modal */}
                <AnimatePresence>
                    {showQR && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
                            onClick={() => setShowQR(false)}
                        >
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                transition={{ duration: 0.15 }}
                                className="relative w-[320px] rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-2xl p-8"
                                onClick={(e) => e.stopPropagation()}
                            >
                                {/* Avatar + Network */}
                                <div className="flex flex-col items-center gap-3 mb-6">
                                    <Avatar
                                        size={48}
                                        name={normalizedAddress}
                                        variant="beam"
                                        colors={colorsFromAddress(normalizedAddress)}
                                    />
                                    <span className="text-xs uppercase tracking-widest text-zinc-500 dark:text-zinc-400 font-medium">
                                        Flow Mainnet
                                    </span>
                                </div>

                                {/* QR Code */}
                                <div className="flex justify-center mb-5">
                                    <div className="p-4 rounded-xl bg-white">
                                        <QRCodeSVG
                                            value={normalizedAddress}
                                            size={180}
                                            fgColor="#18181b"
                                            bgColor="#ffffff"
                                            level="M"
                                        />
                                    </div>
                                </div>

                                {/* Address */}
                                <div className="flex items-center justify-center gap-1.5 mb-5">
                                    <span className="text-xs font-mono text-zinc-600 dark:text-zinc-300 break-all text-center leading-relaxed">
                                        {normalizedAddress}
                                    </span>
                                    <CopyButton
                                        content={normalizedAddress}
                                        variant="ghost"
                                        size="xs"
                                        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 shrink-0"
                                    />
                                </div>

                                {/* Warning */}
                                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40">
                                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                                    <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                                        Only send <strong>Flow network</strong> assets to this address. Sending assets from other networks may result in permanent loss.
                                    </p>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* RPC unavailable banner */}
                {account._rpcUnavailable && (
                    <div className="flex items-center gap-3 border border-amber-300 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-900/10 px-4 py-3 mb-6 rounded-sm">
                        <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                            Live on-chain data is temporarily unavailable for this account (storage limit exceeded). Showing indexed data only — balance and some details may be incomplete.
                        </p>
                    </div>
                )}

                {/* Overview Cards */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-8 md:mb-12">
                    <GlassCard className="p-3 md:p-6 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Coins className="h-12 w-12" />
                        </div>
                        <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Total Staked</p>
                        <p className="text-2xl font-bold">
                            <SafeNumberFlow value={stakedValue} />
                        </p>
                        {onChainData?.staking && (
                            <p className="text-[10px] text-zinc-400 mt-2">
                                {(onChainData.staking.nodeInfos?.length || 0)} node(s), {(onChainData.staking.delegatorInfos?.length || 0)} delegation(s)
                            </p>
                        )}
                    </GlassCard>

                    <GlassCard className="p-3 md:p-6 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Database className="h-12 w-12" />
                        </div>
                        <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Storage Used</p>

                        <div className="mt-2">
                            <div className="flex justify-between items-baseline mb-2">
                                <span className="text-2xl font-bold">
                                    {Math.round(Number(onChainData?.storage?.storageUsedInMB || 0) * 100) / 100} <span className="text-xs font-normal text-zinc-500">MB</span>
                                </span>
                                <span className="text-xs text-zinc-500">
                                    of {Math.round(Number(onChainData?.storage?.storageCapacityInMB || 0) * 100) / 100} MB
                                </span>
                            </div>

                            <div className="h-2 w-full bg-zinc-100 dark:bg-white/10 rounded-full overflow-hidden">
                                <motion.div
                                    className="h-full bg-nothing-green"
                                    initial={{ width: 0 }}
                                    animate={{
                                        width: `${Math.min((Number(onChainData?.storage?.storageUsedInMB || 0) / Number(onChainData?.storage?.storageCapacityInMB || 1)) * 100, 100)}%`
                                    }}
                                    transition={{ duration: 1, ease: "easeOut" }}
                                />
                            </div>
                        </div>
                    </GlassCard>

                    <GlassCard className="p-3 md:p-6 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Key className="h-12 w-12" />
                        </div>
                        <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Keys</p>
                        <p className="text-2xl font-bold">
                            {account.keys?.length || 0}
                        </p>
                    </GlassCard>

                    <GlassCard className="p-3 md:p-6 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <FileText className="h-12 w-12" />
                        </div>
                        <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Contracts</p>
                        <p className="text-2xl font-bold">
                            {account.contracts?.length || 0}
                        </p>
                    </GlassCard>
                </div>

                {/* Tabs & Content */}
                <div className="space-y-6">
                    {/* Mobile Tab Selector */}
                    <div className="md:hidden sticky top-2 z-50">
                        <select
                            value={activeTab}
                            onChange={(e) => setActiveTab(e.target.value as AccountTab)}
                            className="w-full px-4 py-3 text-sm font-bold uppercase tracking-wider bg-white/90 dark:bg-zinc-900/90 backdrop-blur-md border border-zinc-200 dark:border-white/10 shadow-lg rounded-sm appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2216%22%20height%3D%2216%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22%2371717a%22%20stroke-width%3D%222%22%3E%3Cpath%20d%3D%22m6%209%206%206%206-6%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_12px_center] bg-no-repeat text-zinc-900 dark:text-white"
                        >
                            {tabs.map(({ id, label }) => (
                                <option key={id} value={id}>{label}</option>
                            ))}
                        </select>
                    </div>

                    {/* Desktop Floating Tab Bar */}
                    <div className="hidden md:block sticky top-4 z-50">
                        <div className="bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md shadow-lg border border-zinc-200 dark:border-white/10 p-1.5 inline-flex flex-wrap gap-1 max-w-full overflow-x-auto relative">
                            {tabs.map(({ id, label, icon: Icon }) => {
                                const isActive = activeTab === id;
                                return (
                                    <button
                                        key={id}
                                        onClick={() => setActiveTab(id)}
                                        className={cn(
                                            "relative px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors flex items-center gap-2 whitespace-nowrap z-10",
                                            isActive ? "text-white dark:text-zinc-900" : "text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
                                        )}
                                    >
                                        {isActive && (
                                            <motion.div
                                                layoutId="activeTab"
                                                className="absolute inset-0 bg-zinc-900 dark:bg-white -z-10 shadow-md"
                                                transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                                            />
                                        )}
                                        <Icon className="h-3.5 w-3.5" />
                                        {label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="min-h-[500px]">
                        {activeTab === 'activity' && <AccountActivityTab address={address} initialTransactions={initialTransactions} initialNextCursor={initialNextCursor} subtab={activeSubTab} onSubTabChange={setActiveSubTab} />}
                        {activeTab === 'balance' && <AccountBalanceTab address={normalizedAddress} />}
                        {activeTab === 'tokens' && <AccountTokensTab address={address} />}
                        {activeTab === 'nfts' && <AccountNFTsTab address={address} />}
                        {activeTab === 'staking' && <AccountStakingTab address={address} />}
                        {activeTab === 'keys' && <AccountKeysTab account={account} />}
                        {activeTab === 'contracts' && <AccountContractsTab address={address} contracts={account.contracts || []} />}
                        {activeTab === 'storage' && <AccountStorageTab address={address} />}
                        {activeTab === 'linked' && <AccountLinkedAccountsTab address={address} />}
                    </div>
                </div>
            </div>
        </div>
    );
}

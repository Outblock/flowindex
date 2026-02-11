import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState, useEffect } from 'react';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import { getAccountsByAddress, getAccountsByAddressTransactions } from '../../api/gen/core';
import {
    ArrowLeft, User, Activity, Key, Coins, Image as ImageIcon,
    FileText, HardDrive, ArrowRightLeft, Repeat
} from 'lucide-react';
import { SafeNumberFlow } from '../../components/SafeNumberFlow';
import { normalizeAddress } from '../../components/account/accountUtils';
import { AccountActivityTab } from '../../components/account/AccountActivityTab';
import { AccountTokensTab } from '../../components/account/AccountTokensTab';
import { AccountNFTsTab } from '../../components/account/AccountNFTsTab';
import { AccountKeysTab } from '../../components/account/AccountInfoTab';
import { AccountContractsTab } from '../../components/account/AccountContractsTab';
import { AccountStorageTab } from '../../components/account/AccountStorageTab';
import { AccountFTTransfersTab } from '../../components/account/AccountFTTransfersTab';
import { AccountNFTTransfersTab } from '../../components/account/AccountNFTTransfersTab';

const VALID_TABS = ['activity', 'ft-transfers', 'nft-transfers', 'tokens', 'nfts', 'keys', 'contracts', 'storage'] as const;
type AccountTab = (typeof VALID_TABS)[number];

export const Route = createFileRoute('/accounts/$address')({
    component: AccountDetail,
    pendingComponent: AccountDetailPending,
    validateSearch: (search: Record<string, unknown>): { tab?: AccountTab } => {
        const tab = search.tab as string;
        return { tab: VALID_TABS.includes(tab as AccountTab) ? (tab as AccountTab) : undefined };
    },
    loader: async ({ params }) => {
        try {
            const address = params.address;
            const normalized = address.toLowerCase().startsWith('0x') ? address.toLowerCase() : `0x${address.toLowerCase()}`;
            await ensureHeyApiConfigured();
            const accountRes = await getAccountsByAddress({ path: { address: normalized } });
            const accountPayload: any = accountRes.data;
            const normalizedKeys = (accountPayload?.keys || []).map((key: any) => ({
                keyIndex: key.keyIndex ?? key.key_index ?? key.index,
                publicKey: key.publicKey ?? key.public_key ?? '',
                signingAlgorithm: key.signingAlgorithm ?? key.sign_algo ?? key.signing_algorithm ?? '',
                hashingAlgorithm: key.hashingAlgorithm ?? key.hash_algo ?? key.hashing_algorithm ?? '',
                weight: key.weight ?? 0,
                sequenceNumber: key.sequenceNumber ?? key.sequence_number ?? 0,
                revoked: Boolean(key.revoked),
            }));

            const initialAccount = {
                address: normalized,
                balance: accountPayload?.balance,
                createdAt: null,
                contracts: accountPayload?.contracts || [],
                keys: normalizedKeys
            };

            let initialTransactions: any[] = [];
            try {
                const txRes = await getAccountsByAddressTransactions({ path: { address: normalized }, query: { cursor: '', limit: 20 } });
                const payload: any = txRes.data;
                const items = payload?.items ?? (Array.isArray(payload) ? payload : []);
                initialTransactions = (items || []).map((tx: any) => ({
                    ...tx,
                    type: tx.status === 'SEALED' ? 'TRANSFER' : 'PENDING',
                    payer: tx.payer_address || tx.proposer_address,
                    proposer: tx.proposer_address,
                    blockHeight: tx.block_height
                }));
            } catch (e) {
                console.error("Failed to prefetch transactions", e);
            }

            return { account: initialAccount, initialTransactions };
        } catch (e) {
            console.error("Failed to load account data", e);
            return { account: null, initialTransactions: [] };
        }
    }
})

function AccountDetailPending() {
    return (
        <div className="min-h-screen bg-gray-50 dark:bg-black text-zinc-900 dark:text-zinc-300 font-mono transition-colors duration-300">
            <div className="fixed inset-x-0 top-0 z-[9999] h-[3px] overflow-hidden bg-nothing-green/10">
                <div className="h-full w-1/2 bg-nothing-green" style={{ animation: 'route-pending-bar 1s ease-in-out infinite' }} />
            </div>
            <div className="max-w-6xl mx-auto px-4 pt-24 pb-16">
                <div className="flex items-center gap-4 mb-8 animate-shimmer">
                    <div className="h-8 w-8 bg-zinc-200 dark:bg-white/10 rounded-sm" />
                    <div className="h-6 w-64 bg-zinc-200 dark:bg-white/10 rounded-sm" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="border border-zinc-200 dark:border-white/10 p-6 bg-white dark:bg-nothing-dark shadow-sm dark:shadow-none animate-shimmer">
                            <div className="h-3 w-20 bg-zinc-200 dark:bg-white/10 rounded-sm mb-3" />
                            <div className="h-8 w-32 bg-zinc-200 dark:bg-white/10 rounded-sm" />
                        </div>
                    ))}
                </div>
                <div className="flex gap-2 mb-0 border-b border-zinc-200 dark:border-white/10 pb-0">
                    {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="h-10 w-24 bg-zinc-200 dark:bg-white/10 rounded-sm animate-shimmer" />
                    ))}
                </div>
                <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 border-t-0 p-6 min-h-[200px] shadow-sm dark:shadow-none">
                    <div className="h-4 w-36 bg-zinc-200 dark:bg-white/10 rounded-sm mb-6 animate-shimmer" />
                    <div className="space-y-4">
                        {[0, 1].map((i) => (
                            <div key={i}>
                                <div className="h-3 w-16 bg-zinc-200 dark:bg-white/10 rounded-sm mb-2 animate-shimmer" />
                                <div className="h-4 w-48 bg-zinc-200 dark:bg-white/10 rounded-sm animate-shimmer" />
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

function AccountDetail() {
    const { address } = Route.useParams();
    const { tab: searchTab } = Route.useSearch();
    const { account: initialAccount, initialTransactions } = Route.useLoaderData();
    const navigate = useNavigate();

    const [account, setAccount] = useState<any>(initialAccount);
    const [error, setError] = useState<any>(initialAccount ? null : 'Account not found');
    const activeTab: AccountTab = searchTab || 'activity';
    const setActiveTab = (tab: AccountTab) => {
        navigate({ search: { tab }, replace: true });
    };

    const normalizedAddress = normalizeAddress(address);

    // Refresh account on route change
    useEffect(() => {
        if (account?.address === normalizedAddress) return;

        let cancelled = false;
        const refresh = async () => {
            try {
                await ensureHeyApiConfigured();
                const res = await getAccountsByAddress({ path: { address: normalizedAddress } });
                const payload: any = res.data;
                const keys = (payload?.keys || []).map((key: any) => ({
                    keyIndex: key.keyIndex ?? key.key_index ?? key.index,
                    publicKey: key.publicKey ?? key.public_key ?? '',
                    signingAlgorithm: key.signingAlgorithm ?? key.sign_algo ?? key.signing_algorithm ?? '',
                    hashingAlgorithm: key.hashingAlgorithm ?? key.hash_algo ?? key.hashing_algorithm ?? '',
                    weight: key.weight ?? 0,
                    sequenceNumber: key.sequenceNumber ?? key.sequence_number ?? 0,
                    revoked: Boolean(key.revoked),
                }));
                if (cancelled) return;
                setAccount({ address: normalizedAddress, balance: payload?.balance, createdAt: null, contracts: payload?.contracts || [], keys });
                setError(null);
            } catch (e) {
                if (cancelled) return;
                console.error('Failed to refresh account', e);
                setError('Account not found');
            }
        };
        refresh();
        return () => { cancelled = true; };
    }, [address, normalizedAddress]);

    if (error || !account) {
        return (
            <div className="min-h-screen bg-white dark:bg-black flex items-center justify-center font-mono transition-colors duration-300">
                <div className="border border-red-500/30 bg-red-50 dark:bg-nothing-dark p-8 max-w-md text-center shadow-sm">
                    <User className="h-12 w-12 text-red-500 mx-auto mb-4" />
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white uppercase tracking-widest mb-2">Account Not Found</h2>
                    <p className="text-zinc-600 dark:text-zinc-500 text-xs mb-6">The requested account could not be located.</p>
                    <Link to="/" className="inline-block w-full border border-zinc-200 dark:border-white/20 hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-900 dark:text-white text-xs uppercase tracking-widest py-3 transition-all">
                        Return to Dashboard
                    </Link>
                </div>
            </div>
        );
    }

    const tabs = [
        { id: 'activity' as const, label: 'Activity', icon: Activity },
        { id: 'ft-transfers' as const, label: 'FT Transfers', icon: ArrowRightLeft },
        { id: 'nft-transfers' as const, label: 'NFT Transfers', icon: Repeat },
        { id: 'tokens' as const, label: 'Tokens', icon: Coins },
        { id: 'nfts' as const, label: 'NFTs', icon: ImageIcon },
        { id: 'keys' as const, label: 'Public Keys', icon: Key },
        { id: 'contracts' as const, label: `Contracts (${account.contracts?.length || 0})`, icon: FileText },
        { id: 'storage' as const, label: 'Storage', icon: HardDrive },
    ];

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-black text-zinc-900 dark:text-zinc-300 font-mono transition-colors duration-300">
            <div className="max-w-6xl mx-auto px-4 pt-24 pb-16">
                {/* Header */}
                <div className="flex items-center gap-4 mb-8">
                    <Link to="/" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors">
                        <ArrowLeft className="h-5 w-5" />
                    </Link>
                    <div>
                        <h1 className="text-xl font-bold text-zinc-900 dark:text-white uppercase tracking-widest">Account</h1>
                        <p className="text-xs font-mono text-zinc-500 mt-1">{account.address}</p>
                    </div>
                </div>

                {/* Summary cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                    <div className="border border-zinc-200 dark:border-white/10 p-6 bg-white dark:bg-nothing-dark shadow-sm dark:shadow-none">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Balance</p>
                        <p className="text-2xl font-bold text-zinc-900 dark:text-white">
                            <SafeNumberFlow value={account.balance != null ? Number(account.balance) / 1e8 : 0} /> <span className="text-sm text-zinc-500">FLOW</span>
                        </p>
                    </div>
                    <div className="border border-zinc-200 dark:border-white/10 p-6 bg-white dark:bg-nothing-dark shadow-sm dark:shadow-none">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Keys</p>
                        <p className="text-2xl font-bold text-zinc-900 dark:text-white">{account.keys?.length || 0}</p>
                    </div>
                    <div className="border border-zinc-200 dark:border-white/10 p-6 bg-white dark:bg-nothing-dark shadow-sm dark:shadow-none">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Contracts</p>
                        <p className="text-2xl font-bold text-zinc-900 dark:text-white">{account.contracts?.length || 0}</p>
                    </div>
                </div>

                {/* Tabs */}
                <div className="mb-8">
                    <div className="flex flex-wrap border-b border-zinc-200 dark:border-white/10 mb-0">
                        {tabs.map(({ id, label, icon: Icon }) => (
                            <button
                                key={id}
                                onClick={() => setActiveTab(id)}
                                className={`px-5 py-3 text-xs uppercase tracking-widest transition-colors ${activeTab === id
                                    ? 'text-zinc-900 dark:text-white border-b-2 border-nothing-green-dark dark:border-nothing-green bg-zinc-100 dark:bg-white/5'
                                    : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5'
                                }`}
                            >
                                <span className="flex items-center gap-2">
                                    <Icon className={`h-4 w-4 ${activeTab === id ? 'text-nothing-green-dark dark:text-nothing-green' : ''}`} />
                                    {label}
                                </span>
                            </button>
                        ))}
                    </div>

                    <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 border-t-0 p-6 min-h-[200px] shadow-sm dark:shadow-none">
                        {activeTab === 'activity' && <AccountActivityTab address={address} initialTransactions={initialTransactions} />}
                        {activeTab === 'ft-transfers' && <AccountFTTransfersTab address={address} />}
                        {activeTab === 'nft-transfers' && <AccountNFTTransfersTab address={address} />}
                        {activeTab === 'tokens' && <AccountTokensTab address={address} />}
                        {activeTab === 'nfts' && <AccountNFTsTab address={address} />}
                        {activeTab === 'keys' && <AccountKeysTab account={account} />}
                        {activeTab === 'contracts' && <AccountContractsTab address={address} contracts={account.contracts || []} />}
                        {activeTab === 'storage' && <AccountStorageTab address={address} />}
                    </div>
                </div>
            </div>
        </div>
    );
}

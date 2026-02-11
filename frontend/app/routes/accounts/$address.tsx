import { createFileRoute, Link, useRouterState } from '@tanstack/react-router'
import { useState, useEffect } from 'react';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import {
    getAccountsByAddress,
    getAccountsByAddressTransactions,
    getAccountsByAddressTokenTransfers,
    getAccountsByAddressNftTransfers,
    getAccountsByAddressContractsByName,
    getAccountsByAddressStorage,
    getAccountsByAddressStorageLinks,
    getAccountsByAddressStorageItem,
} from '../../api/gen/core';
import type { FTVaultInfo, StorageInfo as FCLStorageInfo, NFTCollectionInfo } from '../../../cadence/cadence.gen';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift';
import { vscDarkPlus, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
    ArrowLeft, ArrowRightLeft, User, Activity, Wallet, Key, Code, Coins, Image as ImageIcon,
    FileText, HardDrive, Folder, FolderOpen, File, ChevronRight, ChevronDown
} from 'lucide-react';
import { SafeNumberFlow } from '../../components/SafeNumberFlow';
import { useTheme } from '../../contexts/ThemeContext';

SyntaxHighlighter.registerLanguage('cadence', swift);

export const Route = createFileRoute('/accounts/$address')({
    component: AccountDetail,
    pendingComponent: AccountDetailPending,
    loader: async ({ params }) => {
        try {
            const address = params.address;
            const normalizedAddress = address.toLowerCase().startsWith('0x') ? address.toLowerCase() : `0x${address.toLowerCase()}`;
            await ensureHeyApiConfigured();
            const accountRes = await getAccountsByAddress({ path: { address: normalizedAddress } });
            const accountPayload: any = accountRes.data;
            const normalizedKeys = (accountPayload?.keys || []).map((key) => ({
                keyIndex: key.keyIndex ?? key.key_index ?? key.index,
                publicKey: key.publicKey ?? key.public_key ?? '',
                signingAlgorithm: key.signingAlgorithm ?? key.sign_algo ?? key.signing_algorithm ?? '',
                hashingAlgorithm: key.hashingAlgorithm ?? key.hash_algo ?? key.hashing_algorithm ?? '',
                weight: key.weight ?? 0,
                sequenceNumber: key.sequenceNumber ?? key.sequence_number ?? 0,
                revoked: Boolean(key.revoked),
            }));

            const initialAccount = {
                address: normalizedAddress,
                balance: accountPayload?.balance,
                createdAt: null,
                contracts: accountPayload?.contracts || [],
                keys: normalizedKeys
            };

            // We could also prefetch initial transactions here if desired, 
            // but to keep initial load fast we might just load account details.
            // Let's load first page of transactions to populate initial view.
            let initialTransactions = [];
            try {
                // Note: using cursor '' for first page
                const txRes = await getAccountsByAddressTransactions({ path: { address: normalizedAddress }, query: { cursor: '', limit: 20 } });
                const payload: any = txRes.data;
                const items = payload?.items ?? (Array.isArray(payload) ? payload : []);
                initialTransactions = (items || []).map(tx => ({
                    ...tx,
                    type: tx.status === 'SEALED' ? 'TRANSFER' : 'PENDING',
                    payer: tx.payer_address || tx.proposer_address, // we will normalize in component if needed
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
            {/* Top progress bar */}
            <div className="fixed inset-x-0 top-0 z-[9999] h-[3px] overflow-hidden bg-nothing-green/10">
                <div
                    className="h-full w-1/2 bg-nothing-green"
                    style={{ animation: 'route-pending-bar 1s ease-in-out infinite' }}
                />
            </div>

            <div className="container mx-auto px-4 py-8 max-w-6xl">
                {/* Back button skeleton */}
                <div className="h-4 w-40 bg-zinc-200 dark:bg-white/5 rounded-sm mb-8 animate-shimmer" />

                {/* Header skeleton */}
                <div className="border border-zinc-200 dark:border-white/10 p-8 mb-8 bg-white dark:bg-nothing-dark shadow-sm dark:shadow-none">
                    <div className="h-5 w-20 bg-zinc-200 dark:bg-white/10 rounded-sm mb-4 animate-shimmer" />
                    <div className="h-8 w-72 bg-zinc-200 dark:bg-white/10 rounded-sm animate-shimmer" />
                </div>

                {/* Stats cards skeleton */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="border border-zinc-200 dark:border-white/10 p-6 bg-white dark:bg-nothing-dark shadow-sm dark:shadow-none">
                            <div className="h-3 w-16 bg-zinc-200 dark:bg-white/10 rounded-sm mb-3 animate-shimmer" />
                            <div className="h-7 w-28 bg-zinc-200 dark:bg-white/10 rounded-sm animate-shimmer" />
                        </div>
                    ))}
                </div>

                {/* Tabs skeleton */}
                <div className="flex border-b border-zinc-200 dark:border-white/10 mb-0">
                    {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="px-6 py-3">
                            <div className="h-4 w-20 bg-zinc-200 dark:bg-white/10 rounded-sm animate-shimmer" />
                        </div>
                    ))}
                </div>

                {/* Tab content skeleton */}
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
    const { account: initialAccount, initialTransactions } = Route.useLoaderData();
    const location = useRouterState({ select: (s) => s.location });
    const { theme } = useTheme();

    const [account, setAccount] = useState<any>(initialAccount);
    const [transactions, setTransactions] = useState<any[]>(initialTransactions);
    // const [loading, setLoading] = useState(true); // handled by loader
    const [error, setError] = useState<any>(initialAccount ? null : 'Account not found');
    const [activeTab, setActiveTab] = useState<'info' | 'keys' | 'contracts' | 'storage' | 'activity' | 'transfers' | 'tokens' | 'nfts'>('activity');

    const syntaxTheme = theme === 'dark' ? vscDarkPlus : oneLight;

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [txLoading, setTxLoading] = useState(false);
    const [txCursors, setTxCursors] = useState({ 1: '' });
    const [txHasNext, setTxHasNext] = useState(false); // We need to check next_cursor from initial load if we want perfect hydration state, but simpler to start false/check in client
    const [tokenTransfers, setTokenTransfers] = useState<any[]>([]);
    const [tokenCursor, setTokenCursor] = useState('');
    const [tokenHasMore, setTokenHasMore] = useState(false);
    const [tokenLoading, setTokenLoading] = useState(false);
    const [nftTransfers, setNftTransfers] = useState<any[]>([]);
    const [nftCursor, setNftCursor] = useState('');
    const [nftHasMore, setNftHasMore] = useState(false);
    const [nftLoading, setNftLoading] = useState(false);

    // FCL-based Tokens tab
    const [fclTokens, setFclTokens] = useState<FTVaultInfo[]>([]);
    const [fclStorage, setFclStorage] = useState<FCLStorageInfo | null>(null);
    const [fclTokensLoading, setFclTokensLoading] = useState(false);
    const [fclTokensError, setFclTokensError] = useState<string | null>(null);

    // FCL-based NFTs tab
    const [fclNFTCollections, setFclNFTCollections] = useState<NFTCollectionInfo[]>([]);
    const [fclNFTsLoading, setFclNFTsLoading] = useState(false);
    const [fclNFTsError, setFclNFTsError] = useState<string | null>(null);

    // NFT collection expand state: { [storagePath]: { nfts, nftCount, loading, error, page } }
    const [expandedNFTs, setExpandedNFTs] = useState<Record<string, { nfts: any[]; nftCount: number; loading: boolean; error: string | null; page: number }>>({});

    useEffect(() => {
        const normalizedAddress = address.toLowerCase().startsWith('0x') ? address.toLowerCase() : `0x${address.toLowerCase()}`;
        if (account?.address === normalizedAddress) return;

        let cancelled = false;
        const refreshAccount = async () => {
            try {
                await ensureHeyApiConfigured();
                const accountRes = await getAccountsByAddress({ path: { address: normalizedAddress } });
                const accountPayload: any = accountRes.data;
                const normalizedKeys = (accountPayload?.keys || []).map((key) => ({
                    keyIndex: key.keyIndex ?? key.key_index ?? key.index,
                    publicKey: key.publicKey ?? key.public_key ?? '',
                    signingAlgorithm: key.signingAlgorithm ?? key.sign_algo ?? key.signing_algorithm ?? '',
                    hashingAlgorithm: key.hashingAlgorithm ?? key.hash_algo ?? key.hashing_algorithm ?? '',
                    weight: key.weight ?? 0,
                    sequenceNumber: key.sequenceNumber ?? key.sequence_number ?? 0,
                    revoked: Boolean(key.revoked),
                }));
                const nextAccount = {
                    address: normalizedAddress,
                    balance: accountPayload?.balance,
                    createdAt: null,
                    contracts: accountPayload?.contracts || [],
                    keys: normalizedKeys
                };

                const txRes = await getAccountsByAddressTransactions({
                    path: { address: normalizedAddress },
                    query: { cursor: '', limit: 20 }
                });
                const payload: any = txRes.data;
                const items = payload?.items ?? (Array.isArray(payload) ? payload : []);
                const initialTx = (items || []).map(tx => ({
                    ...tx,
                    type: tx.status === 'SEALED' ? 'TRANSFER' : 'PENDING',
                    payer: tx.payer_address || tx.proposer_address,
                    proposer: tx.proposer_address,
                    blockHeight: tx.block_height
                }));

                if (cancelled) return;
                setAccount(nextAccount);
                setTransactions(initialTx);
                setCurrentPage(1);
                setTxCursors({ 1: '' });
                setTxHasNext(Boolean(payload?.next_cursor));
                setError(null);
            } catch (e) {
                if (cancelled) return;
                console.error('Failed to refresh account route', e);
                setError('Account not found');
            }
        };

        refreshAccount();
        return () => {
            cancelled = true;
        };
    }, [address, location?.pathname]);

    // Contract code viewer
    const [selectedContract, setSelectedContract] = useState('');
    const [selectedContractCode, setSelectedContractCode] = useState('');
    const [contractCodeLoading, setContractCodeLoading] = useState(false);
    const [contractCodeError, setContractCodeError] = useState<any>(null);

    // Storage viewer (JSON-CDC)
    const [storageOverview, setStorageOverview] = useState<any>(null);
    const [storageSelected, setStorageSelected] = useState<any>(null);
    const [storageItem, setStorageItem] = useState<any>(null);
    const [storageLoading, setStorageLoading] = useState(false);
    const [storageError, setStorageError] = useState<any>(null);
    const [expandedDomains, setExpandedDomains] = useState({ storage: true, public: true, private: false });

    const normalizeAddress = (value) => {
        if (!value) return '';
        const lower = String(value).toLowerCase();
        return lower.startsWith('0x') ? lower : `0x${lower}`;
    };

    const formatShort = (value, head = 8, tail = 6) => {
        if (!value) return 'N/A';
        const normalized = normalizeAddress(value);
        if (normalized.length <= head + tail + 3) return normalized;
        return `${normalized.slice(0, head)}...${normalized.slice(-tail)}`;
    };

    const decodeCadenceValue = (val) => {
        if (!val || typeof val !== 'object') return val;

        if (val.value !== undefined) {
            if (val.type === 'Optional') return val.value ? decodeCadenceValue(val.value) : null;
            if (val.type === 'Array') return Array.isArray(val.value) ? val.value.map(decodeCadenceValue) : [];
            if (val.type === 'Dictionary') {
                const dict = {};
                (val.value || []).forEach((item) => {
                    const k = decodeCadenceValue(item.key);
                    const v = decodeCadenceValue(item.value);
                    dict[String(k)] = v;
                });
                return dict;
            }
            if (val.type === 'Struct' || val.type === 'Resource' || val.type === 'Event') {
                const obj = {};
                if (val.value && Array.isArray(val.value.fields)) {
                    val.value.fields.forEach((f) => {
                        obj[f.name] = decodeCadenceValue(f.value);
                    });
                    return obj;
                }
            }
            if (val.type === 'Path') {
                const domain = val.value?.domain ?? '';
                const identifier = val.value?.identifier ?? '';
                return domain && identifier ? `${domain}/${identifier}` : '';
            }
            if (val.type === 'Type') return val.value?.staticType ?? '';
            if (val.type === 'Address') return normalizeAddress(val.value);

            return val.value;
        }

        return val;
    };

    const formatStorageBytes = (bytes: any): string => {
        const n = Number(bytes);
        if (!Number.isFinite(n) || n === 0) return '0 B';
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
        return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    };

    const normalizedAddress = normalizeAddress(address);

    // We rely on loader for initial data, but if params change we might want effect?
    // Tanstack Router handles component remount/loader refresh usually. 
    // But let's keep the client-side load effects for pagination/contracts/storage/tokens

    useEffect(() => {
        // If navigating between accounts, reset state
        if (!initialAccount) {
            setError('Account not found');
        } else {
            setAccount(initialAccount);
            setError(null);
            setTransactions(initialTransactions);
        }
        // Reset other states
        setSelectedContract('');
        setSelectedContractCode('');
        setContractCodeError(null);
        setStorageOverview(null);
        setStorageSelected(null);
        setStorageItem(null);
        setStorageError(null);

        setCurrentPage(1);
        setTxCursors({ 1: '' });
        setTxHasNext(false); // Initial load doesn't give us next cursor unless we pass it from loader. 
        // Improvement: pass cursor info from loader. For now, assume single page or let client fetch next if user paginates.

        setTokenTransfers([]);
        setTokenCursor('');
        setTokenHasMore(false);
        setNftTransfers([]);
        setNftCursor('');
        setNftHasMore(false);

        setFclTokens([]);
        setFclStorage(null);
        setFclTokensError(null);
        setFclNFTCollections([]);
        setFclNFTsError(null);
        setExpandedNFTs({});
    }, [initialAccount, initialTransactions, address]);


    const loadTransactions = async (page) => {
        setTxLoading(true);
        try {
            const cursor = txCursors[page] ?? '';
            await ensureHeyApiConfigured();
            const txRes = await getAccountsByAddressTransactions({ path: { address: normalizedAddress || address }, query: { cursor, limit: 20 } });
            const payload: any = txRes.data;
            const items = payload?.items ?? (Array.isArray(payload) ? payload : []);
            const nextCursor = payload?.next_cursor ?? '';
            const accountTxs = (items || [])
                .map(tx => ({
                    ...tx,
                    type: tx.status === 'SEALED' ? 'TRANSFER' : 'PENDING',
                    payer: normalizeAddress(tx.payer_address || tx.proposer_address),
                    proposer: normalizeAddress(tx.proposer_address),
                    blockHeight: tx.block_height
                }));
            setTransactions(accountTxs);
            setTxHasNext(Boolean(nextCursor));
            if (nextCursor) {
                setTxCursors(prev => ({ ...prev, [page + 1]: nextCursor }));
            }
        } catch (err) {
            console.error("Failed to load transactions", err);
        } finally {
            setTxLoading(false);
        }
    };

    const loadTokenTransfers = async (cursorValue, append) => {
        setTokenLoading(true);
        try {
            await ensureHeyApiConfigured();
            const tokenRes = await getAccountsByAddressTokenTransfers({ path: { address: normalizedAddress || address }, query: { cursor: cursorValue, limit: 20 } });
            const payload: any = tokenRes.data;
            const items = payload?.items ?? payload ?? [];
            const nextCursor = payload?.next_cursor ?? '';
            setTokenTransfers(prev => (append ? [...prev, ...items] : items));
            setTokenCursor(nextCursor || '');
            setTokenHasMore(Boolean(nextCursor));
        } catch (err) {
            console.error('Failed to load token transfers', err);
        } finally {
            setTokenLoading(false);
        }
    };

    const loadNFTTransfers = async (cursorValue, append) => {
        setNftLoading(true);
        try {
            await ensureHeyApiConfigured();
            const nftRes = await getAccountsByAddressNftTransfers({ path: { address: normalizedAddress || address }, query: { cursor: cursorValue, limit: 20 } });
            const payload: any = nftRes.data;
            const items = payload?.items ?? payload ?? [];
            const nextCursor = payload?.next_cursor ?? '';
            setNftTransfers(prev => (append ? [...prev, ...items] : items));
            setNftCursor(nextCursor || '');
            setNftHasMore(Boolean(nextCursor));
        } catch (err) {
            console.error('Failed to load NFT transfers', err);
        } finally {
            setNftLoading(false);
        }
    };

    const loadFclTokens = async () => {
        setFclTokensLoading(true);
        setFclTokensError(null);
        try {
            const { cadenceService } = await import('../../fclConfig');
            const res = await cadenceService.getToken(normalizedAddress || address);
            setFclTokens(res.tokens || []);
            setFclStorage(res.storage || null);
        } catch (err) {
            console.error('Failed to load FCL tokens', err);
            setFclTokensError('Failed to load token data');
        } finally {
            setFclTokensLoading(false);
        }
    };

    const loadFclNFTCollections = async () => {
        setFclNFTsLoading(true);
        setFclNFTsError(null);
        try {
            const { cadenceService } = await import('../../fclConfig');
            const collections = await cadenceService.getNftCollections(normalizedAddress || address);
            setFclNFTCollections(collections || []);
        } catch (err) {
            console.error('Failed to load NFT collections', err);
            setFclNFTsError('Failed to load NFT collections');
        } finally {
            setFclNFTsLoading(false);
        }
    };

    const NFT_PAGE_SIZE = 12;

    const toggleCollectionNFTs = async (storagePath: string, page = 0) => {
        const pathId = storagePath.split('/').pop() || '';
        if (!pathId) return;

        // If already expanded and clicking again (page 0), collapse
        const existing = expandedNFTs[storagePath];
        if (existing && page === 0 && !existing.loading) {
            setExpandedNFTs(prev => {
                const next = { ...prev };
                delete next[storagePath];
                return next;
            });
            return;
        }

        // Set loading
        setExpandedNFTs(prev => ({
            ...prev,
            [storagePath]: { nfts: existing?.nfts || [], nftCount: existing?.nftCount || 0, loading: true, error: null, page }
        }));

        try {
            const { cadenceService } = await import('../../fclConfig');
            const start = page * NFT_PAGE_SIZE;
            const end = start + NFT_PAGE_SIZE;
            const res = await cadenceService.getCollectionCount(normalizedAddress || address, pathId, start, end);
            const nfts = res?.nfts || [];
            const nftCount = res?.nftCount || 0;
            setExpandedNFTs(prev => ({
                ...prev,
                [storagePath]: { nfts, nftCount, loading: false, error: null, page }
            }));
        } catch (err) {
            console.error('Failed to load collection NFTs', err);
            setExpandedNFTs(prev => ({
                ...prev,
                [storagePath]: { nfts: [], nftCount: 0, loading: false, error: 'Failed to load NFTs', page }
            }));
        }
    };

    const getNFTThumbnail = (nft: any): string => {
        const display = nft?.display;
        if (!display) return '';
        const thumbnail = display.thumbnail || display;
        if (typeof thumbnail === 'string') return thumbnail;
        if (thumbnail?.url) return thumbnail.url;
        if (thumbnail?.cid) return `https://ipfs.io/ipfs/${thumbnail.cid}${thumbnail.path ? `/${thumbnail.path}` : ''}`;
        return '';
    };

    const loadContractCode = async (name) => {
        if (!name) return;
        setContractCodeLoading(true);
        setContractCodeError(null);
        setSelectedContract(name);
        setSelectedContractCode('');
        try {
            await ensureHeyApiConfigured();
            const res = await getAccountsByAddressContractsByName({ path: { address: normalizedAddress || address, name } });
            setSelectedContractCode(res?.data?.code || '');
        } catch (err) {
            console.error('Failed to load contract code', err);
            setContractCodeError('Failed to load contract code');
        } finally {
            setContractCodeLoading(false);
        }
    };

    const loadStorageOverview = async () => {
        setStorageLoading(true);
        setStorageError(null);
        setStorageItem(null);
        setStorageSelected(null);
        try {
            await ensureHeyApiConfigured();
            const res = await getAccountsByAddressStorage({ path: { address: normalizedAddress || address } });
            setStorageOverview(decodeCadenceValue(res?.data));
        } catch (err) {
            console.error('Failed to load storage overview', err);
            setStorageError('Failed to load storage overview');
        } finally {
            setStorageLoading(false);
        }
    };

    const browseStoragePath = async (pathValue, opts = {}) => {
        const str = String(pathValue || '');
        const parts = str.split('/');
        const identifier = parts[parts.length - 1] || '';
        if (!identifier) return;

        setStorageLoading(true);
        setStorageError(null);
        setStorageSelected(str);
        setStorageItem(null);
        try {
            await ensureHeyApiConfigured();
            const res = await getAccountsByAddressStorageItem({
                path: { address: normalizedAddress || address },
                query: { path: identifier, raw: opts?.raw ?? false, uuid: opts?.uuid ?? '' }
            });
            setStorageItem(decodeCadenceValue(res?.data));
        } catch (err) {
            console.error('Failed to browse storage item', err);
            setStorageError('Failed to browse storage item');
        } finally {
            setStorageLoading(false);
        }
    };

    useEffect(() => {
        if (currentPage > 1) { // Only fetch if not initial page (initial page handled by loader or initial transactions state)
            loadTransactions(currentPage);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentPage]);

    // Actually, we should probably fetch cursor for next page on mount?
    // Let's just rely on user interaction for pagination beyond page 1.


    useEffect(() => {
        if (activeTab === 'transfers') {
            if (tokenTransfers.length === 0 && !tokenLoading) loadTokenTransfers('', false);
            if (nftTransfers.length === 0 && !nftLoading) loadNFTTransfers('', false);
        }
        if (activeTab === 'tokens') {
            if (fclTokens.length === 0 && !fclTokensLoading) loadFclTokens();
        }
        if (activeTab === 'nfts') {
            if (fclNFTCollections.length === 0 && !fclNFTsLoading) loadFclNFTCollections();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, address]);

    useEffect(() => {
        if (activeTab !== 'storage') return;
        if (storageOverview || storageLoading) return;
        loadStorageOverview();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, address]);


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

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-black text-zinc-900 dark:text-zinc-300 font-mono selection:bg-nothing-green selection:text-black transition-colors duration-300">
            <div className="container mx-auto px-4 py-8 max-w-6xl">
                {/* Back Button */}
                <Link to="/" className="inline-flex items-center space-x-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors mb-8 group">
                    <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
                    <span className="text-xs uppercase tracking-widest">Return to Dashboard</span>
                </Link>

                {/* Header */}
                <div className="border border-zinc-200 dark:border-white/10 p-8 mb-8 relative overflow-hidden bg-white dark:bg-nothing-dark shadow-sm dark:shadow-none">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        <Wallet className="h-32 w-32" />
                    </div>

                    <div className="relative z-10 flex flex-col md:flex-row justify-between items-end gap-6">
                        <div>
                            <div className="flex items-center gap-2 mb-4">
                                <span className="text-nothing-green-dark dark:text-nothing-green text-xs uppercase tracking-[0.2em] border border-nothing-green-dark/30 dark:border-nothing-green/30 px-2 py-1 rounded-sm w-fit">
                                    Account
                                </span>
                            </div>

                            <h1 className="text-2xl md:text-3xl font-bold text-zinc-900 dark:text-white mb-2 break-all" title={account.address}>
                                {formatShort(account.address, 12, 8)}
                            </h1>
                        </div>
                    </div>
                </div>

                {/* Account Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    <div className="border border-zinc-200 dark:border-white/10 p-6 bg-white dark:bg-nothing-dark hover:border-nothing-green-dark/50 dark:hover:border-nothing-green/50 transition-colors shadow-sm dark:shadow-none">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Balance</p>
                        <p className="text-2xl font-bold text-zinc-900 dark:text-white overflow-hidden text-ellipsis flex items-center gap-2">
                            <SafeNumberFlow
                                value={account.balance || 0}
                                format={{ minimumFractionDigits: 0, maximumFractionDigits: 4 }}
                            />
                            <span className="text-sm text-nothing-green-dark dark:text-nothing-green">FLOW</span>
                        </p>
                    </div>
                    <div className="border border-zinc-200 dark:border-white/10 p-6 bg-white dark:bg-nothing-dark shadow-sm dark:shadow-none">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Transactions</p>
                        <p className="text-2xl font-bold text-zinc-900 dark:text-white">{transactions.length >= 10 ? '10+' : transactions.length}</p>
                    </div>
                    <div className="border border-zinc-200 dark:border-white/10 p-6 bg-white dark:bg-nothing-dark shadow-sm dark:shadow-none">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Contracts</p>
                        <p className="text-2xl font-bold text-zinc-900 dark:text-white">{account.contracts?.length || 0}</p>
                    </div>
                </div>

                {/* Tabs */}
                <div className="mb-8">
                    <div className="flex flex-wrap border-b border-zinc-200 dark:border-white/10 mb-0">
                        {[
                            { id: 'activity' as const, label: 'Activity', icon: Activity },
                            { id: 'tokens' as const, label: 'Tokens', icon: Coins },
                            { id: 'nfts' as const, label: 'NFTs', icon: ImageIcon },
                            { id: 'transfers' as const, label: 'Transfers', icon: ArrowRightLeft },
                            { id: 'info' as const, label: 'Account Info', icon: User },
                            { id: 'keys' as const, label: 'Public Keys', icon: Key },
                            { id: 'contracts' as const, label: `Contracts (${account.contracts?.length || 0})`, icon: FileText },
                            { id: 'storage' as const, label: 'Storage', icon: HardDrive },
                        ].map(({ id, label, icon: Icon }) => (
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
                        {activeTab === 'info' && (
                            <div className="space-y-4">
                                <h2 className="text-zinc-900 dark:text-white text-sm uppercase tracking-widest mb-6 border-b border-zinc-100 dark:border-white/5 pb-2">
                                    Account Overview
                                </h2>
                                <div className="group">
                                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Address</p>
                                    <p className="text-sm text-zinc-900 dark:text-white font-mono" title={account.address}>{formatShort(account.address, 12, 8)}</p>
                                </div>
                                <div className="group">
                                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Created At</p>
                                    <p className="text-sm text-zinc-900 dark:text-white font-mono">
                                        {account.createdAt ? new Date(account.createdAt).toLocaleString() : 'N/A'}
                                    </p>
                                </div>
                            </div>
                        )}

                        {activeTab === 'keys' && (
                            <div className="space-y-4">
                                <h2 className="text-zinc-900 dark:text-white text-sm uppercase tracking-widest mb-6 border-b border-zinc-100 dark:border-white/5 pb-2">
                                    Associated Public Keys
                                </h2>
                                {account.keys && account.keys.length > 0 ? (
                                    <div className="space-y-2">
                                        {account.keys.map((key, idx) => (
                                            <div key={idx} className="bg-zinc-50 dark:bg-black/40 border border-zinc-200 dark:border-white/5 p-5 group hover:border-nothing-green-dark/30 dark:hover:border-nothing-green/30 transition-colors rounded-sm">
                                                <div className="flex flex-col gap-4">
                                                    {/* Top Row: Metadata Badges */}
                                                    <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 dark:border-white/5 pb-3">
                                                        <div className="flex items-center gap-2 pr-3 border-r border-zinc-200 dark:border-white/5">
                                                            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Index</span>
                                                            <span className="text-xs text-zinc-900 dark:text-white font-mono">#{key.keyIndex ?? idx}</span>
                                                        </div>

                                                        <div className="flex items-center gap-2 pr-3 border-r border-zinc-200 dark:border-white/5">
                                                            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Weight</span>
                                                            <span className="text-xs text-zinc-900 dark:text-white font-mono">{key.weight ?? 0}</span>
                                                        </div>

                                                        <div className="flex items-center gap-2 pr-3 border-r border-zinc-200 dark:border-white/5">
                                                            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Algo</span>
                                                            <span className="text-xs text-zinc-600 dark:text-zinc-300 font-mono">
                                                                {key.signingAlgorithm || 'N/A'} <span className="text-zinc-400 dark:text-zinc-600">/</span> {key.hashingAlgorithm || 'N/A'}
                                                            </span>
                                                        </div>

                                                        <span className={`ml-auto text-[10px] uppercase px-2 py-0.5 border rounded-sm tracking-widest ${key.revoked
                                                            ? 'border-red-500/40 text-red-500 bg-red-500/10'
                                                            : 'border-nothing-green-dark/30 dark:border-nothing-green/30 text-nothing-green-dark dark:text-nothing-green bg-nothing-green-dark/10 dark:bg-nothing-green/10'
                                                            }`}>
                                                            {key.revoked ? 'Revoked' : 'Active'}
                                                        </span>
                                                    </div>

                                                    {/* Bottom Row: Key Data */}
                                                    <div className="flex flex-col gap-1">
                                                        <span className="text-[10px] text-zinc-500 dark:text-zinc-600 uppercase tracking-widest">Public Key</span>
                                                        <div className="bg-zinc-100 dark:bg-black/60 p-3 border border-zinc-200 dark:border-white/5 rounded-sm overflow-hidden group-hover:bg-white dark:group-hover:bg-black/80 transition-colors">
                                                            <code className="text-xs text-zinc-600 dark:text-zinc-400 break-all font-mono leading-relaxed select-all">
                                                                {key.publicKey}
                                                            </code>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs text-zinc-500 italic">No keys found</p>
                                )}
                            </div>
                        )}

                        {activeTab === 'contracts' && (
                            <div className="space-y-4">
                                <h2 className="text-zinc-900 dark:text-white text-sm uppercase tracking-widest mb-6 border-b border-zinc-100 dark:border-white/5 pb-2">
                                    Deployed Contracts
                                </h2>
                                {account.contracts && account.contracts.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {account.contracts.map((contract, idx) => (
                                            <button
                                                key={idx}
                                                type="button"
                                                onClick={() => loadContractCode(contract.name || contract)}
                                                className="bg-zinc-50 dark:bg-black/50 border border-zinc-200 dark:border-white/5 p-4 flex items-center justify-between hover:border-nothing-green-dark/30 dark:hover:border-nothing-green/30 hover:bg-zinc-100 dark:hover:bg-black/70 transition-colors text-left rounded-sm"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <Code className="h-4 w-4 text-nothing-green-dark dark:text-nothing-green" />
                                                    <span className="text-sm text-zinc-900 dark:text-white font-mono">{contract.name || contract}</span>
                                                </div>
                                                <span className="text-[10px] text-zinc-500 uppercase tracking-widest">View</span>
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs text-zinc-500 italic">No contracts deployed</p>
                                )}

                                {(contractCodeLoading || contractCodeError || selectedContractCode) && (
                                    <div className="mt-6 border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-black/40 p-4 rounded-sm">
                                        <div className="flex items-center justify-between gap-4 mb-3">
                                            <div className="text-[10px] text-zinc-500 uppercase tracking-widest">
                                                Contract Source
                                            </div>
                                            {selectedContract && (
                                                <div className="text-xs text-zinc-900 dark:text-white font-mono">
                                                    {selectedContract}
                                                </div>
                                            )}
                                        </div>

                                        {contractCodeLoading && (
                                            <div className="text-xs text-zinc-500 italic">Loading contract source…</div>
                                        )}
                                        {contractCodeError && (
                                            <div className="text-xs text-red-500 dark:text-red-400">{contractCodeError}</div>
                                        )}
                                        {!contractCodeLoading && !contractCodeError && selectedContractCode && (
                                            <div className="rounded-sm overflow-hidden border border-zinc-200 dark:border-white/10">
                                                <SyntaxHighlighter
                                                    language="cadence"
                                                    style={syntaxTheme}
                                                    customStyle={{
                                                        margin: 0,
                                                        padding: '1rem',
                                                        fontSize: '11px',
                                                        lineHeight: '1.5',
                                                        maxHeight: '420px',
                                                    }}
                                                    showLineNumbers={true}
                                                    lineNumberStyle={{ minWidth: "2em", paddingRight: "1em", color: theme === 'dark' ? "#555" : "#999", userSelect: "none" }}
                                                >
                                                    {selectedContractCode}
                                                </SyntaxHighlighter>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'storage' && (
                            <div className="space-y-4">
                                <h2 className="text-zinc-900 dark:text-white text-sm uppercase tracking-widest mb-6 border-b border-zinc-100 dark:border-white/5 pb-2">
                                    Storage
                                </h2>

                                {storageError && (
                                    <div className="text-xs text-red-500 dark:text-red-400 mb-4">{storageError}</div>
                                )}

                                {(!storageOverview && storageLoading) && (
                                    <div className="text-xs text-zinc-500 italic p-4">Loading storage overview...</div>
                                )}

                                {storageOverview && (
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[600px]">
                                        {/* Left: File Browser */}
                                        <div className="md:col-span-1 border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-black/40 rounded-sm flex flex-col overflow-hidden">
                                            <div className="p-3 border-b border-zinc-200 dark:border-white/10 bg-white dark:bg-white/5 flex items-center justify-between">
                                                <span className="text-xs font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">File Browser</span>
                                                <span className="text-[10px] text-zinc-500">
                                                    {formatStorageBytes(storageOverview.used)} / {formatStorageBytes(storageOverview.capacity)}
                                                </span>
                                            </div>
                                            <div className="flex-1 overflow-auto p-2 space-y-1">
                                                {/* Domains */}
                                                {['storage', 'public', 'private'].map(domain => {
                                                    const paths = domain === 'storage' ? storageOverview.storagePaths
                                                        : domain === 'public' ? storageOverview.publicPaths
                                                            : domain === 'private' ? storageOverview.privatePaths
                                                                : [];
                                                    if (!paths || paths.length === 0) return null;

                                                    const isExpanded = expandedDomains[domain];

                                                    return (
                                                        <div key={domain}>
                                                            <button
                                                                onClick={() => setExpandedDomains(prev => ({ ...prev, [domain]: !prev[domain] }))}
                                                                className="flex items-center gap-2 w-full text-left px-2 py-1.5 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-sm transition-colors text-zinc-700 dark:text-zinc-300"
                                                            >
                                                                {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                                                {isExpanded ? <FolderOpen className="h-3 w-3 text-nothing-green-dark dark:text-nothing-green" /> : <Folder className="h-3 w-3 text-nothing-green-dark dark:text-nothing-green" />}
                                                                <span className="text-xs font-semibold uppercase tracking-wider">/{domain}</span>
                                                                <span className="text-[10px] text-zinc-500 ml-auto">({paths.length})</span>
                                                            </button>

                                                            {isExpanded && (
                                                                <div className="ml-4 pl-2 border-l border-zinc-200 dark:border-white/5 mt-1 space-y-0.5">
                                                                    {paths.map(path => {
                                                                        const name = path.split('/').pop();
                                                                        const isSelected = storageSelected === path;
                                                                        return (
                                                                            <button
                                                                                key={path}
                                                                                onClick={() => {
                                                                                    if (domain === 'storage') browseStoragePath(path);
                                                                                    else {
                                                                                        setStorageSelected(path);
                                                                                        setStorageItem({ [domain + 'Path']: path });
                                                                                    }
                                                                                }}
                                                                                className={`flex items-center gap-2 w-full text-left px-2 py-1 rounded-sm transition-colors text-xs font-mono truncate ${isSelected
                                                                                    ? 'bg-nothing-green-dark/10 dark:bg-nothing-green/10 text-nothing-green-dark dark:text-nothing-green'
                                                                                    : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5'}`}
                                                                                title={path}
                                                                            >
                                                                                <File className="h-3 w-3 flex-shrink-0" />
                                                                                <span className="truncate">{name}</span>
                                                                            </button>
                                                                        );
                                                                    })}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {/* Right: Content Viewer */}
                                        <div className="md:col-span-2 border border-zinc-200 dark:border-white/10 bg-white dark:bg-black/40 rounded-sm flex flex-col overflow-hidden relative">
                                            {storageLoading && (
                                                <div className="absolute inset-0 bg-white/50 dark:bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                                                    <div className="w-8 h-8 border-2 border-dashed border-nothing-green-dark dark:border-nothing-green rounded-full animate-spin"></div>
                                                </div>
                                            )}

                                            <div className="p-3 border-b border-zinc-200 dark:border-white/10 bg-white dark:bg-white/5 flex items-center justify-between">
                                                <div className="flex items-center gap-2 overflow-hidden">
                                                    <FileText className="h-4 w-4 text-zinc-500" />
                                                    <span className="text-xs font-mono text-zinc-700 dark:text-zinc-300 truncate" title={storageSelected || ''}>
                                                        {storageSelected || 'Select a file'}
                                                    </span>
                                                </div>
                                            </div>

                                            <div className={`flex-1 overflow-auto relative ${theme === 'dark' ? 'bg-[#1e1e1e]' : 'bg-zinc-50'}`}>
                                                {storageItem ? (
                                                    <SyntaxHighlighter
                                                        language="json"
                                                        style={syntaxTheme}
                                                        customStyle={{
                                                            margin: 0,
                                                            padding: '1.5rem',
                                                            fontSize: '11px',
                                                            lineHeight: '1.6',
                                                            minHeight: '100%',
                                                        }}
                                                        showLineNumbers={true}
                                                        lineNumberStyle={{ minWidth: "2em", paddingRight: "1em", color: theme === 'dark' ? "#555" : "#999", userSelect: "none" }}
                                                    >
                                                        {JSON.stringify(storageItem, null, 2)}
                                                    </SyntaxHighlighter>
                                                ) : (
                                                    <div className="flex flex-col items-center justify-center h-full text-zinc-400 dark:text-zinc-600">
                                                        <HardDrive className="h-12 w-12 mb-4 opacity-20" />
                                                        <p className="text-xs uppercase tracking-widest">Select an item to view contents</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'activity' && (
                            <>
                                <div className="overflow-x-auto min-h-[200px] relative -mx-6 -mb-6">
                                    {txLoading && (
                                        <div className="absolute inset-0 bg-white/50 dark:bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                                            <div className="w-8 h-8 border-2 border-dashed border-zinc-900 dark:border-white rounded-full animate-spin"></div>
                                        </div>
                                    )}

                                    {transactions.length > 0 ? (
                                        <table className="w-full text-left text-xs">
                                            <thead>
                                                <tr className="border-b border-zinc-200 dark:border-white/5 text-zinc-500 uppercase tracking-wider bg-zinc-50 dark:bg-white/5">
                                                    <th className="p-4 font-normal">Tx Hash</th>
                                                    <th className="p-4 font-normal">Type</th>
                                                    <th className="p-4 font-normal">Role</th>
                                                    <th className="p-4 font-normal">Status</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                                {transactions.map((tx) => {
                                                    const role = tx.payer === normalizedAddress ? 'Payer' :
                                                        tx.proposer === normalizedAddress ? 'Proposer' : 'Authorizer';
                                                    return (
                                                        <tr key={tx.id} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors group">
                                                            <td className="p-4">
                                                                <Link to={`/transactions/${tx.id}`} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">
                                                                    {formatShort(tx.id, 12, 8)}
                                                                </Link>
                                                            </td>
                                                            <td className="p-4">
                                                                <span className="border border-zinc-200 dark:border-white/10 px-2 py-1 rounded-sm text-zinc-600 dark:text-zinc-300 text-[10px] uppercase bg-zinc-100 dark:bg-transparent">
                                                                    {tx.type}
                                                                </span>
                                                            </td>
                                                            <td className="p-4">
                                                                <span className="text-[10px] uppercase text-zinc-500">{role}</span>
                                                            </td>
                                                            <td className="p-4">
                                                                <span className={`text-[10px] uppercase ${tx.status === 'SEALED' ? 'text-zinc-500 dark:text-zinc-400' : 'text-yellow-600 dark:text-yellow-500'}`}>
                                                                    {tx.status}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    ) : (
                                        <div className="p-8 text-center text-zinc-500 italic">No transactions found</div>
                                    )}
                                </div>
                                <div className="-mx-6 -mb-6 p-4 flex justify-between items-center border-t border-zinc-200 dark:border-white/5">
                                    <button
                                        disabled={currentPage <= 1 || txLoading}
                                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                        className="px-3 py-1 text-xs border border-zinc-200 dark:border-white/10 rounded-sm disabled:opacity-50"
                                    >
                                        Previous
                                    </button>
                                    <span className="text-xs text-zinc-500">Page {currentPage}</span>
                                    <button
                                        disabled={!txHasNext || txLoading}
                                        onClick={() => setCurrentPage(prev => prev + 1)}
                                        className="px-3 py-1 text-xs border border-zinc-200 dark:border-white/10 rounded-sm disabled:opacity-50"
                                    >
                                        Next
                                    </button>
                                </div>
                            </>
                        )}

                        {activeTab === 'transfers' && (
                            <div className="space-y-8">
                                <div>
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="text-[10px] uppercase tracking-widest text-zinc-500">FT Transfers</div>
                                        {tokenLoading && <div className="text-[10px] text-zinc-500">Loading...</div>}
                                    </div>
                                    <div className="overflow-x-auto">
                                        {tokenTransfers.length > 0 ? (
                                            <table className="w-full text-left text-xs">
                                                <thead>
                                                    <tr className="border-b border-zinc-200 dark:border-white/5 text-zinc-500 uppercase tracking-wider bg-zinc-50 dark:bg-white/5">
                                                        <th className="p-4 font-normal">Token</th>
                                                        <th className="p-4 font-normal">Amount</th>
                                                        <th className="p-4 font-normal">From</th>
                                                        <th className="p-4 font-normal">To</th>
                                                        <th className="p-4 font-normal text-right">Time</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                                    {tokenTransfers.map((tx, i) => (
                                                        <tr key={`${tx.transactionId}-${i}`} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                                                            <td className="p-4 font-mono">{tx.token_id?.split('.').pop() || 'Unknown'}</td>
                                                            <td className="p-4 font-mono font-bold">{parseFloat(tx.amount).toLocaleString()}</td>
                                                            <td className="p-4 font-mono text-nothing-green-dark dark:text-nothing-green">
                                                                <Link to={`/accounts/${tx.from_address}`}>{formatShort(tx.from_address)}</Link>
                                                            </td>
                                                            <td className="p-4 font-mono text-nothing-green-dark dark:text-nothing-green">
                                                                <Link to={`/accounts/${tx.to_address}`}>{formatShort(tx.to_address)}</Link>
                                                            </td>
                                                            <td className="p-4 text-right text-zinc-500">
                                                                {tx.block_timestamp ? new Date(tx.block_timestamp).toLocaleString() : 'N/A'}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        ) : (
                                            <div className="text-center text-zinc-500 italic py-8">No token transfers found</div>
                                        )}
                                    </div>
                                    {tokenHasMore && (
                                        <div className="mt-4 text-center">
                                            <button
                                                onClick={() => loadTokenTransfers(tokenCursor, true)}
                                                disabled={tokenLoading}
                                                className="px-4 py-2 text-xs border border-zinc-200 dark:border-white/10 rounded-sm hover:bg-zinc-50 dark:hover:bg-white/5 disabled:opacity-50"
                                            >
                                                {tokenLoading ? 'Loading...' : 'Load More'}
                                            </button>
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="text-[10px] uppercase tracking-widest text-zinc-500">NFT Transfers</div>
                                        {nftLoading && <div className="text-[10px] text-zinc-500">Loading...</div>}
                                    </div>
                                    <div className="overflow-x-auto">
                                        {nftTransfers.length > 0 ? (
                                            <table className="w-full text-left text-xs">
                                                <thead>
                                                    <tr className="border-b border-zinc-200 dark:border-white/5 text-zinc-500 uppercase tracking-wider bg-zinc-50 dark:bg-white/5">
                                                        <th className="p-4 font-normal">Collection</th>
                                                        <th className="p-4 font-normal">ID</th>
                                                        <th className="p-4 font-normal">From</th>
                                                        <th className="p-4 font-normal">To</th>
                                                        <th className="p-4 font-normal text-right">Time</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                                    {nftTransfers.map((tx, i) => (
                                                        <tr key={`${tx.transactionId}-${i}`} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                                                            <td className="p-4 font-mono">{tx.collection_id?.split('.').pop() || 'Unknown'}</td>
                                                            <td className="p-4 font-mono">{tx.nft_id}</td>
                                                            <td className="p-4 font-mono text-nothing-green-dark dark:text-nothing-green">
                                                                <Link to={`/accounts/${tx.from_address}`}>{formatShort(tx.from_address)}</Link>
                                                            </td>
                                                            <td className="p-4 font-mono text-nothing-green-dark dark:text-nothing-green">
                                                                <Link to={`/accounts/${tx.to_address}`}>{formatShort(tx.to_address)}</Link>
                                                            </td>
                                                            <td className="p-4 text-right text-zinc-500">
                                                                {tx.block_timestamp ? new Date(tx.block_timestamp).toLocaleString() : 'N/A'}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        ) : (
                                            <div className="text-center text-zinc-500 italic py-8">No NFT transfers found</div>
                                        )}
                                    </div>
                                    {nftHasMore && (
                                        <div className="mt-4 text-center">
                                            <button
                                                onClick={() => loadNFTTransfers(nftCursor, true)}
                                                disabled={nftLoading}
                                                className="px-4 py-2 text-xs border border-zinc-200 dark:border-white/10 rounded-sm hover:bg-zinc-50 dark:hover:bg-white/5 disabled:opacity-50"
                                            >
                                                {nftLoading ? 'Loading...' : 'Load More'}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeTab === 'tokens' && (
                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <div className="text-[10px] uppercase tracking-widest text-zinc-500">Fungible Tokens</div>
                                    {fclTokensLoading && <div className="text-[10px] text-zinc-500">Loading...</div>}
                                </div>

                                {fclTokensError && (
                                    <div className="text-xs text-red-500 dark:text-red-400 mb-4">{fclTokensError}</div>
                                )}

                                {fclStorage && (
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                                        <div className="border border-zinc-200 dark:border-white/5 p-3 bg-zinc-50 dark:bg-black/40 rounded-sm">
                                            <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Storage Used</div>
                                            <div className="text-xs font-mono text-zinc-900 dark:text-white">{fclStorage.storageUsedInMB} MB</div>
                                        </div>
                                        <div className="border border-zinc-200 dark:border-white/5 p-3 bg-zinc-50 dark:bg-black/40 rounded-sm">
                                            <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Capacity</div>
                                            <div className="text-xs font-mono text-zinc-900 dark:text-white">{fclStorage.storageCapacityInMB} MB</div>
                                        </div>
                                        <div className="border border-zinc-200 dark:border-white/5 p-3 bg-zinc-50 dark:bg-black/40 rounded-sm">
                                            <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Locked FLOW</div>
                                            <div className="text-xs font-mono text-zinc-900 dark:text-white">{fclStorage.lockedFLOWforStorage}</div>
                                        </div>
                                        <div className="border border-zinc-200 dark:border-white/5 p-3 bg-zinc-50 dark:bg-black/40 rounded-sm">
                                            <div className="text-[9px] text-zinc-500 uppercase tracking-wider mb-1">Available Balance</div>
                                            <div className="text-xs font-mono text-zinc-900 dark:text-white">{fclStorage.availableBalanceToUse}</div>
                                        </div>
                                    </div>
                                )}

                                <div className="overflow-x-auto min-h-[120px] relative">
                                    {fclTokens.length > 0 ? (
                                        <table className="w-full text-left text-xs">
                                            <thead>
                                                <tr className="border-b border-zinc-200 dark:border-white/5 text-zinc-500 uppercase tracking-wider bg-zinc-50 dark:bg-white/5">
                                                    <th className="p-4 font-normal">Token</th>
                                                    <th className="p-4 font-normal">Contract</th>
                                                    <th className="p-4 font-normal text-right">Balance</th>
                                                    <th className="p-4 font-normal">EVM Bridge</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                                {fclTokens.map((token, i) => (
                                                    <tr key={`${token.identifier}-${i}`} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                                                        <td className="p-4">
                                                            <div className="flex items-center gap-2">
                                                                <div>
                                                                    <div className="font-mono text-zinc-900 dark:text-white">
                                                                        {token.name || token.contractName}
                                                                    </div>
                                                                    {token.symbol && (
                                                                        <div className="text-[10px] text-zinc-500">{token.symbol}</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="p-4 font-mono">
                                                            <Link to={`/accounts/${token.contractAddress}`} className="text-nothing-green-dark dark:text-nothing-green hover:underline">
                                                                {formatShort(token.contractAddress)}
                                                            </Link>
                                                            <div className="text-[10px] text-zinc-500">{token.contractName}</div>
                                                        </td>
                                                        <td className="p-4 text-right font-mono font-bold text-zinc-900 dark:text-white">
                                                            {parseFloat(token.balance).toLocaleString(undefined, { maximumFractionDigits: 8 })}
                                                        </td>
                                                        <td className="p-4 font-mono text-[10px]">
                                                            {token.evmAddress ? (
                                                                <span className="text-nothing-green-dark dark:text-nothing-green" title={token.evmAddress}>
                                                                    {token.evmAddress.slice(0, 10)}...{token.evmAddress.slice(-6)}
                                                                </span>
                                                            ) : (
                                                                <span className="text-zinc-400">—</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    ) : !fclTokensLoading ? (
                                        <div className="text-center text-zinc-500 italic py-8">No token holdings found</div>
                                    ) : null}
                                </div>
                            </div>
                        )}

                        {activeTab === 'nfts' && (
                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <div className="text-[10px] uppercase tracking-widest text-zinc-500">NFT Collections</div>
                                    {fclNFTsLoading && <div className="text-[10px] text-zinc-500">Loading...</div>}
                                </div>

                                {fclNFTsError && (
                                    <div className="text-xs text-red-500 dark:text-red-400 mb-4">{fclNFTsError}</div>
                                )}

                                <div className="min-h-[120px] relative">
                                    {fclNFTCollections.length > 0 ? (
                                        <div className="space-y-4">
                                            {fclNFTCollections.map((c, i) => {
                                                const pathId = c.storagePath.split('/').pop() || '';
                                                const expanded = expandedNFTs[c.storagePath];
                                                const isExpanded = !!expanded;

                                                return (
                                                    <div key={`${c.identifier}-${i}`} className="border border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-black/40 rounded-sm overflow-hidden">
                                                        {/* Collection header — clickable */}
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleCollectionNFTs(c.storagePath)}
                                                            className="w-full text-left hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors"
                                                        >
                                                            <div className="p-4 flex items-center gap-3">
                                                                {isExpanded ? <ChevronDown className="h-4 w-4 text-zinc-500 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-zinc-500 flex-shrink-0" />}

                                                                {/* Square image or placeholder */}
                                                                {c.squareImageURL ? (
                                                                    <img
                                                                        src={c.squareImageURL}
                                                                        alt=""
                                                                        className="w-10 h-10 rounded-sm border border-zinc-200 dark:border-white/10 object-cover flex-shrink-0 bg-zinc-200 dark:bg-white/5"
                                                                        loading="lazy"
                                                                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }}
                                                                    />
                                                                ) : null}
                                                                <div className={`w-10 h-10 rounded-sm border border-zinc-200 dark:border-white/10 bg-zinc-200 dark:bg-white/5 flex items-center justify-center flex-shrink-0 ${c.squareImageURL ? 'hidden' : ''}`}>
                                                                    <ImageIcon className="h-4 w-4 text-zinc-400 dark:text-zinc-600" />
                                                                </div>

                                                                <div className="min-w-0 flex-1">
                                                                    <div className="text-sm font-mono text-zinc-900 dark:text-white truncate">
                                                                        {c.name || c.contractName}
                                                                    </div>
                                                                    <div className="text-[10px] text-zinc-500 font-mono truncate" title={c.identifier}>
                                                                        {c.contractName}
                                                                    </div>
                                                                </div>

                                                                <div className="text-right flex-shrink-0">
                                                                    <div className="text-sm font-mono font-bold text-zinc-900 dark:text-white">{c.count.toLocaleString()}</div>
                                                                    <div className="text-[10px] text-zinc-500">items</div>
                                                                </div>
                                                            </div>
                                                        </button>

                                                        {/* Expanded NFT grid */}
                                                        {isExpanded && (
                                                            <div className="border-t border-zinc-200 dark:border-white/5 p-4">
                                                                {expanded.loading && expanded.nfts.length === 0 && (
                                                                    <div className="flex items-center justify-center py-8">
                                                                        <div className="w-6 h-6 border-2 border-dashed border-nothing-green-dark dark:border-nothing-green rounded-full animate-spin"></div>
                                                                    </div>
                                                                )}

                                                                {expanded.error && (
                                                                    <div className="text-xs text-red-500 dark:text-red-400 text-center py-4">{expanded.error}</div>
                                                                )}

                                                                {expanded.nfts.length > 0 && (
                                                                    <>
                                                                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                                                                            {expanded.nfts.map((nft, ni) => {
                                                                                const thumb = getNFTThumbnail(nft);
                                                                                const name = nft?.display?.name || `#${nft?.tokenId ?? ni}`;
                                                                                return (
                                                                                    <div key={`${nft?.tokenId ?? ni}`} className="border border-zinc-200 dark:border-white/5 rounded-sm overflow-hidden bg-white dark:bg-black/40 hover:border-nothing-green-dark/30 dark:hover:border-nothing-green/30 transition-colors group">
                                                                                        <div className="aspect-square bg-zinc-100 dark:bg-white/5 relative overflow-hidden">
                                                                                            {thumb ? (
                                                                                                <img
                                                                                                    src={thumb}
                                                                                                    alt={name}
                                                                                                    className="w-full h-full object-cover"
                                                                                                    loading="lazy"
                                                                                                    onError={(e) => {
                                                                                                        const el = e.target as HTMLImageElement;
                                                                                                        el.style.display = 'none';
                                                                                                        el.parentElement!.querySelector('.nft-placeholder')?.classList.remove('hidden');
                                                                                                    }}
                                                                                                />
                                                                                            ) : null}
                                                                                            <div className={`nft-placeholder absolute inset-0 flex items-center justify-center ${thumb ? 'hidden' : ''}`}>
                                                                                                <ImageIcon className="h-6 w-6 text-zinc-300 dark:text-zinc-700" />
                                                                                            </div>
                                                                                        </div>
                                                                                        <div className="p-2">
                                                                                            <div className="text-[10px] font-mono text-zinc-700 dark:text-zinc-300 truncate" title={name}>
                                                                                                {name}
                                                                                            </div>
                                                                                            <div className="text-[9px] text-zinc-400">#{nft?.tokenId ?? ni}</div>
                                                                                        </div>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>

                                                                        {/* Pagination */}
                                                                        {expanded.nftCount > NFT_PAGE_SIZE && (
                                                                            <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-200 dark:border-white/5">
                                                                                <button
                                                                                    disabled={expanded.page <= 0 || expanded.loading}
                                                                                    onClick={() => toggleCollectionNFTs(c.storagePath, expanded.page - 1)}
                                                                                    className="px-3 py-1 text-[10px] uppercase tracking-wider border border-zinc-200 dark:border-white/10 rounded-sm disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-white/5"
                                                                                >
                                                                                    Previous
                                                                                </button>
                                                                                <span className="text-[10px] text-zinc-500">
                                                                                    {expanded.page * NFT_PAGE_SIZE + 1}–{Math.min((expanded.page + 1) * NFT_PAGE_SIZE, expanded.nftCount)} of {expanded.nftCount.toLocaleString()}
                                                                                </span>
                                                                                <button
                                                                                    disabled={(expanded.page + 1) * NFT_PAGE_SIZE >= expanded.nftCount || expanded.loading}
                                                                                    onClick={() => toggleCollectionNFTs(c.storagePath, expanded.page + 1)}
                                                                                    className="px-3 py-1 text-[10px] uppercase tracking-wider border border-zinc-200 dark:border-white/10 rounded-sm disabled:opacity-30 hover:bg-zinc-100 dark:hover:bg-white/5"
                                                                                >
                                                                                    Next
                                                                                </button>
                                                                            </div>
                                                                        )}
                                                                    </>
                                                                )}

                                                                {!expanded.loading && !expanded.error && expanded.nfts.length === 0 && (
                                                                    <div className="text-center text-zinc-500 italic text-xs py-4">No NFTs found in this collection</div>
                                                                )}

                                                                {expanded.loading && expanded.nfts.length > 0 && (
                                                                    <div className="flex items-center justify-center py-2 mt-2">
                                                                        <div className="w-4 h-4 border-2 border-dashed border-nothing-green-dark dark:border-nothing-green rounded-full animate-spin"></div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}

                                                        {/* Collection footer */}
                                                        {!isExpanded && (
                                                            <div className="px-4 pb-3">
                                                                {c.description && (
                                                                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-1 mb-2">{c.description}</p>
                                                                )}
                                                                <div className="flex items-center justify-between pt-2 border-t border-zinc-200 dark:border-white/5">
                                                                    <Link to={`/accounts/${normalizeAddress(c.contractAddress)}`} className="text-[10px] font-mono text-nothing-green-dark dark:text-nothing-green hover:underline">
                                                                        {formatShort(c.contractAddress)}
                                                                    </Link>
                                                                    {c.externalURL && (
                                                                        <a href={c.externalURL} target="_blank" rel="noopener noreferrer" className="text-[10px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors uppercase tracking-wider">
                                                                            Website
                                                                        </a>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : !fclNFTsLoading ? (
                                        <div className="text-center text-zinc-500 italic py-8">No NFT collections found</div>
                                    ) : null}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

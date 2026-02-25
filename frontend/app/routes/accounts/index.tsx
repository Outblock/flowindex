import { createFileRoute, Link } from '@tanstack/react-router'
import { AddressLink } from '../../components/AddressLink';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, Coins, ImageIcon, ArrowUpDown } from 'lucide-react';
import NumberFlow from '@number-flow/react';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import { getFlowV1Account, getFlowV1Ft, getFlowV1Nft } from '../../api/gen/find';
import { useWebSocketStatus } from '../../hooks/useWebSocket';
import { Pagination } from '../../components/Pagination';
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/time';
import { useTimeTicker } from '../../hooks/useTimeTicker';
import { resolveApiBaseUrl } from '../../api';
import { useState, useEffect, useCallback } from 'react';

type Tab = 'accounts' | 'ft_holders' | 'nft_collectors';

interface AccountsSearch {
    page?: number;
    tab?: Tab;
    sort_by?: string;
    token?: string;
    collection?: string;
}

export const Route = createFileRoute('/accounts/')({
    component: Accounts,
    validateSearch: (search: Record<string, unknown>): AccountsSearch => {
        return {
            page: Number(search.page) || 1,
            tab: (['accounts', 'ft_holders', 'nft_collectors'].includes(search.tab as string) ? search.tab : 'accounts') as Tab,
            sort_by: (search.sort_by as string) || 'block_height',
            token: (search.token as string) || '',
            collection: (search.collection as string) || '',
        }
    },
    loaderDeps: ({ search: { page, tab, sort_by } }) => ({ page, tab, sort_by }),
    loader: async ({ deps: { page, tab, sort_by } }) => {
        const limit = 20;
        const offset = ((page || 1) - 1) * limit;
        try {
            await ensureHeyApiConfigured();
            if (tab === 'accounts') {
                const res = await getFlowV1Account({ query: { limit, offset, sort_by } });
                const payload: any = res.data;
                return {
                    accounts: payload?.data || [],
                    meta: payload?._meta || null,
                    page,
                };
            }
            return { accounts: [], meta: null, page };
        } catch (e) {
            console.error("Failed to load accounts", e);
            return { accounts: [], meta: null, page };
        }
    }
})

const TABS: { key: Tab; label: string; icon: typeof Users }[] = [
    { key: 'accounts', label: 'All Accounts', icon: Users },
    { key: 'ft_holders', label: 'Top Token Holders', icon: Coins },
    { key: 'nft_collectors', label: 'Top NFT Collectors', icon: ImageIcon },
];

const DEFAULT_FLOW_TOKEN = 'A.1654653399040a61.FlowToken';

function Accounts() {
    const { accounts, meta, page } = Route.useLoaderData();
    const navigate = Route.useNavigate();
    const { tab, sort_by, token, collection } = Route.useSearch();

    const { isConnected } = useWebSocketStatus();
    const nowTick = useTimeTicker(20000);

    const normalizeHex = (value: any) => {
        if (!value) return '';
        const lower = String(value).toLowerCase();
        return lower.startsWith('0x') ? lower : `0x${lower}`;
    };

    const limit = 20;
    const offset = ((page || 1) - 1) * limit;
    const totalCount = Number(meta?.count || 0);
    const hasNext = totalCount > 0 ? offset + limit < totalCount : accounts.length === limit;

    const setSearch = (updates: Partial<AccountsSearch>) => {
        navigate({ search: (prev: AccountsSearch) => ({ ...prev, ...updates }) });
    };

    return (
        <div className="container mx-auto px-4 py-8 space-y-8">
            {/* Header */}
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-between"
            >
                <div className="flex items-center space-x-4">
                    <div className="p-3 bg-nothing-green/10 rounded-lg">
                        <Users className="h-8 w-8 text-nothing-green-dark dark:text-nothing-green" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-zinc-900 dark:text-white uppercase tracking-tighter">Accounts</h1>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">Flow Accounts Catalog</p>
                    </div>
                </div>
                <div className={`flex items-center space-x-2 px-3 py-1 border rounded-full ${isConnected ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                    <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                    <span className="text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                        {isConnected ? 'Live Feed' : 'Offline'}
                    </span>
                </div>
            </motion.div>

            {/* Tab Bar */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="flex gap-1 bg-zinc-100 dark:bg-white/5 p-1 rounded-sm border border-zinc-200 dark:border-white/10"
            >
                {TABS.map(({ key, label, icon: Icon }) => (
                    <button
                        key={key}
                        onClick={() => setSearch({ tab: key, page: 1 })}
                        className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors rounded-sm flex-1 justify-center ${
                            tab === key
                                ? 'bg-white dark:bg-nothing-dark text-zinc-900 dark:text-white shadow-sm'
                                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                        }`}
                    >
                        <Icon className="w-4 h-4" />
                        {label}
                    </button>
                ))}
            </motion.div>

            {/* Tab Content */}
            {tab === 'accounts' && (
                <AllAccountsTab
                    accounts={accounts}
                    meta={meta}
                    page={page}
                    sortBy={sort_by || 'block_height'}
                    totalCount={totalCount}
                    hasNext={hasNext}
                    nowTick={nowTick}
                    normalizeHex={normalizeHex}
                    onSortChange={(s: string) => setSearch({ sort_by: s, page: 1 })}
                    onPageChange={(p: number) => setSearch({ page: p })}
                />
            )}
            {tab === 'ft_holders' && (
                <TopTokenHoldersTab
                    token={token || DEFAULT_FLOW_TOKEN}
                    onTokenChange={(t: string) => setSearch({ token: t, page: 1 })}
                    page={page}
                    onPageChange={(p: number) => setSearch({ page: p })}
                    normalizeHex={normalizeHex}
                />
            )}
            {tab === 'nft_collectors' && (
                <TopNFTCollectorsTab
                    collection={collection}
                    onCollectionChange={(c: string) => setSearch({ collection: c, page: 1 })}
                    page={page}
                    onPageChange={(p: number) => setSearch({ page: p })}
                    normalizeHex={normalizeHex}
                />
            )}
        </div>
    );
}

// ─── Sortable Header ─────────────────────────────────────────────────
function SortableHeader({ label, sortKey, currentSort, onSort, align }: { label: string; sortKey: string; currentSort: string; onSort: (key: string) => void; align?: 'left' | 'right' }) {
    const active = currentSort === sortKey;
    return (
        <th
            className={`p-4 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none transition-colors hover:text-nothing-green-dark dark:hover:text-nothing-green ${active ? 'text-nothing-green-dark dark:text-nothing-green' : 'text-zinc-500 dark:text-gray-400'} ${align === 'right' ? 'text-right' : ''}`}
            onClick={() => onSort(sortKey)}
        >
            <span className="inline-flex items-center gap-1">
                {label}
                {active && <ArrowUpDown className="w-3 h-3" />}
            </span>
        </th>
    );
}

// ─── All Accounts Tab ────────────────────────────────────────────────
function AllAccountsTab({ accounts, meta: _meta, page, sortBy, totalCount, hasNext, nowTick, normalizeHex, onSortChange, onPageChange }: any) {
    return (
        <>
            {/* Stats */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="flex items-center justify-end"
            >
                <div className="text-xs text-zinc-500 font-mono">
                    <NumberFlow value={Number.isFinite(totalCount) ? totalCount : 0} format={{ useGrouping: true }} /> accounts
                </div>
            </motion.div>

            {/* Table */}
            <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden shadow-sm dark:shadow-none">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-white/5">
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider w-8">#</th>
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Address</th>
                                <SortableHeader label="TX Count" sortKey="tx_count" currentSort={sortBy} onSort={onSortChange} align="right" />
                                <SortableHeader label="Last Seen Height" sortKey="block_height" currentSort={sortBy} onSort={onSortChange} align="right" />
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Updated</th>
                            </tr>
                        </thead>
                        <tbody>
                            <AnimatePresence mode="popLayout">
                                {accounts.map((a: any, i: number) => {
                                    const addr = normalizeHex(a?.address);
                                    const height = Number(a?.height || 0);
                                    const ts = a?.timestamp || '';
                                    const rel = ts ? formatRelativeTime(ts, nowTick) : '';
                                    const abs = ts ? formatAbsoluteTime(ts) : '';
                                    const txCount = Number(a?.tx_count || 0);
                                    const rank = ((page - 1) * 20) + i + 1;

                                    return (
                                        <motion.tr
                                            layout
                                            key={addr || `${height}-${ts}`}
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            className="border-b border-zinc-100 dark:border-white/5 group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                                        >
                                            <td className="p-4 text-xs text-zinc-400 font-mono">{rank}</td>
                                            <td className="p-4">
                                                <AddressLink address={addr} prefixLen={20} suffixLen={0} />
                                            </td>
                                            <td className="p-4 text-right">
                                                <span className="font-mono text-sm text-zinc-700 dark:text-zinc-300">
                                                    {txCount.toLocaleString()}
                                                </span>
                                            </td>
                                            <td className="p-4 text-right">
                                                <span className="font-mono text-sm text-zinc-700 dark:text-zinc-300">
                                                    {height ? height.toLocaleString() : '0'}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                <div className="flex flex-col">
                                                    <span className="text-sm text-zinc-900 dark:text-white">{rel}</span>
                                                    <span className="text-xs text-zinc-500">{abs}</span>
                                                </div>
                                            </td>
                                        </motion.tr>
                                    );
                                })}
                            </AnimatePresence>
                        </tbody>
                    </table>
                </div>
                <div className="p-4 border-t border-zinc-200 dark:border-white/5">
                    <Pagination currentPage={page} onPageChange={onPageChange} hasNext={hasNext} />
                </div>
            </div>
        </>
    );
}

// ─── Top Token Holders Tab ───────────────────────────────────────────
function TopTokenHoldersTab({ token, onTokenChange, page, onPageChange, normalizeHex }: any) {
    const [ftTokens, setFtTokens] = useState<any[]>([]);
    const [holders, setHolders] = useState<any[]>([]);
    const [_holdersMeta, setHoldersMeta] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [tokenMeta, setTokenMeta] = useState<any>(null);

    const limit = 20;
    const offset = (page - 1) * limit;

    // Load FT token list for dropdown
    useEffect(() => {
        (async () => {
            try {
                await ensureHeyApiConfigured();
                const res = await getFlowV1Ft({ query: { limit: 200, offset: 0 } });
                const payload: any = res.data;
                setFtTokens(payload?.data || []);
            } catch { /* ignore */ }
        })();
    }, []);

    // Load holders for selected token
    const loadHolders = useCallback(async () => {
        if (!token) return;
        setLoading(true);
        try {
            const baseUrl = await resolveApiBaseUrl();
            const res = await fetch(`${baseUrl}/flow/ft/${encodeURIComponent(token)}/top-account?limit=${limit}&offset=${offset}`);
            if (res.ok) {
                const json = await res.json();
                setHolders(json?.data || []);
                setHoldersMeta(json?._meta || null);
            }
            // Also fetch token metadata
            const metaRes = await fetch(`${baseUrl}/flow/ft/${encodeURIComponent(token)}`);
            if (metaRes.ok) {
                const metaJson = await metaRes.json();
                setTokenMeta(metaJson?.data?.[0] || null);
            }
        } catch { /* ignore */ }
        setLoading(false);
    }, [token, offset]);

    useEffect(() => { loadHolders(); }, [loadHolders]);

    const hasNext = holders.length === limit;
    const symbol = tokenMeta?.symbol || token.split('.').pop() || '';

    return (
        <>
            {/* Token Selector */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="flex flex-col sm:flex-row items-start sm:items-center gap-4"
            >
                <div className="flex items-center gap-2">
                    <Coins className="w-4 h-4 text-zinc-400" />
                    <span className="text-xs text-zinc-500 uppercase tracking-wider">Token:</span>
                    <select
                        value={token}
                        onChange={(e) => onTokenChange(e.target.value)}
                        className="px-3 py-1.5 text-sm font-mono bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-nothing-green/50"
                    >
                        {!ftTokens.length && <option value={token}>{token}</option>}
                        {ftTokens.map((t: any) => {
                            const id = t.token || `A.${t.contract_address?.replace('0x', '')}.${t.contract_name}`;
                            const label = t.name || t.symbol || t.contract_name || id;
                            return <option key={id} value={id}>{label} ({t.symbol || ''})</option>;
                        })}
                    </select>
                </div>
                {tokenMeta && (
                    <div className="flex items-center gap-3 text-xs text-zinc-500">
                        {tokenMeta.logo && <img src={tokenMeta.logo} alt="" className="w-5 h-5 rounded-full" />}
                        <span className="font-semibold text-zinc-700 dark:text-zinc-300">{tokenMeta.name || symbol}</span>
                        {tokenMeta.decimals > 0 && <span>Decimals: {tokenMeta.decimals}</span>}
                    </div>
                )}
            </motion.div>

            {/* Holders Table */}
            <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden shadow-sm dark:shadow-none">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-white/5">
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider w-8">#</th>
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Address</th>
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">Balance</th>
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">Token</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={4} className="p-8 text-center text-zinc-500 text-sm">Loading...</td></tr>
                            ) : holders.length === 0 ? (
                                <tr><td colSpan={4} className="p-8 text-center text-zinc-500 text-sm">No holders found</td></tr>
                            ) : (
                                <AnimatePresence mode="popLayout">
                                    {holders.map((h: any, i: number) => {
                                        const addr = normalizeHex(h.address);
                                        const balance = h.balance || '0';
                                        const rank = offset + i + 1;
                                        return (
                                            <motion.tr
                                                layout
                                                key={addr}
                                                initial={{ opacity: 0, x: -10 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                className="border-b border-zinc-100 dark:border-white/5 group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                                            >
                                                <td className="p-4 text-xs text-zinc-400 font-mono">{rank}</td>
                                                <td className="p-4">
                                                    <AddressLink address={addr} prefixLen={20} suffixLen={0} />
                                                </td>
                                                <td className="p-4 text-right">
                                                    <span className="font-mono text-sm text-zinc-700 dark:text-zinc-300">
                                                        {formatBalance(balance, tokenMeta?.decimals)}
                                                    </span>
                                                </td>
                                                <td className="p-4 text-right">
                                                    <span className="text-xs text-zinc-500 font-mono uppercase">{symbol}</span>
                                                </td>
                                            </motion.tr>
                                        );
                                    })}
                                </AnimatePresence>
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="p-4 border-t border-zinc-200 dark:border-white/5">
                    <Pagination currentPage={page} onPageChange={onPageChange} hasNext={hasNext} />
                </div>
            </div>
        </>
    );
}

// ─── Top NFT Collectors Tab ──────────────────────────────────────────
function TopNFTCollectorsTab({ collection, onCollectionChange, page, onPageChange, normalizeHex }: any) {
    const [collections, setCollections] = useState<any[]>([]);
    const [owners, setOwners] = useState<any[]>([]);
    const [ownersMeta, setOwnersMeta] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [selectedCollection, setSelectedCollection] = useState(collection);

    const limit = 20;
    const offset = (page - 1) * limit;

    // Load NFT collection list
    useEffect(() => {
        (async () => {
            try {
                await ensureHeyApiConfigured();
                const res = await getFlowV1Nft({ query: { limit: 200, offset: 0 } });
                const payload: any = res.data;
                const cols = payload?.data || [];
                setCollections(cols);
                // Auto-select first collection if none selected
                if (!collection && cols.length > 0) {
                    const first = cols[0];
                    const id = first.collection || `A.${first.contract_address?.replace('0x', '')}.${first.contract_name}`;
                    setSelectedCollection(id);
                    onCollectionChange(id);
                }
            } catch { /* ignore */ }
        })();
    }, []);

    const activeCollection = collection || selectedCollection;

    // Load top owners for selected collection
    const loadOwners = useCallback(async () => {
        if (!activeCollection) { setLoading(false); return; }
        setLoading(true);
        try {
            const baseUrl = await resolveApiBaseUrl();
            const res = await fetch(`${baseUrl}/flow/nft/${encodeURIComponent(activeCollection)}/top-account?limit=${limit}&offset=${offset}`);
            if (res.ok) {
                const json = await res.json();
                setOwners(json?.data || []);
                setOwnersMeta(json?._meta || null);
            }
        } catch { /* ignore */ }
        setLoading(false);
    }, [activeCollection, offset]);

    useEffect(() => { loadOwners(); }, [loadOwners]);

    const hasNext = owners.length === limit;
    const totalNFTs = ownersMeta?.total_nfts || 0;

    return (
        <>
            {/* Collection Selector */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="flex flex-col sm:flex-row items-start sm:items-center gap-4"
            >
                <div className="flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-zinc-400" />
                    <span className="text-xs text-zinc-500 uppercase tracking-wider">Collection:</span>
                    <select
                        value={activeCollection}
                        onChange={(e) => onCollectionChange(e.target.value)}
                        className="px-3 py-1.5 text-sm font-mono bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm text-zinc-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-nothing-green/50 max-w-sm"
                    >
                        {!collections.length && activeCollection && <option value={activeCollection}>{activeCollection}</option>}
                        {collections.map((c: any) => {
                            const id = c.collection || `A.${c.contract_address?.replace('0x', '')}.${c.contract_name}`;
                            const label = c.name || c.contract_name || id;
                            return <option key={id} value={id}>{label}</option>;
                        })}
                    </select>
                </div>
                {totalNFTs > 0 && (
                    <span className="text-xs text-zinc-500 font-mono">
                        {totalNFTs.toLocaleString()} NFTs total
                    </span>
                )}
            </motion.div>

            {/* Owners Table */}
            <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden shadow-sm dark:shadow-none">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-white/5">
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider w-8">#</th>
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Address</th>
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">NFTs Owned</th>
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">% of Supply</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={4} className="p-8 text-center text-zinc-500 text-sm">Loading...</td></tr>
                            ) : owners.length === 0 ? (
                                <tr><td colSpan={4} className="p-8 text-center text-zinc-500 text-sm">No owners found</td></tr>
                            ) : (
                                <AnimatePresence mode="popLayout">
                                    {owners.map((o: any, i: number) => {
                                        const addr = normalizeHex(o.address);
                                        const count = Number(o.count || o.nft_count || 0);
                                        const pct = Number(o.percentage || 0);
                                        const rank = offset + i + 1;
                                        return (
                                            <motion.tr
                                                layout
                                                key={addr}
                                                initial={{ opacity: 0, x: -10 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                className="border-b border-zinc-100 dark:border-white/5 group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                                            >
                                                <td className="p-4 text-xs text-zinc-400 font-mono">{rank}</td>
                                                <td className="p-4">
                                                    <AddressLink address={addr} prefixLen={20} suffixLen={0} />
                                                </td>
                                                <td className="p-4 text-right">
                                                    <span className="font-mono text-sm text-zinc-700 dark:text-zinc-300">
                                                        {count.toLocaleString()}
                                                    </span>
                                                </td>
                                                <td className="p-4 text-right">
                                                    <span className="font-mono text-sm text-zinc-500">
                                                        {(pct * 100).toFixed(2)}%
                                                    </span>
                                                </td>
                                            </motion.tr>
                                        );
                                    })}
                                </AnimatePresence>
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="p-4 border-t border-zinc-200 dark:border-white/5">
                    <Pagination currentPage={page} onPageChange={onPageChange} hasNext={hasNext} />
                </div>
            </div>
        </>
    );
}

// ─── Helpers ─────────────────────────────────────────────────────────
function formatBalance(raw: string, decimals?: number): string {
    if (!raw || raw === '0') return '0';
    const dec = decimals || 8;
    try {
        const num = parseFloat(raw) / Math.pow(10, dec);
        if (num > 1_000_000) return num.toLocaleString(undefined, { maximumFractionDigits: 0 });
        if (num > 1) return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
        return num.toLocaleString(undefined, { maximumFractionDigits: 6 });
    } catch {
        return raw;
    }
}

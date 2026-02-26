import { createFileRoute, Link } from '@tanstack/react-router'
import { AddressLink } from '../../components/AddressLink';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Search, Shield } from 'lucide-react';
import NumberFlow from '@number-flow/react';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import { getFlowV1Contract } from '../../api/gen/find';
import { useWebSocketStatus } from '../../hooks/useWebSocket';
import { Pagination } from '../../components/Pagination';
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/time';
import { useTimeTicker } from '../../hooks/useTimeTicker';
import { VerifiedBadge } from '../../components/ui/VerifiedBadge';

const KIND_TABS = [
    { label: 'All', value: '' },
    { label: 'FT', value: 'FT' },
    { label: 'NFT', value: 'NFT' },
    { label: 'Contract', value: 'CONTRACT' },
] as const;

// Define the search params validator
interface ContractsSearch {
    page?: number;
    query?: string;
    kind?: string;
}

export const Route = createFileRoute('/contracts/')({
    component: Contracts,
    validateSearch: (search: Record<string, unknown>): ContractsSearch => {
        return {
            page: Number(search.page) || 1,
            query: (search.query as string) || '',
            kind: (search.kind as string) || '',
        }
    },
    loaderDeps: ({ search: { page, query, kind } }) => ({ page, query, kind }),
    loader: async ({ deps: { page, query, kind } }) => {
        const isSSR = import.meta.env.SSR;
        const limit = 25;
        const offset = ((page || 1) - 1) * limit;
        try {
            await ensureHeyApiConfigured();
            const q: Record<string, any> = { limit, offset, identifier: query };
            if (kind) q.kind = kind;
            const res = await getFlowV1Contract({
                query: q,
                timeout: isSSR ? 2500 : 12000,
            });
            const payload: any = res.data;
            return {
                contracts: payload?.data || [],
                meta: payload?._meta || null,
                page,
                query,
                kind,
                deferred: false,
            };
        } catch (e) {
            console.error("Failed to load contracts", e);
            return { contracts: [], meta: null, page, query, kind, deferred: isSSR };
        }
    }
})

function TokenLogo({ src, name, size = 20 }: { src: string; name: string; size?: number }) {
    const [failed, setFailed] = useState(false);
    const letter = (name || '?')[0].toUpperCase();
    if (!src || failed) {
        return (
            <div
                className="flex items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-700 text-[10px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0"
                style={{ width: size, height: size }}
            >
                {letter}
            </div>
        );
    }
    return (
        <img
            src={src}
            alt={name}
            className="rounded-full shrink-0"
            style={{ width: size, height: size }}
            onError={() => setFailed(true)}
        />
    );
}

function KindBadge({ kind }: { kind: string }) {
    if (!kind || kind === 'CONTRACT') return null;
    const colors = kind === 'FT'
        ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
        : 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20';
    return (
        <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider border rounded ${colors}`}>
            {kind}
        </span>
    );
}

function Contracts() {
    const { contracts, meta, page, query, kind, deferred } = Route.useLoaderData();
    const navigate = Route.useNavigate();
    const search = Route.useSearch();
    const [searchQuery, setSearchQuery] = useState(query); // Local state for input
    const [contractsData, setContractsData] = useState<any[]>(contracts);
    const [contractsMeta, setContractsMeta] = useState<any>(meta);
    const [contractsLoading, setContractsLoading] = useState(Boolean(deferred));
    const [contractsError, setContractsError] = useState('');

    useEffect(() => {
        setSearchQuery(query);
    }, [query]);

    const { isConnected } = useWebSocketStatus();
    const nowTick = useTimeTicker(20000);

    const limit = 25;
    const offset = ((page || 1) - 1) * limit;
    const totalCount = Number(contractsMeta?.count || 0);
    const hasNext = totalCount > 0 ? offset + limit < totalCount : contractsData.length === limit;

    useEffect(() => {
        setContractsData(contracts);
        setContractsMeta(meta);
        setContractsError('');
        setContractsLoading(Boolean(deferred));
    }, [contracts, meta, deferred]);

    useEffect(() => {
        if (!deferred) return;
        let cancelled = false;
        const loadContractsClientSide = async () => {
            setContractsLoading(true);
            try {
                await ensureHeyApiConfigured();
                const q: Record<string, any> = { limit, offset, identifier: query };
                if (kind) q.kind = kind;
                const res = await getFlowV1Contract({
                    query: q,
                    timeout: 12000,
                });
                if (cancelled) return;
                const payload: any = res.data;
                setContractsData(payload?.data || []);
                setContractsMeta(payload?._meta || null);
            } catch (err) {
                if (!cancelled) {
                    console.error('Client fallback: failed to load contracts', err);
                    setContractsError('Contract list is temporarily slow. Please retry in a few seconds.');
                }
            } finally {
                if (!cancelled) setContractsLoading(false);
            }
        };
        loadContractsClientSide();
        return () => {
            cancelled = true;
        };
    }, [deferred, limit, offset, query, kind]);

    const normalizeHex = (value: any) => {
        if (!value) return '';
        const lower = String(value).toLowerCase();
        return lower.startsWith('0x') ? lower : `0x${lower}`;
    };

    const submitQuery = (e: any) => {
        e.preventDefault();
        const next = String(searchQuery || '').trim();
        navigate({ search: { page: 1, query: next, kind } });
    };

    const setPage = (newPage: number) => {
        navigate({ search: { page: newPage, query, kind } });
    };

    const setKind = (newKind: string) => {
        navigate({ search: { page: 1, query, kind: newKind } });
    };

    const activeKind = kind || '';

    return (
        <div className="container mx-auto px-4 py-8 space-y-8">
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-between"
            >
                <div className="flex items-center space-x-4">
                    <div className="p-3 bg-nothing-green/10 rounded-lg">
                        <FileText className="h-8 w-8 text-nothing-green-dark dark:text-nothing-green" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold text-zinc-900 dark:text-white uppercase tracking-tighter">Contracts</h1>
                        <p className="text-sm text-zinc-500 dark:text-zinc-400">Smart Contracts Indexed</p>
                    </div>
                </div>

                <div className={`flex items-center space-x-2 px-3 py-1 border rounded-full ${isConnected ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                    <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                    <span className="text-xs font-medium uppercase tracking-wider text-zinc-600 dark:text-zinc-300">
                        {isConnected ? 'Live Feed' : 'Offline'}
                    </span>
                </div>
            </motion.div>

            {/* Filter */}
            <motion.form
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                onSubmit={submitQuery}
                className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-4 rounded-sm shadow-sm dark:shadow-none flex items-center gap-3"
            >
                <div className="flex items-center gap-2 text-zinc-500">
                    <Search className="w-4 h-4" />
                    <span className="text-[10px] uppercase tracking-widest font-semibold">Filter</span>
                </div>
                <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by name, identifier, or address (e.g. FlowToken, A.82ed...MyContract, 0x82ed...)"
                    className="flex-1 bg-transparent border border-zinc-200 dark:border-white/10 px-3 py-2 rounded-sm text-sm font-mono text-zinc-900 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-nothing-green/30"
                />
                <button
                    type="submit"
                    className="px-4 py-2 border border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-black/30 hover:bg-zinc-100 dark:hover:bg-white/5 rounded-sm text-xs uppercase tracking-widest font-semibold text-zinc-700 dark:text-zinc-200 transition-colors"
                >
                    Apply
                </button>
            </motion.form>

            {/* Category Tabs */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 }}
                className="flex items-center gap-2"
            >
                {KIND_TABS.map((tab) => (
                    <button
                        key={tab.value}
                        onClick={() => setKind(tab.value)}
                        className={`px-4 py-1.5 text-xs uppercase tracking-widest font-semibold border rounded-full transition-colors ${
                            activeKind === tab.value
                                ? 'border-nothing-green bg-nothing-green/10 text-nothing-green-dark dark:text-nothing-green'
                                : 'border-zinc-200 dark:border-white/10 text-zinc-500 dark:text-zinc-400 hover:border-zinc-300 dark:hover:border-white/20'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </motion.div>

            {/* Stats */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="grid grid-cols-1 gap-6"
            >
                <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
                    <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1">Total Contracts</p>
                    <p className="text-3xl font-bold font-mono text-zinc-900 dark:text-white">
                        <NumberFlow value={Number.isFinite(totalCount) ? totalCount : 0} format={{ useGrouping: true }} />
                    </p>
                    {contractsMeta?.warning ? (
                        <p className="mt-2 text-[10px] text-amber-600 dark:text-amber-400 uppercase tracking-widest">{contractsMeta.warning}</p>
                    ) : null}
                </div>
            </motion.div>

            {/* Contracts Table */}
            <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden shadow-sm dark:shadow-none">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-white/5">
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Identifier</th>
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Address</th>
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">Dependents</th>
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">Deployed</th>
                                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">Last Updated</th>
                            </tr>
                        </thead>
                        <tbody>
                            {contractsLoading ? (
                                <tr>
                                    <td colSpan={5} className="p-8 text-center text-zinc-500 text-sm">Loading contract list...</td>
                                </tr>
                            ) : contractsError ? (
                                <tr>
                                    <td colSpan={5} className="p-8 text-center text-amber-600 dark:text-amber-400 text-sm">{contractsError}</td>
                                </tr>
                            ) : contractsData.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="p-8 text-center text-zinc-500 text-sm">No contracts found</td>
                                </tr>
                            ) : (
                            <AnimatePresence mode="popLayout">
                                {contractsData.map((c: any) => {
                                    const identifier = String(c?.identifier || c?.id || '');
                                    const addr = normalizeHex(c?.address);
                                    const lastUpdatedHeight = Number(c?.valid_from || 0);
                                    const createdAt = c?.created_at || '';
                                    const rel = createdAt ? formatRelativeTime(createdAt, nowTick) : '';
                                    const abs = createdAt ? formatAbsoluteTime(createdAt) : '';
                                    const depCount = Number(c?.import_count || c?.imported_count || 0);
                                    const isVerified = Boolean(c?.is_verified);
                                    const contractKind = String(c?.kind || '');
                                    const tokenLogo = String(c?.token_logo || '');
                                    const tokenName = String(c?.token_name || '');
                                    const contractName = String(c?.name || '');

                                    return (
                                        <motion.tr
                                            layout
                                            key={identifier || `${addr}-${lastUpdatedHeight}`}
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            className="border-b border-zinc-100 dark:border-white/5 group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                                        >
                                            <td className="p-4">
                                                <div className="flex items-center gap-2">
                                                    <TokenLogo src={tokenLogo} name={tokenName || contractName} size={20} />
                                                    <Link
                                                        to={`/contracts/${identifier}` as any}
                                                        className="font-mono text-sm text-zinc-900 dark:text-white hover:underline"
                                                        title={identifier}
                                                    >
                                                        {identifier}
                                                    </Link>
                                                    <KindBadge kind={contractKind} />
                                                    {isVerified && <VerifiedBadge size={14} />}
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                {addr ? (
                                                    <AddressLink address={addr} prefixLen={20} suffixLen={0} />
                                                ) : (
                                                    <span className="text-zinc-500">N/A</span>
                                                )}
                                            </td>
                                            <td className="p-4 text-right">
                                                <span className="font-mono text-sm text-zinc-900 dark:text-white">
                                                    {depCount > 0 ? depCount.toLocaleString() : '\u2014'}
                                                </span>
                                            </td>
                                            <td className="p-4">
                                                <div className="flex flex-col">
                                                    <span className="text-sm text-zinc-900 dark:text-white">{rel}</span>
                                                    <span className="text-xs text-zinc-500">{abs}</span>
                                                </div>
                                            </td>
                                            <td className="p-4 text-right">
                                                {lastUpdatedHeight > 0 ? (
                                                    <Link
                                                        to="/blocks/$height"
                                                        params={{ height: String(lastUpdatedHeight) }}
                                                        className="font-mono text-sm text-nothing-green-dark dark:text-nothing-green hover:underline"
                                                    >
                                                        {lastUpdatedHeight.toLocaleString()}
                                                    </Link>
                                                ) : (
                                                    <span className="font-mono text-sm text-zinc-500">{'\u2014'}</span>
                                                )}
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
                    <Pagination
                        currentPage={page ?? 1}
                        onPageChange={setPage}
                        hasNext={hasNext}
                    />
                </div>
            </div>
        </div>
    );
}

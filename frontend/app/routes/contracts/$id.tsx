import { createFileRoute, Link } from '@tanstack/react-router'
import { AddressLink } from '../../components/AddressLink';
import { useState, useEffect } from 'react';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import { getFlowV1Contract } from '../../api/gen/find';
import { resolveApiBaseUrl } from '../../api';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift';
import { vscDarkPlus, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { ArrowLeft, Box, Code, FileText, Layers, Activity, GitCompare } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/time';
import { useTimeTicker } from '../../hooks/useTimeTicker';
import { normalizeAddress, formatShort } from '../../components/account/accountUtils';
import { CopyButton } from '../../../components/animate-ui/components/buttons/copy';

SyntaxHighlighter.registerLanguage('cadence', swift);

type ContractTab = 'source' | 'transactions' | 'versions';

interface ContractVersion {
    version: number;
    block_height: number;
    transaction_id: string;
    created_at: string;
    code?: string;
}

interface ContractTransaction {
    id: string;
    block_height: number;
    timestamp: string;
    status: string;
    payer: string;
    proposer: string;
    gas_used: number;
    tags: string[];
    contract_imports: string[];
    fee: number;
}

export const Route = createFileRoute('/contracts/$id')({
    component: ContractDetail,
    loader: async ({ params }) => {
        try {
            const id = params.id;
            await ensureHeyApiConfigured();
            const listRes = await getFlowV1Contract({ query: { limit: 1, offset: 0, identifier: id } });
            const listPayload: any = listRes?.data;
            const meta = listPayload?.data?.[0];

            if (!meta) {
                return { contract: null, code: null, error: 'Contract not found' };
            }

            let code = '// Source code not available';
            const address = meta.address;
            let name = meta.name;

            if (!name && meta.identifier) {
                const parts = meta.identifier.split('.');
                if (parts.length >= 3) {
                    name = parts[2];
                }
            }

            if (address && name) {
                try {
                    const baseUrl = await resolveApiBaseUrl();
                    const codeRes = await fetch(`${baseUrl}/flow/account/${encodeURIComponent(address)}/contract/${encodeURIComponent(name)}`);
                    if (codeRes.ok) {
                        const codePayload: any = await codeRes.json();
                        code = codePayload?.code || code;
                    }
                } catch (e) {
                    console.warn('Failed to fetch code', e);
                }
            }

            return { contract: meta, code, error: null };

        } catch (e) {
            console.error("Failed to load contract data", e);
            return { contract: null, code: null, error: 'Failed to load contract details' };
        }
    }
})

function ContractDetail() {
    const { id } = Route.useParams();
    const { contract: initialContract, code: initialCode, error: initialError } = Route.useLoaderData();

    const [contract, setContract] = useState<any>(initialContract);
    const [code, setCode] = useState(initialCode);
    const [error, setError] = useState<any>(initialError);
    const [activeTab, setActiveTab] = useState<ContractTab>('source');
    const nowTick = useTimeTicker(20000);
    const { theme } = useTheme();
    const syntaxTheme = theme === 'dark' ? vscDarkPlus : oneLight;

    // Transactions state
    const [transactions, setTransactions] = useState<ContractTransaction[]>([]);
    const [txLoading, setTxLoading] = useState(false);
    const [txOffset, setTxOffset] = useState(0);
    const [txHasMore, setTxHasMore] = useState(false);

    // Versions state
    const [versions, setVersions] = useState<ContractVersion[]>([]);
    const [versionsLoading, setVersionsLoading] = useState(false);
    const [diffVersionA, setDiffVersionA] = useState<number | null>(null);
    const [diffVersionB, setDiffVersionB] = useState<number | null>(null);
    const [diffCodeA, setDiffCodeA] = useState<string>('');
    const [diffCodeB, setDiffCodeB] = useState<string>('');
    const [diffLoading, setDiffLoading] = useState(false);

    useEffect(() => {
        if (!initialContract && !initialError) {
            setError('Contract not found');
        } else {
            setContract(initialContract);
            setCode(initialCode);
            setError(initialError);
        }
    }, [initialContract, initialCode, initialError]);

    // Load transactions for this contract
    const loadContractTransactions = async (offset: number, append: boolean) => {
        setTxLoading(true);
        try {
            const baseUrl = await resolveApiBaseUrl();
            const res = await fetch(`${baseUrl}/flow/contract/${encodeURIComponent(id)}/transaction?limit=20&offset=${offset}`);
            const payload = await res.json();
            const items = payload?.data ?? [];
            setTransactions(append ? prev => [...prev, ...items] : items);
            setTxHasMore(items.length >= 20);
            setTxOffset(offset + items.length);
        } catch (err) {
            console.error('Failed to load contract transactions', err);
        } finally {
            setTxLoading(false);
        }
    };

    // Load version history
    const loadVersions = async () => {
        setVersionsLoading(true);
        try {
            const baseUrl = await resolveApiBaseUrl();
            const res = await fetch(`${baseUrl}/flow/contract/${encodeURIComponent(id)}/version?limit=50`);
            const payload = await res.json();
            const items = payload?.data ?? [];
            setVersions(items);
        } catch (err) {
            console.error('Failed to load contract versions', err);
        } finally {
            setVersionsLoading(false);
        }
    };

    // Load version code for diff
    const loadVersionCode = async (version: number): Promise<string> => {
        try {
            const baseUrl = await resolveApiBaseUrl();
            const res = await fetch(`${baseUrl}/flow/contract/${encodeURIComponent(id)}/version/${version}`);
            const payload = await res.json();
            const items = payload?.data;
            if (Array.isArray(items) && items.length > 0) {
                return items[0].code || '';
            }
            return '';
        } catch {
            return '';
        }
    };

    // Auto-load on tab switch
    useEffect(() => {
        if (activeTab === 'transactions' && transactions.length === 0 && !txLoading) {
            loadContractTransactions(0, false);
        }
        if (activeTab === 'versions' && versions.length === 0 && !versionsLoading) {
            loadVersions();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab]);

    // Load diff when both versions selected
    useEffect(() => {
        if (diffVersionA != null && diffVersionB != null && diffVersionA !== diffVersionB) {
            setDiffLoading(true);
            Promise.all([loadVersionCode(diffVersionA), loadVersionCode(diffVersionB)])
                .then(([a, b]) => {
                    setDiffCodeA(a);
                    setDiffCodeB(b);
                })
                .finally(() => setDiffLoading(false));
        }
    }, [diffVersionA, diffVersionB]);

    if (error || !contract) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-black flex items-center justify-center font-mono transition-colors duration-300">
                <div className="border border-red-500/30 bg-red-50 dark:bg-red-900/10 p-8 max-w-md text-center rounded-sm">
                    <FileText className="h-12 w-12 text-red-500 mx-auto mb-4" />
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white uppercase tracking-widest mb-2">Contract Not Found</h2>
                    <p className="text-zinc-600 dark:text-zinc-400 text-sm mb-6">{error || 'The requested contract identifier could not be found.'}</p>
                    <Link to="/contracts" className="inline-block w-full border border-zinc-200 dark:border-white/20 hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-900 dark:text-white text-xs uppercase tracking-widest py-3 transition-all rounded-sm">
                        Back to Contracts
                    </Link>
                </div>
            </div>
        );
    }

    const validFrom = Number(contract.valid_from || 0);
    const createdAt = contract.created_at;
    const timeRel = createdAt ? formatRelativeTime(createdAt, nowTick) : '';
    const timeAbs = createdAt ? formatAbsoluteTime(createdAt) : '';



    const tabs = [
        { id: 'source' as const, label: 'Source Code', icon: Code },
        { id: 'transactions' as const, label: 'Transactions', icon: Activity },
        { id: 'versions' as const, label: 'Version History', icon: GitCompare },
    ];

    // Simple unified diff display
    const renderDiff = () => {
        if (!diffCodeA && !diffCodeB) return null;
        const linesA = diffCodeA.split('\n');
        const linesB = diffCodeB.split('\n');
        const maxLines = Math.max(linesA.length, linesB.length);
        const diffLines: { type: 'same' | 'removed' | 'added'; line: string }[] = [];

        for (let i = 0; i < maxLines; i++) {
            const a = linesA[i] ?? '';
            const b = linesB[i] ?? '';
            if (a === b) {
                diffLines.push({ type: 'same', line: a });
            } else {
                if (i < linesA.length) diffLines.push({ type: 'removed', line: a });
                if (i < linesB.length) diffLines.push({ type: 'added', line: b });
            }
        }

        return (
            <div className="font-mono text-[11px] overflow-auto max-h-[600px]">
                {diffLines.map((dl, i) => (
                    <div
                        key={i}
                        className={`px-4 py-0.5 whitespace-pre ${dl.type === 'removed'
                            ? 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                            : dl.type === 'added'
                                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                                : 'text-zinc-600 dark:text-zinc-400'
                            }`}
                    >
                        <span className="inline-block w-6 text-right mr-3 text-zinc-400 select-none">
                            {dl.type === 'removed' ? '-' : dl.type === 'added' ? '+' : ' '}
                        </span>
                        {dl.line}
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-black text-zinc-900 dark:text-zinc-300 font-mono selection:bg-nothing-green selection:text-black transition-colors duration-300">
            <div className="container mx-auto px-4 py-8 max-w-6xl">
                <Link to="/contracts" className="inline-flex items-center space-x-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors mb-8 group">
                    <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
                    <span className="text-xs uppercase tracking-widest">Back to Contracts</span>
                </Link>

                {/* Header */}
                <div className="border border-zinc-200 dark:border-white/10 p-8 mb-8 relative overflow-hidden bg-white dark:bg-nothing-dark shadow-sm dark:shadow-none rounded-sm">
                    <div className="absolute top-0 right-0 p-4 opacity-5">
                        <FileText className="h-32 w-32" />
                    </div>

                    <div className="relative z-10">
                        <div className="flex items-center gap-3 mb-4">
                            <span className="text-nothing-green-dark dark:text-nothing-green text-xs uppercase tracking-[0.2em] border border-nothing-green-dark/30 dark:border-nothing-green/30 px-2 py-1 rounded-sm">
                                Smart Contract
                            </span>
                            {contract.is_evm && (
                                <span className="text-blue-600 dark:text-blue-400 text-xs uppercase tracking-[0.2em] border border-blue-400/30 px-2 py-1 rounded-sm">
                                    EVM
                                </span>
                            )}
                        </div>

                        <h1 className="text-3xl md:text-4xl font-bold text-zinc-900 dark:text-white mb-2 break-all font-mono">
                            {contract.name || contract.identifier}
                        </h1>
                        <p className="text-zinc-500 text-xs uppercase tracking-widest">
                            {contract.identifier}
                        </p>
                    </div>
                </div>

                {/* Info Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
                    {/* Metadata */}
                    <div className="lg:col-span-1 space-y-6">
                        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
                            <h3 className="text-xs text-zinc-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                                <Box className="h-4 w-4" /> Contract Details
                            </h3>

                            <div className="space-y-4">
                                <div className="group">
                                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Address</p>
                                    <div className="flex items-center gap-1 group">
                                        <AddressLink address={contract.address} prefixLen={20} suffixLen={0} />
                                        <CopyButton
                                            content={contract.address}
                                            variant="ghost"
                                            size="xs"
                                            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity"
                                        />
                                    </div>
                                </div>

                                {validFrom > 0 && (
                                    <div className="group">
                                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Valid From Height</p>
                                        <Link to={`/blocks/${validFrom}`} className="text-sm text-zinc-900 dark:text-white hover:text-nothing-green-dark dark:hover:text-nothing-green transition-colors font-mono">
                                            {validFrom.toLocaleString()}
                                        </Link>
                                    </div>
                                )}

                                {createdAt && (
                                    <div className="group">
                                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Deployed</p>
                                        <div className="text-sm text-zinc-900 dark:text-white">{timeRel}</div>
                                        <div className="text-[10px] text-zinc-500">{timeAbs}</div>
                                    </div>
                                )}

                                <div className="group">
                                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Dependents</p>
                                    <div className="flex items-center gap-2">
                                        <span className="bg-zinc-100 dark:bg-white/10 px-2 py-1 text-xs font-mono rounded-sm text-zinc-600 dark:text-zinc-300">
                                            {contract.dependents_count || 0} imports
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Main Content Area */}
                    <div className="lg:col-span-2">
                        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden shadow-sm dark:shadow-none flex flex-col min-h-[500px]">
                            {/* Tab bar */}
                            <div className="border-b border-zinc-200 dark:border-white/10 px-4 py-0 flex items-center gap-0 bg-zinc-50 dark:bg-white/5">
                                {tabs.map(({ id, label, icon: Icon }) => (
                                    <button
                                        key={id}
                                        onClick={() => setActiveTab(id)}
                                        className={`flex items-center gap-2 px-4 py-3 text-xs uppercase tracking-widest border-b-2 transition-colors ${activeTab === id
                                            ? 'border-nothing-green-dark dark:border-nothing-green text-zinc-900 dark:text-white font-bold'
                                            : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                                            }`}
                                    >
                                        <Icon className="h-3.5 w-3.5" />
                                        {label}
                                    </button>
                                ))}
                                {activeTab === 'source' && (
                                    <div className="ml-auto">
                                        <CopyButton
                                            content={code || ''}
                                            variant="ghost"
                                            size="xs"
                                            className="flex items-center gap-1.5 px-2 py-1 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-sm transition-colors text-xs text-zinc-600 dark:text-zinc-400 uppercase tracking-wider"
                                        />
                                    </div>
                                )}
                            </div>

                            {/* Source Code Tab */}
                            {activeTab === 'source' && (
                                <div className={`flex-1 relative overflow-auto ${theme === 'dark' ? 'bg-[#1e1e1e]' : 'bg-zinc-50'}`}>
                                    {code ? (
                                        <SyntaxHighlighter
                                            language="cadence"
                                            style={syntaxTheme}
                                            customStyle={{
                                                margin: 0,
                                                padding: '1.5rem',
                                                fontSize: '11px',
                                                lineHeight: '1.6',
                                                height: '100%',
                                            }}
                                            showLineNumbers={true}
                                            lineNumberStyle={{ minWidth: "2em", paddingRight: "1em", color: theme === 'dark' ? "#555" : "#999", userSelect: "none", textAlign: "right" }}
                                        >
                                            {code}
                                        </SyntaxHighlighter>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center p-12 text-zinc-500">
                                            <p className="text-xs uppercase tracking-widest">Loading Source Code...</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Transactions Tab */}
                            {activeTab === 'transactions' && (
                                <div className="flex-1 overflow-auto">
                                    {txLoading && transactions.length === 0 && (
                                        <div className="flex items-center justify-center p-12">
                                            <div className="w-8 h-8 border-2 border-dashed border-zinc-400 rounded-full animate-spin" />
                                        </div>
                                    )}
                                    {transactions.length > 0 && (
                                        <table className="w-full text-left text-xs">
                                            <thead>
                                                <tr className="border-b border-zinc-200 dark:border-white/5 text-zinc-500 uppercase tracking-wider bg-zinc-50 dark:bg-white/5">
                                                    <th className="p-3 font-normal">Tx Hash</th>
                                                    <th className="p-3 font-normal">Status</th>
                                                    <th className="p-3 font-normal">Block</th>
                                                    <th className="p-3 font-normal">Fee</th>
                                                    <th className="p-3 font-normal text-right">Time</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                                {transactions.map((tx) => (
                                                    <tr key={tx.id} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                                                        <td className="p-3">
                                                            <Link to={`/tx/${tx.id}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">
                                                                {formatShort(tx.id, 10, 6)}
                                                            </Link>
                                                        </td>
                                                        <td className="p-3">
                                                            <span className={`text-[10px] uppercase ${tx.status === 'SEALED' ? 'text-zinc-400' : tx.status === 'EXPIRED' ? 'text-red-500' : 'text-yellow-600'}`}>
                                                                {tx.status}
                                                            </span>
                                                        </td>
                                                        <td className="p-3">
                                                            <Link to={`/blocks/${tx.block_height}` as any} className="text-zinc-600 dark:text-zinc-400 hover:text-nothing-green-dark dark:hover:text-nothing-green font-mono">
                                                                {tx.block_height?.toLocaleString()}
                                                            </Link>
                                                        </td>
                                                        <td className="p-3 font-mono text-zinc-500">
                                                            {tx.fee ? `${Number(tx.fee).toFixed(4)}` : '—'}
                                                        </td>
                                                        <td className="p-3 text-right text-[10px] text-zinc-400">
                                                            {tx.timestamp ? formatRelativeTime(tx.timestamp, nowTick) : '—'}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    )}
                                    {txHasMore && (
                                        <div className="text-center py-3 border-t border-zinc-100 dark:border-white/5">
                                            <button
                                                onClick={() => loadContractTransactions(txOffset, true)}
                                                disabled={txLoading}
                                                className="px-4 py-2 text-xs border border-zinc-200 dark:border-white/10 rounded-sm hover:bg-zinc-100 dark:hover:bg-white/5 disabled:opacity-50 uppercase tracking-widest"
                                            >
                                                {txLoading ? 'Loading...' : 'Load More'}
                                            </button>
                                        </div>
                                    )}
                                    {transactions.length === 0 && !txLoading && (
                                        <div className="flex flex-col items-center justify-center p-12 text-zinc-500">
                                            <Activity className="h-8 w-8 mb-3 opacity-30" />
                                            <p className="text-xs uppercase tracking-widest">No transactions found</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Version History Tab */}
                            {activeTab === 'versions' && (
                                <div className="flex-1 overflow-auto">
                                    {versionsLoading && versions.length === 0 && (
                                        <div className="flex items-center justify-center p-12">
                                            <div className="w-8 h-8 border-2 border-dashed border-zinc-400 rounded-full animate-spin" />
                                        </div>
                                    )}
                                    {versions.length > 0 && (
                                        <div>
                                            {/* Version selection for diff */}
                                            <div className="px-4 py-3 border-b border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-white/5">
                                                <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">Select two versions to compare</p>
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    {versions.map(v => (
                                                        <button
                                                            key={v.version}
                                                            onClick={() => {
                                                                if (diffVersionA == null) {
                                                                    setDiffVersionA(v.version);
                                                                } else if (diffVersionB == null && v.version !== diffVersionA) {
                                                                    setDiffVersionB(v.version);
                                                                } else {
                                                                    setDiffVersionA(v.version);
                                                                    setDiffVersionB(null);
                                                                    setDiffCodeA('');
                                                                    setDiffCodeB('');
                                                                }
                                                            }}
                                                            className={`px-2 py-1 text-[10px] font-mono border rounded-sm transition-colors ${v.version === diffVersionA
                                                                ? 'border-red-400 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                                                                : v.version === diffVersionB
                                                                    ? 'border-green-400 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                                                                    : 'border-zinc-200 dark:border-white/10 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5'
                                                                }`}
                                                        >
                                                            v{v.version}
                                                        </button>
                                                    ))}
                                                    {(diffVersionA != null || diffVersionB != null) && (
                                                        <button
                                                            onClick={() => { setDiffVersionA(null); setDiffVersionB(null); setDiffCodeA(''); setDiffCodeB(''); }}
                                                            className="px-2 py-1 text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 uppercase tracking-wider"
                                                        >
                                                            Clear
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Diff view */}
                                            {diffVersionA != null && diffVersionB != null && (
                                                <div className="border-b border-zinc-200 dark:border-white/5">
                                                    <div className="px-4 py-2 bg-zinc-50 dark:bg-white/5 text-[10px] text-zinc-500 uppercase tracking-widest flex items-center gap-2">
                                                        <GitCompare className="h-3 w-3" />
                                                        Diff: v{Math.min(diffVersionA, diffVersionB)} → v{Math.max(diffVersionA, diffVersionB)}
                                                    </div>
                                                    {diffLoading ? (
                                                        <div className="flex items-center justify-center p-8">
                                                            <div className="w-6 h-6 border-2 border-dashed border-zinc-400 rounded-full animate-spin" />
                                                        </div>
                                                    ) : (
                                                        renderDiff()
                                                    )}
                                                </div>
                                            )}

                                            {/* Version list */}
                                            <table className="w-full text-left text-xs">
                                                <thead>
                                                    <tr className="border-b border-zinc-200 dark:border-white/5 text-zinc-500 uppercase tracking-wider bg-zinc-50 dark:bg-white/5">
                                                        <th className="p-3 font-normal">Version</th>
                                                        <th className="p-3 font-normal">Block Height</th>
                                                        <th className="p-3 font-normal">Transaction</th>
                                                        <th className="p-3 font-normal text-right">Time</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-zinc-100 dark:divide-white/5">
                                                    {versions.map((v) => (
                                                        <tr key={v.version} className="hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors">
                                                            <td className="p-3">
                                                                <span className="inline-flex items-center gap-1.5">
                                                                    <Layers className="h-3 w-3 text-zinc-400" />
                                                                    <span className="font-mono font-bold">v{v.version}</span>
                                                                </span>
                                                            </td>
                                                            <td className="p-3">
                                                                <Link to={`/blocks/${v.block_height}` as any} className="text-zinc-600 dark:text-zinc-400 hover:text-nothing-green-dark dark:hover:text-nothing-green font-mono">
                                                                    {v.block_height?.toLocaleString()}
                                                                </Link>
                                                            </td>
                                                            <td className="p-3">
                                                                {v.transaction_id ? (
                                                                    <Link to={`/tx/${v.transaction_id}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">
                                                                        {formatShort(v.transaction_id, 10, 6)}
                                                                    </Link>
                                                                ) : '—'}
                                                            </td>
                                                            <td className="p-3 text-right text-[10px] text-zinc-400">
                                                                {v.created_at ? formatRelativeTime(v.created_at, nowTick) : '—'}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                    {versions.length === 0 && !versionsLoading && (
                                        <div className="flex flex-col items-center justify-center p-12 text-zinc-500">
                                            <GitCompare className="h-8 w-8 mb-3 opacity-30" />
                                            <p className="text-xs uppercase tracking-widest">No version history available</p>
                                            <p className="text-[10px] text-zinc-400 mt-1">Version tracking starts from first indexed contract update</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}

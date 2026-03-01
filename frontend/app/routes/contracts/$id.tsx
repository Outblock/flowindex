import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { AddressLink } from '../../components/AddressLink';
import { useState, useEffect, useMemo, useRef } from 'react';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import { getFlowV1Contract } from '../../api/gen/find';
import { resolveApiBaseUrl } from '../../api';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift';
import { vscDarkPlus, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { ArrowLeft, Box, Code, FileText, Layers, Activity, GitCompare, ChevronDown, ChevronRight, Clock, Hash, Sparkles, Terminal, GitBranch } from 'lucide-react';
import { openAIChat } from '../../components/chat/openAIChat';
import { VerifiedBadge } from '../../components/ui/VerifiedBadge';
import { useTheme } from '../../contexts/ThemeContext';
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/time';
import { useTimeTicker } from '../../hooks/useTimeTicker';
import { formatShort } from '../../components/account/accountUtils';
import { CopyButton } from '@/components/animate-ui/components/buttons/copy';
import { diffLines, type Change } from 'diff';
import ReactFlow, { Background, Controls, useNodesState, useEdgesState, MarkerType, Position, Handle } from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';

// Custom node that shows name + identifier + metadata
const ContractNode = ({ data }: { data: { label: string; identifier: string; isCurrent: boolean; isVerified?: boolean; kind?: string; tokenLogo?: string; tokenSymbol?: string } }) => {
    const parts = data.identifier.split('.');
    const addr = parts.length >= 2 ? parts[1] : '';
    const shortAddr = addr.length > 8 ? `0x${addr.slice(0, 4)}...${addr.slice(-4)}` : `0x${addr}`;
    return (
        <div className="flex items-center gap-1.5">
            <Handle type="target" position={Position.Left} style={{ background: 'transparent', border: 'none' }} />
            {data.tokenLogo && (
                <img src={data.tokenLogo} alt="" className="w-4 h-4 rounded-full flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            )}
            <div className="text-center min-w-0">
                <div className="flex items-center justify-center gap-1" style={{ fontSize: 11, fontWeight: data.isCurrent ? 700 : 500 }}>
                    <span className="truncate">{data.label}</span>
                    {data.isVerified && <VerifiedBadge size={11} />}
                    {data.kind && <span style={{ fontSize: 7, opacity: 0.5, fontWeight: 600 }}>{data.kind}</span>}
                </div>
                <div style={{ fontSize: 8, opacity: 0.5, marginTop: 1, fontFamily: 'monospace' }}>{shortAddr}</div>
            </div>
            <Handle type="source" position={Position.Right} style={{ background: 'transparent', border: 'none' }} />
        </div>
    );
};
const nodeTypes = { contract: ContractNode };

SyntaxHighlighter.registerLanguage('cadence', swift);

type ContractTab = 'source' | 'transactions' | 'versions' | 'scripts' | 'dependencies';
const VALID_TABS: ContractTab[] = ['source', 'transactions', 'versions', 'scripts', 'dependencies'];

interface ContractVersion {
    version: number;
    block_height: number;
    transaction_id: string;
    created_at: string;
    code?: string;
}

interface ContractScript {
    script_hash: string;
    tx_count: number;
    category: string;
    label: string;
    description: string;
    script_preview: string;
}

interface ContractDependencyData {
    imports: Array<{ identifier: string; address: string; name: string }>;
    dependents: Array<{ identifier: string; address: string; name: string }>;
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
    validateSearch: (search: Record<string, unknown>): { tab?: ContractTab; line?: number; col?: number } => {
        const tab = search.tab as string;
        const line = Number(search.line) || undefined;
        const col = Number(search.col) || undefined;
        return {
            tab: VALID_TABS.includes(tab as ContractTab) ? (tab as ContractTab) : undefined,
            line,
            col,
        };
    },
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

            // Use the body field from the contract response (contains source code)
            let code = meta.body || '// Source code not available';

            // Fallback: if body is empty, try the dedicated endpoint
            if (!meta.body) {
                const address = meta.address;
                let name = meta.name;
                if (!name && meta.identifier) {
                    const parts = meta.identifier.split('.');
                    if (parts.length >= 3) name = parts[2];
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
    const { tab: searchTab, line: highlightLine } = Route.useSearch();
    const navigate = useNavigate({ from: Route.fullPath });
    const { contract: initialContract, code: initialCode, error: initialError } = Route.useLoaderData();

    const [contract, setContract] = useState<any>(initialContract);
    const [code, setCode] = useState(initialCode);
    const [error, setError] = useState<any>(initialError);
    const activeTab: ContractTab = searchTab || 'source';
    const nowTick = useTimeTicker(20000);
    const { theme } = useTheme();
    const syntaxTheme = theme === 'dark' ? vscDarkPlus : oneLight;
    const scrolledRef = useRef(false);

    // Scroll to highlighted line on mount
    useEffect(() => {
        if (highlightLine && code && !scrolledRef.current) {
            scrolledRef.current = true;
            setTimeout(() => {
                const el = document.getElementById('contract-highlight-line');
                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 300);
        }
    }, [highlightLine, code]);

    const switchTab = (tab: ContractTab) => {
        navigate({ search: { tab: tab === 'source' ? undefined : tab } as any, replace: true });
    };

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

    // Scripts state
    const [scripts, setScripts] = useState<ContractScript[]>([]);
    const [scriptsLoading, setScriptsLoading] = useState(false);
    const [scriptsOffset, setScriptsOffset] = useState(0);
    const [scriptsHasMore, setScriptsHasMore] = useState(false);
    const [selectedScript, setSelectedScript] = useState<string | null>(null);
    const [selectedScriptText, setSelectedScriptText] = useState<string>('');
    const [scriptTextLoading, setScriptTextLoading] = useState(false);

    // Dependencies state
    const [deps, setDeps] = useState<ContractDependencyData | null>(null);
    const [depsLoading, setDepsLoading] = useState(false);

    // Reset tab-loaded data when navigating to a different contract
    useEffect(() => {
        setDeps(null);
        setTransactions([]);
        setVersions([]);
        setScripts([]);
        setSelectedScript(null);
        setSelectedScriptText('');
    }, [id]);

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

    // Load common scripts
    const loadScripts = async (offset: number, append: boolean) => {
        setScriptsLoading(true);
        try {
            const baseUrl = await resolveApiBaseUrl();
            const res = await fetch(`${baseUrl}/flow/contract/${encodeURIComponent(id)}/scripts?limit=20&offset=${offset}`);
            const payload = await res.json();
            const items = payload?.data ?? [];
            setScripts(append ? prev => [...prev, ...items] : items);
            setScriptsHasMore(items.length >= 20);
            setScriptsOffset(offset + items.length);
        } catch (err) {
            console.error('Failed to load contract scripts', err);
        } finally {
            setScriptsLoading(false);
        }
    };

    // Fetch full script text by hash
    const loadScriptText = async (hash: string) => {
        setScriptTextLoading(true);
        try {
            const baseUrl = await resolveApiBaseUrl();
            const res = await fetch(`${baseUrl}/flow/script/${encodeURIComponent(hash)}`);
            const payload = await res.json();
            const items = payload?.data;
            if (Array.isArray(items) && items.length > 0) {
                setSelectedScriptText(items[0].script_text || '');
            }
        } catch (err) {
            console.error('Failed to load script text', err);
        } finally {
            setScriptTextLoading(false);
        }
    };

    // Auto-select first script when scripts load
    useEffect(() => {
        if (scripts.length > 0 && !selectedScript) {
            setSelectedScript(scripts[0].script_hash);
            loadScriptText(scripts[0].script_hash);
        }
    }, [scripts]);

    // Load dependencies
    const loadDeps = async () => {
        setDepsLoading(true);
        try {
            const baseUrl = await resolveApiBaseUrl();
            const res = await fetch(`${baseUrl}/flow/contract/${encodeURIComponent(id)}/dependencies?depth=3`);
            const payload = await res.json();
            const items = payload?.data;
            if (Array.isArray(items) && items.length > 0) {
                setDeps(items[0]);
            }
        } catch (err) {
            console.error('Failed to load contract dependencies', err);
        } finally {
            setDepsLoading(false);
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
        if (activeTab === 'scripts' && scripts.length === 0 && !scriptsLoading) {
            loadScripts(0, false);
        }
        if (activeTab === 'dependencies' && deps === null && !depsLoading) {
            loadDeps();
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
                    <button onClick={() => window.history.back()} className="inline-block w-full border border-zinc-200 dark:border-white/20 hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-900 dark:text-white text-xs uppercase tracking-widest py-3 transition-all rounded-sm">
                        Back
                    </button>
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
        { id: 'scripts' as const, label: 'Common Txs', icon: Terminal },
        { id: 'dependencies' as const, label: 'Dependencies', icon: GitBranch },
    ];

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-black text-zinc-900 dark:text-zinc-300 font-mono selection:bg-nothing-green selection:text-black transition-colors duration-300">
            <div className="container mx-auto px-4 py-8 max-w-7xl">
                <button onClick={() => window.history.back()} className="inline-flex items-center space-x-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors mb-8 group">
                    <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
                    <span className="text-xs uppercase tracking-widest">Back</span>
                </button>

                {/* Header */}
                <div className="border border-zinc-200 dark:border-white/10 p-8 mb-6 relative overflow-hidden bg-white dark:bg-nothing-dark shadow-sm dark:shadow-none rounded-sm">
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

                        <h1 className="text-3xl md:text-4xl font-bold text-zinc-900 dark:text-white mb-2 break-all font-mono flex items-center gap-2">
                            {contract.name || contract.identifier}
                            {contract.is_verified && <VerifiedBadge size={24} />}
                        </h1>
                        <p className="text-zinc-500 text-xs uppercase tracking-widest">
                            {contract.identifier}
                        </p>
                    </div>
                </div>

                {/* Metadata - horizontal stats bar */}
                <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm shadow-sm dark:shadow-none mb-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-zinc-100 dark:divide-white/5">
                        <div className="p-4 group">
                            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                                <Box className="h-3 w-3" /> Address
                            </p>
                            <div className="flex items-center gap-1">
                                <AddressLink address={contract.address} prefixLen={10} suffixLen={4} />
                                <CopyButton
                                    content={contract.address}
                                    variant="ghost"
                                    size="xs"
                                    className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity"
                                />
                            </div>
                        </div>

                        {validFrom > 0 && (
                            <div className="p-4">
                                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                                    <Hash className="h-3 w-3" /> Valid From
                                </p>
                                <Link to={`/blocks/${validFrom}` as any} className="text-sm text-zinc-900 dark:text-white hover:text-nothing-green-dark dark:hover:text-nothing-green transition-colors font-mono">
                                    {validFrom.toLocaleString()}
                                </Link>
                            </div>
                        )}

                        {createdAt && (
                            <div className="p-4">
                                <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                                    <Clock className="h-3 w-3" /> Deployed
                                </p>
                                <div className="text-sm text-zinc-900 dark:text-white">{timeRel}</div>
                                <div className="text-[10px] text-zinc-500">{timeAbs}</div>
                            </div>
                        )}

                        <div className="p-4">
                            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                                <Layers className="h-3 w-3" /> Dependents
                            </p>
                            <span className="text-sm font-mono text-zinc-900 dark:text-white">
                                {contract.imported_count || contract.import_count || 0} <span className="text-zinc-500 text-xs">imports</span>
                            </span>
                        </div>
                    </div>
                </div>

                {/* Main Content Area - full width */}
                <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden shadow-sm dark:shadow-none flex flex-col min-h-[500px]">
                    {/* Tab bar */}
                    <div className="border-b border-zinc-200 dark:border-white/10 px-4 py-0 flex items-center gap-0 bg-zinc-50 dark:bg-white/5">
                        {tabs.map(({ id, label, icon: Icon }) => (
                            <button
                                key={id}
                                onClick={() => switchTab(id)}
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
                            <div className="ml-auto flex items-center gap-1">
                                {code && (
                                    <button
                                        onClick={() => openAIChat(
                                            `Audit this Cadence smart contract for security vulnerabilities, logic errors, and best practice violations.\n\nFollow these steps in order:\n1. Call \`get_contract_source("${contract.address}")\` to get the contract manifest (names, sizes, dependency graph).\n2. Call \`get_contract_code("${contract.address}", "${contract.name || contract.identifier}")\` to fetch the target contract source code.\n3. Run \`cadence_security_scan\` on the source code for a comprehensive security audit.\n4. If the scan flags issues in specific dependencies, use \`get_contract_code\` to fetch those individual contracts and analyze them.\n\n> **Contract:** \`${contract.name || contract.identifier}\`\n> **Address:** \`${contract.address}\``,
                                            'deep'
                                        )}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[10px] uppercase tracking-widest font-bold bg-nothing-green text-black hover:bg-nothing-green/85 shadow-sm shadow-nothing-green/25 transition-colors"
                                    >
                                        <Sparkles className="h-3 w-3" />
                                        Audit with AI
                                        <span className="text-black/50 font-normal ml-0.5">Beta</span>
                                    </button>
                                )}
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
                                    language="swift"
                                    style={syntaxTheme}
                                    customStyle={{
                                        margin: 0,
                                        padding: '1.5rem',
                                        fontSize: '11px',
                                        lineHeight: '1.6',
                                        height: '100%',
                                    }}
                                    showLineNumbers={true}
                                    wrapLines={true}
                                    lineNumberStyle={{ minWidth: "2em", paddingRight: "1em", color: theme === 'dark' ? "#555" : "#999", userSelect: "none", textAlign: "right" }}
                                    lineProps={(lineNumber: number) => {
                                        if (highlightLine && lineNumber === highlightLine) {
                                            return {
                                                id: 'contract-highlight-line',
                                                style: {
                                                    backgroundColor: theme === 'dark' ? 'rgba(74,222,128,0.12)' : 'rgba(22,163,74,0.08)',
                                                    borderLeft: `3px solid ${theme === 'dark' ? '#4ade80' : '#16a34a'}`,
                                                    marginLeft: '-3px',
                                                    display: 'block',
                                                },
                                            };
                                        }
                                        return { style: { display: 'block' } };
                                    }}
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
                                                    <Link to={`/txs/${tx.id}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">
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
                                                <DiffView codeA={diffCodeA} codeB={diffCodeB} />
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
                                                            <Link to={`/txs/${v.transaction_id}` as any} className="text-nothing-green-dark dark:text-nothing-green hover:underline font-mono">
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

                    {/* Common Scripts Tab */}
                    {activeTab === 'scripts' && (
                        <div className="flex-1 flex overflow-hidden">
                            {scriptsLoading && scripts.length === 0 && (
                                <div className="flex items-center justify-center flex-1 p-12">
                                    <div className="w-8 h-8 border-2 border-dashed border-zinc-400 rounded-full animate-spin" />
                                </div>
                            )}
                            {scripts.length > 0 && (
                                <>
                                    {/* Left sidebar - script list */}
                                    <div className="w-[280px] shrink-0 border-r border-zinc-200 dark:border-white/10 overflow-y-auto">
                                        <div className="divide-y divide-zinc-100 dark:divide-white/5">
                                            {scripts.map((sc) => (
                                                <button
                                                    key={sc.script_hash}
                                                    onClick={() => {
                                                        setSelectedScript(sc.script_hash);
                                                        loadScriptText(sc.script_hash);
                                                    }}
                                                    className={`w-full text-left px-3 py-2.5 transition-colors ${
                                                        selectedScript === sc.script_hash
                                                            ? 'bg-nothing-green/10 border-l-2 border-nothing-green'
                                                            : 'hover:bg-zinc-50 dark:hover:bg-white/5 border-l-2 border-transparent'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-1.5 mb-0.5">
                                                        <span className={`text-[11px] font-mono truncate ${
                                                            selectedScript === sc.script_hash
                                                                ? 'text-zinc-900 dark:text-white font-semibold'
                                                                : 'text-zinc-700 dark:text-zinc-300'
                                                        }`}>
                                                            {sc.label || sc.script_hash.substring(0, 12) + '...'}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        {sc.category && (
                                                            <span className="text-[8px] px-1 py-0.5 rounded-sm bg-zinc-100 dark:bg-white/10 text-zinc-500 uppercase tracking-wider">
                                                                {sc.category}
                                                            </span>
                                                        )}
                                                        <span className="text-[10px] text-zinc-400 font-mono ml-auto">
                                                            {sc.tx_count?.toLocaleString()} txs
                                                        </span>
                                                    </div>
                                                    {sc.description && (
                                                        <p className="text-[9px] text-zinc-400 mt-0.5 truncate">{sc.description}</p>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                        {scriptsHasMore && (
                                            <div className="text-center py-2 border-t border-zinc-100 dark:border-white/5">
                                                <button
                                                    onClick={() => loadScripts(scriptsOffset, true)}
                                                    disabled={scriptsLoading}
                                                    className="px-3 py-1.5 text-[10px] border border-zinc-200 dark:border-white/10 rounded-sm hover:bg-zinc-100 dark:hover:bg-white/5 disabled:opacity-50 uppercase tracking-widest"
                                                >
                                                    {scriptsLoading ? 'Loading...' : 'Load More'}
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Right panel - script code */}
                                    <div className={`flex-1 overflow-auto ${theme === 'dark' ? 'bg-[#1e1e1e]' : 'bg-zinc-50'}`}>
                                        {scriptTextLoading ? (
                                            <div className="flex items-center justify-center h-full">
                                                <div className="w-6 h-6 border-2 border-dashed border-zinc-400 rounded-full animate-spin" />
                                            </div>
                                        ) : selectedScriptText ? (
                                            <SyntaxHighlighter
                                                language="swift"
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
                                                {selectedScriptText}
                                            </SyntaxHighlighter>
                                        ) : selectedScript ? (
                                            <div className="flex items-center justify-center h-full text-zinc-500 text-xs uppercase tracking-widest">
                                                Select a script to view
                                            </div>
                                        ) : null}
                                    </div>
                                </>
                            )}
                            {scripts.length === 0 && !scriptsLoading && (
                                <div className="flex flex-col items-center justify-center flex-1 p-12 text-zinc-500">
                                    <Terminal className="h-8 w-8 mb-3 opacity-30" />
                                    <p className="text-xs uppercase tracking-widest">No common transactions found</p>
                                    <p className="text-[10px] text-zinc-400 mt-1">Script templates that reference this contract will appear here</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Dependencies Tab */}
                    {activeTab === 'dependencies' && (
                        <div className="flex-1 overflow-auto" style={{ minHeight: 500 }}>
                            {depsLoading && (
                                <div className="flex items-center justify-center p-12">
                                    <div className="w-8 h-8 border-2 border-dashed border-zinc-400 rounded-full animate-spin" />
                                </div>
                            )}
                            {deps && !depsLoading && (
                                <DependencyGraph
                                    contractName={contract.name || id}
                                    contractIdentifier={contract.identifier || id}
                                    imports={deps.imports}
                                    dependents={deps.dependents}
                                    graph={deps.graph}
                                />
                            )}
                            {!deps && !depsLoading && (
                                <div className="flex flex-col items-center justify-center p-12 text-zinc-500">
                                    <GitBranch className="h-8 w-8 mb-3 opacity-30" />
                                    <p className="text-xs uppercase tracking-widest">No dependency data</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
}

// GitHub-style unified diff component
const CONTEXT_LINES = 3;

interface DiffHunk {
    lines: DiffLine[];
}

interface DiffLine {
    type: 'added' | 'removed' | 'context';
    content: string;
    oldNum: number | null;
    newNum: number | null;
}

function DiffView({ codeA, codeB }: { codeA: string; codeB: string }) {
    const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());

    const { hunks, stats } = useMemo(() => {
        if (!codeA && !codeB) return { hunks: [], stats: { added: 0, removed: 0 } };

        const changes: Change[] = diffLines(codeA, codeB);

        // Build flat list of diff lines with line numbers
        const allLines: DiffLine[] = [];
        let oldLineNum = 1;
        let newLineNum = 1;

        for (const change of changes) {
            const lines = change.value.replace(/\n$/, '').split('\n');
            for (const line of lines) {
                if (change.added) {
                    allLines.push({ type: 'added', content: line, oldNum: null, newNum: newLineNum++ });
                } else if (change.removed) {
                    allLines.push({ type: 'removed', content: line, oldNum: oldLineNum++, newNum: null });
                } else {
                    allLines.push({ type: 'context', content: line, oldNum: oldLineNum++, newNum: newLineNum++ });
                }
            }
        }

        // Find changed line indices
        const changedIndices = new Set<number>();
        allLines.forEach((line, i) => {
            if (line.type !== 'context') changedIndices.add(i);
        });

        // Build hunks with context lines, collapsing large unchanged sections
        const visibleIndices = new Set<number>();
        for (const idx of changedIndices) {
            for (let j = Math.max(0, idx - CONTEXT_LINES); j <= Math.min(allLines.length - 1, idx + CONTEXT_LINES); j++) {
                visibleIndices.add(j);
            }
        }

        // If no changes at all, show everything
        if (changedIndices.size === 0) {
            return { hunks: [{ lines: allLines }], stats: { added: 0, removed: 0 } };
        }

        const result: (DiffHunk | { collapsed: true; count: number; startIdx: number })[] = [];
        let currentHunk: DiffLine[] = [];
        let i = 0;

        while (i < allLines.length) {
            if (visibleIndices.has(i)) {
                currentHunk.push(allLines[i]);
                i++;
            } else {
                // Flush current hunk
                if (currentHunk.length > 0) {
                    result.push({ lines: currentHunk });
                    currentHunk = [];
                }
                // Count collapsed lines
                const startIdx = i;
                let collapsedCount = 0;
                while (i < allLines.length && !visibleIndices.has(i)) {
                    collapsedCount++;
                    i++;
                }
                result.push({ collapsed: true, count: collapsedCount, startIdx });
            }
        }
        if (currentHunk.length > 0) {
            result.push({ lines: currentHunk });
        }

        const added = allLines.filter(l => l.type === 'added').length;
        const removed = allLines.filter(l => l.type === 'removed').length;

        return { hunks: result as any, stats: { added, removed } };
    }, [codeA, codeB]);

    if (hunks.length === 0) return null;

    const toggleCollapsed = (startIdx: number) => {
        setCollapsedSections(prev => {
            const next = new Set(prev);
            if (next.has(startIdx)) next.delete(startIdx);
            else next.add(startIdx);
            return next;
        });
    };

    return (
        <div className="font-mono text-[11px] overflow-auto max-h-[700px]">
            {/* Stats bar */}
            <div className="px-4 py-1.5 border-b border-zinc-200 dark:border-white/5 flex items-center gap-3 text-[10px] bg-zinc-50/50 dark:bg-white/[0.02]">
                <span className="text-green-600 dark:text-green-400">+{stats.added}</span>
                <span className="text-red-600 dark:text-red-400">-{stats.removed}</span>
            </div>

            {hunks.map((hunk: any, hi: number) => {
                if (hunk.collapsed) {
                    const expanded = collapsedSections.has(hunk.startIdx);
                    if (expanded) {
                        // Re-compute lines from codeA for the expanded section
                        // For simplicity, we show a "collapse" button — the actual lines come from allLines
                        // Since we memoize, we need a different approach: store allLines
                    }
                    return (
                        <button
                            key={`c-${hi}`}
                            onClick={() => toggleCollapsed(hunk.startIdx)}
                            className="w-full px-4 py-1 text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-blue-50 dark:hover:bg-blue-900/10 border-y border-zinc-100 dark:border-white/5 flex items-center gap-1.5 transition-colors"
                        >
                            <ChevronRight className="h-3 w-3" />
                            {hunk.count} unchanged lines
                        </button>
                    );
                }
                return (
                    <div key={`h-${hi}`}>
                        {hunk.lines.map((line: DiffLine, li: number) => (
                            <div
                                key={li}
                                className={`flex whitespace-pre ${line.type === 'removed'
                                    ? 'bg-red-50 dark:bg-red-900/15'
                                    : line.type === 'added'
                                        ? 'bg-green-50 dark:bg-green-900/15'
                                        : ''
                                    }`}
                            >
                                <span className="inline-block w-[3.5rem] text-right pr-2 text-zinc-400 dark:text-zinc-600 select-none shrink-0 border-r border-zinc-100 dark:border-white/5">
                                    {line.oldNum ?? ''}
                                </span>
                                <span className="inline-block w-[3.5rem] text-right pr-2 text-zinc-400 dark:text-zinc-600 select-none shrink-0 border-r border-zinc-100 dark:border-white/5">
                                    {line.newNum ?? ''}
                                </span>
                                <span className={`inline-block w-4 text-center select-none shrink-0 ${line.type === 'removed'
                                    ? 'text-red-500 dark:text-red-400'
                                    : line.type === 'added'
                                        ? 'text-green-500 dark:text-green-400'
                                        : 'text-zinc-300 dark:text-zinc-600'
                                    }`}>
                                    {line.type === 'removed' ? '-' : line.type === 'added' ? '+' : ' '}
                                </span>
                                <span className={`pl-2 ${line.type === 'removed'
                                    ? 'text-red-700 dark:text-red-300'
                                    : line.type === 'added'
                                        ? 'text-green-700 dark:text-green-300'
                                        : 'text-zinc-600 dark:text-zinc-400'
                                    }`}>
                                    {line.content}
                                </span>
                            </div>
                        ))}
                    </div>
                );
            })}
        </div>
    );
}

function DependencyGraph({ contractName, contractIdentifier, imports, dependents, graph }: {
    contractName: string;
    contractIdentifier: string;
    imports: Array<{ identifier: string; address: string; name: string }>;
    dependents: Array<{ identifier: string; address: string; name: string }>;
    graph?: {
        nodes: Array<{ identifier: string; address: string; name: string; is_verified?: boolean; kind?: string; token_logo?: string; token_name?: string; token_symbol?: string }>;
        edges: Array<{ source: string; target: string }>;
        root: string;
    };
}) {
    const navigate = useNavigate();
    const { theme } = useTheme();

    const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
        const isDark = theme === 'dark';
        const green = isDark ? '#4ade80' : '#16a34a';
        const purple = isDark ? '#a78bfa' : '#7c3aed';
        const nodeBg = isDark ? '#18181b' : '#fff';
        const nodeBorder = isDark ? 'rgba(255,255,255,0.1)' : '#e4e4e7';
        const nodeColor = isDark ? '#a1a1aa' : '#52525b';
        const labelFill = isDark ? '#71717a' : '#a1a1aa';
        const labelBg = isDark ? '#09090b' : '#fff';

        const baseNodeStyle = {
            background: nodeBg,
            border: `1px solid ${nodeBorder}`,
            borderRadius: 4,
            padding: '8px 12px',
            fontSize: 10,
            fontFamily: 'monospace',
            color: nodeColor,
            cursor: 'pointer',
        };

        const rootID = graph?.root ?? contractIdentifier;

        // Build the graph using dagre for layout
        const g = new dagre.graphlib.Graph();
        g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 180, marginx: 40, marginy: 40 });
        g.setDefaultEdgeLabel(() => ({}));

        // Collect all node identifiers with metadata
        type NodeMeta = { name: string; identifier: string; isVerified?: boolean; kind?: string; tokenLogo?: string; tokenSymbol?: string };
        const allNodes = new Map<string, NodeMeta>();

        // Build a lookup from graph nodes for metadata
        const graphMeta = new Map<string, typeof graph extends undefined ? never : NonNullable<typeof graph>['nodes'][number]>();
        if (graph?.nodes) {
            for (const n of graph.nodes) {
                graphMeta.set(n.identifier, n);
            }
        }

        const metaFor = (id: string, name: string): NodeMeta => {
            const gn = graphMeta.get(id);
            return {
                name,
                identifier: id,
                isVerified: gn?.is_verified,
                kind: gn?.kind,
                tokenLogo: gn?.token_logo,
                tokenSymbol: gn?.token_symbol,
            };
        };

        // Add root node
        allNodes.set(rootID, metaFor(rootID, contractName));

        // Add graph import nodes + edges
        if (graph?.nodes) {
            for (const n of graph.nodes) {
                allNodes.set(n.identifier, metaFor(n.identifier, n.name));
            }
        } else {
            for (const imp of imports) {
                allNodes.set(imp.identifier, { name: imp.name, identifier: imp.identifier });
            }
        }

        // Add dependent nodes
        for (const dep of dependents) {
            if (!allNodes.has(dep.identifier)) {
                allNodes.set(dep.identifier, { name: dep.name, identifier: dep.identifier });
            }
        }

        // Estimate node widths for dagre
        for (const [id, n] of allNodes) {
            const hasLogo = n.tokenLogo ? 20 : 0;
            const w = Math.max(120, n.name.length * 7 + 32 + hasLogo);
            g.setNode(id, { width: w, height: 46 });
        }

        // Add edges: import edges (source imports target, arrow: source -> target means "source uses target")
        // In the graph data, edge.source imports edge.target
        const edgeKeys = new Set<string>();
        if (graph?.edges) {
            for (const e of graph.edges) {
                const key = `${e.source}->${e.target}`;
                if (!edgeKeys.has(key)) {
                    edgeKeys.add(key);
                    // dagre edge: target (imported) -> source (importer) for LR layout
                    // Actually we want imports to flow right-to-left: imported libs on left, importer on right
                    // So edge direction in dagre: target -> source (target is imported, appears left)
                    g.setEdge(e.target, e.source);
                }
            }
        } else {
            for (const imp of imports) {
                g.setEdge(imp.identifier, rootID);
            }
        }

        // Dependent edges: root -> dep (dep is on the right)
        for (const dep of dependents) {
            const key = `${rootID}->dep:${dep.identifier}`;
            if (!edgeKeys.has(key)) {
                edgeKeys.add(key);
                g.setEdge(rootID, dep.identifier);
            }
        }

        dagre.layout(g);

        // Convert to ReactFlow nodes/edges
        const rfNodes: any[] = [];
        const rfEdges: any[] = [];

        for (const [id, data] of allNodes) {
            const pos = g.node(id);
            if (!pos) continue;
            const isCurrent = id === rootID;
            rfNodes.push({
                id,
                type: 'contract',
                position: { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 },
                data: { label: data.name, identifier: data.identifier, isCurrent, isVerified: data.isVerified, kind: data.kind, tokenLogo: data.tokenLogo, tokenSymbol: data.tokenSymbol },
                style: isCurrent ? {
                    background: isDark ? '#1a2e1a' : '#f0fdf4',
                    border: `2px solid ${green}`,
                    borderRadius: 4,
                    padding: '8px 12px',
                    fontFamily: 'monospace',
                    color: isDark ? '#fff' : '#000',
                } : { ...baseNodeStyle, padding: '6px 12px' },
            });
        }

        // Import edges (green)
        if (graph?.edges) {
            for (const e of graph.edges) {
                rfEdges.push({
                    id: `e-${e.source}-${e.target}`,
                    source: e.target,   // imported lib (left)
                    target: e.source,   // importer (right)
                    animated: false,
                    style: { stroke: green, strokeWidth: 1.5 },
                    markerEnd: { type: MarkerType.ArrowClosed, color: green, width: 14, height: 14 },
                    labelStyle: { fontSize: 9, fontFamily: 'monospace', fill: labelFill },
                    labelBgStyle: { fill: labelBg, fillOpacity: 0.8 },
                });
            }
        } else {
            for (const imp of imports) {
                rfEdges.push({
                    id: `e-imp-${imp.identifier}`,
                    source: imp.identifier,
                    target: rootID,
                    animated: false,
                    style: { stroke: green, strokeWidth: 1.5 },
                    markerEnd: { type: MarkerType.ArrowClosed, color: green, width: 14, height: 14 },
                });
            }
        }

        // Dependent edges (purple)
        for (const dep of dependents) {
            rfEdges.push({
                id: `e-dep-${dep.identifier}`,
                source: rootID,
                target: dep.identifier,
                animated: false,
                style: { stroke: purple, strokeWidth: 1.5 },
                markerEnd: { type: MarkerType.ArrowClosed, color: purple, width: 14, height: 14 },
                labelStyle: { fontSize: 9, fontFamily: 'monospace', fill: labelFill },
                labelBgStyle: { fill: labelBg, fillOpacity: 0.8 },
            });
        }

        return { nodes: rfNodes, edges: rfEdges };
    }, [contractName, contractIdentifier, imports, dependents, graph, theme]);

    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    // Sync when data changes (e.g. navigating to a different contract)
    useEffect(() => {
        setNodes(initialNodes);
        setEdges(initialEdges);
    }, [initialNodes, initialEdges]);

    const onNodeClick = (_: any, node: any) => {
        if (node.data?.identifier && !node.data?.isCurrent) {
            navigate({ to: `/contracts/${node.data.identifier}` as any });
        }
    };

    if (imports.length === 0 && dependents.length === 0 && (!graph?.edges || graph.edges.length === 0)) {
        return (
            <div className="flex flex-col items-center justify-center p-12 text-zinc-500">
                <GitBranch className="h-8 w-8 mb-3 opacity-30" />
                <p className="text-xs uppercase tracking-widest">No dependencies found</p>
                <p className="text-[10px] text-zinc-400 mt-1">This contract has no imports and no known dependents</p>
            </div>
        );
    }

    return (
        <div style={{ height: 500 }}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={onNodeClick}
                fitView
                fitViewOptions={{ padding: 0.3 }}
                proOptions={{ hideAttribution: true }}
            >
                <Background color={theme === 'dark' ? '#333' : '#ddd'} gap={20} size={1} />
                <Controls
                    style={{
                        background: theme === 'dark' ? '#18181b' : '#fff',
                        border: `1px solid ${theme === 'dark' ? 'rgba(255,255,255,0.1)' : '#e4e4e7'}`,
                        borderRadius: 4,
                    }}
                />
            </ReactFlow>
            {/* Legend */}
            <div className="flex items-center gap-6 px-4 py-2 border-t border-zinc-100 dark:border-white/5 text-[10px] text-zinc-500">
                <span className="flex items-center gap-1.5">
                    <span className="w-3 h-0.5 bg-green-500 inline-block" /> Imports
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-3 h-0.5 bg-purple-500 inline-block" /> Imported by
                </span>
                <span className="text-zinc-400">Click a node to navigate</span>
            </div>
        </div>
    );
}

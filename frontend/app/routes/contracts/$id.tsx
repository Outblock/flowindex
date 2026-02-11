import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useEffect } from 'react';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import { getFlowV1Contract } from '../../api/gen/find';
import { getAccountsByAddressContractsByName } from '../../api/gen/core';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift';
import { vscDarkPlus, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { ArrowLeft, Box, CheckCircle, Code, Copy, ExternalLink, FileText, Layers } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/time';
import { useTimeTicker } from '../../hooks/useTimeTicker';
import { toast } from 'react-hot-toast';

SyntaxHighlighter.registerLanguage('cadence', swift);

export const Route = createFileRoute('/contracts/$id')({
    component: ContractDetail,
    loader: async ({ params }) => {
        try {
            const id = params.id;
            // 1. Fetch contract metadata
            await ensureHeyApiConfigured();
            const listRes = await getFlowV1Contract({ query: { limit: 1, offset: 0, identifier: id } });
            const listPayload: any = listRes?.data;
            const meta = listPayload?.data?.[0];

            if (!meta) {
                return { contract: null, code: null, error: 'Contract not found' };
            }

            // 2. Fetch contract code
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
                    const codeRes = await getAccountsByAddressContractsByName({ path: { address, name } });
                    const codePayload: any = codeRes?.data;
                    code = codePayload?.code || code;
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
    const nowTick = useTimeTicker(20000);
    const { theme } = useTheme();
    const syntaxTheme = theme === 'dark' ? vscDarkPlus : oneLight;

    useEffect(() => {
        if (!initialContract && !initialError) {
            setError('Contract not found');
        } else {
            setContract(initialContract);
            setCode(initialCode);
            setError(initialError);
        }
    }, [initialContract, initialCode, initialError]);


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

    const copyText = async (text: string, successMessage: string) => {
        try {
            if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
            } else if (typeof document !== 'undefined') {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.setAttribute('readonly', 'true');
                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            } else {
                throw new Error('Clipboard is unavailable');
            }
            toast.success(successMessage);
        } catch (e) {
            console.error('Copy failed', e);
            toast.error('Copy failed');
        }
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
                                    <div className="flex items-center gap-2">
                                        <Link to={`/accounts/${contract.address}`} className="text-sm font-mono text-nothing-green-dark dark:text-nothing-green hover:underline break-all">
                                            {contract.address}
                                        </Link>
                                        <button
                                            type="button"
                                            onClick={() => copyText(contract.address, 'Address copied')}
                                            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
                                            aria-label="Copy address"
                                        >
                                            <Copy className="h-3 w-3" />
                                        </button>
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

                    {/* Code */}
                    <div className="lg:col-span-2">
                        <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-0 rounded-sm overflow-hidden shadow-sm dark:shadow-none flex flex-col h-full min-h-[500px]">
                            <div className="border-b border-zinc-200 dark:border-white/10 px-4 py-3 flex items-center justify-between bg-zinc-50 dark:bg-white/5">
                                <div className="flex items-center gap-2">
                                    <Code className="h-4 w-4 text-zinc-500" />
                                    <span className="text-xs uppercase tracking-widest font-bold text-zinc-700 dark:text-zinc-300">Source Code</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => copyText(code, 'Code copied')}
                                    className="flex items-center gap-1.5 px-2 py-1 hover:bg-zinc-200 dark:hover:bg-white/10 rounded-sm transition-colors text-xs text-zinc-600 dark:text-zinc-400 uppercase tracking-wider"
                                    aria-label="Copy source code"
                                >
                                    <Copy className="h-3 w-3" /> Copy
                                </button>
                            </div>

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
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}

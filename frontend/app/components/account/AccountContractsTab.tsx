import { useState, useEffect, useRef } from 'react';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import { getFlowV1ContractByIdentifier } from '../../api/gen/find';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Code, FileText, ChevronRight, ExternalLink } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { normalizeAddress } from './accountUtils';
import { GlassCard } from '../ui/GlassCard';
import { motion, AnimatePresence } from 'framer-motion';

SyntaxHighlighter.registerLanguage('swift', swift);

interface Props {
    address: string;
    contracts: string[];
}

export function AccountContractsTab({ address, contracts }: Props) {
    const normalizedAddress = normalizeAddress(address);


    const [selectedContract, setSelectedContract] = useState<string | null>(null);
    const [contractCode, setContractCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const didAutoSelect = useRef(false);
    useEffect(() => {
        if (!didAutoSelect.current && contracts.length > 0 && !selectedContract) {
            didAutoSelect.current = true;
            loadContractCode(contracts[0]);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contracts]);

    const loadContractCode = async (name: string) => {
        if (!name || selectedContract === name) {
            if (selectedContract === name) setSelectedContract(null); // Toggle off
            return;
        }

        setLoading(true);
        setError(null);
        setSelectedContract(name);
        setContractCode('');

        try {
            await ensureHeyApiConfigured();
            const addr = normalizedAddress.replace(/^0x/, '');
            const identifier = `A.${addr}.${name}`;
            const res = await getFlowV1ContractByIdentifier({ path: { identifier } });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const contract = (res?.data as any)?.data?.[0];
            setContractCode(contract?.body || '');
        } catch (err) {
            console.error('Failed to load contract code', err);
            setError('Failed to load contract code');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <h3 className="text-sm font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Deployed Contracts ({contracts.length})
            </h3>

            {contracts.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-4">
                    {/* Contract List */}
                    <div className="space-y-1">
                        <AnimatePresence>
                            {contracts.map((name: string, i: number) => (
                                <motion.div
                                    key={name}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: i * 0.05 }}
                                >
                                    <button
                                        onClick={() => loadContractCode(name)}
                                        className={`w-full text-left group relative overflow-hidden transition-all duration-300 border ${selectedContract === name
                                            ? 'bg-nothing-green/10 border-nothing-green dark:border-nothing-green'
                                            : 'bg-white/50 dark:bg-zinc-900/50 hover:bg-white dark:hover:bg-white/5 border-zinc-200 dark:border-white/10'
                                            }`}
                                    >
                                        <div className="px-3 py-2.5 flex items-center justify-between">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <Code className={`w-3.5 h-3.5 flex-shrink-0 ${selectedContract === name ? 'text-nothing-green' : 'text-zinc-400'}`} />
                                                <span className={`font-mono text-xs truncate ${selectedContract === name
                                                    ? 'text-nothing-green-dark dark:text-nothing-green font-semibold'
                                                    : 'text-zinc-700 dark:text-zinc-300'
                                                    }`}>
                                                    {name}
                                                </span>
                                                <Link
                                                    to={`/contracts/A.${normalizedAddress.replace(/^0x/, '')}.${name}` as any}
                                                    className="opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400 hover:text-nothing-green"
                                                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                                    title="View contract details"
                                                >
                                                    <ExternalLink className="w-3 h-3" />
                                                </Link>
                                            </div>
                                            <ChevronRight className={`w-3 h-3 flex-shrink-0 transition-transform ${selectedContract === name ? 'rotate-90 text-nothing-green' : 'text-zinc-400 group-hover:translate-x-1'
                                                }`} />
                                        </div>
                                    </button>

                                    {/* Mobile/Inline rendering for better UX on small screens or just immediate context */}
                                    <AnimatePresence>
                                        {selectedContract === name && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: 'auto', opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                className="overflow-hidden md:hidden"
                                            >
                                                <div className="mt-2 bg-zinc-900 rounded-lg overflow-hidden border border-zinc-200 dark:border-white/10 shadow-inner">
                                                    {loading ? (
                                                        <div className="p-8 text-center text-xs text-zinc-500 animate-pulse">
                                                            Loading contract source...
                                                        </div>
                                                    ) : error ? (
                                                        <div className="p-4 text-xs text-red-500">{error}</div>
                                                    ) : (
                                                        <SyntaxHighlighter
                                                            language="swift"
                                                            style={vscDarkPlus}
                                                            customStyle={{ margin: 0, padding: '1rem', fontSize: '11px' }}
                                                            showLineNumbers={true}
                                                            wrapLines={true}
                                                        >
                                                            {contractCode}
                                                        </SyntaxHighlighter>
                                                    )}
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>

                    {/* Desktop Code Preview (Sticky) */}
                    <div className="hidden md:block">
                        <div className="sticky top-24">
                            <GlassCard className="p-0 overflow-hidden min-h-[400px] flex flex-col">
                                <div className="p-3 bg-zinc-50 dark:bg-white/5 border-b border-zinc-200 dark:border-white/10 flex items-center justify-between">
                                    <span className="text-xs font-mono text-zinc-500 flex items-center gap-2">
                                        <Code className="w-3 h-3" />
                                        {selectedContract ? `${selectedContract}.cdc` : 'Select a contract'}
                                    </span>
                                </div>

                                <div className="flex-1 bg-[#1e1e1e] overflow-auto max-h-[calc(100vh-200px)]">
                                    {selectedContract ? (
                                        loading ? (
                                            <div className="flex items-center justify-center h-full min-h-[300px] text-zinc-500 text-xs animate-pulse">
                                                Fetching source code...
                                            </div>
                                        ) : error ? (
                                            <div className="p-8 text-center text-red-400 text-xs">
                                                {error}
                                            </div>
                                        ) : (
                                            <SyntaxHighlighter
                                                language="swift"
                                                style={vscDarkPlus}
                                                customStyle={{
                                                    margin: 0,
                                                    padding: '1.5rem',
                                                    fontSize: '12px',
                                                    lineHeight: '1.6',
                                                    background: 'transparent'
                                                }}
                                                showLineNumbers={true}
                                                lineNumberStyle={{ color: '#444', minWidth: '3em' }}
                                                wrapLines={true}
                                            >
                                                {contractCode}
                                            </SyntaxHighlighter>
                                        )
                                    ) : (
                                        <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-zinc-600 space-y-4">
                                            <FileText className="w-12 h-12 opacity-20" />
                                            <p className="text-xs uppercase tracking-widest">Select a contract to view source</p>
                                        </div>
                                    )}
                                </div>
                            </GlassCard>
                        </div>
                    </div>
                </div>
            ) : (
                <GlassCard className="text-center py-12">
                    <FileText className="w-12 h-12 text-zinc-300 dark:text-zinc-700 mx-auto mb-4" />
                    <div className="text-zinc-500 italic">No contracts deployed</div>
                </GlassCard>
            )}
        </div>
    );
}

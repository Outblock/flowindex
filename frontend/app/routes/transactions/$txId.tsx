import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react';
import { ensureHeyApiConfigured } from '../../api/heyapi';
import { getFlowV1TransactionById } from '../../api/gen/find';
import { ArrowLeft, Activity, User, Box, Clock, CheckCircle, XCircle, Hash, ArrowRightLeft, Coins, Image as ImageIcon, Zap, Database, AlertCircle, FileText, Layers, Braces } from 'lucide-react';
import { formatAbsoluteTime, formatRelativeTime } from '../../lib/time';
import { useTimeTicker } from '../../hooks/useTimeTicker';

import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift';
import { vscDarkPlus, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { useTheme } from '../../contexts/ThemeContext';
import { CopyButton } from '../../../components/animate-ui/components/buttons/copy';

SyntaxHighlighter.registerLanguage('cadence', swift);

export const Route = createFileRoute('/transactions/$txId')({
    component: TransactionDetail,
    loader: async ({ params }) => {
        try {
            await ensureHeyApiConfigured();
            const res = await getFlowV1TransactionById({ path: { id: params.txId } });
            const rawTx: any = (res.data as any)?.data?.[0] ?? res.data;
            const transformedTx = {
                ...rawTx,
                type: rawTx.type || (rawTx.status === 'SEALED' ? 'TRANSFER' : 'PENDING'),
                payer: rawTx.payer_address || rawTx.payer || 'Unknown',
                proposer: rawTx.proposer_address || rawTx.proposer || 'Unknown',
                proposerKeyIndex: rawTx.proposer_key_index ?? -1,
                proposerSequenceNumber: rawTx.proposer_sequence_number ?? -1,
                blockHeight: rawTx.block_height,
                gasLimit: rawTx.gas_limit,
                gasUsed: rawTx.gas_used,
                events: rawTx.events || [],
                status: rawTx.status || 'UNKNOWN',
                errorMessage: rawTx.error_message,
                arguments: rawTx.arguments
            };
            return { transaction: transformedTx, error: null as string | null };
        } catch (e) {
            const status = (e as any)?.response?.status;
            const message = (e as any)?.message;
            // Avoid logging the full Axios error object (it contains huge request/socket graphs).
            console.error('Failed to load transaction data', { status, message });

            if (status === 404) {
                return { transaction: null, error: 'Transaction not found' };
            }

            return { transaction: null, error: 'Failed to load transaction details' };
        }
    }
})

function TransactionDetail() {
    const { transaction, error: loaderError } = Route.useLoaderData();
    const error = transaction ? null : (loaderError || 'Transaction not found');
    const [activeTab, setActiveTab] = useState(() =>
        transaction?.script ? 'script' : 'events'
    );
    const nowTick = useTimeTicker(20000);
    const { theme } = useTheme();
    const syntaxTheme = theme === 'dark' ? vscDarkPlus : oneLight;


    const formatAddress = (addr) => {
        if (!addr) return 'Unknown';
        let formatted = addr.toLowerCase();
        if (!formatted.startsWith('0x')) {
            formatted = '0x' + formatted;
        }
        return formatted;
    };

    if (error || !transaction) {
        return (
            <div className="min-h-screen bg-white dark:bg-black flex items-center justify-center font-mono transition-colors duration-300">
                <div className="border border-yellow-500/30 bg-yellow-50 dark:bg-nothing-dark p-8 max-w-md text-center shadow-sm">
                    <XCircle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
                    <h2 className="text-lg font-bold text-zinc-900 dark:text-white uppercase tracking-widest mb-2">Transaction Not Yet Indexed</h2>
                    <p className="text-zinc-600 dark:text-zinc-400 text-sm mb-4">This transaction exists on the blockchain but hasn&apos;t been indexed yet.</p>
                    <p className="text-zinc-500 text-xs mb-6">
                        The indexer is currently processing historical blocks. Please check back in a few minutes.
                    </p>
                    <div className="space-y-2">
                        <Link to="/" className="inline-block w-full border border-zinc-200 dark:border-white/20 hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-900 dark:text-white text-xs uppercase tracking-widest py-3 transition-all">
                            Return to Dashboard
                        </Link>
                        <Link to="/stats" className="inline-block w-full border border-nothing-green-dark/20 dark:border-nothing-green/20 hover:bg-nothing-green-dark/10 dark:hover:bg-nothing-green/10 text-nothing-green-dark dark:text-nothing-green text-xs uppercase tracking-widest py-3 transition-all">
                            View Indexing Progress
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    const txTimeSource = transaction.timestamp || transaction.created_at || transaction.block_timestamp;
    const txTimeAbsolute = formatAbsoluteTime(txTimeSource);
    const txTimeRelative = formatRelativeTime(txTimeSource, nowTick);

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
                        {transaction.is_evm ? <Box className="h-32 w-32" /> : <Hash className="h-32 w-32" />}
                    </div>

                    <div className="relative z-10">
                        <div className="flex flex-col md:flex-row md:items-center gap-4 mb-4">
                            <span className="text-nothing-green-dark dark:text-nothing-green text-xs uppercase tracking-[0.2em] border border-nothing-green-dark/30 dark:border-nothing-green/30 px-2 py-1 rounded-sm w-fit">
                                {transaction.type}
                            </span>
                            <span className={`text-xs uppercase tracking-[0.2em] border px-2 py-1 rounded-sm w-fit ${transaction.status === 'SEALED'
                                ? 'text-zinc-500 dark:text-white border-zinc-300 dark:border-white/30'
                                : 'text-yellow-600 dark:text-yellow-500 border-yellow-500/30'
                                }`}>
                                {transaction.status}
                            </span>
                            {transaction.is_evm && (
                                <span className="text-blue-600 dark:text-blue-400 text-xs uppercase tracking-[0.2em] border border-blue-400/30 px-2 py-1 rounded-sm w-fit">
                                    EVM Transaction
                                </span>
                            )}
                        </div>

                        <h1 className="text-3xl md:text-4xl font-bold text-zinc-900 dark:text-white mb-2 break-all flex items-center gap-1">
                            {transaction.is_evm ? transaction.evm_hash : transaction.id}
                            <CopyButton
                                content={transaction.is_evm ? transaction.evm_hash : transaction.id}
                                variant="ghost"
                                size="xs"
                                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                            />
                        </h1>
                        <p className="text-zinc-500 text-xs uppercase tracking-widest">
                            {transaction.is_evm ? 'EVM Hash' : 'Transaction ID'}
                        </p>
                    </div>
                </div>

                {/* Error Message Section */}
                {transaction.errorMessage && (
                    <div className="border border-red-500/30 bg-red-50 dark:bg-red-900/10 p-6 mb-8 flex items-start gap-4 rounded-sm">
                        <AlertCircle className="h-6 w-6 text-red-500 flex-shrink-0 mt-0.5" />
                        <div>
                            <h3 className="text-red-500 text-sm font-bold uppercase tracking-widest mb-1">Execution Error</h3>
                            <p className="text-red-600 dark:text-red-300 text-xs font-mono break-all leading-relaxed">
                                {transaction.errorMessage}
                            </p>
                        </div>
                    </div>
                )}

                {/* Info Grid - Now Full Width for Flow Info */}
                <div className="mb-8">
                    {/* Flow Information */}
                    <div className="border border-zinc-200 dark:border-white/10 p-6 bg-white dark:bg-nothing-dark shadow-sm dark:shadow-none">
                        <h2 className="text-zinc-900 dark:text-white text-sm uppercase tracking-widest mb-6 border-b border-zinc-100 dark:border-white/5 pb-2">
                            Cadence / Flow Information
                        </h2>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-6">
                                <div className="group">
                                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Flow Transaction ID</p>
                                    <div className="flex items-center gap-1">
                                        <code className="text-sm text-zinc-600 dark:text-zinc-300 break-all">{transaction.id}</code>
                                        <CopyButton
                                            content={transaction.id}
                                            variant="ghost"
                                            size="xs"
                                            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                                        />
                                    </div>
                                </div>
                                <div className="group">
                                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Timestamp</p>
                                    <span className="text-sm text-zinc-600 dark:text-zinc-300">{txTimeAbsolute || 'N/A'}</span>
                                    {txTimeRelative && (
                                        <div className="text-[10px] text-zinc-500 uppercase tracking-wider mt-1">
                                            {txTimeRelative}
                                        </div>
                                    )}
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="group">
                                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Block Height</p>
                                        <Link
                                            to={`/blocks/${transaction.blockHeight}` as any}
                                            className="text-sm text-zinc-900 dark:text-white hover:text-nothing-green-dark dark:hover:text-nothing-green transition-colors"
                                        >
                                            {transaction.blockHeight?.toLocaleString()}
                                        </Link>
                                    </div>
                                    <div className="group">
                                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Computation Usage</p>
                                        <span className="text-sm text-zinc-600 dark:text-zinc-300">{transaction.computation_usage?.toLocaleString() || 0}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col gap-6">
                                {/* Payer Section */}
                                <div className="group">
                                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Payer</p>
                                    <div className="bg-zinc-50 dark:bg-black/40 border border-zinc-200 dark:border-white/5 p-3 flex items-center justify-between hover:border-nothing-green-dark/30 dark:hover:border-nothing-green/30 transition-colors rounded-sm">
                                        <div className="flex items-center gap-1">
                                            <Link to={`/accounts/${formatAddress(transaction.payer)}` as any} className="text-sm text-nothing-green-dark dark:text-nothing-green hover:underline break-all font-mono">
                                                {formatAddress(transaction.payer)}
                                            </Link>
                                            <CopyButton
                                                content={formatAddress(transaction.payer)}
                                                variant="ghost"
                                                size="xs"
                                                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                                            />
                                        </div>
                                        <span className="text-[10px] text-zinc-500 dark:text-zinc-600 uppercase tracking-wider px-2 py-0.5 bg-zinc-200 dark:bg-white/5 rounded-sm">
                                            Fee Payer
                                        </span>
                                    </div>
                                </div>

                                {/* Proposer Section */}
                                <div className="group">
                                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Proposer</p>
                                    <div className="bg-zinc-50 dark:bg-black/40 border border-zinc-200 dark:border-white/5 p-3 flex flex-col gap-2 hover:border-zinc-300 dark:hover:border-white/20 transition-colors rounded-sm">
                                        <div className="flex items-center justify-between border-b border-zinc-200 dark:border-white/5 pb-2 mb-1">
                                            <span className="text-[10px] text-zinc-500 uppercase tracking-widest">Key Info</span>
                                            <div className="flex gap-3">
                                                <span className="text-[10px] text-zinc-400 font-mono">Seq: <span className="text-zinc-600 dark:text-white">{transaction.proposerSequenceNumber}</span></span>
                                                <span className="text-[10px] text-zinc-400 font-mono">Key: <span className="text-zinc-600 dark:text-white">{transaction.proposerKeyIndex}</span></span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <Link to={`/accounts/${formatAddress(transaction.proposer)}` as any} className="text-sm text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white break-all font-mono">
                                                {formatAddress(transaction.proposer)}
                                            </Link>
                                            <CopyButton
                                                content={formatAddress(transaction.proposer)}
                                                variant="ghost"
                                                size="xs"
                                                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Authorizers Section */}
                                {transaction.authorizers && transaction.authorizers.length > 0 && (
                                    <div className="group">
                                        <div className="flex items-center gap-2 mb-2">
                                            <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Authorizers</p>
                                            <span className="bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-white text-[9px] px-1.5 py-0.5 rounded-full">{transaction.authorizers.length}</span>
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            {transaction.authorizers.map((auth, idx) => (
                                                <div key={`${auth}-${idx}`} className="bg-zinc-50 dark:bg-black/40 border border-zinc-200 dark:border-white/5 p-3 hover:border-zinc-300 dark:hover:border-white/20 transition-colors rounded-sm flex items-center gap-1">
                                                    <Link to={`/accounts/${formatAddress(auth)}` as any} className="text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white break-all font-mono block">
                                                        {formatAddress(auth)}
                                                    </Link>
                                                    <CopyButton
                                                        content={formatAddress(auth)}
                                                        variant="ghost"
                                                        size="xs"
                                                        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Tabs Section */}
                <div className="mt-12">
                    <div className="flex border-b border-zinc-200 dark:border-white/10 mb-0 overflow-x-auto">
                        <button
                            onClick={() => setActiveTab('script')}
                            className={`px-6 py-3 text-xs uppercase tracking-widest transition-colors flex-shrink-0 ${activeTab === 'script'
                                ? 'text-zinc-900 dark:text-white border-b-2 border-nothing-green-dark dark:border-nothing-green bg-zinc-100 dark:bg-white/5'
                                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5'
                                }`}
                        >
                            <span className="flex items-center gap-2">
                                <Zap className={`h-4 w-4 ${activeTab === 'script' ? 'text-nothing-green-dark dark:text-nothing-green' : ''}`} />
                                Script & Args
                            </span>
                        </button>
                        <button
                            onClick={() => setActiveTab('events')}
                            className={`px-6 py-3 text-xs uppercase tracking-widest transition-colors flex-shrink-0 ${activeTab === 'events'
                                ? 'text-zinc-900 dark:text-white border-b-2 border-nothing-green-dark dark:border-nothing-green bg-zinc-100 dark:bg-white/5'
                                : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5'
                                }`}
                        >
                            <span className="flex items-center gap-2">
                                <Database className={`h-4 w-4 ${activeTab === 'events' ? 'text-nothing-green-dark dark:text-nothing-green' : ''}`} />
                                Key Events ({transaction.events ? transaction.events.length : 0})
                            </span>
                        </button>
                        {transaction.is_evm && (
                            <button
                                onClick={() => setActiveTab('evm')}
                                className={`px-6 py-3 text-xs uppercase tracking-widest transition-colors flex-shrink-0 ${activeTab === 'evm'
                                    ? 'text-zinc-900 dark:text-white border-b-2 border-nothing-green-dark dark:border-nothing-green bg-zinc-100 dark:bg-white/5'
                                    : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5'
                                    }`}
                            >
                                <span className="flex items-center gap-2">
                                    <Layers className={`h-4 w-4 ${activeTab === 'evm' ? 'text-blue-600 dark:text-blue-400' : ''}`} />
                                    EVM Execution Details
                                </span>
                            </button>
                        )}
                    </div>

                    <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 border-t-0 p-6 min-h-[300px] shadow-sm dark:shadow-none">
                        {activeTab === 'script' && (
                            <div className="space-y-8">
                                {/* Arguments */}
                                <div className="font-mono">
                                    <h3 className="text-xs text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                                        <FileText className="h-4 w-4" /> Script Arguments
                                    </h3>
                                    {transaction.arguments ? (
                                        <div className="bg-zinc-50 dark:bg-black/50 border border-zinc-200 dark:border-white/5 p-4 rounded-sm">
                                            {(() => {
                                                const decodeCadenceValue = (val) => {
                                                    if (!val || typeof val !== 'object') return val;

                                                    if (val.value !== undefined) {
                                                        if (val.type === 'Optional') {
                                                            return val.value ? decodeCadenceValue(val.value) : null;
                                                        }
                                                        if (val.type === 'Array') {
                                                            return val.value.map(decodeCadenceValue);
                                                        }
                                                        if (val.type === 'Dictionary') {
                                                            const dict = {};
                                                            val.value.forEach(item => {
                                                                const k = decodeCadenceValue(item.key);
                                                                const v = decodeCadenceValue(item.value);
                                                                dict[String(k)] = v;
                                                            });
                                                            return dict;
                                                        }
                                                        if (val.type === 'Struct' || val.type === 'Resource' || val.type === 'Event') {
                                                            const obj = {};
                                                            if (val.value && val.value.fields) {
                                                                val.value.fields.forEach(f => {
                                                                    obj[f.name] = decodeCadenceValue(f.value);
                                                                });
                                                                return obj;
                                                            }
                                                        }
                                                        if (val.type === 'Path') {
                                                            return `${val.value.domain}/${val.value.identifier}`;
                                                        }
                                                        if (val.type === 'Type') {
                                                            return val.value.staticType;
                                                        }
                                                        return val.value;
                                                    }
                                                    return val;
                                                };

                                                try {
                                                    let args = transaction.arguments;
                                                    if (typeof args === 'string') {
                                                        try {
                                                            args = JSON.parse(args);
                                                        } catch {
                                                            return <div className="text-zinc-500 dark:text-zinc-400 text-xs">{args}</div>;
                                                        }
                                                    }

                                                    if (!Array.isArray(args)) {
                                                        return <pre className="text-[10px] text-nothing-green-dark dark:text-nothing-green whitespace-pre-wrap">{JSON.stringify(args, null, 2)}</pre>;
                                                    }

                                                    const decodedArgs = args.map(decodeCadenceValue);

                                                    return (
                                                        <div className="space-y-2">
                                                            {decodedArgs.map((arg, idx) => (
                                                                <div key={idx} className="flex flex-col gap-1 border-b border-zinc-200 dark:border-white/5 last:border-0 pb-2 mb-2 last:mb-0 last:pb-0">
                                                                    <span className="text-[10px] text-zinc-500 uppercase tracking-widest">Argument {idx}</span>
                                                                    <div className="text-xs text-zinc-700 dark:text-zinc-300 font-mono break-all bg-zinc-100 dark:bg-white/5 p-2 rounded-sm">
                                                                        {typeof arg === 'object' && arg !== null
                                                                            ? JSON.stringify(arg, null, 2)
                                                                            : String(arg)
                                                                        }
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    );

                                                } catch {
                                                    return <div className="text-zinc-500 text-xs">Failed to parse arguments: {String(transaction.arguments)}</div>;
                                                }
                                            })()}
                                        </div>
                                    ) : (
                                        <div className="text-xs text-zinc-600 italic px-2">No arguments provided</div>
                                    )}
                                </div>

                                {/* Script */}
                                <div className="font-mono">
                                    <h3 className="text-xs text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-2">
                                        <Braces className="h-4 w-4" /> Cadence Script
                                    </h3>
                                    {transaction.script ? (
                                        <div className="border border-zinc-200 dark:border-white/5 rounded-sm overflow-hidden text-[10px]">
                                            <SyntaxHighlighter
                                                language="swift"
                                                style={syntaxTheme}
                                                customStyle={{
                                                    margin: 0,
                                                    padding: '1.5rem',
                                                    fontSize: '11px',
                                                    lineHeight: '1.6',
                                                }}
                                                showLineNumbers={true}
                                                lineNumberStyle={{ minWidth: "2em", paddingRight: "1em", color: theme === 'dark' ? "#555" : "#999", userSelect: "none" }}
                                            >
                                                {transaction.script}
                                            </SyntaxHighlighter>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center h-24 text-zinc-600 border border-zinc-200 dark:border-white/5 border-dashed rounded-sm">
                                            <p className="text-xs uppercase tracking-widest">No Script Content Available</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeTab === 'events' && (
                            <div className="space-y-6">
                                {transaction.events && transaction.events.length > 0 ? (
                                    transaction.events.map((event, idx) => (
                                        <div key={idx} className="relative pl-6 border-l border-zinc-200 dark:border-white/5 hover:border-nothing-green-dark/30 dark:hover:border-nothing-green/30 transition-all group/event">
                                            <div className="absolute left-0 top-0 -translate-x-1/2 w-2 h-2 bg-nothing-green-dark/20 dark:bg-nothing-green/20 border border-nothing-green-dark/40 dark:border-nothing-green/40 rounded-full group-hover/event:bg-nothing-green-dark dark:group-hover/event:bg-nothing-green group-hover/event:scale-125 transition-all"></div>

                                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 mb-3">
                                                <div className="flex flex-col">
                                                    <p className="text-xs font-bold text-nothing-green-dark dark:text-nothing-green mb-1 uppercase tracking-wider">
                                                        {event.event_name || event.type.split('.').pop()}
                                                    </p>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[10px] text-zinc-500 dark:text-zinc-600 uppercase">Contract</span>
                                                        <Link
                                                            to={`/accounts/${formatAddress(event.contract_address)}` as any}
                                                            className="text-[10px] text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors underline decoration-zinc-300 dark:decoration-white/10 underline-offset-2"
                                                        >
                                                            {formatAddress(event.contract_address) || 'System'} {event.contract_name ? `(${event.contract_name})` : ''}
                                                        </Link>
                                                    </div>
                                                </div>
                                                <span className="text-[10px] text-zinc-600 dark:text-zinc-700 font-mono bg-zinc-100 dark:bg-white/5 px-2 py-0.5 rounded uppercase">
                                                    Index #{event.event_index}
                                                </span>
                                            </div>

                                            <div className="bg-zinc-50 dark:bg-black/40 rounded-sm border border-zinc-200 dark:border-white/5 p-4 group-hover/event:bg-zinc-100 dark:group-hover/event:bg-black/60 transition-colors">
                                                <pre className="text-[11px] text-zinc-600 dark:text-zinc-400 font-mono leading-relaxed whitespace-pre-wrap break-all">
                                                    {JSON.stringify(event.values || event.payload || event.data, null, 2)}
                                                </pre>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-48 text-zinc-600">
                                        <Database className="h-8 w-8 mb-2 opacity-20" />
                                        <p className="text-xs uppercase tracking-widest">No Events Emitted</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'evm' && transaction.is_evm && (
                            <div className="space-y-6">
                                {/* Detailed EVM Fields */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="bg-zinc-50 dark:bg-black/30 p-4 border border-zinc-200 dark:border-white/5 space-y-1 rounded-sm">
                                        <p className="text-[10px] text-zinc-500 uppercase">EVM Hash</p>
                                        <p className="text-xs text-blue-600 dark:text-blue-400 font-mono break-all">{transaction.evm_hash}</p>
                                    </div>
                                    <div className="bg-zinc-50 dark:bg-black/30 p-4 border border-zinc-200 dark:border-white/5 space-y-1 rounded-sm">
                                        <p className="text-[10px] text-zinc-500 uppercase">Value</p>
                                        <p className="text-xs text-zinc-700 dark:text-white font-mono">{transaction.evm_value ? `${parseInt(transaction.evm_value, 16) / 1e18}` : '0'} FLOW</p>
                                    </div>
                                    <div className="bg-zinc-50 dark:bg-black/30 p-4 border border-zinc-200 dark:border-white/5 space-y-1 rounded-sm">
                                        <p className="text-[10px] text-zinc-500 uppercase">From</p>
                                        <p className="text-xs text-zinc-700 dark:text-zinc-300 font-mono break-all uppercase">{transaction.evm_from || 'N/A'}</p>
                                    </div>
                                    <div className="bg-zinc-50 dark:bg-black/30 p-4 border border-zinc-200 dark:border-white/5 space-y-1 rounded-sm">
                                        <p className="text-[10px] text-zinc-500 uppercase">To</p>
                                        <p className="text-xs text-zinc-700 dark:text-zinc-300 font-mono break-all uppercase">{transaction.evm_to || 'Contract Creation'}</p>
                                    </div>
                                </div>

                                <div className="p-4 border border-zinc-200 dark:border-white/5 bg-zinc-50 dark:bg-white/5 text-center mt-4 rounded-sm">
                                    <p className="text-xs text-zinc-500">Further EVM logs and traces to be implemented.</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

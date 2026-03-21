import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useEffect, useMemo } from 'react';
import { Clock, CheckCircle, Ban, Timer, Zap, ArrowLeft, Copy, Check, ExternalLink, BarChart3, ChevronDown, ChevronRight, Activity, Code, FileText } from 'lucide-react';
import { AddressLink } from '../../components/AddressLink';
import { resolveApiBaseUrl } from '../../api';
import { PageHeader } from '../../components/ui/PageHeader';
import { deriveEnrichments } from '../../lib/deriveFromEvents';
import { buildTxDetailAssetView } from '../../lib/txAssetFlow';

interface ScheduledTx {
    scheduled_id: number;
    priority: number;
    priority_label: string;
    expected_at: string;
    execution_effort: number;
    fees: string;
    handler_owner: string;
    handler_type: string;
    handler_contract: string;
    handler_contract_address: string;
    handler_uuid: number;
    handler_public_path: string;
    scheduled_block: number;
    scheduled_tx_id: string;
    scheduled_at: string;
    status: string;
    executed_block?: number;
    executed_tx_id?: string;
    executed_at?: string;
    fees_returned?: string;
    fees_deducted?: string;
    handler_stats?: Record<string, number>;
    executor_events?: TxEvent[];
}

interface TxEvent {
    type: string;
    event_name: string;
    event_index: number;
    payload: Record<string, any>;
}

const EXCLUDED_EVENT_SOURCES = ['FlowTransactionScheduler', 'FlowFees', 'FlowServiceAccount'];

function parseEventType(fullType: string): string {
    // Format: A.1654653399040a61.FungibleToken.Deposited -> FungibleToken.Deposited
    const parts = fullType.split('.');
    if (parts.length >= 4) {
        return parts.slice(2).join('.');
    }
    return fullType;
}

function isExcludedEvent(eventType: string): boolean {
    return EXCLUDED_EVENT_SOURCES.some(source => eventType.includes(source));
}

interface FTTransfer {
    from_address?: string;
    to_address?: string;
    amount: string;
    tokenType: string;
    transfer_type?: string;
    evm_to_address?: string;
    evm_from_address?: string;
}

interface NFTTransfer {
    from_address?: string;
    to_address?: string;
    token: string;
    token_id: string;
}

interface AppEvent {
    name: string;
    fields: Record<string, string>;
}

interface ExecutionSummary {
    ftTransfers: FTTransfer[];
    nftTransfers: NFTTransfer[];
    appEvents: AppEvent[];
    hasEVM: boolean;
    isIdle: boolean;
}

function buildExecutionSummary(events: TxEvent[]): ExecutionSummary {
    const enrichments = deriveEnrichments(events);
    const assetView = buildTxDetailAssetView({
        events,
        ft_transfers: enrichments.ft_transfers,
        raw_ft_transfers: enrichments.ft_transfers,
        nft_transfers: enrichments.nft_transfers,
        evm_executions: enrichments.evm_executions,
    });

    const ftTransfers: FTTransfer[] = assetView.canonicalFtTransfers.map((ft: any) => ({
        from_address: ft.from_address || '',
        to_address: ft.to_address || '',
        amount: String(ft.amount || '0'),
        tokenType: ft.token_symbol || ft.token_name || String(ft.token || ''),
        transfer_type: ft.transfer_type,
        evm_to_address: ft.evm_to_address,
        evm_from_address: ft.evm_from_address,
    }));
    const nftTransfers: NFTTransfer[] = (enrichments.nft_transfers || []).map((nt: any) => ({
        from_address: nt.from_address || '',
        to_address: nt.to_address || '',
        token: String(nt.token || ''),
        token_id: String(nt.token_id || ''),
    }));
    const appEvents: AppEvent[] = [];
    const hasEVM = (enrichments.evm_executions || []).length > 0;

    for (const evt of events) {
        const shortType = parseEventType(evt.type);

        // App-specific events (not system, not FT, not FlowToken)
        if (!isExcludedEvent(evt.type)
            && !evt.type.includes('FungibleToken')
            && !evt.type.includes('NonFungibleToken')
            && !evt.type.includes('FlowToken')
            && !evt.type.includes('EVM.TransactionExecuted')
            && evt.payload) {
            const fields: Record<string, string> = {};
            for (const [k, v] of Object.entries(evt.payload)) {
                if (v != null && typeof v !== 'object') {
                    fields[k] = String(v);
                }
            }
            if (Object.keys(fields).length > 0) {
                appEvents.push({ name: shortType, fields });
            }
        }
    }

    // Idle = only system events (no FT/NFT/app activity, no EVM)
    const isIdle = ftTransfers.length === 0 && nftTransfers.length === 0 && appEvents.length === 0 && !hasEVM;

    return { ftTransfers, nftTransfers, appEvents, hasEVM, isIdle };
}

function isAddress(val: string): boolean {
    return /^[0-9a-f]{16}$/.test(val) || /^[0-9a-f]{40}$/.test(val);
}

function DetailSkeleton() {
    return (
        <div className="min-h-screen bg-gray-50/50 dark:bg-black text-zinc-900 dark:text-white font-mono">
            <div className="max-w-5xl mx-auto px-4 pt-12 pb-24 space-y-6">
                <div className="h-8 w-60 bg-zinc-200 dark:bg-white/10 rounded-sm animate-pulse" />
                {[...Array(6)].map((_, i) => (
                    <div key={i} className="h-12 bg-zinc-100 dark:bg-white/5 rounded-sm animate-pulse" />
                ))}
            </div>
        </div>
    );
}

export const Route = createFileRoute('/scheduled/$id')({
    component: ScheduledTransactionDetail,
    pendingComponent: DetailSkeleton,
    loader: async ({ params }) => {
        try {
            const baseUrl = await resolveApiBaseUrl();
            const res = await fetch(`${baseUrl}/flow/scheduled-transaction/${params.id}`);
            if (!res.ok) return { tx: null };
            const payload = await res.json();
            return { tx: payload?.data || null };
        } catch {
            return { tx: null };
        }
    }
})

const formatDate = (iso: string) => {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) +
        ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const priorityColor = (p: number) => {
    switch (p) {
        case 0: return 'text-red-500 bg-red-500/10 border-red-500/20';
        case 1: return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
        case 2: return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
        default: return 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20';
    }
};

const statusColor = (status: string) => {
    switch (status) {
        case 'EXECUTED': return 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';
        case 'CANCELED': return 'text-red-500 bg-red-500/10 border-red-500/20';
        default: return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
    }
};

const statusIcon = (status: string) => {
    switch (status) {
        case 'EXECUTED': return <CheckCircle className="h-3.5 w-3.5" />;
        case 'CANCELED': return <Ban className="h-3.5 w-3.5" />;
        default: return <Timer className="h-3.5 w-3.5" />;
    }
};

// Cadence syntax highlighting tokenizer
const CADENCE_KEYWORDS = new Set([
    'import', 'from', 'access', 'all', 'fun', 'let', 'var', 'if', 'else', 'return',
    'self', 'create', 'destroy', 'emit', 'pub', 'priv', 'pre', 'post', 'execute',
    'prepare', 'transaction', 'resource', 'struct', 'contract', 'event', 'interface',
    'init', 'nil', 'true', 'false', 'as', 'while', 'for', 'in', 'break', 'continue',
    'switch', 'case', 'default',
]);

function highlightCadenceLine(line: string): React.ReactNode[] {
    const tokens: React.ReactNode[] = [];
    let i = 0;

    // Check for line comments first
    const commentIdx = line.indexOf('//');
    let codePart = line;
    let commentPart = '';
    if (commentIdx !== -1) {
        // Make sure it's not inside a string
        let inString = false;
        for (let j = 0; j < commentIdx; j++) {
            if (line[j] === '"' && (j === 0 || line[j - 1] !== '\\')) inString = !inString;
        }
        if (!inString) {
            codePart = line.slice(0, commentIdx);
            commentPart = line.slice(commentIdx);
        }
    }

    // Tokenize the code part
    i = 0;
    while (i < codePart.length) {
        // String literal
        if (codePart[i] === '"') {
            let end = i + 1;
            while (end < codePart.length && codePart[end] !== '"') {
                if (codePart[end] === '\\') end++; // skip escaped char
                end++;
            }
            if (end < codePart.length) end++; // include closing quote
            tokens.push(<span key={`s${i}`} className="text-amber-300">{codePart.slice(i, end)}</span>);
            i = end;
            continue;
        }

        // Address literal (0x followed by hex)
        if (codePart[i] === '0' && i + 1 < codePart.length && codePart[i + 1] === 'x') {
            let end = i + 2;
            while (end < codePart.length && /[0-9a-fA-F]/.test(codePart[end])) end++;
            if (end > i + 2) {
                tokens.push(<span key={`a${i}`} className="text-emerald-400">{codePart.slice(i, end)}</span>);
                i = end;
                continue;
            }
        }

        // Number
        if (/[0-9]/.test(codePart[i]) && (i === 0 || !/[a-zA-Z_]/.test(codePart[i - 1]))) {
            let end = i;
            while (end < codePart.length && /[0-9.]/.test(codePart[end])) end++;
            // Don't match if followed by a letter (part of identifier)
            if (end === codePart.length || !/[a-zA-Z_]/.test(codePart[end])) {
                tokens.push(<span key={`n${i}`} className="text-orange-400">{codePart.slice(i, end)}</span>);
                i = end;
                continue;
            }
        }

        // Word (identifier / keyword / type)
        if (/[a-zA-Z_]/.test(codePart[i])) {
            let end = i;
            while (end < codePart.length && /[a-zA-Z0-9_]/.test(codePart[end])) end++;
            const word = codePart.slice(i, end);

            // Look ahead for function call
            let lookAhead = end;
            while (lookAhead < codePart.length && codePart[lookAhead] === ' ') lookAhead++;
            const isFunc = lookAhead < codePart.length && codePart[lookAhead] === '(';

            // Look behind for type context (after : or < or as)
            let lookBehind = i - 1;
            while (lookBehind >= 0 && codePart[lookBehind] === ' ') lookBehind--;
            const prevChar = lookBehind >= 0 ? codePart[lookBehind] : '';
            const isTypeCtx = prevChar === ':' || prevChar === '<' || prevChar === '@';

            if (CADENCE_KEYWORDS.has(word)) {
                tokens.push(<span key={`k${i}`} className="text-purple-400">{word}</span>);
            } else if (isTypeCtx && /^[A-Z]/.test(word)) {
                tokens.push(<span key={`t${i}`} className="text-cyan-400">{word}</span>);
            } else if (isFunc) {
                tokens.push(<span key={`f${i}`} className="text-blue-400">{word}</span>);
            } else if (/^[A-Z]/.test(word) && (isTypeCtx || prevChar === '.' || prevChar === '{' || i === 0 || codePart.slice(Math.max(0, i - 10), i).match(/\b(resource|struct|contract|event|interface|import)\s*$/))) {
                // Capitalized words in likely type positions
                tokens.push(<span key={`t${i}`} className="text-cyan-400">{word}</span>);
            } else {
                tokens.push(<span key={`w${i}`} className="text-zinc-300">{word}</span>);
            }
            i = end;
            continue;
        }

        // Default: single character
        tokens.push(<span key={`c${i}`} className="text-zinc-300">{codePart[i]}</span>);
        i++;
    }

    // Append comment part
    if (commentPart) {
        tokens.push(<span key="comment" className="text-zinc-500 italic">{commentPart}</span>);
    }

    return tokens;
}

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors p-0.5"
            title="Copy"
        >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
        </button>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-1 md:gap-4 py-3 border-b border-zinc-100 dark:border-white/5">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500 self-center">{label}</span>
            <div className="text-xs text-zinc-800 dark:text-zinc-200">{children}</div>
        </div>
    );
}

type DetailTab = 'overview' | 'events' | 'contract';

function ScheduledTransactionDetail() {
    const { tx } = Route.useLoaderData() as { tx: ScheduledTx | null };
    const [activeTab, setActiveTab] = useState<DetailTab>('overview');
    const [contractCode, setContractCode] = useState<string | null>(null);
    const [loadingCode, setLoadingCode] = useState(false);
    const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set());

    // Filter executor events from the detail response (already included by backend)
    const allEvents = tx?.executor_events || [];
    const executorEvents = allEvents.filter(e => !isExcludedEvent(e.type));
    const summary = useMemo(() => buildExecutionSummary(allEvents), [allEvents]);

    // Fetch handler contract code
    useEffect(() => {
        if (!tx) return;
        const addr = tx.handler_contract_address;
        const name = tx.handler_contract;
        if (!addr || !name) return;

        setLoadingCode(true);
        resolveApiBaseUrl().then(baseUrl => {
            fetch(`${baseUrl}/flow/v1/contract/${addr.replace('0x', '')}`)
                .then(r => r.json())
                .then(payload => {
                    const contracts = payload?.data;
                    if (Array.isArray(contracts)) {
                        const match = contracts.find((c: any) => c.name === name);
                        if (match) setContractCode(match.code || match.body || null);
                    } else if (contracts) {
                        setContractCode(contracts.code || contracts.body || null);
                    }
                })
                .catch(() => {})
                .finally(() => setLoadingCode(false));
        });
    }, [tx]);

    if (!tx) {
        return (
            <div className="min-h-screen bg-gray-50/50 dark:bg-black text-zinc-900 dark:text-white font-mono">
                <div className="max-w-5xl mx-auto px-4 pt-12 pb-24">
                    <div className="text-center py-20">
                        <p className="text-zinc-500 text-sm">Scheduled transaction not found</p>
                        <Link to="/scheduled" className="text-nothing-green-dark dark:text-nothing-green hover:underline text-xs mt-2 inline-block">
                            Back to Scheduled Transactions
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    const showEventsTab = tx.status === 'EXECUTED';

    return (
        <div className="min-h-screen bg-gray-50/50 dark:bg-black text-zinc-900 dark:text-white font-mono transition-colors duration-300">
            <div className="max-w-5xl mx-auto px-4 pt-12 pb-24">
                {/* Back link */}
                <Link
                    to="/scheduled"
                    className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 mb-6 transition-colors"
                >
                    <ArrowLeft className="h-3 w-3" />
                    Scheduled Transactions
                </Link>

                {/* Header */}
                <div className="flex flex-wrap items-center gap-3 mb-8">
                    <h1 className="text-2xl font-bold">Scheduled Transaction</h1>
                    <span className="text-xl font-bold text-nothing-green-dark dark:text-nothing-green">#{tx.scheduled_id}</span>
                    <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded border font-bold uppercase tracking-wider ${statusColor(tx.status)}`}>
                        {statusIcon(tx.status)}
                        {tx.status}
                    </span>
                    <span className={`inline-flex items-center gap-0.5 text-[10px] px-2 py-1 rounded border font-medium ${priorityColor(tx.priority)}`}>
                        <Zap className="h-2.5 w-2.5" />
                        {tx.priority_label}
                    </span>
                    <span className="text-xs text-zinc-500 bg-zinc-100 dark:bg-white/5 px-2 py-1 rounded border border-zinc-200 dark:border-white/10">
                        {tx.execution_effort} effort
                    </span>
                </div>

                {/* Tab bar */}
                <div className="flex items-center gap-0 border-b border-zinc-200 dark:border-white/10 mb-6">
                    <button
                        onClick={() => setActiveTab('overview')}
                        className={`flex items-center gap-1.5 px-4 py-2.5 text-xs uppercase tracking-widest font-medium border-b-2 transition-colors ${
                            activeTab === 'overview' ? 'border-nothing-green text-zinc-900 dark:text-white' : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                        }`}
                    >
                        <FileText className="h-3.5 w-3.5" />
                        Overview
                    </button>
                    {showEventsTab && (
                        <button
                            onClick={() => setActiveTab('events')}
                            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs uppercase tracking-widest font-medium border-b-2 transition-colors ${
                                activeTab === 'events' ? 'border-nothing-green text-zinc-900 dark:text-white' : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                            }`}
                        >
                            <Activity className="h-3.5 w-3.5" />
                            Events ({executorEvents.length})
                        </button>
                    )}
                    <button
                        onClick={() => setActiveTab('contract')}
                        className={`flex items-center gap-1.5 px-4 py-2.5 text-xs uppercase tracking-widest font-medium border-b-2 transition-colors ${
                            activeTab === 'contract' ? 'border-nothing-green text-zinc-900 dark:text-white' : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                        }`}
                    >
                        <Code className="h-3.5 w-3.5" />
                        Contract
                    </button>
                </div>

                {/* Overview tab */}
                {activeTab === 'overview' && (
                    <>
                        {/* Detail fields */}
                        <div className="bg-white dark:bg-zinc-900/50 rounded-lg border border-zinc-200 dark:border-white/10 px-4">
                            <Field label="ID">
                                <span className="font-medium">{tx.scheduled_id}</span>
                            </Field>

                            <Field label="Owner">
                                <div className="flex items-center gap-2">
                                    <AddressLink address={tx.handler_owner} prefixLen={16} suffixLen={8} size={14} />
                                    <CopyButton text={tx.handler_owner} />
                                </div>
                            </Field>

                            <Field label="Fees">
                                <span className="font-medium">{parseFloat(tx.fees).toFixed(8)} FLOW</span>
                            </Field>

                            <Field label="Handler Contract">
                                <div className="flex items-center gap-2">
                                    <Link
                                        to={`/contracts/${tx.handler_contract_address.replace('0x', '')}.${tx.handler_contract}` as any}
                                        className="text-nothing-green-dark dark:text-nothing-green hover:underline font-medium"
                                    >
                                        {tx.handler_contract}
                                    </Link>
                                    <ExternalLink className="h-3 w-3 text-zinc-400" />
                                </div>
                            </Field>

                            <Field label="Handler UUID">{tx.handler_uuid}</Field>

                            <Field label="Handler">
                                <span className="break-all">{tx.handler_type}</span>
                            </Field>

                            {tx.handler_public_path && (
                                <Field label="Public Path">{tx.handler_public_path}</Field>
                            )}

                            <Field label="Scheduled At">{formatDate(tx.scheduled_at)}</Field>
                            <Field label="Expected At">{formatDate(tx.expected_at)}</Field>

                            <Field label="Scheduled By">
                                <div className="flex flex-wrap items-center gap-2">
                                    <Link
                                        to={`/blocks/${tx.scheduled_block}` as any}
                                        className="text-nothing-green-dark dark:text-nothing-green hover:underline"
                                    >
                                        #{tx.scheduled_block}
                                    </Link>
                                    <span className="text-zinc-400">|</span>
                                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-nothing-green/10 text-nothing-green-dark dark:text-nothing-green border border-nothing-green/20 uppercase font-bold">
                                        FLOW
                                    </span>
                                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 uppercase font-bold">
                                        SEALED
                                    </span>
                                    <Link
                                        to={`/txs/${tx.scheduled_tx_id.replace('0x', '')}` as any}
                                        className="text-nothing-green-dark dark:text-nothing-green hover:underline break-all"
                                    >
                                        {tx.scheduled_tx_id}
                                    </Link>
                                    <CopyButton text={tx.scheduled_tx_id} />
                                </div>
                            </Field>

                            {tx.status === 'EXECUTED' && tx.executed_tx_id && (
                                <Field label="Executed In">
                                    <div className="flex flex-wrap items-center gap-2">
                                        {tx.executed_block && (
                                            <>
                                                <Link
                                                    to={`/blocks/${tx.executed_block}` as any}
                                                    className="text-nothing-green-dark dark:text-nothing-green hover:underline"
                                                >
                                                    #{tx.executed_block}
                                                </Link>
                                                <span className="text-zinc-400">|</span>
                                            </>
                                        )}
                                        <Link
                                            to={`/txs/${tx.executed_tx_id.replace('0x', '')}` as any}
                                            className="text-nothing-green-dark dark:text-nothing-green hover:underline break-all font-mono text-[10px]"
                                        >
                                            {tx.executed_tx_id}
                                        </Link>
                                        <CopyButton text={tx.executed_tx_id} />
                                        <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-white/5 text-zinc-500 border border-zinc-200 dark:border-white/10">
                                            System TX
                                        </span>
                                        {executorEvents.length > 0 && (
                                            <button
                                                onClick={() => setActiveTab('events')}
                                                className="text-[10px] text-nothing-green-dark dark:text-nothing-green hover:underline"
                                            >
                                                View Events ({executorEvents.length})
                                            </button>
                                        )}
                                        {tx.executed_at && (
                                            <>
                                                <span className="text-zinc-400">|</span>
                                                <span className="text-zinc-500">{formatDate(tx.executed_at)}</span>
                                            </>
                                        )}
                                    </div>
                                </Field>
                            )}

                            {tx.status === 'CANCELED' && (
                                <>
                                    {tx.fees_returned && (
                                        <Field label="Fees Returned">{tx.fees_returned} FLOW</Field>
                                    )}
                                    {tx.fees_deducted && (
                                        <Field label="Fees Deducted">{tx.fees_deducted} FLOW</Field>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Handler Stats */}
                        {tx.handler_stats && Object.keys(tx.handler_stats).length > 0 && (
                            <div className="mt-8">
                                <h2 className="text-sm font-bold mb-3 text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                                    <BarChart3 className="h-4 w-4" />
                                    Handler Execution Stats
                                    <span className="text-[10px] font-normal text-zinc-500">(owner: {tx.handler_owner})</span>
                                </h2>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    {[
                                        { label: 'Total', value: Object.values(tx.handler_stats).reduce((a, b) => a + b, 0), color: 'text-zinc-800 dark:text-zinc-200 bg-zinc-100 dark:bg-white/5 border-zinc-200 dark:border-white/10' },
                                        { label: 'Scheduled', value: tx.handler_stats['SCHEDULED'] || 0, color: 'text-amber-500 bg-amber-500/10 border-amber-500/20' },
                                        { label: 'Executed', value: tx.handler_stats['EXECUTED'] || 0, color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20' },
                                        { label: 'Canceled', value: tx.handler_stats['CANCELED'] || 0, color: 'text-red-500 bg-red-500/10 border-red-500/20' },
                                    ].map(({ label, value, color }) => (
                                        <div key={label} className={`rounded-lg border px-4 py-3 ${color}`}>
                                            <div className="text-[10px] uppercase tracking-widest opacity-70">{label}</div>
                                            <div className="text-xl font-bold mt-1">{value.toLocaleString()}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Execution Summary */}
                        {tx.status === 'EXECUTED' && !summary.isIdle && (
                            <div className="mt-8">
                                <h2 className="text-sm font-bold mb-3 text-zinc-700 dark:text-zinc-300 flex items-center gap-2">
                                    <Activity className="h-4 w-4" />
                                    Execution Summary
                                </h2>
                                <div className="bg-white dark:bg-zinc-900/50 rounded-lg border border-zinc-200 dark:border-white/10 divide-y divide-zinc-100 dark:divide-white/5">
                                    {/* FT Transfers */}
                                    {summary.ftTransfers.length > 0 && (
                                        <div className="px-4 py-3">
                                            <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">Token Transfers</div>
                                            <div className="space-y-2">
                                                {summary.ftTransfers.map((ft, i) => (
                                                    <div key={i} className="flex items-center gap-2 text-xs">
                                                        <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                                            ft.transfer_type === 'burn' || ft.transfer_type === 'stake'
                                                                ? 'bg-red-500/10 text-red-500 border border-red-500/20'
                                                                : ft.transfer_type === 'mint' || ft.transfer_type === 'unstake'
                                                                    ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                                                                    : 'bg-blue-500/10 text-blue-500 border border-blue-500/20'
                                                        }`}>
                                                            {(ft.transfer_type || 'transfer').toUpperCase()}
                                                        </span>
                                                        <span className="font-medium text-zinc-800 dark:text-zinc-200">{parseFloat(ft.amount).toFixed(4)}</span>
                                                        <span className="text-zinc-500">{ft.tokenType}</span>
                                                        {ft.from_address && (
                                                            <>
                                                                <span className="text-zinc-400">from</span>
                                                                <AddressLink address={ft.from_address} prefixLen={8} suffixLen={4} size={12} />
                                                            </>
                                                        )}
                                                        {ft.to_address && (
                                                            <>
                                                                <span className="text-zinc-400">to</span>
                                                                <AddressLink address={ft.to_address} prefixLen={8} suffixLen={4} size={12} />
                                                            </>
                                                        )}
                                                        {ft.evm_to_address && (
                                                            <span className="text-[10px] text-purple-500 bg-purple-500/10 border border-purple-500/20 px-1.5 py-0.5 rounded">
                                                                EVM to {ft.evm_to_address.slice(0, 10)}...{ft.evm_to_address.slice(-4)}
                                                            </span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {summary.nftTransfers.length > 0 && (
                                        <div className="px-4 py-3">
                                            <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-2">NFT Transfers</div>
                                            <div className="space-y-2">
                                                {summary.nftTransfers.map((nt, i) => (
                                                    <div key={i} className="flex items-center gap-2 text-xs">
                                                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium bg-fuchsia-500/10 text-fuchsia-500 border border-fuchsia-500/20">
                                                            NFT
                                                        </span>
                                                        <span className="font-medium text-zinc-800 dark:text-zinc-200">{nt.token.split('.').pop() || nt.token}</span>
                                                        <span className="text-zinc-500">#{nt.token_id}</span>
                                                        {nt.from_address && (
                                                            <>
                                                                <span className="text-zinc-400">from</span>
                                                                <AddressLink address={nt.from_address} prefixLen={8} suffixLen={4} size={12} />
                                                            </>
                                                        )}
                                                        {nt.to_address && (
                                                            <>
                                                                <span className="text-zinc-400">to</span>
                                                                <AddressLink address={nt.to_address} prefixLen={8} suffixLen={4} size={12} />
                                                            </>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* EVM Activity */}
                                    {summary.hasEVM && (
                                        <div className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-500 border border-purple-500/20 font-medium">EVM</span>
                                                <span className="text-xs text-zinc-600 dark:text-zinc-400">Cross-chain EVM transaction executed</span>
                                            </div>
                                        </div>
                                    )}

                                    {/* App Events */}
                                    {summary.appEvents.map((evt, i) => (
                                        <div key={i} className="px-4 py-3">
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 border border-blue-500/20 font-medium">
                                                    {evt.name}
                                                </span>
                                            </div>
                                            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
                                                {Object.entries(evt.fields).map(([k, v]) => (
                                                    <div key={k} className="flex items-center gap-1.5 text-xs">
                                                        <span className="text-zinc-500 text-[10px]">{k}:</span>
                                                        {isAddress(v) ? (
                                                            <AddressLink address={`0x${v}`} prefixLen={8} suffixLen={4} size={12} />
                                                        ) : (
                                                            <span className="text-zinc-800 dark:text-zinc-200 truncate" title={v}>
                                                                {v.length > 30 ? v.slice(0, 27) + '...' : v}
                                                            </span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {tx.status === 'EXECUTED' && summary.isIdle && (
                            <div className="mt-8 text-center text-zinc-500 text-xs italic py-4">
                                Idle run — no application activity
                            </div>
                        )}
                    </>
                )}

                {/* Events tab */}
                {activeTab === 'events' && showEventsTab && (
                    <div>
                        {executorEvents.length === 0 ? (
                            <div className="bg-white dark:bg-zinc-900/50 rounded-lg border border-zinc-200 dark:border-white/10 px-4 py-6 text-center text-zinc-500 text-xs">
                                No application events
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {executorEvents.map((evt) => {
                                    const isExpanded = expandedEvents.has(evt.event_index);
                                    const displayName = parseEventType(evt.type);
                                    const valueEntries = evt.payload ? Object.entries(evt.payload) : [];
                                    return (
                                        <div
                                            key={evt.event_index}
                                            className="bg-white dark:bg-zinc-900/50 rounded-lg border border-zinc-200 dark:border-white/10 overflow-hidden"
                                        >
                                            <button
                                                onClick={() => {
                                                    setExpandedEvents(prev => {
                                                        const next = new Set(prev);
                                                        if (next.has(evt.event_index)) {
                                                            next.delete(evt.event_index);
                                                        } else {
                                                            next.add(evt.event_index);
                                                        }
                                                        return next;
                                                    });
                                                }}
                                                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                                            >
                                                {isExpanded ? (
                                                    <ChevronDown className="h-3.5 w-3.5 text-zinc-400 flex-shrink-0" />
                                                ) : (
                                                    <ChevronRight className="h-3.5 w-3.5 text-zinc-400 flex-shrink-0" />
                                                )}
                                                <span className="text-xs font-medium text-zinc-800 dark:text-zinc-200 truncate">
                                                    {displayName}
                                                </span>
                                                <span className="text-[10px] text-zinc-500 ml-auto flex-shrink-0">
                                                    index {evt.event_index}
                                                </span>
                                            </button>
                                            {isExpanded && valueEntries.length > 0 && (
                                                <div className="border-t border-zinc-100 dark:border-white/5 px-4 py-2">
                                                    {valueEntries.map(([key, val]) => (
                                                        <div
                                                            key={key}
                                                            className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-1 md:gap-4 py-2 border-b border-zinc-100 dark:border-white/5 last:border-0"
                                                        >
                                                            <span className="text-[10px] uppercase tracking-widest text-zinc-500 self-center">
                                                                {key}
                                                            </span>
                                                            <span className="text-xs text-zinc-800 dark:text-zinc-200 break-all">
                                                                {typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val)}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* Contract tab */}
                {activeTab === 'contract' && (
                    <div>
                        <div className="bg-zinc-900 rounded-lg border border-zinc-700 overflow-hidden">
                            {loadingCode ? (
                                <div className="p-6 text-center text-zinc-500 text-xs">Loading contract code...</div>
                            ) : contractCode ? (
                                <div className="relative">
                                    <div className="absolute top-2 right-2 z-10">
                                        <CopyButton text={contractCode} />
                                    </div>
                                    <pre className="p-4 text-xs overflow-x-auto max-h-[600px] overflow-y-auto leading-5">
                                        <code>
                                            {contractCode.split('\n').map((line, i) => (
                                                <div key={i} className="flex">
                                                    <span className="text-zinc-600 w-10 flex-shrink-0 text-right pr-3 select-none border-r border-zinc-800 mr-3">{i + 1}</span>
                                                    <span className="flex-1">{highlightCadenceLine(line)}</span>
                                                </div>
                                            ))}
                                        </code>
                                    </pre>
                                </div>
                            ) : (
                                <div className="p-6 text-center text-zinc-500 text-xs">Contract code not available</div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

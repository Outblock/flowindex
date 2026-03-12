import { createFileRoute, Link } from '@tanstack/react-router'
import { useState, useEffect } from 'react';
import { Clock, CheckCircle, Ban, Timer, Zap, ArrowLeft, Copy, Check, ExternalLink, BarChart3 } from 'lucide-react';
import { AddressLink } from '../../components/AddressLink';
import { resolveApiBaseUrl } from '../../api';
import { PageHeader } from '../../components/ui/PageHeader';

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

function ScheduledTransactionDetail() {
    const { tx } = Route.useLoaderData() as { tx: ScheduledTx | null };
    const [contractCode, setContractCode] = useState<string | null>(null);
    const [loadingCode, setLoadingCode] = useState(false);

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
                                    className="text-nothing-green-dark dark:text-nothing-green hover:underline break-all"
                                >
                                    {tx.executed_tx_id}
                                </Link>
                                <CopyButton text={tx.executed_tx_id} />
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

                {/* Handler Contract Code */}
                <div className="mt-8">
                    <h2 className="text-sm font-bold mb-3 text-zinc-700 dark:text-zinc-300">Handler contract code:</h2>
                    <div className="bg-zinc-900 rounded-lg border border-zinc-700 overflow-hidden">
                        {loadingCode ? (
                            <div className="p-6 text-center text-zinc-500 text-xs">Loading contract code...</div>
                        ) : contractCode ? (
                            <div className="relative">
                                <div className="absolute top-2 right-2 z-10">
                                    <CopyButton text={contractCode} />
                                </div>
                                <pre className="p-4 text-xs text-zinc-300 overflow-x-auto max-h-[600px] overflow-y-auto leading-5">
                                    <code>
                                        {contractCode.split('\n').map((line, i) => (
                                            <div key={i} className="flex">
                                                <span className="text-zinc-600 w-10 flex-shrink-0 text-right pr-3 select-none">{i + 1}</span>
                                                <span className="flex-1">{line}</span>
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
            </div>
        </div>
    );
}

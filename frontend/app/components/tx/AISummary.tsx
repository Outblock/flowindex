import { useState, useCallback, useMemo } from 'react';
import { Sparkles, Loader2, Shield, ShieldAlert, ShieldCheck, AlertTriangle, Lightbulb, ChevronDown, Maximize2, X } from 'lucide-react';
import { Node, Edge } from 'reactflow';
import 'reactflow/dist/style.css';
import { resolveApiBaseUrl } from '../../api';
import { deriveActivityType, buildSummaryLine } from '../TransactionRow';
import { useTheme } from '../../contexts/ThemeContext';
import { Flow, buildTokenIconMap, layoutGraph, FlowDiagram } from './TransferFlowDiagram';

interface AISummaryData {
    summary: string;
    flows: Flow[];
    risk_score: number;
    risk_label: string;
    tips: string[];
}

/* ── Lightweight inline markdown → React ── */

function InlineMarkdown({ text }: { text: string }) {
    if (!text) return null;

    const tokens: Array<{ type: 'text' | 'bold' | 'code' | 'link'; value: string; href?: string }> = [];
    const pattern = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
    let lastIdx = 0;
    let m: RegExpExecArray | null;

    pattern.lastIndex = 0;

    while ((m = pattern.exec(text)) !== null) {
        if (m.index > lastIdx) {
            tokens.push({ type: 'text', value: text.slice(lastIdx, m.index) });
        }
        if (m[1] !== undefined) {
            tokens.push({ type: 'bold', value: m[1] });
        } else if (m[2] !== undefined) {
            tokens.push({ type: 'code', value: m[2] });
        } else if (m[3] !== undefined && m[4] !== undefined) {
            tokens.push({ type: 'link', value: m[3], href: m[4] });
        }
        lastIdx = m.index + m[0].length;
    }
    if (lastIdx < text.length) {
        tokens.push({ type: 'text', value: text.slice(lastIdx) });
    }

    return (
        <>
            {tokens.map((tok, i) => {
                switch (tok.type) {
                    case 'bold':
                        return <strong key={i} className="font-bold text-zinc-900 dark:text-white">{tok.value}</strong>;
                    case 'code':
                        return <code key={i} className="text-[11px] bg-zinc-100 dark:bg-white/10 px-1 py-0.5 rounded font-mono text-purple-600 dark:text-purple-400">{tok.value}</code>;
                    case 'link':
                        return <a key={i} href={tok.href} className="text-nothing-green-dark dark:text-nothing-green hover:underline">{tok.value}</a>;
                    default:
                        return <span key={i}>{tok.value}</span>;
                }
            })}
        </>
    );
}

/* ── Risk badge ── */

function RiskBadge({ score, label, tips }: { score: number; label: string; tips?: string[] }) {
    const [expanded, setExpanded] = useState(false);
    let color: string;
    let bg: string;
    let border: string;
    let Icon: typeof Shield;

    if (score <= 20) {
        color = 'text-green-600 dark:text-green-400';
        bg = 'bg-green-50 dark:bg-green-500/10';
        border = 'border-green-200 dark:border-green-500/20';
        Icon = ShieldCheck;
    } else if (score <= 50) {
        color = 'text-yellow-600 dark:text-yellow-400';
        bg = 'bg-yellow-50 dark:bg-yellow-500/10';
        border = 'border-yellow-200 dark:border-yellow-500/20';
        Icon = Shield;
    } else if (score <= 80) {
        color = 'text-orange-600 dark:text-orange-400';
        bg = 'bg-orange-50 dark:bg-orange-500/10';
        border = 'border-orange-200 dark:border-orange-500/20';
        Icon = AlertTriangle;
    } else {
        color = 'text-red-600 dark:text-red-400';
        bg = 'bg-red-50 dark:bg-red-500/10';
        border = 'border-red-200 dark:border-red-500/20';
        Icon = ShieldAlert;
    }

    return (
        <div className="relative">
            <button
                onClick={() => tips?.length && setExpanded(!expanded)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-sm border ${bg} ${border} transition-colors ${tips?.length ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}`}
            >
                <Icon className={`w-4 h-4 ${color}`} />
                <span className={`text-xs font-bold uppercase tracking-widest ${color}`}>{label}</span>
                <span className={`text-[10px] font-mono ${color}`}>{score}/100</span>
                {tips && tips.length > 0 && (
                    <ChevronDown className={`w-3 h-3 ${color} transition-transform ${expanded ? 'rotate-180' : ''}`} />
                )}
            </button>
            {expanded && tips && tips.length > 0 && (
                <div className={`absolute right-0 top-full mt-1 z-50 w-80 p-3 rounded-sm border shadow-lg bg-white dark:bg-zinc-900 ${border}`}>
                    <div className="flex items-center gap-1.5 mb-2">
                        <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                        <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Tips</span>
                    </div>
                    {tips.map((tip, i) => (
                        <p key={i} className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed mb-1 last:mb-0">
                            <InlineMarkdown text={tip} />
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
}

/* ── Main Component ── */

export default function AISummary({ transaction }: { transaction: any }) {
    const [data, setData] = useState<AISummaryData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [flowModal, setFlowModal] = useState(false);
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const tokenIcons = useMemo(() => buildTokenIconMap(transaction), [transaction]);

    const handleSummarize = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const baseUrl = await resolveApiBaseUrl();
            const activity = deriveActivityType(transaction);
            const summaryLine = buildSummaryLine(transaction);

            const payload = {
                id: transaction.id,
                status: transaction.status,
                is_evm: transaction.is_evm || false,
                activity_type: activity.type,
                activity_label: activity.label,
                preliminary_summary: summaryLine,
                transfer_summary: transaction.transfer_summary || null,
                events: (transaction.events || []).slice(0, 30).map((e: any) => ({
                    type: e.type,
                    event_name: e.event_name,
                    contract_name: e.contract_name,
                    contract_address: e.contract_address,
                    values: e.values || e.payload || e.data || null,
                })),
                ft_transfers: (() => {
                    // Aggregate by (from, to, token) to reduce payload for bulk-transfer txs
                    const agg = new Map<string, { from_address: string; to_address: string; amount: number; token_symbol: string; token: string; count: number }>();
                    for (const ft of (transaction.ft_transfers || [])) {
                        const sym = ft.token_symbol || ft.token?.split('.').pop() || '';
                        const key = `${ft.from_address}|${ft.to_address}|${sym}`;
                        const existing = agg.get(key);
                        if (existing) {
                            existing.amount += parseFloat(ft.amount) || 0;
                            existing.count += 1;
                        } else {
                            agg.set(key, { from_address: ft.from_address, to_address: ft.to_address, amount: parseFloat(ft.amount) || 0, token_symbol: sym, token: ft.token, count: 1 });
                        }
                    }
                    return Array.from(agg.values()).slice(0, 20).map(a => ({
                        from_address: a.from_address,
                        to_address: a.to_address,
                        amount: a.amount.toString(),
                        token_symbol: a.token_symbol,
                        token: a.token,
                        transfer_count: a.count,
                    }));
                })(),
                defi_events: (transaction.defi_events || []).slice(0, 5),
                tags: transaction.tags || [],
                contract_imports: transaction.contract_imports || [],
                script: transaction.script || '',
                evm_executions: (transaction.evm_executions || []).slice(0, 3).map((e: any) => ({
                    from: e.from,
                    to: e.to,
                    value: e.value,
                    status: e.status,
                })),
            };

            const res = await fetch(`${baseUrl}/ai/tx-summary`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                throw new Error((errBody as any)?.error || `HTTP ${res.status}`);
            }

            const result = await res.json();
            const d = result.data as AISummaryData;

            if (!d || typeof d.summary !== 'string') {
                throw new Error('Invalid response format');
            }
            if (!Array.isArray(d.flows)) d.flows = [];
            if (!Array.isArray(d.tips)) d.tips = [];

            setData(d);
        } catch (e: any) {
            setError(e.message || 'Failed to generate summary');
        } finally {
            setLoading(false);
        }
    }, [transaction]);

    const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
        if (!data?.flows?.length) return { nodes: [] as Node[], edges: [] as Edge[] };
        return layoutGraph(data.flows, isDark, tokenIcons);
    }, [data, isDark, tokenIcons]);

    /* ── Button state ── */
    if (!data && !loading && !error) {
        return (
            <button
                onClick={handleSummarize}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-[11px] uppercase tracking-widest font-bold bg-purple-600 dark:bg-purple-500 text-white hover:bg-purple-700 dark:hover:bg-purple-400 shadow-sm shadow-purple-500/25 transition-colors rounded-sm"
            >
                <Sparkles className="w-3.5 h-3.5" />
                Summarize with AI
                <span className="text-[9px] bg-purple-200 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 rounded uppercase tracking-wider">
                    Beta
                </span>
            </button>
        );
    }

    /* ── Loading ── */
    if (loading) {
        return (
            <div className="flex items-center gap-2 text-xs text-purple-500 py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="uppercase tracking-widest">Analyzing transaction...</span>
            </div>
        );
    }

    /* ── Error ── */
    if (error) {
        return (
            <div className="text-xs text-red-500 py-2">
                <span className="uppercase tracking-widest">AI Error:</span> {error}
                <button onClick={() => { setError(null); }} className="ml-2 text-purple-500 hover:underline uppercase tracking-widest">
                    Dismiss
                </button>
            </div>
        );
    }

    /* ── Result ── */
    return (
        <div className="space-y-4">
            {/* Header + Risk badge */}
            <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                    <span className="text-[10px] text-purple-600 dark:text-purple-400 uppercase tracking-widest font-bold">
                        AI Summary
                    </span>
                    <span className="text-[9px] bg-purple-100 dark:bg-purple-500/10 text-purple-600 dark:text-purple-300 px-1.5 py-0.5 rounded uppercase tracking-wider">
                        Beta
                    </span>
                </div>
                {data && <RiskBadge score={data.risk_score} label={data.risk_label} tips={data.tips} />}
            </div>

            {/* Summary text */}
            <div className="bg-purple-50 dark:bg-purple-500/5 border border-purple-200 dark:border-purple-500/20 p-3 rounded-sm">
                <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
                    <InlineMarkdown text={data?.summary || ''} />
                </p>
            </div>

            {/* React Flow diagram — inline preview + modal expand */}
            {initialNodes.length > 0 && (
                <>
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Asset Flow</p>
                            <button
                                onClick={() => setFlowModal(true)}
                                className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white uppercase tracking-widest border border-zinc-200 dark:border-white/10 hover:border-zinc-400 dark:hover:border-white/30 rounded-sm transition-colors"
                            >
                                <Maximize2 className="w-3 h-3" />
                                Expand
                            </button>
                        </div>
                        <div
                            className="border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden"
                            style={{ height: Math.max(250, Math.ceil(initialNodes.length / 2) * 100 + 80) }}
                        >
                            <FlowDiagram
                                initialNodes={initialNodes}
                                initialEdges={initialEdges}
                                isDark={isDark}
                            />
                        </div>
                    </div>

                    {/* Fullscreen modal */}
                    {flowModal && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center">
                            {/* Backdrop */}
                            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setFlowModal(false)} />
                            {/* Modal */}
                            <div className="relative w-[95vw] h-[85vh] max-w-[1400px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-sm shadow-2xl flex flex-col">
                                {/* Header */}
                                <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-white/10 flex-shrink-0">
                                    <div className="flex items-center gap-3">
                                        <Sparkles className="w-4 h-4 text-purple-500" />
                                        <span className="text-xs text-zinc-700 dark:text-zinc-300 uppercase tracking-widest font-bold">Asset Flow</span>
                                        <span className="text-[10px] text-zinc-400 font-mono">
                                            {data?.flows?.length || 0} flow{(data?.flows?.length || 0) !== 1 ? 's' : ''} · {initialNodes.length} address{initialNodes.length !== 1 ? 'es' : ''}
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => setFlowModal(false)}
                                        className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/10 rounded-sm transition-colors"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                                {/* Flow diagram — full size */}
                                <div className="flex-1 min-h-0">
                                    <FlowDiagram
                                        initialNodes={initialNodes}
                                        initialEdges={initialEdges}
                                        isDark={isDark}
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

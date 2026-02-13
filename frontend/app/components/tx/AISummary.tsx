import { useState, useCallback, useMemo } from 'react';
import { Sparkles, Loader2, Shield, ShieldAlert, ShieldCheck, AlertTriangle, Lightbulb, ChevronDown } from 'lucide-react';
import ReactFlow, {
    Node,
    Edge,
    Position,
    MarkerType,
    Background,
    BackgroundVariant,
    Controls,
    useNodesState,
    useEdgesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { resolveApiBaseUrl } from '../../api';
import { formatShort } from '../account/accountUtils';
import { deriveActivityType, buildSummaryLine, extractLogoUrl } from '../TransactionRow';
import { useTheme } from '../../contexts/ThemeContext';

interface Flow {
    from: string;
    fromLabel: string;
    to: string;
    toLabel: string;
    token: string;
    amount: string;
}

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
                <div className={`absolute right-0 top-full mt-1 z-50 w-80 p-3 rounded-sm border shadow-lg ${bg} ${border}`}>
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

/* ── Build token icon map from transaction data ── */

function buildTokenIconMap(transaction: any): Map<string, string> {
    const map = new Map<string, string>();
    for (const ft of transaction.ft_transfers || []) {
        const symbol = ft.token_symbol || ft.token?.split('.')?.pop();
        const logo = ft.token_logo;
        if (symbol && logo) {
            const url = typeof logo === 'string' && logo.startsWith('http') ? logo : extractLogoUrl(logo);
            if (url) map.set(symbol, url);
        }
    }
    for (const swap of transaction.defi_events || []) {
        for (const key of ['asset0_logo', 'asset1_logo']) {
            const symKey = key.replace('_logo', '_symbol');
            const sym = swap[symKey];
            const logo = swap[key];
            if (sym && logo) {
                const url = typeof logo === 'string' && logo.startsWith('http') ? logo : extractLogoUrl(logo);
                if (url) map.set(sym, url);
            }
        }
    }
    return map;
}

/* ── Layout: assign (x,y) per unique address, left-to-right ── */

function layoutGraph(flows: Flow[], isDark: boolean, tokenIcons: Map<string, string>): { nodes: Node[]; edges: Edge[] } {
    const seen = new Map<string, { label: string; isSource: boolean; isTarget: boolean }>();
    for (const f of flows) {
        if (!seen.has(f.from)) seen.set(f.from, { label: f.fromLabel || formatShort(f.from, 8, 4), isSource: true, isTarget: false });
        else seen.get(f.from)!.isSource = true;

        if (!seen.has(f.to)) seen.set(f.to, { label: f.toLabel || formatShort(f.to, 8, 4), isSource: false, isTarget: true });
        else seen.get(f.to)!.isTarget = true;
    }

    const sources: string[] = [];
    const targets: string[] = [];
    const middle: string[] = [];
    for (const [addr, info] of seen) {
        if (info.isSource && !info.isTarget) sources.push(addr);
        else if (info.isTarget && !info.isSource) targets.push(addr);
        else middle.push(addr);
    }

    const colWidth = 300;
    const rowHeight = 100;

    const nodeStyle = {
        padding: '12px 16px',
        borderRadius: '6px',
        fontSize: '11px',
        fontFamily: 'ui-monospace, monospace',
        minWidth: 170,
        border: isDark ? '1px solid rgba(255,255,255,0.1)' : '1px solid #e4e4e7',
        background: isDark ? '#18181b' : '#ffffff',
        color: isDark ? '#e4e4e7' : '#27272a',
        boxShadow: isDark ? '0 1px 3px rgba(0,0,0,0.4)' : '0 1px 3px rgba(0,0,0,0.08)',
        cursor: 'grab',
    };

    const placeColumn = (addrs: string[], col: number): Node[] =>
        addrs.map((addr, row) => ({
            id: addr,
            data: {
                label: (
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontWeight: 700, fontSize: '11px', color: isDark ? '#e4e4e7' : '#27272a' }}>
                            {seen.get(addr)!.label}
                        </div>
                        <div style={{ fontSize: '9px', color: isDark ? '#71717a' : '#a1a1aa', fontFamily: 'ui-monospace, monospace', marginTop: '2px' }}>
                            {formatShort(addr, 8, 4)}
                        </div>
                    </div>
                ),
            },
            position: { x: col * colWidth, y: row * rowHeight },
            sourcePosition: Position.Right,
            targetPosition: Position.Left,
            draggable: true,
            style: nodeStyle,
        }));

    const nodes: Node[] = [
        ...placeColumn(sources, 0),
        ...placeColumn(middle, 1),
        ...placeColumn(targets, middle.length > 0 ? 2 : 1),
    ];

    const accentColor = isDark ? '#4ade80' : '#16a34a';

    const edges: Edge[] = flows.map((f, i) => {
        const amountStr = Number(f.amount).toLocaleString(undefined, { maximumFractionDigits: 8 });
        const iconUrl = tokenIcons.get(f.token);
        return {
            id: `e-${i}`,
            source: f.from,
            target: f.to,
            label: (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '10px', fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: accentColor }}>
                    {iconUrl && <img src={iconUrl} alt="" style={{ width: 14, height: 14, borderRadius: '50%' }} />}
                    {amountStr} {f.token}
                </span>
            ) as any,
            labelStyle: { fontSize: '10px', fontFamily: 'ui-monospace, monospace', fontWeight: 600, fill: accentColor },
            labelBgStyle: { fill: isDark ? '#18181b' : '#ffffff', fillOpacity: 0.95, rx: 4, ry: 4 },
            labelBgPadding: [8, 4] as [number, number],
            style: { stroke: accentColor, strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: accentColor, width: 18, height: 18 },
            animated: true,
        };
    });

    return { nodes, edges };
}

/* ── Flow diagram wrapper using controlled state for drag support ── */

function FlowDiagram({ initialNodes, initialEdges, isDark }: {
    initialNodes: Node[];
    initialEdges: Edge[];
    isDark: boolean;
}) {
    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    return (
        <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            nodesDraggable
            nodesConnectable={false}
            panOnDrag
            zoomOnScroll
            zoomOnPinch
            zoomOnDoubleClick
            minZoom={0.3}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
        >
            <Background
                variant={BackgroundVariant.Dots}
                gap={16}
                size={1}
                color={isDark ? '#333' : '#ddd'}
                style={{ backgroundColor: isDark ? '#09090b' : '#fafafa' }}
            />
            <Controls
                showInteractive={false}
                className="!bg-white dark:!bg-zinc-800 !border-zinc-200 dark:!border-white/10 !shadow-sm [&>button]:!border-zinc-200 dark:[&>button]:!border-white/10 [&>button]:!bg-white dark:[&>button]:!bg-zinc-800 [&>button>svg]:!fill-zinc-600 dark:[&>button>svg]:!fill-zinc-400"
            />
        </ReactFlow>
    );
}

/* ── Main Component ── */

export default function AISummary({ transaction }: { transaction: any }) {
    const [data, setData] = useState<AISummaryData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
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
                className="inline-flex items-center gap-2 px-3 py-1.5 text-[11px] uppercase tracking-widest border border-purple-300 dark:border-purple-500/30 text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/10 hover:bg-purple-100 dark:hover:bg-purple-500/20 transition-colors rounded-sm"
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

            {/* React Flow diagram */}
            {initialNodes.length > 0 && (
                <div>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">Asset Flow</p>
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
            )}
        </div>
    );
}

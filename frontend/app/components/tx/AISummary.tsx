import { useState, useCallback, useMemo } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import ReactFlow, {
    Node,
    Edge,
    Position,
    MarkerType,
    Background,
    BackgroundVariant,
    Controls,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { resolveApiBaseUrl } from '../../api';
import { formatShort } from '../account/accountUtils';
import { deriveActivityType, buildSummaryLine } from '../TransactionRow';
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
}

/* ── Lightweight inline markdown → React ── */

function InlineMarkdown({ text }: { text: string }) {
    if (!text) return null;

    // Process bold, code, and links via sequential replacement
    const tokens: Array<{ type: 'text' | 'bold' | 'code' | 'link'; value: string; href?: string }> = [];
    const pattern = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
    let lastIdx = 0;
    let m: RegExpExecArray | null;

    // Reset regex state
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

/* ── Layout: assign (x,y) per unique address, left-to-right ── */

function layoutGraph(flows: Flow[], isDark: boolean): { nodes: Node[]; edges: Edge[] } {
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
        return {
            id: `e-${i}`,
            source: f.from,
            target: f.to,
            label: `${amountStr} ${f.token}`,
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

/* ── Component ── */

export default function AISummary({ transaction }: { transaction: any }) {
    const [data, setData] = useState<AISummaryData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { theme } = useTheme();
    const isDark = theme === 'dark';

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
                ft_transfers: (transaction.ft_transfers || []).slice(0, 10).map((ft: any) => ({
                    from_address: ft.from_address,
                    to_address: ft.to_address,
                    amount: ft.amount,
                    token_symbol: ft.token_symbol,
                    token: ft.token,
                })),
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

            setData(d);
        } catch (e: any) {
            setError(e.message || 'Failed to generate summary');
        } finally {
            setLoading(false);
        }
    }, [transaction]);

    const { nodes, edges } = useMemo(() => {
        if (!data?.flows?.length) return { nodes: [], edges: [] };
        return layoutGraph(data.flows, isDark);
    }, [data, isDark]);

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
            {/* Header */}
            <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                <span className="text-[10px] text-purple-600 dark:text-purple-400 uppercase tracking-widest font-bold">
                    AI Summary
                </span>
                <span className="text-[9px] bg-purple-100 dark:bg-purple-500/10 text-purple-600 dark:text-purple-300 px-1.5 py-0.5 rounded uppercase tracking-wider">
                    Beta
                </span>
            </div>

            {/* Summary text with inline markdown */}
            <div className="bg-purple-50 dark:bg-purple-500/5 border border-purple-200 dark:border-purple-500/20 p-3 rounded-sm">
                <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
                    <InlineMarkdown text={data?.summary || ''} />
                </p>
            </div>

            {/* React Flow diagram */}
            {nodes.length > 0 && (
                <div>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">Asset Flow</p>
                    <div
                        className="border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden"
                        style={{ height: Math.max(250, Math.ceil(nodes.length / 2) * 100 + 80) }}
                    >
                        <ReactFlow
                            nodes={nodes}
                            edges={edges}
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
                    </div>
                </div>
            )}
        </div>
    );
}

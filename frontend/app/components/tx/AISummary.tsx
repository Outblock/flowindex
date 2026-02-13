import { useState, useCallback, useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { Sparkles, Loader2 } from 'lucide-react';
import ReactFlow, {
    Node,
    Edge,
    Position,
    MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { resolveApiBaseUrl } from '../../api';
import { formatShort } from '../account/accountUtils';
import { deriveActivityType, buildSummaryLine } from '../TransactionRow';

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

/* ── Layout: assign (x,y) per unique address, left-to-right ── */

function layoutGraph(flows: Flow[]): { nodes: Node[]; edges: Edge[] } {
    // Collect unique addresses preserving order of appearance
    const seen = new Map<string, { label: string; isSource: boolean; isTarget: boolean }>();
    for (const f of flows) {
        if (!seen.has(f.from)) seen.set(f.from, { label: f.fromLabel || formatShort(f.from, 8, 4), isSource: true, isTarget: false });
        else seen.get(f.from)!.isSource = true;

        if (!seen.has(f.to)) seen.set(f.to, { label: f.toLabel || formatShort(f.to, 8, 4), isSource: false, isTarget: true });
        else seen.get(f.to)!.isTarget = true;
    }

    // Categorize: pure sources → left column, pure targets → right, mixed → middle
    const sources: string[] = [];
    const targets: string[] = [];
    const middle: string[] = [];
    for (const [addr, info] of seen) {
        if (info.isSource && !info.isTarget) sources.push(addr);
        else if (info.isTarget && !info.isSource) targets.push(addr);
        else middle.push(addr);
    }

    const colWidth = 280;
    const rowHeight = 90;

    const placeColumn = (addrs: string[], col: number): Node[] =>
        addrs.map((addr, row) => ({
            id: addr,
            data: {
                label: (
                    <div style={{ textAlign: 'center' }}>
                        <div className="font-bold text-[11px] text-zinc-800 dark:text-zinc-200">
                            {seen.get(addr)!.label}
                        </div>
                        <div className="text-[9px] text-zinc-400 dark:text-zinc-500 font-mono mt-0.5">
                            {formatShort(addr, 8, 4)}
                        </div>
                    </div>
                ),
            },
            position: { x: col * colWidth, y: row * rowHeight },
            sourcePosition: Position.Right,
            targetPosition: Position.Left,
            style: {
                padding: '10px 14px',
                borderRadius: '6px',
                fontSize: '11px',
                fontFamily: 'ui-monospace, monospace',
                minWidth: 160,
                border: '1px solid #d4d4d8',
                background: '#fafafa',
                color: '#27272a',
            },
        }));

    const nodes: Node[] = [
        ...placeColumn(sources, 0),
        ...placeColumn(middle, 1),
        ...placeColumn(targets, middle.length > 0 ? 2 : 1),
    ];

    const edges: Edge[] = flows.map((f, i) => {
        const amountStr = Number(f.amount).toLocaleString(undefined, { maximumFractionDigits: 8 });
        return {
            id: `e-${i}`,
            source: f.from,
            target: f.to,
            label: `${amountStr} ${f.token}`,
            labelStyle: { fontSize: '10px', fontFamily: 'ui-monospace, monospace', fontWeight: 600, fill: '#16a34a' },
            labelBgStyle: { fill: '#ffffff', fillOpacity: 0.95, rx: 4, ry: 4 },
            labelBgPadding: [8, 4] as [number, number],
            style: { stroke: '#22c55e', strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#22c55e', width: 18, height: 18 },
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

    const handleSummarize = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const baseUrl = await resolveApiBaseUrl();
            const scriptLines = (transaction.script || '').split('\n');
            const scriptSummary = scriptLines.length > 20
                ? scriptLines.slice(0, 10).join('\n') + '\n... (truncated)'
                : transaction.script || '';

            // Pre-analyzed data from frontend helpers
            const activity = deriveActivityType(transaction);
            const summaryLine = buildSummaryLine(transaction);

            const payload = {
                id: transaction.id,
                status: transaction.status,
                is_evm: transaction.is_evm || false,
                // Pre-analyzed context — AI can use these directly
                activity_type: activity.type,
                activity_label: activity.label,
                preliminary_summary: summaryLine,
                transfer_summary: transaction.transfer_summary || null,
                // Raw data
                events: (transaction.events || []).slice(0, 20).map((e: any) => ({
                    type: e.type,
                    event_name: e.event_name,
                    contract_name: e.contract_name,
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
                script_summary: scriptSummary,
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

            // Frontend validation: summary must be a string, flows must be an array
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
        return layoutGraph(data.flows);
    }, [data]);

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

            {/* Summary text */}
            <div className="bg-purple-50 dark:bg-purple-500/5 border border-purple-200 dark:border-purple-500/20 p-3 rounded-sm">
                <p className="text-sm text-zinc-800 dark:text-zinc-200 leading-relaxed">
                    {data?.summary}
                </p>
            </div>

            {/* React Flow diagram */}
            {nodes.length > 0 && (
                <div>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">Asset Flow</p>
                    <div
                        className="border border-zinc-200 dark:border-white/10 rounded-sm bg-white dark:bg-zinc-900 overflow-hidden"
                        style={{ height: Math.max(200, Math.ceil(nodes.length / 2) * 90 + 60) }}
                    >
                        <ReactFlow
                            nodes={nodes}
                            edges={edges}
                            fitView
                            fitViewOptions={{ padding: 0.4 }}
                            nodesDraggable={false}
                            nodesConnectable={false}
                            elementsSelectable={false}
                            panOnDrag={false}
                            zoomOnScroll={false}
                            zoomOnPinch={false}
                            zoomOnDoubleClick={false}
                            proOptions={{ hideAttribution: true }}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

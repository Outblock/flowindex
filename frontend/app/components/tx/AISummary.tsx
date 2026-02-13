import { useState, useCallback, useMemo } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import ReactFlow, {
    Node,
    Edge,
    Position,
    MarkerType,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { resolveApiBaseUrl } from '../../api';

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

function truncateAddr(addr: string): string {
    if (!addr || addr.length <= 12) return addr;
    return addr.slice(0, 8) + '...' + addr.slice(-4);
}

const nodeStyle = {
    padding: '8px 12px',
    border: '1px solid',
    borderRadius: '4px',
    fontSize: '11px',
    fontFamily: 'monospace',
    minWidth: 120,
    textAlign: 'center' as const,
};

function buildFlowGraph(flows: Flow[]): { nodes: Node[]; edges: Edge[] } {
    const addressMap = new Map<string, string>();
    flows.forEach(f => {
        if (f.from) addressMap.set(f.from, f.fromLabel || truncateAddr(f.from));
        if (f.to) addressMap.set(f.to, f.toLabel || truncateAddr(f.to));
    });

    const addresses = Array.from(addressMap.keys());
    const ySpacing = 100;
    const xCenter = 200;

    const nodes: Node[] = addresses.map((addr, i) => ({
        id: addr,
        data: {
            label: (
                <div>
                    <div className="font-bold text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        {addressMap.get(addr)}
                    </div>
                    <div className="text-[9px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                        {truncateAddr(addr)}
                    </div>
                </div>
            ),
        },
        position: { x: (i % 2 === 0 ? 0 : xCenter * 2), y: Math.floor(i / 2) * ySpacing },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: {
            ...nodeStyle,
            borderColor: 'var(--flow-node-border, #d4d4d8)',
            background: 'var(--flow-node-bg, #fafafa)',
            color: 'var(--flow-node-color, #27272a)',
        },
    }));

    const edges: Edge[] = flows.map((f, i) => ({
        id: `e-${i}`,
        source: f.from,
        target: f.to,
        label: `${f.amount} ${f.token}`,
        labelStyle: { fontSize: '10px', fontFamily: 'monospace', fill: '#71717a' },
        labelBgStyle: { fill: 'var(--flow-edge-bg, #ffffff)', fillOpacity: 0.9 },
        labelBgPadding: [6, 3] as [number, number],
        style: { stroke: '#22c55e', strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#22c55e', width: 16, height: 16 },
        animated: true,
    }));

    return { nodes, edges };
}

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

            const payload = {
                id: transaction.id,
                status: transaction.status,
                is_evm: transaction.is_evm || false,
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
                const errBody = await res.text();
                throw new Error(errBody || `HTTP ${res.status}`);
            }

            const result = await res.json();
            setData(result.data);
        } catch (e: any) {
            setError(e.message || 'Failed to generate summary');
        } finally {
            setLoading(false);
        }
    }, [transaction]);

    const { nodes, edges } = useMemo(() => {
        if (!data?.flows?.length) return { nodes: [], edges: [] };
        return buildFlowGraph(data.flows);
    }, [data]);

    if (!data && !loading) {
        return (
            <button
                onClick={handleSummarize}
                disabled={loading}
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

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-xs text-purple-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="uppercase tracking-widest">Analyzing transaction...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-xs text-red-500">
                <span className="uppercase tracking-widest">AI Summary Error:</span> {error}
                <button
                    onClick={handleSummarize}
                    className="ml-2 text-purple-500 hover:underline uppercase tracking-widest"
                >
                    Retry
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                <span className="text-[10px] text-purple-600 dark:text-purple-400 uppercase tracking-widest font-bold">
                    AI Summary
                </span>
                <span className="text-[9px] bg-purple-100 dark:bg-purple-500/10 text-purple-600 dark:text-purple-300 px-1.5 py-0.5 rounded uppercase tracking-wider">
                    Beta
                </span>
            </div>

            <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
                {data?.summary}
            </p>

            {nodes.length > 0 && (
                <div
                    className="border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden"
                    style={{
                        height: Math.max(250, nodes.length * 60 + 100),
                        // CSS custom properties for dark mode support in ReactFlow nodes
                        ['--flow-node-border' as any]: 'var(--tw-border-opacity, 1) #d4d4d8',
                        ['--flow-node-bg' as any]: '#fafafa',
                        ['--flow-node-color' as any]: '#27272a',
                        ['--flow-edge-bg' as any]: '#ffffff',
                    }}
                >
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        fitView
                        fitViewOptions={{ padding: 0.3 }}
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
            )}
        </div>
    );
}

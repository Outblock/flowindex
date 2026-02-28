import { useMemo } from 'react';
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
import { formatShort } from '../account/accountUtils';
import { extractLogoUrl } from '../TransactionRow';
import { useTheme } from '../../contexts/ThemeContext';

/* ── Shared Flow interface ── */

export interface Flow {
    from: string;
    fromLabel: string;
    to: string;
    toLabel: string;
    token: string;
    amount: string;
    usdValue?: number;
}

/* ── Build token icon map from transaction data ── */

export function buildTokenIconMap(transaction: any): Map<string, string> {
    const map = new Map<string, string>();
    for (const ft of transaction.ft_transfers || []) {
        const symbol = ft.token_symbol || ft.token?.split('.')?.pop();
        const logo = ft.token_logo;
        if (symbol && logo) {
            const url = typeof logo === 'string' && logo.startsWith('http') ? logo : extractLogoUrl(logo);
            if (url) map.set(symbol, url);
        }
    }
    for (const nt of transaction.nft_transfers || []) {
        const name = nt.collection_name || nt.token?.split('.')?.pop();
        const logo = nt.collection_logo || nt.nft_thumbnail;
        if (name && logo) {
            const url = typeof logo === 'string' && logo.startsWith('http') ? logo : extractLogoUrl(logo);
            if (url) map.set(name, url);
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

export function layoutGraph(flows: Flow[], isDark: boolean, tokenIcons: Map<string, string>): { nodes: Node[]; edges: Edge[] } {
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
    const nftColor = isDark ? '#a78bfa' : '#7c3aed';

    // Group flows by (source, target) pair to merge into single edges
    const pairFlows = new Map<string, Flow[]>();
    for (const f of flows) {
        const pk = `${f.from}|${f.to}`;
        const arr = pairFlows.get(pk);
        if (arr) arr.push(f);
        else pairFlows.set(pk, [f]);
    }

    const edges: Edge[] = [];
    let edgeIdx = 0;
    for (const [, group] of pairFlows) {
        const from = group[0].from;
        const to = group[0].to;
        const hasNft = group.some(f => !f.usdValue && (f.token.includes('#') || f.token.includes('x')));
        const color = hasNft && group.length === 1 ? nftColor : accentColor;

        // Build label lines — each flow becomes one line with optional icon
        const labelLines = group.map(f => {
            const amountStr = Number(f.amount).toLocaleString(undefined, { maximumFractionDigits: 4 });
            const usdStr = f.usdValue && f.usdValue > 0 ? ` ≈$${f.usdValue >= 1 ? f.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : f.usdValue.toFixed(4)}` : '';
            const tokenSym = f.token.split(' ')[0];
            const iconUrl = tokenIcons.get(tokenSym) || tokenIcons.get(f.token);
            return { text: `${amountStr} ${f.token}${usdStr}`, iconUrl };
        });

        // Use React element label for rich rendering (icon + text)
        const labelEl = (
            <div style={{ display: 'flex', flexDirection: 'column', gap: group.length > 1 ? '4px' : '0', alignItems: 'center' }}>
                {labelLines.map((line, li) => (
                    <div key={li} style={{ display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
                        {line.iconUrl && (
                            <img src={line.iconUrl} alt="" style={{ width: 14, height: 14, borderRadius: '50%', flexShrink: 0 }} />
                        )}
                        <span style={{ fontSize: '10px', fontFamily: 'ui-monospace, monospace', fontWeight: 600, color }}>{line.text}</span>
                    </div>
                ))}
            </div>
        );

        edges.push({
            id: `e-${edgeIdx++}`,
            source: from,
            target: to,
            label: labelEl,
            labelBgStyle: { fill: isDark ? '#18181b' : '#ffffff', fillOpacity: 0.95, rx: 4, ry: 4 },
            labelBgPadding: [8, 4] as [number, number],
            style: { stroke: color, strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
            animated: true,
        });
    }

    return { nodes, edges };
}

/* ── Flow diagram wrapper using controlled state for drag support ── */

export function FlowDiagram({ initialNodes, initialEdges, isDark }: {
    initialNodes: Node[];
    initialEdges: Edge[];
    isDark: boolean;
}) {
    const [nodes, , onNodesChange] = useNodesState(initialNodes);
    const [edges, , onEdgesChange] = useEdgesState(initialEdges);

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

/* ── Convert transfer data to Flow[] ── */

function transfersToFlows(detail: any): Flow[] {
    const flows: Flow[] = [];
    const ftTransfers: any[] = detail?.ft_transfers || [];
    const nftTransfers: any[] = detail?.nft_transfers || [];
    const defiEvents: any[] = detail?.defi_events || [];

    // Aggregate FT transfers by (from, to, symbol)
    // Cross-VM transfers with evm_to/from are split into two legs (Cadence + EVM)
    const ftAgg = new Map<string, { from: string; to: string; amount: number; symbol: string; usdValue: number }>();
    const directFlows: Flow[] = [];
    for (const ft of ftTransfers) {
        const from = ft.from_address;
        const to = ft.to_address;
        if (!from || !to) continue;
        const sym = ft.token_symbol || ft.token?.split('.').pop() || 'FT';
        const amount = parseFloat(ft.amount) || 0;
        const usdValue = parseFloat(ft.usd_value) || 0;
        const evmTo = ft.evm_to_address;
        const evmFrom = ft.evm_from_address;

        if (evmTo || evmFrom) {
            // Leg 1: Cadence transfer (from → COA)
            directFlows.push({
                from, fromLabel: formatShort(from, 8, 4),
                to, toLabel: evmTo ? 'COA' : formatShort(to, 8, 4),
                token: sym, amount: amount.toString(), usdValue,
            });
            // Leg 2: EVM execution (COA → EVM dest)
            if (evmTo) {
                directFlows.push({
                    from: to, fromLabel: 'COA',
                    to: evmTo, toLabel: formatShort(evmTo, 8, 4),
                    token: sym, amount: amount.toString(), usdValue,
                });
            }
            if (evmFrom) {
                directFlows.push({
                    from: evmFrom, fromLabel: formatShort(evmFrom, 8, 4),
                    to: from, toLabel: formatShort(from, 8, 4),
                    token: sym, amount: amount.toString(), usdValue,
                });
            }
            continue;
        }

        const key = `${from}|${to}|${sym}`;
        const existing = ftAgg.get(key);
        if (existing) {
            existing.amount += amount;
            existing.usdValue += usdValue;
        } else {
            ftAgg.set(key, { from, to, amount, symbol: sym, usdValue });
        }
    }
    flows.push(...directFlows);
    for (const agg of ftAgg.values()) {
        flows.push({
            from: agg.from,
            fromLabel: formatShort(agg.from, 8, 4),
            to: agg.to,
            toLabel: formatShort(agg.to, 8, 4),
            token: agg.symbol,
            amount: agg.amount.toString(),
            usdValue: agg.usdValue,
        });
    }

    // Aggregate NFT transfers by (from, to, collection)
    const nftAgg = new Map<string, { from: string; to: string; count: number; collection: string; items: string[] }>();
    for (const nt of nftTransfers) {
        const from = nt.from_address;
        const to = nt.to_address;
        if (!from || !to) continue;
        const name = nt.collection_name || nt.token?.split('.').pop() || 'NFT';
        const key = `${from}|${to}|${name}`;
        const existing = nftAgg.get(key);
        if (existing) {
            existing.count++;
            if (existing.items.length < 3) existing.items.push(nt.nft_name || `#${nt.token_id}`);
        } else {
            nftAgg.set(key, { from, to, count: 1, collection: name, items: [nt.nft_name || `#${nt.token_id}`] });
        }
    }
    for (const agg of nftAgg.values()) {
        const label = agg.count > 1 ? `${agg.collection} x${agg.count}` : `${agg.collection} ${agg.items[0]}`;
        flows.push({
            from: agg.from,
            fromLabel: formatShort(agg.from, 8, 4),
            to: agg.to,
            toLabel: formatShort(agg.to, 8, 4),
            token: label,
            amount: agg.count.toString(),
        });
    }

    // DeFi events: user→DEX (input) and DEX→user (output)
    for (const de of defiEvents) {
        const dex = de.dex || 'DEX';
        const dexNode = `DEX:${dex}`;
        // Determine user address from the associated ft_transfers or proposer
        const user = de.user_address || detail?.proposer || detail?.payer || '';
        if (!user) continue;

        const asset0In = parseFloat(de.asset0_in) || 0;
        const asset0Out = parseFloat(de.asset0_out) || 0;
        const asset1In = parseFloat(de.asset1_in) || 0;
        const asset1Out = parseFloat(de.asset1_out) || 0;
        const sym0 = de.asset0_symbol || 'Token0';
        const sym1 = de.asset1_symbol || 'Token1';

        // Input side: user sends token to DEX
        if (asset0In > 0) {
            flows.push({ from: user, fromLabel: formatShort(user, 8, 4), to: dexNode, toLabel: dex, token: sym0, amount: asset0In.toString() });
        } else if (asset1In > 0) {
            flows.push({ from: user, fromLabel: formatShort(user, 8, 4), to: dexNode, toLabel: dex, token: sym1, amount: asset1In.toString() });
        }

        // Output side: DEX sends token to user
        if (asset1Out > 0) {
            flows.push({ from: dexNode, fromLabel: dex, to: user, toLabel: formatShort(user, 8, 4), token: sym1, amount: asset1Out.toString() });
        } else if (asset0Out > 0) {
            flows.push({ from: dexNode, fromLabel: dex, to: user, toLabel: formatShort(user, 8, 4), token: sym0, amount: asset0Out.toString() });
        }
    }

    // Cap at 15 flows for readability
    return flows.slice(0, 15);
}

/* ── Main component ── */

export default function TransferFlowDiagram({ detail }: { detail: any }) {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const tokenIcons = useMemo(() => buildTokenIconMap(detail), [detail]);
    const flows = useMemo(() => transfersToFlows(detail), [detail]);

    const { nodes, edges } = useMemo(() => {
        if (!flows.length) return { nodes: [] as Node[], edges: [] as Edge[] };
        return layoutGraph(flows, isDark, tokenIcons);
    }, [flows, isDark, tokenIcons]);

    if (nodes.length === 0) return null;

    // Height based on tallest column, not total node count
    const maxY = Math.max(...nodes.map(n => n.position.y));
    const height = Math.max(200, maxY + 160);

    return (
        <div>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Transfer Flow</div>
            <div
                className="border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden"
                style={{ height }}
            >
                <FlowDiagram initialNodes={nodes} initialEdges={edges} isDark={isDark} />
            </div>
        </div>
    );
}

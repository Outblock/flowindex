import { useMemo, useEffect } from 'react';
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
    getBezierPath,
    EdgeLabelRenderer,
    type EdgeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import Avatar from 'boring-avatars';
import { normalizeAddress, formatShort } from '../account/accountUtils';
import { colorsFromAddress, addressType } from '../AddressLink';
import { extractLogoUrl } from '../TransactionRow';
import { useTheme } from '../../contexts/ThemeContext';
import { ExpandableFlowContainer } from '../ExpandableFlowContainer';
import { decodeEVMCallData } from '../../lib/deriveFromEvents';

/* ── Custom edge that reliably renders React element labels ── */

function LabeledEdge({
    id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
    style, markerEnd, data,
}: EdgeProps) {
    const [edgePath, labelX, labelY] = getBezierPath({
        sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
    });

    return (
        <>
            <path id={id} className="react-flow__edge-path" d={edgePath} style={style} markerEnd={markerEnd as string} />
            {/* Animated dashes overlay */}
            <path d={edgePath} fill="none" style={{ ...style, strokeDasharray: '6 4' }} className="react-flow__edge-path">
                <animate attributeName="stroke-dashoffset" from="24" to="0" dur="1s" repeatCount="indefinite" />
            </path>
            {data?.labelElement && (
                <EdgeLabelRenderer>
                    <div
                        style={{
                            position: 'absolute',
                            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                            pointerEvents: 'all',
                        }}
                        className="nodrag nopan"
                    >
                        {data.labelElement}
                    </div>
                </EdgeLabelRenderer>
            )}
        </>
    );
}

const edgeTypes = { labeled: LabeledEdge };

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

    const isSynthetic = (addr: string) => addr.startsWith('MINT:') || addr.startsWith('BURN:') || addr.startsWith('DEX:') || addr.startsWith('STAKE:') || addr.startsWith('BRIDGE:');

    const syntheticColor = (addr: string) =>
        addr.startsWith('MINT:') ? (isDark ? '#4ade80' : '#16a34a')
        : addr.startsWith('BURN:') ? (isDark ? '#f87171' : '#dc2626')
        : addr.startsWith('STAKE:') ? (isDark ? '#60a5fa' : '#2563eb')
        : addr.startsWith('BRIDGE:') ? (isDark ? '#38bdf8' : '#0284c7')
        : (isDark ? '#e4e4e7' : '#27272a');

    const syntheticBorder = (addr: string) =>
        addr.startsWith('MINT:') ? (isDark ? '1px solid rgba(74,222,128,0.3)' : '1px solid rgba(22,163,74,0.3)')
        : addr.startsWith('BURN:') ? (isDark ? '1px solid rgba(248,113,113,0.3)' : '1px solid rgba(220,38,38,0.3)')
        : addr.startsWith('STAKE:') ? (isDark ? '1px solid rgba(96,165,250,0.3)' : '1px solid rgba(37,99,235,0.3)')
        : addr.startsWith('BRIDGE:') ? (isDark ? '1px solid rgba(56,189,248,0.3)' : '1px solid rgba(2,132,199,0.3)')
        : nodeStyle.border;

    const avatarVariant = (addr: string): 'beam' | 'bauhaus' | 'pixel' => {
        const t = addressType(addr);
        return t === 'flow' ? 'beam' : t === 'coa' ? 'bauhaus' : 'pixel';
    };

    const placeColumn = (addrs: string[], col: number): Node[] =>
        addrs.map((addr, row) => {
            const synthetic = isSynthetic(addr);
            const info = seen.get(addr)!;
            const normalized = normalizeAddress(addr);
            return {
                id: addr,
                data: {
                    label: synthetic ? (
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontWeight: 700, fontSize: '11px', color: syntheticColor(addr) }}>
                                {info.label}
                            </div>
                        </div>
                    ) : (() => {
                        const addrType = addressType(normalized);
                        const tagColors: Record<string, { bg: string; text: string }> = {
                            coa: { bg: isDark ? 'rgba(139,92,246,0.15)' : 'rgba(139,92,246,0.1)', text: isDark ? '#a78bfa' : '#7c3aed' },
                            eoa: { bg: isDark ? 'rgba(245,158,11,0.15)' : 'rgba(245,158,11,0.1)', text: isDark ? '#fbbf24' : '#d97706' },
                        };
                        const tag = tagColors[addrType];
                        return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{ width: 24, height: 24, flexShrink: 0, borderRadius: '50%', overflow: 'hidden' }}>
                                    <Avatar
                                        size={24}
                                        name={normalized}
                                        variant={avatarVariant(normalized)}
                                        colors={colorsFromAddress(normalized)}
                                    />
                                </div>
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <span style={{ fontWeight: 700, fontSize: '11px', color: isDark ? '#e4e4e7' : '#27272a' }}>
                                            {info.label}
                                        </span>
                                        {tag && (
                                            <span style={{
                                                fontSize: '8px', fontWeight: 700, textTransform: 'uppercase',
                                                padding: '1px 4px', borderRadius: '2px', lineHeight: '14px',
                                                background: tag.bg, color: tag.text,
                                            }}>
                                                {addrType}
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: '9px', color: isDark ? '#71717a' : '#a1a1aa', fontFamily: 'ui-monospace, monospace', marginTop: '2px' }}>
                                        {formatShort(addr, 8, 4)}
                                    </div>
                                </div>
                            </div>
                        );
                    })(),
                },
                position: { x: col * colWidth, y: row * rowHeight },
                sourcePosition: Position.Right,
                targetPosition: Position.Left,
                draggable: true,
                style: synthetic ? {
                    ...nodeStyle,
                    border: syntheticBorder(addr),
                    minWidth: 100,
                } : nodeStyle,
            };
        });

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
        const hasBurn = to.startsWith('BURN:');
        const hasMint = from.startsWith('MINT:');
        const hasStake = to.startsWith('STAKE:');
        const burnColor = isDark ? '#f87171' : '#dc2626';
        const mintColor = isDark ? '#4ade80' : '#16a34a';
        const stakeColor = isDark ? '#60a5fa' : '#2563eb';
        const color = hasBurn ? burnColor : hasMint ? mintColor : hasStake ? stakeColor : hasNft && group.length === 1 ? nftColor : accentColor;

        // Build label lines — each flow becomes one line with optional icon
        const labelLines = group.map(f => {
            const amountStr = Number(f.amount).toLocaleString(undefined, { maximumFractionDigits: 4 });
            const usdStr = f.usdValue && f.usdValue > 0 ? ` ≈$${f.usdValue >= 1 ? f.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : f.usdValue.toFixed(4)}` : '';
            const tokenSym = f.token.split(' ')[0];
            const iconUrl = tokenIcons.get(tokenSym) || tokenIcons.get(f.token);
            return { text: `${amountStr} ${f.token}${usdStr}`, iconUrl };
        });

        // React element label with inline background (foreignObject doesn't work with labelBgStyle)
        const bgColor = isDark ? '#18181b' : '#ffffff';
        const labelEl = (
            <div style={{
                display: 'flex', flexDirection: 'column', gap: group.length > 1 ? '4px' : '0',
                alignItems: 'center', background: bgColor, padding: '4px 8px', borderRadius: '4px',
                border: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid #e4e4e7',
            }}>
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
            type: 'labeled',
            data: { labelElement: labelEl },
            style: { stroke: color, strokeWidth: 2 },
            markerEnd: { type: MarkerType.ArrowClosed, color, width: 18, height: 18 },
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
    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    // Re-sync when enrichment data arrives (initial state doesn't update on prop change)
    useEffect(() => { setNodes(initialNodes); }, [initialNodes, setNodes]);
    useEffect(() => { setEdges(initialEdges); }, [initialEdges, setEdges]);

    return (
        <ReactFlow
            nodes={nodes}
            edges={edges}
            edgeTypes={edgeTypes}
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

    // Pre-process cross-VM transfers: merge Cadence leg (sender→COA) with
    // unmatched deposit leg (""→recipient) into a single sender→recipient flow.
    // The backend marks cross-VM legs with is_cross_vm + to_coa_flow_address/from_coa_flow_address.
    const crossVmSenders = new Map<string, { from: string; amount: number; usdValue: number }>();
    const mergedMints = new Set<number>(); // indices of "mint" transfers absorbed by cross-VM merge
    for (let i = 0; i < ftTransfers.length; i++) {
        const ft = ftTransfers[i];
        if (!ft.is_cross_vm) continue;
        const sym = ft.token_symbol || ft.token?.split('.').pop() || 'FT';
        const amount = parseFloat(ft.amount) || 0;
        if (ft.from_address && ft.to_coa_flow_address) {
            // Cadence leg: sender → COA — record the sender for matching
            const key = `${sym}|${amount}`;
            crossVmSenders.set(key, { from: ft.from_address, amount, usdValue: parseFloat(ft.usd_value) || 0 });
        }
    }
    // Match unmatched deposits (would-be "mints") with cross-VM senders
    if (crossVmSenders.size > 0) {
        for (let i = 0; i < ftTransfers.length; i++) {
            const ft = ftTransfers[i];
            if (ft.from_address || !ft.to_address) continue; // only match mints (no from_address)
            const sym = ft.token_symbol || ft.token?.split('.').pop() || 'FT';
            const amount = parseFloat(ft.amount) || 0;
            const key = `${sym}|${amount}`;
            const sender = crossVmSenders.get(key);
            if (sender) {
                // Rewrite: turn this "mint" into a proper transfer from the original sender
                ft.from_address = sender.from;
                if (!ft.usd_value && sender.usdValue) ft.usd_value = sender.usdValue;
                crossVmSenders.delete(key); // consume the match
            }
        }
        // Remove the now-redundant Cadence→COA legs (they've been merged into the direct transfer)
        for (let i = 0; i < ftTransfers.length; i++) {
            const ft = ftTransfers[i];
            if (ft.is_cross_vm && ft.from_address && (ft.to_coa_flow_address || ft.from_coa_flow_address)) {
                const sym = ft.token_symbol || ft.token?.split('.').pop() || 'FT';
                const amount = parseFloat(ft.amount) || 0;
                const key = `${sym}|${amount}`;
                // If this sender was consumed (not in map anymore), skip the COA leg
                if (!crossVmSenders.has(key)) {
                    mergedMints.add(i);
                }
            }
        }
    }

    // Detect bridge-in: EVMVMBridgedToken with empty from_address + EVM execution with ERC-20 transfer.
    // This means tokens were bridged from EVM → Cadence, not minted.
    const evmExecs: any[] = detail?.evm_executions || [];
    const bridgeFromMap = new Map<string, string>(); // token key → EVM from address (COA)
    for (const exec of evmExecs) {
        if (!exec.data || !exec.from) continue;
        const decoded = decodeEVMCallData(exec.data);
        if (decoded.callType === 'erc20_transfer' || decoded.callType === 'erc20_transferFrom') {
            // The EVM 'from' is the source COA
            const fromCOA = `0x${(exec.from as string).replace(/^0x/, '').padStart(40, '0')}`;
            // Match by EVM contract address (the 'to' of the execution = token contract)
            const evmContract = (exec.to as string)?.replace(/^0x/, '').toLowerCase() || '';
            bridgeFromMap.set(evmContract, fromCOA);
        }
    }

    // Detect staking transactions: if events include FlowIDTableStaking, relabel burns as "Stake"
    const isStakingTx = (detail?.events || []).some((evt: any) =>
        typeof evt?.type === 'string' && evt.type.includes('FlowIDTableStaking')
    );

    // Aggregate FT transfers by (from, to, symbol)
    const ftAgg = new Map<string, { from: string; to: string; amount: number; symbol: string; usdValue: number }>();
    const directFlows: Flow[] = [];
    for (let i = 0; i < ftTransfers.length; i++) {
        if (mergedMints.has(i)) continue; // skip COA legs already merged
        const ft = ftTransfers[i];
        let rawFrom = ft.from_address || '';
        const rawTo = ft.to_address || '';
        if (!rawFrom && !rawTo) continue;
        const sym = ft.token_symbol || ft.token?.split('.').pop() || 'FT';
        const amount = parseFloat(ft.amount) || 0;
        const usdValue = parseFloat(ft.usd_value) || 0;

        // Detect EVMVMBridgedToken bridge-in: empty from_address but EVM execution shows the source COA
        if (!rawFrom && rawTo && ft.token?.includes?.('EVMVMBridgedToken')) {
            const match = ft.token.match(/EVMVMBridgedToken_([a-f0-9]+)/i);
            if (match) {
                const evmContract = match[1].toLowerCase();
                const bridgeFrom = bridgeFromMap.get(evmContract);
                if (bridgeFrom) rawFrom = bridgeFrom;
            }
        }

        // Use synthetic nodes for mint (no from) and burn (no to)
        const from = rawFrom || `MINT:${sym}`;
        const to = rawTo || (isStakingTx ? `STAKE:${sym}` : `BURN:${sym}`);

        // If this transfer has an EVM destination (decoded from call data), add an extra COA→EOA leg
        const evmTo = (ft as any).evm_to_address;
        if (evmTo && rawTo) {
            // Leg 1: from → COA (to_address)
            const k1 = `${from}|${to}|${sym}`;
            const e1 = ftAgg.get(k1);
            if (e1) { e1.amount += amount; e1.usdValue += usdValue; }
            else { ftAgg.set(k1, { from, to, amount, symbol: sym, usdValue }); }
            // Leg 2: COA → EVM recipient
            const evmToNorm = evmTo.toLowerCase().replace(/^0x/, '');
            const k2 = `${to}|${evmToNorm}|${sym}`;
            const e2 = ftAgg.get(k2);
            if (e2) { e2.amount += amount; e2.usdValue += usdValue; }
            else { ftAgg.set(k2, { from: to, to: evmToNorm, amount, symbol: sym, usdValue }); }
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
        const isMint = agg.from.startsWith('MINT:');
        const isBurn = agg.to.startsWith('BURN:');
        const isStake = agg.to.startsWith('STAKE:');
        flows.push({
            from: agg.from,
            fromLabel: isMint ? 'Mint' : formatShort(agg.from, 8, 4),
            to: agg.to,
            toLabel: isBurn ? 'Burn' : isStake ? 'Stake' : formatShort(agg.to, 8, 4),
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
        <ExpandableFlowContainer
            label="Transfer Flow"
            subtitle={`${nodes.length} address${nodes.length !== 1 ? 'es' : ''} · ${edges.length} transfer${edges.length !== 1 ? 's' : ''}`}
            height={height}
        >
            <FlowDiagram initialNodes={nodes} initialEdges={edges} isDark={isDark} />
        </ExpandableFlowContainer>
    );
}

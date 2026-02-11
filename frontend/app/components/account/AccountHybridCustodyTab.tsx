import { useState, useEffect, useCallback, useMemo } from 'react';
import ReactFlow, {
    Node, Edge, Position, MarkerType,
    Background, Controls,
    useNodesState, useEdgesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Link } from '@tanstack/react-router';
import { User, Shield, ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react';
import { normalizeAddress } from './accountUtils';
import type { ManagerInfo, OwnedAccountInfo } from '../../../cadence/cadence.gen';

interface Props {
    address: string;
}

/* ── Custom Node ── */
function AccountNode({ data }: { data: any }) {
    const isCurrent = data.isCurrent;
    const role = data.role as 'current' | 'parent' | 'child' | 'owned';

    const borderColor = isCurrent
        ? 'border-nothing-green-dark dark:border-nothing-green'
        : role === 'parent'
            ? 'border-blue-400 dark:border-blue-500'
            : 'border-amber-400 dark:border-amber-500';

    const bgColor = isCurrent
        ? 'bg-nothing-green-dark/5 dark:bg-nothing-green/5'
        : 'bg-white dark:bg-zinc-900';

    const IconComp = role === 'parent' ? ShieldCheck : role === 'owned' ? ShieldAlert : User;

    return (
        <div className={`border-2 ${borderColor} ${bgColor} rounded-sm px-4 py-3 min-w-[180px] shadow-sm font-mono`}>
            <div className="flex items-center gap-2 mb-1">
                <IconComp className={`h-4 w-4 flex-shrink-0 ${isCurrent ? 'text-nothing-green-dark dark:text-nothing-green' : role === 'parent' ? 'text-blue-500' : 'text-amber-500'}`} />
                <span className="text-[10px] uppercase tracking-widest text-zinc-500">{data.label}</span>
            </div>
            {data.displayName && (
                <div className="text-xs font-semibold text-zinc-900 dark:text-white truncate mb-1">{data.displayName}</div>
            )}
            {isCurrent ? (
                <div className="text-[11px] text-zinc-600 dark:text-zinc-400 truncate">{data.address}</div>
            ) : (
                <Link
                    to={`/accounts/${data.address}` as any}
                    className="text-[11px] text-nothing-green-dark dark:text-nothing-green hover:underline truncate block"
                >
                    {data.address}
                </Link>
            )}
            {data.description && (
                <div className="text-[10px] text-zinc-500 mt-1 line-clamp-1">{data.description}</div>
            )}
            {data.isClaimed === false && (
                <div className="text-[9px] text-amber-500 mt-1 uppercase tracking-wider">Unclaimed</div>
            )}
        </div>
    );
}

const nodeTypes = { account: AccountNode };

export function AccountHybridCustodyTab({ address }: Props) {
    const normalizedAddress = normalizeAddress(address);

    const [managerInfo, setManagerInfo] = useState<ManagerInfo | null>(null);
    const [ownedInfo, setOwnedInfo] = useState<OwnedAccountInfo | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

    useEffect(() => {
        setManagerInfo(null);
        setOwnedInfo(null);
        setError(null);
    }, [address]);

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const { cadenceService } = await import('../../fclConfig');
            const [manager, owned] = await Promise.all([
                cadenceService.getHcManagerInfo(normalizedAddress).catch(() => null),
                cadenceService.getOwnedAccountInfo(normalizedAddress).catch(() => null),
            ]);
            setManagerInfo(manager as ManagerInfo | null);
            setOwnedInfo(owned as OwnedAccountInfo | null);
        } catch (err) {
            console.error('Failed to load hybrid custody data', err);
            setError('Failed to load hybrid custody data');
        } finally {
            setLoading(false);
        }
    }, [normalizedAddress]);

    useEffect(() => {
        if (!managerInfo && !ownedInfo && !loading) loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [address]);

    // Build graph when data arrives
    useEffect(() => {
        if (!managerInfo && !ownedInfo) return;

        const newNodes: Node[] = [];
        const newEdges: Edge[] = [];

        // Treat Cadence response children as `any` since codegen type is incomplete
        const children: any[] = (managerInfo?.childAccounts as any[]) || [];
        const ownedAccounts: any[] = (managerInfo?.ownedAccounts as any[]) || [];
        const parents: any[] = ownedInfo?.parents || [];

        const hasManager = managerInfo?.isManagerExists ?? false;
        const hasOwned = ownedInfo?.isOwnedAccountExists ?? false;

        const totalParents = parents.length;
        const totalChildren = children.length + ownedAccounts.length;

        // Layout constants
        const COL_WIDTH = 260;
        const ROW_HEIGHT = 120;
        const centerX = Math.max(totalParents, totalChildren, 1) * COL_WIDTH / 2;

        // Current account node (center)
        newNodes.push({
            id: 'current',
            type: 'account',
            position: { x: centerX - 90, y: totalParents > 0 ? ROW_HEIGHT : 0 },
            data: {
                address: normalizedAddress,
                label: 'Current Account',
                role: 'current',
                isCurrent: true,
                displayName: ownedInfo?.display?.name || null,
                description: ownedInfo?.display?.description || null,
            },
            sourcePosition: Position.Bottom,
            targetPosition: Position.Top,
        });

        // Parent nodes (above)
        parents.forEach((p, i) => {
            const id = `parent-${i}`;
            const xOffset = (i - (totalParents - 1) / 2) * COL_WIDTH;
            newNodes.push({
                id,
                type: 'account',
                position: { x: centerX - 90 + xOffset, y: 0 },
                data: {
                    address: normalizeAddress(p.address),
                    label: 'Parent',
                    role: 'parent',
                    isCurrent: false,
                    isClaimed: p.isClaimed,
                },
                sourcePosition: Position.Bottom,
                targetPosition: Position.Top,
            });
            newEdges.push({
                id: `e-${id}`,
                source: id,
                target: 'current',
                animated: true,
                style: { stroke: '#3b82f6' },
                markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' },
                label: p.isClaimed ? 'manages' : 'unclaimed',
                labelStyle: { fontSize: 10, fill: '#94a3b8' },
            });
        });

        // Child nodes (below)
        const allChildren = [
            ...children.map((c: any) => ({ ...c, isOwned: false })),
            ...ownedAccounts.map((c: any) => ({ ...c, isOwned: true })),
        ];
        const currentY = totalParents > 0 ? ROW_HEIGHT : 0;

        allChildren.forEach((c, i) => {
            const id = `child-${i}`;
            const xOffset = (i - (allChildren.length - 1) / 2) * COL_WIDTH;
            const display = c.display as any;
            newNodes.push({
                id,
                type: 'account',
                position: { x: centerX - 90 + xOffset, y: currentY + ROW_HEIGHT },
                data: {
                    address: normalizeAddress(c.address),
                    label: c.isOwned ? 'Owned Account' : 'Child Account',
                    role: c.isOwned ? 'owned' : 'child',
                    isCurrent: false,
                    displayName: display?.name || null,
                    description: display?.description || null,
                },
                sourcePosition: Position.Bottom,
                targetPosition: Position.Top,
            });
            newEdges.push({
                id: `e-${id}`,
                source: 'current',
                target: id,
                animated: true,
                style: { stroke: '#f59e0b' },
                markerEnd: { type: MarkerType.ArrowClosed, color: '#f59e0b' },
                label: c.isOwned ? 'owns' : 'manages',
                labelStyle: { fontSize: 10, fill: '#94a3b8' },
            });
        });

        setNodes(newNodes);
        setEdges(newEdges);
    }, [managerInfo, ownedInfo, normalizedAddress, setNodes, setEdges]);

    const hasAnyRelationship = (managerInfo?.isManagerExists && ((managerInfo?.childAccounts as any[])?.length > 0 || (managerInfo?.ownedAccounts as any[])?.length > 0))
        || (ownedInfo?.isOwnedAccountExists && ownedInfo?.parents?.length > 0);

    const graphHeight = useMemo(() => {
        const parents = ownedInfo?.parents?.length || 0;
        const children = ((managerInfo?.childAccounts as any[])?.length || 0) + ((managerInfo?.ownedAccounts as any[])?.length || 0);
        const rows = (parents > 0 ? 1 : 0) + 1 + (children > 0 ? 1 : 0);
        return Math.max(300, rows * 140 + 80);
    }, [managerInfo, ownedInfo]);

    return (
        <div>
            <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] uppercase tracking-widest text-zinc-500">
                    Hybrid Custody
                </div>
                {loading && (
                    <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Loading...
                    </div>
                )}
            </div>

            {error && <div className="text-xs text-red-500 dark:text-red-400 mb-4">{error}</div>}

            {!loading && !error && managerInfo !== null && ownedInfo !== null && !hasAnyRelationship && (
                <div className="flex flex-col items-center justify-center py-12 text-zinc-400 dark:text-zinc-600">
                    <Shield className="h-12 w-12 mb-4 opacity-20" />
                    <p className="text-xs uppercase tracking-widest">No hybrid custody relationships</p>
                    <p className="text-[10px] text-zinc-500 mt-1">This account has no parent or child accounts</p>
                </div>
            )}

            {hasAnyRelationship && nodes.length > 0 && (
                <div
                    className="border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden bg-zinc-50 dark:bg-[#0a0a0a]"
                    style={{ height: graphHeight }}
                >
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        nodeTypes={nodeTypes}
                        fitView
                        fitViewOptions={{ padding: 0.3 }}
                        proOptions={{ hideAttribution: true }}
                        minZoom={0.5}
                        maxZoom={1.5}
                        nodesDraggable={true}
                        nodesConnectable={false}
                        elementsSelectable={false}
                    >
                        <Background color="#27272a" gap={20} size={1} />
                        <Controls
                            showInteractive={false}
                            className="!bg-white dark:!bg-zinc-900 !border-zinc-200 dark:!border-white/10 !shadow-sm [&_button]:!bg-white dark:[&_button]:!bg-zinc-900 [&_button]:!border-zinc-200 dark:[&_button]:!border-white/10 [&_button]:!fill-zinc-600 dark:[&_button]:!fill-zinc-400"
                        />
                    </ReactFlow>
                </div>
            )}

            {/* Summary info */}
            {!loading && (managerInfo || ownedInfo) && (
                <div className="grid grid-cols-2 gap-4 mt-4">
                    <div className="border border-zinc-200 dark:border-white/5 p-3 bg-zinc-50 dark:bg-black/40 rounded-sm">
                        <div className="text-[9px] uppercase tracking-widest text-zinc-500 mb-1">Manager Status</div>
                        <div className="text-sm font-mono font-bold text-zinc-900 dark:text-white">
                            {managerInfo?.isManagerExists ? 'Active' : 'None'}
                        </div>
                        {managerInfo?.isManagerExists && (
                            <div className="text-[10px] text-zinc-500 mt-1">
                                {(managerInfo.childAccounts as any[])?.length || 0} child · {(managerInfo.ownedAccounts as any[])?.length || 0} owned
                            </div>
                        )}
                    </div>
                    <div className="border border-zinc-200 dark:border-white/5 p-3 bg-zinc-50 dark:bg-black/40 rounded-sm">
                        <div className="text-[9px] uppercase tracking-widest text-zinc-500 mb-1">Owned Account</div>
                        <div className="text-sm font-mono font-bold text-zinc-900 dark:text-white">
                            {ownedInfo?.isOwnedAccountExists ? 'Active' : 'None'}
                        </div>
                        {ownedInfo?.isOwnedAccountExists && (
                            <div className="text-[10px] text-zinc-500 mt-1">
                                {ownedInfo.parents?.length || 0} parent{(ownedInfo.parents?.length || 0) !== 1 ? 's' : ''}
                                {ownedInfo.owner && <span> · owner: {ownedInfo.owner.slice(0, 10)}…</span>}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

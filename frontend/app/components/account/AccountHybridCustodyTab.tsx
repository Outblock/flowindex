import { useState, useEffect, useCallback, useMemo } from 'react';
import ReactFlow, {
    Node, Edge, Position, MarkerType, Handle,
    Background, BackgroundVariant, Controls,
    useNodesState, useEdgesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Link } from '@tanstack/react-router';
import { User, Shield, Loader2, UserCog, KeyRound, ShieldCheck, Coins, Image as ImageIcon } from 'lucide-react';
import { normalizeAddress } from './accountUtils';
import type { ManagerInfo, OwnedAccountInfo, TokenInfo } from '../../../cadence/cadence.gen';

interface Props {
    address: string;
}

/* ── Custom Node with explicit Handles ── */
function AccountNode({ data }: { data: any }) {
    const isCurrent = data.isCurrent;
    const role = data.role as 'current' | 'parent' | 'child' | 'owned';

    const bgColor = 'bg-white dark:bg-zinc-900';

    const IconComp = role === 'parent' ? ShieldCheck : role === 'child' ? UserCog : role === 'owned' ? KeyRound : User;
    const iconColor = isCurrent ? 'text-nothing-green-dark dark:text-nothing-green' : role === 'parent' ? 'text-blue-500' : 'text-amber-500';
    const dotColor = isCurrent ? 'bg-nothing-green' : role === 'parent' ? 'bg-blue-400' : 'bg-amber-400';

    const thumbnail = data.thumbnail;

    return (
        <div className={`border border-zinc-200 dark:border-white/10 ${bgColor} rounded-lg px-4 py-3 min-w-[220px] max-w-[280px] shadow-sm font-mono relative`}>
            {/* Handles for edges */}
            <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-zinc-300 dark:!bg-zinc-600 !border-0 !-top-1" />
            <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-zinc-300 dark:!bg-zinc-600 !border-0 !-bottom-1" />

            {/* Top accent line */}
            <div className={`absolute top-0 left-4 right-4 h-[2px] ${dotColor} rounded-full`} />

            <div className="flex items-start gap-3 mt-1">
                {/* Avatar / Icon */}
                {thumbnail ? (
                    <img
                        src={thumbnail}
                        alt=""
                        className="w-9 h-9 rounded-full object-cover flex-shrink-0 border border-zinc-200 dark:border-white/10"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                ) : (
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${isCurrent ? 'bg-nothing-green-dark/10 dark:bg-nothing-green/10' : role === 'parent' ? 'bg-blue-500/10' : 'bg-amber-500/10'}`}>
                        <IconComp className={`h-4 w-4 ${iconColor}`} />
                    </div>
                )}

                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[9px] uppercase tracking-widest text-zinc-400">{data.label}</span>
                    </div>
                    {data.displayName && (
                        <div className="text-[11px] font-semibold text-zinc-900 dark:text-white truncate">{data.displayName}</div>
                    )}
                    {isCurrent ? (
                        <div className="text-[10px] text-zinc-500 dark:text-zinc-500 truncate">{data.address}</div>
                    ) : (
                        <Link
                            to={`/accounts/${data.address}` as any}
                            className="text-[10px] text-nothing-green-dark dark:text-nothing-green hover:underline truncate block"
                        >
                            {data.address}
                        </Link>
                    )}
                </div>
            </div>

            {data.description && (
                <div className="text-[9px] text-zinc-400 mt-2 line-clamp-1">{data.description}</div>
            )}

            {/* Accessible tokens detail */}
            {data.ftTokens && data.ftTokens.length > 0 && (
                <div className="mt-2 border-t border-zinc-100 dark:border-white/5 pt-2">
                    <div className="flex items-center gap-1 text-[9px] text-zinc-400 mb-1">
                        <Coins className="h-3 w-3" />
                        <span className="font-semibold uppercase tracking-wider">Tokens</span>
                    </div>
                    {data.ftTokens.map((ft: any, i: number) => (
                        <div key={i} className="text-[9px] text-zinc-500 dark:text-zinc-400 truncate pl-4">
                            {ft.id?.split('.')?.pop() || ft.id}: {Number(ft.balance).toFixed(4)}
                        </div>
                    ))}
                </div>
            )}
            {data.nftCollections && data.nftCollections.length > 0 && (
                <div className="mt-2 border-t border-zinc-100 dark:border-white/5 pt-2">
                    <div className="flex items-center gap-1 text-[9px] text-zinc-400 mb-1">
                        <ImageIcon className="h-3 w-3" />
                        <span className="font-semibold uppercase tracking-wider">NFTs</span>
                    </div>
                    {data.nftCollections.map((col: string, i: number) => (
                        <div key={i} className="text-[9px] text-zinc-500 dark:text-zinc-400 truncate pl-4">
                            {col.split('.').pop() || col}
                        </div>
                    ))}
                </div>
            )}

            {data.isClaimed === false && (
                <div className="text-[9px] text-amber-500 mt-2 uppercase tracking-wider font-semibold">Unclaimed</div>
            )}
        </div>
    );
}

const nodeTypes = { account: AccountNode };

const defaultEdgeOptions = {
    type: 'smoothstep',
    animated: true,
    style: { strokeWidth: 1.5 },
};

export function AccountHybridCustodyTab({ address }: Props) {
    const normalizedAddress = normalizeAddress(address);

    const [managerInfo, setManagerInfo] = useState<ManagerInfo | null>(null);
    const [ownedInfo, setOwnedInfo] = useState<OwnedAccountInfo | null>(null);
    const [childMetadata, setChildMetadata] = useState<Record<string, any>>({});
    const [ftAccessibility, setFtAccessibility] = useState<Record<string, TokenInfo[]>>({});
    const [nftAccessibility, setNftAccessibility] = useState<Record<string, Record<string, number[]>>>({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

    useEffect(() => {
        setManagerInfo(null);
        setOwnedInfo(null);
        setChildMetadata({});
        setFtAccessibility({});
        setNftAccessibility({});
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

            // Load child metadata and accessibility data in parallel
            const promises: Promise<void>[] = [];

            if (manager?.isManagerExists) {
                promises.push(
                    cadenceService.getChildMetadata(normalizedAddress)
                        .then((meta: any) => {
                            if (!meta) return setChildMetadata({});
                            // Normalize address keys so lookup matches
                            const normalized: Record<string, any> = {};
                            for (const [k, v] of Object.entries(meta)) {
                                normalized[normalizeAddress(k)] = v;
                            }
                            setChildMetadata(normalized);
                        })
                        .catch(() => {})
                );
                promises.push(
                    cadenceService.getNftAccessibility(normalizedAddress)
                        .then((data: any) => {
                            if (!data) return setNftAccessibility({});
                            const normalized: Record<string, Record<string, number[]>> = {};
                            for (const [k, v] of Object.entries(data)) {
                                normalized[normalizeAddress(k)] = v as Record<string, number[]>;
                            }
                            setNftAccessibility(normalized);
                        })
                        .catch(() => {})
                );

                // Load FT accessibility per child
                const children = (manager.childAccounts as any[]) || [];
                for (const child of children) {
                    const childAddr = normalizeAddress(child.address);
                    promises.push(
                        cadenceService.getFtAccessibility(normalizedAddress, childAddr)
                            .then((tokens: TokenInfo[]) => {
                                setFtAccessibility(prev => ({ ...prev, [childAddr]: tokens || [] }));
                            })
                            .catch(() => {})
                    );
                }
            }

            await Promise.allSettled(promises);
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

        const children: any[] = (managerInfo?.childAccounts as any[]) || [];
        const ownedAccounts: any[] = (managerInfo?.ownedAccounts as any[]) || [];
        const parents: any[] = ownedInfo?.parents || [];

        const totalParents = parents.length;
        const totalChildren = children.length + ownedAccounts.length;

        // Layout constants
        const COL_WIDTH = 300;
        const ROW_HEIGHT = 200;
        const centerX = Math.max(totalParents, totalChildren, 1) * COL_WIDTH / 2;

        // Current account node (center)
        newNodes.push({
            id: 'current',
            type: 'account',
            position: { x: centerX - 110, y: totalParents > 0 ? ROW_HEIGHT : 0 },
            data: {
                address: normalizedAddress,
                label: 'Current Account',
                role: 'current',
                isCurrent: true,
                displayName: ownedInfo?.display?.name || null,
                description: ownedInfo?.display?.description || null,
                thumbnail: ownedInfo?.display?.thumbnail || null,
            },
        });

        // Parent nodes (above)
        parents.forEach((p, i) => {
            const id = `parent-${i}`;
            const xOffset = (i - (totalParents - 1) / 2) * COL_WIDTH;
            newNodes.push({
                id,
                type: 'account',
                position: { x: centerX - 110 + xOffset, y: 0 },
                data: {
                    address: normalizeAddress(p.address),
                    label: 'Parent',
                    role: 'parent',
                    isCurrent: false,
                    isClaimed: p.isClaimed,
                },
            });
            newEdges.push({
                id: `e-${id}`,
                source: id,
                target: 'current',
                style: { stroke: '#60a5fa', strokeWidth: 1.5 },
                markerEnd: { type: MarkerType.ArrowClosed, color: '#60a5fa', width: 16, height: 16 },
                label: p.isClaimed ? 'manages' : 'unclaimed',
                labelStyle: { fontSize: 9, fill: '#94a3b8', fontFamily: 'ui-monospace, monospace' },
                labelBgStyle: { fill: 'transparent' },
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
            const childAddr = normalizeAddress(c.address);

            // Get metadata from getChildMetadata call (keys already normalized)
            const meta = childMetadata[childAddr];
            const displayName = display?.name || meta?.name || null;
            const rawThumb = display?.thumbnail || meta?.thumbnail;
            const thumbnail = typeof rawThumb === 'string' ? rawThumb : rawThumb?.url || rawThumb?.cid ? `https://nftstorage.link/ipfs/${rawThumb.cid}` : null;
            const desc = display?.description || meta?.description || null;

            // Get accessibility info
            const childFts = ftAccessibility[childAddr] || [];
            const childNfts = nftAccessibility[childAddr] || {};
            const nftCollectionKeys = Object.keys(childNfts);

            newNodes.push({
                id,
                type: 'account',
                position: { x: centerX - 110 + xOffset, y: currentY + ROW_HEIGHT },
                data: {
                    address: childAddr,
                    label: c.isOwned ? 'Owned Account' : 'Child Account',
                    role: c.isOwned ? 'owned' : 'child',
                    isCurrent: false,
                    displayName,
                    description: desc,
                    thumbnail,
                    ftTokens: childFts,
                    nftCollections: nftCollectionKeys,
                },
            });
            newEdges.push({
                id: `e-${id}`,
                source: 'current',
                target: id,
                style: { stroke: '#fbbf24', strokeWidth: 1.5 },
                markerEnd: { type: MarkerType.ArrowClosed, color: '#fbbf24', width: 16, height: 16 },
                label: c.isOwned ? 'owns' : 'manages',
                labelStyle: { fontSize: 9, fill: '#94a3b8', fontFamily: 'ui-monospace, monospace' },
                labelBgStyle: { fill: 'transparent' },
            });
        });

        setNodes(newNodes);
        setEdges(newEdges);
    }, [managerInfo, ownedInfo, normalizedAddress, childMetadata, ftAccessibility, nftAccessibility, setNodes, setEdges]);

    const hasAnyRelationship = (managerInfo?.isManagerExists && ((managerInfo?.childAccounts as any[])?.length > 0 || (managerInfo?.ownedAccounts as any[])?.length > 0))
        || (ownedInfo?.isOwnedAccountExists && ownedInfo?.parents?.length > 0);

    const graphHeight = useMemo(() => {
        const parents = ownedInfo?.parents?.length || 0;
        const children = ((managerInfo?.childAccounts as any[])?.length || 0) + ((managerInfo?.ownedAccounts as any[])?.length || 0);
        const rows = (parents > 0 ? 1 : 0) + 1 + (children > 0 ? 1 : 0);
        return Math.max(400, rows * 220 + 80);
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
                    className="border border-zinc-200 dark:border-white/10 rounded-lg overflow-hidden bg-zinc-50 dark:bg-[#0a0a0a]"
                    style={{ height: graphHeight }}
                >
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        nodeTypes={nodeTypes}
                        defaultEdgeOptions={defaultEdgeOptions}
                        fitView
                        fitViewOptions={{ padding: 0.3 }}
                        proOptions={{ hideAttribution: true }}
                        minZoom={0.5}
                        maxZoom={1.5}
                        nodesDraggable={true}
                        nodesConnectable={false}
                        elementsSelectable={false}
                    >
                        <Background variant={BackgroundVariant.Dots} color="#3f3f46" gap={20} size={1} />
                        <Controls
                            showInteractive={false}
                            className="!bg-white dark:!bg-zinc-900 !border-zinc-200 dark:!border-white/10 !shadow-sm !rounded-lg [&_button]:!bg-white dark:[&_button]:!bg-zinc-900 [&_button]:!border-zinc-200 dark:[&_button]:!border-white/10 [&_button]:!fill-zinc-600 dark:[&_button]:!fill-zinc-400 [&_button]:!rounded-md"
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

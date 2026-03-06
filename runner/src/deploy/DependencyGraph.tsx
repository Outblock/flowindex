// ---------------------------------------------------------------------------
// DependencyGraph — ReactFlow-based dependency visualization
// Adapted from frontend/app/routes/contracts/$id.tsx
// ---------------------------------------------------------------------------

import { useMemo, useEffect, useCallback } from 'react';
import ReactFlow, {
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  MarkerType,
  Position,
  Handle,
} from 'reactflow';
import 'reactflow/dist/style.css';
import dagre from 'dagre';
import { GitBranch } from 'lucide-react';
import type { ContractDependency, DependencyGraph as DependencyGraphType } from './api';
import ExpandableFlowContainer from './ExpandableFlowContainer';

// ---------------------------------------------------------------------------
// Custom node
// ---------------------------------------------------------------------------

interface ContractNodeData {
  label: string;
  identifier: string;
  isCurrent: boolean;
  isVerified?: boolean;
  kind?: string;
  tokenLogo?: string;
}

function ContractNode({ data }: { data: ContractNodeData }) {
  const parts = data.identifier.split('.');
  const addr = parts.length >= 2 ? parts[1] : '';
  const shortAddr = addr.length > 8 ? `0x${addr.slice(0, 4)}...${addr.slice(-4)}` : `0x${addr}`;
  return (
    <div className="flex items-center gap-1.5">
      <Handle type="target" position={Position.Left} style={{ background: 'transparent', border: 'none' }} />
      {data.tokenLogo && (
        <img
          src={data.tokenLogo}
          alt=""
          className="w-4 h-4 rounded-full flex-shrink-0"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      )}
      <div className="text-center min-w-0">
        <div
          className="flex items-center justify-center gap-1"
          style={{ fontSize: 11, fontWeight: data.isCurrent ? 700 : 500 }}
        >
          <span className="truncate">{data.label}</span>
          {data.kind && (
            <span style={{ fontSize: 7, opacity: 0.5, fontWeight: 600 }}>{data.kind}</span>
          )}
        </div>
        <div style={{ fontSize: 8, opacity: 0.5, marginTop: 1, fontFamily: 'monospace' }}>
          {shortAddr}
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: 'transparent', border: 'none' }} />
    </div>
  );
}

const nodeTypes = { contract: ContractNode };

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  contractName: string;
  contractIdentifier: string;
  imports: ContractDependency[];
  dependents: ContractDependency[];
  graph?: DependencyGraphType;
  onNodeClick?: (identifier: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DependencyGraph({
  contractName,
  contractIdentifier,
  imports,
  dependents,
  graph,
  onNodeClick,
}: Props) {
  const green = '#4ade80';
  const purple = '#a78bfa';

  const { nodes: initialNodes, edges: initialEdges } = useMemo(() => {
    const baseNodeStyle = {
      background: '#18181b',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 4,
      padding: '8px 12px',
      fontSize: 10,
      fontFamily: 'monospace',
      color: '#a1a1aa',
      cursor: 'pointer',
    };

    const rootID = graph?.root ?? contractIdentifier;

    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 180, marginx: 40, marginy: 40 });
    g.setDefaultEdgeLabel(() => ({}));

    type NodeMeta = { name: string; identifier: string; isVerified?: boolean; kind?: string; tokenLogo?: string };
    const allNodes = new Map<string, NodeMeta>();

    // Build metadata lookup from graph nodes
    const graphMeta = new Map<string, NonNullable<typeof graph>['nodes'][number]>();
    if (graph?.nodes) {
      for (const n of graph.nodes) {
        graphMeta.set(n.identifier, n);
      }
    }

    const metaFor = (id: string, name: string): NodeMeta => {
      const gn = graphMeta.get(id);
      return {
        name,
        identifier: id,
        isVerified: gn?.is_verified,
        kind: gn?.kind,
        tokenLogo: gn?.token_logo,
      };
    };

    // Add root
    allNodes.set(rootID, metaFor(rootID, contractName));

    // Add graph import nodes
    if (graph?.nodes) {
      for (const n of graph.nodes) {
        allNodes.set(n.identifier, metaFor(n.identifier, n.name));
      }
    } else {
      for (const imp of imports) {
        const id = imp.identifier || `A.${imp.address}.${imp.name}`;
        allNodes.set(id, { name: imp.name, identifier: id });
      }
    }

    // Add dependent nodes
    for (const dep of dependents) {
      const id = dep.identifier || `A.${dep.address}.${dep.name}`;
      if (!allNodes.has(id)) {
        allNodes.set(id, { name: dep.name, identifier: id });
      }
    }

    // Set dagre node sizes
    for (const [id, n] of allNodes) {
      const hasLogo = n.tokenLogo ? 20 : 0;
      const w = Math.max(120, n.name.length * 7 + 32 + hasLogo);
      g.setNode(id, { width: w, height: 46 });
    }

    // Add edges
    const edgeKeys = new Set<string>();
    if (graph?.edges) {
      for (const e of graph.edges) {
        const key = `${e.source}->${e.target}`;
        if (!edgeKeys.has(key)) {
          edgeKeys.add(key);
          g.setEdge(e.target, e.source);
        }
      }
    } else {
      for (const imp of imports) {
        const id = imp.identifier || `A.${imp.address}.${imp.name}`;
        g.setEdge(id, rootID);
      }
    }

    for (const dep of dependents) {
      const id = dep.identifier || `A.${dep.address}.${dep.name}`;
      const key = `${rootID}->dep:${id}`;
      if (!edgeKeys.has(key)) {
        edgeKeys.add(key);
        g.setEdge(rootID, id);
      }
    }

    dagre.layout(g);

    // Convert to ReactFlow nodes/edges
    const rfNodes: any[] = [];
    const rfEdges: any[] = [];

    for (const [id, data] of allNodes) {
      const pos = g.node(id);
      if (!pos) continue;
      const isCurrent = id === rootID;
      rfNodes.push({
        id,
        type: 'contract',
        position: { x: pos.x - pos.width / 2, y: pos.y - pos.height / 2 },
        data: {
          label: data.name,
          identifier: data.identifier,
          isCurrent,
          isVerified: data.isVerified,
          kind: data.kind,
          tokenLogo: data.tokenLogo,
        },
        style: isCurrent
          ? {
              background: '#1a2e1a',
              border: `2px solid ${green}`,
              borderRadius: 4,
              padding: '8px 12px',
              fontFamily: 'monospace',
              color: '#fff',
            }
          : { ...baseNodeStyle, padding: '6px 12px' },
      });
    }

    // Import edges (green)
    if (graph?.edges) {
      for (const e of graph.edges) {
        rfEdges.push({
          id: `e-${e.source}-${e.target}`,
          source: e.target,
          target: e.source,
          animated: false,
          style: { stroke: green, strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: green, width: 14, height: 14 },
        });
      }
    } else {
      for (const imp of imports) {
        const id = imp.identifier || `A.${imp.address}.${imp.name}`;
        rfEdges.push({
          id: `e-imp-${id}`,
          source: id,
          target: rootID,
          animated: false,
          style: { stroke: green, strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: green, width: 14, height: 14 },
        });
      }
    }

    // Dependent edges (purple)
    for (const dep of dependents) {
      const id = dep.identifier || `A.${dep.address}.${dep.name}`;
      rfEdges.push({
        id: `e-dep-${id}`,
        source: rootID,
        target: id,
        animated: false,
        style: { stroke: purple, strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: purple, width: 14, height: 14 },
      });
    }

    return { nodes: rfNodes, edges: rfEdges };
  }, [contractName, contractIdentifier, imports, dependents, graph]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges]);

  const handleNodeClick = useCallback((_: any, node: any) => {
    if (node.data?.identifier && !node.data?.isCurrent && onNodeClick) {
      onNodeClick(node.data.identifier);
    }
  }, [onNodeClick]);

  if (imports.length === 0 && dependents.length === 0 && (!graph?.edges || graph.edges.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-zinc-500">
        <GitBranch className="h-8 w-8 mb-3 opacity-30" />
        <p className="text-xs uppercase tracking-widest">No dependencies found</p>
      </div>
    );
  }

  const legend = (
    <div className="flex items-center gap-6 px-4 py-2 border-t border-zinc-800 text-[10px] text-zinc-500">
      <span className="flex items-center gap-1.5">
        <span className="w-3 h-0.5 bg-green-400 inline-block" /> Imports
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-3 h-0.5 bg-purple-400 inline-block" /> Imported by
      </span>
      <span className="text-zinc-600">Click a node to navigate</span>
    </div>
  );

  return (
    <ExpandableFlowContainer
      label="Dependency Graph"
      subtitle={`${nodes.length} contract${nodes.length !== 1 ? 's' : ''} · ${edges.length} edge${edges.length !== 1 ? 's' : ''}`}
      icon={<GitBranch className="w-4 h-4 text-green-400" />}
      height={500}
      footer={legend}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#333" gap={20} size={1} />
        <Controls
          style={{
            background: '#18181b',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 4,
          }}
        />
      </ReactFlow>
    </ExpandableFlowContainer>
  );
}

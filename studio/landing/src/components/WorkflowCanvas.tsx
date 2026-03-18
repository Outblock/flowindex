import { useCallback, useEffect } from 'react'
import {
  ReactFlow,
  Background,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Handle,
  Position,
  BaseEdge,
  getBezierPath,
  type EdgeProps,
  type NodeProps,
} from '@xyflow/react'

/* ---- Types ---- */

export type WorkflowNodeData = {
  label: string
  subtitle: string
  description: string
  tags: { text: string; purple?: boolean }[]
  icon: 'trigger' | 'agent' | 'code' | 'db' | 'webhook' | 'email' | 'clock'
  isActive?: boolean
}

export type WorkflowPreset = {
  id: string
  name: string
  description: string
  tag: string
  nodes: Node<WorkflowNodeData>[]
  edges: Edge[]
}

/* ---- Icons ---- */

function NodeIcon({ type }: { type: string }) {
  switch (type) {
    case 'trigger':
    case 'clock':
      return (
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none">
          <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    case 'agent':
      return (
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none">
          <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      )
    case 'code':
      return (
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none">
          <path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
      )
    case 'db':
      return (
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none">
          <path d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m-12 5c0 2.21 3.582 4 8 4s8-1.79 8-4" />
        </svg>
      )
    case 'webhook':
      return (
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none">
          <path d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      )
    case 'email':
      return (
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none">
          <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none">
          <path d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
          <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
  }
}

/* ---- Custom Node ---- */

function WorkflowNode({ data, selected }: NodeProps<Node<WorkflowNodeData>>) {
  return (
    <div className={`flow-node${selected || data.isActive ? ' active-node' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="node-header">
        <div className="node-title-group">
          <div className="node-icon-bg">
            <NodeIcon type={data.icon} />
          </div>
          <span className="node-title">{data.label}</span>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" stroke="var(--text-low)" strokeWidth="2" fill="none">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </div>
      <div className="node-content">
        {data.subtitle && <div className="node-content-title">{data.subtitle}</div>}
        {data.description && <div className="node-text">{data.description}</div>}
        {data.tags.length > 0 && (
          <div className="node-tags">
            {data.tags.map((tag, i) => (
              <span key={i} className={`node-tag${tag.purple ? ' purple' : ''}`}>{tag.text}</span>
            ))}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

/* ---- Custom Animated Edge ---- */

function AnimatedEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition,
  })
  const isActive = (data as { active?: boolean })?.active
  return (
    <g className={`animated-edge${isActive ? ' active-edge' : ''}`}>
      <BaseEdge id={id} path={edgePath} />
    </g>
  )
}

/* ---- Workflow Presets ---- */

export const workflowPresets: WorkflowPreset[] = [
  {
    id: 'swap-stake',
    name: 'Swap & Stake Flow',
    description: 'DeFi swap optimization with AI routing',
    tag: 'DeFi',
    nodes: [
      {
        id: 'trigger', type: 'workflow', position: { x: 40, y: 140 },
        data: { label: 'Wallet Connected', subtitle: 'Event Listener', description: 'Listens for Flow wallet authentication event.', tags: [{ text: 'Flow Auth' }], icon: 'trigger' },
      },
      {
        id: 'agent', type: 'workflow', position: { x: 380, y: 200 },
        data: { label: 'DeFi Swap Optimizer', subtitle: 'Agent Logic', description: 'Analyzes liquidity pools to find best swap route across Flow DEXs.', tags: [{ text: 'LLM Routing', purple: true }, { text: 'Flow-EVM' }], icon: 'agent', isActive: true },
      },
      {
        id: 'swap', type: 'workflow', position: { x: 740, y: 120 },
        data: { label: 'Execute Swap', subtitle: 'Contract Interaction', description: 'Calls swapExactTokensForTokens on Router.', tags: [], icon: 'code' },
      },
      {
        id: 'log', type: 'workflow', position: { x: 740, y: 360 },
        data: { label: 'Log Transaction', subtitle: '', description: '', tags: [{ text: 'PostgreSQL' }], icon: 'db' },
      },
    ],
    edges: [
      { id: 'e1', source: 'trigger', target: 'agent', type: 'animated', data: { active: false } },
      { id: 'e2', source: 'agent', target: 'swap', type: 'animated', data: { active: true } },
      { id: 'e3', source: 'agent', target: 'log', type: 'animated', data: { active: false } },
    ],
  },
  {
    id: 'nft-mint',
    name: 'NFT Minting Service',
    description: 'Automated NFT minting from webhook trigger',
    tag: 'NFT',
    nodes: [
      {
        id: 'webhook', type: 'workflow', position: { x: 40, y: 160 },
        data: { label: 'Webhook Trigger', subtitle: 'HTTP Endpoint', description: 'Receives mint request with metadata payload.', tags: [{ text: 'POST /mint' }], icon: 'webhook' },
      },
      {
        id: 'validate', type: 'workflow', position: { x: 380, y: 100 },
        data: { label: 'Validate Metadata', subtitle: 'Agent Logic', description: 'Checks image URL, attributes, and royalty fields.', tags: [{ text: 'LLM', purple: true }], icon: 'agent', isActive: true },
      },
      {
        id: 'mint', type: 'workflow', position: { x: 380, y: 320 },
        data: { label: 'Mint NFT', subtitle: 'Cadence Transaction', description: 'Calls NonFungibleToken.mint on collection contract.', tags: [{ text: 'Cadence' }], icon: 'code' },
      },
      {
        id: 'notify', type: 'workflow', position: { x: 740, y: 200 },
        data: { label: 'Send Confirmation', subtitle: 'Email Notification', description: 'Sends receipt with tx hash and OpenSea link.', tags: [{ text: 'Email' }], icon: 'email' },
      },
    ],
    edges: [
      { id: 'e1', source: 'webhook', target: 'validate', type: 'animated', data: { active: true } },
      { id: 'e2', source: 'webhook', target: 'mint', type: 'animated', data: { active: false } },
      { id: 'e3', source: 'validate', target: 'notify', type: 'animated', data: { active: false } },
      { id: 'e4', source: 'mint', target: 'notify', type: 'animated', data: { active: true } },
    ],
  },
  {
    id: 'arb-bot',
    name: 'EVM Arbitrage Bot',
    description: 'Cross-DEX price monitoring and execution',
    tag: 'DeFi',
    nodes: [
      {
        id: 'monitor', type: 'workflow', position: { x: 40, y: 180 },
        data: { label: 'Price Monitor', subtitle: 'Chain Event', description: 'Watches Sync events on Uniswap V2 pairs.', tags: [{ text: 'Flow-EVM' }], icon: 'trigger' },
      },
      {
        id: 'analyzer', type: 'workflow', position: { x: 380, y: 120 },
        data: { label: 'Spread Analyzer', subtitle: 'Agent Logic', description: 'Calculates profit after gas. Triggers if spread > 0.3%.', tags: [{ text: 'LLM', purple: true }, { text: 'Math' }], icon: 'agent', isActive: true },
      },
      {
        id: 'flash', type: 'workflow', position: { x: 740, y: 120 },
        data: { label: 'Flash Swap', subtitle: 'Contract Call', description: 'Executes atomic flash loan + swap bundle.', tags: [{ text: 'Solidity' }], icon: 'code' },
      },
      {
        id: 'report', type: 'workflow', position: { x: 740, y: 340 },
        data: { label: 'PnL Logger', subtitle: 'Analytics', description: 'Records trade outcome and cumulative PnL.', tags: [{ text: 'PostgreSQL' }], icon: 'db' },
      },
    ],
    edges: [
      { id: 'e1', source: 'monitor', target: 'analyzer', type: 'animated', data: { active: true } },
      { id: 'e2', source: 'analyzer', target: 'flash', type: 'animated', data: { active: true } },
      { id: 'e3', source: 'flash', target: 'report', type: 'animated', data: { active: false } },
    ],
  },
  {
    id: 'airdrop',
    name: 'Daily Token Airdrop',
    description: 'Scheduled batch transfers to eligible wallets',
    tag: 'Ops',
    nodes: [
      {
        id: 'cron', type: 'workflow', position: { x: 40, y: 180 },
        data: { label: 'Daily Schedule', subtitle: 'CRON Trigger', description: 'Fires every day at 00:00 UTC.', tags: [{ text: '0 0 * * *' }], icon: 'clock' },
      },
      {
        id: 'query', type: 'workflow', position: { x: 380, y: 120 },
        data: { label: 'Query Recipients', subtitle: 'Database', description: 'Fetches eligible addresses from staking table.', tags: [{ text: 'PostgreSQL' }], icon: 'db' },
      },
      {
        id: 'batch', type: 'workflow', position: { x: 380, y: 340 },
        data: { label: 'Build Batch Tx', subtitle: 'Agent Logic', description: 'Constructs multi-transfer Cadence transaction.', tags: [{ text: 'LLM', purple: true }, { text: 'Cadence' }], icon: 'agent', isActive: true },
      },
      {
        id: 'execute', type: 'workflow', position: { x: 740, y: 220 },
        data: { label: 'Execute Transfer', subtitle: 'On-Chain', description: 'Signs and submits batch FT transfer.', tags: [{ text: 'Flow' }], icon: 'code' },
      },
    ],
    edges: [
      { id: 'e1', source: 'cron', target: 'query', type: 'animated', data: { active: false } },
      { id: 'e2', source: 'cron', target: 'batch', type: 'animated', data: { active: false } },
      { id: 'e3', source: 'query', target: 'execute', type: 'animated', data: { active: true } },
      { id: 'e4', source: 'batch', target: 'execute', type: 'animated', data: { active: true } },
    ],
  },
  {
    id: 'bridge-monitor',
    name: 'Cross-Chain Bridge Monitor',
    description: 'Monitors bridge events and alerts on anomalies',
    tag: 'Security',
    nodes: [
      {
        id: 'listener', type: 'workflow', position: { x: 40, y: 180 },
        data: { label: 'Bridge Listener', subtitle: 'Event Stream', description: 'Watches deposit/withdraw events on bridge contract.', tags: [{ text: 'Flow-EVM' }], icon: 'trigger' },
      },
      {
        id: 'api', type: 'workflow', position: { x: 380, y: 120 },
        data: { label: 'Cross-Chain Verify', subtitle: 'API Call', description: 'Confirms counterpart tx on source chain via RPC.', tags: [{ text: 'Ethereum' }, { text: 'REST' }], icon: 'webhook' },
      },
      {
        id: 'analyzer2', type: 'workflow', position: { x: 380, y: 340 },
        data: { label: 'Anomaly Detector', subtitle: 'Agent Logic', description: 'Flags mismatched amounts or missing counterparts.', tags: [{ text: 'LLM', purple: true }], icon: 'agent', isActive: true },
      },
      {
        id: 'alert', type: 'workflow', position: { x: 740, y: 220 },
        data: { label: 'Send Alert', subtitle: 'Notification', description: 'Posts to Discord and PagerDuty if anomaly detected.', tags: [{ text: 'Discord' }, { text: 'Slack' }], icon: 'email' },
      },
    ],
    edges: [
      { id: 'e1', source: 'listener', target: 'api', type: 'animated', data: { active: false } },
      { id: 'e2', source: 'listener', target: 'analyzer2', type: 'animated', data: { active: false } },
      { id: 'e3', source: 'api', target: 'alert', type: 'animated', data: { active: true } },
      { id: 'e4', source: 'analyzer2', target: 'alert', type: 'animated', data: { active: true } },
    ],
  },
]

/* ---- Canvas Component ---- */

const nodeTypes: NodeTypes = { workflow: WorkflowNode }
const edgeTypes: EdgeTypes = { animated: AnimatedEdge }

function CanvasInner({ preset }: { preset: WorkflowPreset }) {
  const [nodes, setNodes, onNodesChange] = useNodesState(preset.nodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(preset.edges)
  const { fitView } = useReactFlow()

  useEffect(() => {
    setNodes(preset.nodes)
    setEdges(preset.edges)
    // Wait for React Flow to process the new nodes before fitting
    setTimeout(() => fitView({ padding: 0.25, duration: 400 }), 50)
  }, [preset, setNodes, setEdges, fitView])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onDragOver={onDragOver}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.25 }}
      proOptions={{ hideAttribution: true }}
      minZoom={0.4}
      maxZoom={1.5}
      defaultEdgeOptions={{ type: 'animated' }}
    >
      <Background color="#2e2e2e" gap={20} size={1} />
    </ReactFlow>
  )
}

export default function WorkflowCanvas({ preset }: { preset: WorkflowPreset }) {
  return (
    <div className="app-canvas">
      <CanvasInner preset={preset} />
    </div>
  )
}

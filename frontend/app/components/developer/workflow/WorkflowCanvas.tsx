import { useState, useCallback, useRef, useMemo } from 'react'
import ReactFlow, {
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  MarkerType,
} from 'reactflow'
import type {
  Node,
  Edge,
  Connection,
  NodeChange,
  EdgeChange,
  ReactFlowInstance,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Save, Rocket, Loader2, ArrowLeft, Pencil, Check, Sparkles } from 'lucide-react'
import { Link } from '@tanstack/react-router'

import TriggerNode from './nodes/TriggerNode'
import ConditionNode from './nodes/ConditionNode'
import DestinationNode from './nodes/DestinationNode'
import NodePalette from './NodePalette'
import NodeConfigPanel from './NodeConfigPanel'
import { NODE_TYPE_MAP } from './nodeTypes'
import { compileWorkflow } from './compiler'
import { generateWorkflow } from './aiGenerate'
import {
  updateWorkflow,
  deployWorkflow,
  listEndpoints,
  createEndpoint,
  createSubscription,
} from '../../../lib/webhookApi'
import type { Endpoint } from '../../../lib/webhookApi'

// Register custom node types
const nodeTypes = {
  // Triggers
  trigger_ft_transfer: TriggerNode,
  trigger_nft_transfer: TriggerNode,
  trigger_account_event: TriggerNode,
  trigger_tx_sealed: TriggerNode,
  trigger_block_sealed: TriggerNode,
  trigger_evm_tx: TriggerNode,
  trigger_contract_event: TriggerNode,
  trigger_balance_change: TriggerNode,
  trigger_schedule: TriggerNode,
  // Conditions
  condition_if: ConditionNode,
  condition_filter: ConditionNode,
  // Destinations
  dest_webhook: DestinationNode,
  dest_slack: DestinationNode,
  dest_discord: DestinationNode,
  dest_telegram: DestinationNode,
  dest_email: DestinationNode,
}

interface WorkflowCanvasProps {
  workflowId: string
  initialName: string
  initialNodes: Node[]
  initialEdges: Edge[]
}

let nodeIdCounter = 0
function nextNodeId() {
  return `node_${++nodeIdCounter}_${Date.now()}`
}

export default function WorkflowCanvas({
  workflowId,
  initialName,
  initialNodes,
  initialEdges,
}: WorkflowCanvasProps) {
  const [nodes, setNodes] = useState<Node[]>(initialNodes)
  const [edges, setEdges] = useState<Edge[]>(initialEdges)
  const [name, setName] = useState(initialName)
  const [editingName, setEditingName] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [deployResult, setDeployResult] = useState<{
    ok: boolean
    message: string
  } | null>(null)

  // AI prompt bar
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  // Selected node for config panel
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const reactFlowRef = useRef<ReactFlowInstance | null>(null)

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId]
  )

  // --- ReactFlow callbacks ---

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds))
  }, [])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds))
  }, [])

  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) =>
      addEdge(
        {
          ...connection,
          animated: true,
          style: { stroke: '#525252', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#525252', width: 16, height: 16 },
        },
        eds
      )
    )
  }, [])

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id)
  }, [])

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null)
  }, [])

  // --- Add node ---

  const addNode = useCallback((nodeType: string) => {
    const meta = NODE_TYPE_MAP[nodeType]
    if (!meta) return

    const position = reactFlowRef.current
      ? reactFlowRef.current.project({
          x: 300 + Math.random() * 200,
          y: 150 + Math.random() * 200,
        })
      : { x: 300, y: 200 }

    const newNode: Node = {
      id: nextNodeId(),
      type: nodeType,
      position,
      data: { nodeType, config: {} },
    }

    setNodes((nds) => [...nds, newNode])
  }, [])

  // --- Drop handler (drag from palette) ---

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const nodeType = e.dataTransfer.getData('application/reactflow-node-type')
    if (!nodeType || !NODE_TYPE_MAP[nodeType]) return

    const position = reactFlowRef.current
      ? reactFlowRef.current.project({
          x: e.clientX - 250,
          y: e.clientY - 50,
        })
      : { x: e.clientX, y: e.clientY }

    const newNode: Node = {
      id: nextNodeId(),
      type: nodeType,
      position,
      data: { nodeType, config: {} },
    }

    setNodes((nds) => [...nds, newNode])
  }, [])

  // --- Config panel handlers ---

  const handleConfigChange = useCallback(
    (key: string, value: string) => {
      if (!selectedNodeId) return
      setNodes((nds) =>
        nds.map((n) =>
          n.id === selectedNodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  config: { ...n.data.config, [key]: value },
                },
              }
            : n
        )
      )
    },
    [selectedNodeId]
  )

  const handleDeleteNode = useCallback(() => {
    if (!selectedNodeId) return
    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId))
    setEdges((eds) =>
      eds.filter(
        (e) => e.source !== selectedNodeId && e.target !== selectedNodeId
      )
    )
    setSelectedNodeId(null)
  }, [selectedNodeId])

  // --- AI Generate ---

  const handleAIGenerate = useCallback(async () => {
    if (!aiPrompt.trim()) return
    setAiGenerating(true)
    setAiError(null)
    try {
      const result = await generateWorkflow(aiPrompt.trim(), nodes)
      if (nodes.length === 0) {
        // Empty canvas — replace
        setNodes(result.nodes)
        setEdges(result.edges)
      } else {
        // Smart merge — append
        setNodes((nds) => [...nds, ...result.nodes])
        setEdges((eds) => [...eds, ...result.edges])
      }
      if (result.name && name === 'Untitled Workflow') {
        setName(result.name)
      }
      setAiPrompt('')
      // Fit view after adding nodes
      setTimeout(() => reactFlowRef.current?.fitView({ padding: 0.2 }), 100)
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI generation failed')
    } finally {
      setAiGenerating(false)
    }
  }, [aiPrompt, nodes, name])

  // --- Save ---

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await updateWorkflow(workflowId, {
        name,
        canvas_json: { nodes, edges },
      })
    } catch (err) {
      console.error('Save failed:', err)
    } finally {
      setSaving(false)
    }
  }, [workflowId, name, nodes, edges])

  // --- Deploy ---

  const handleDeploy = useCallback(async () => {
    setDeploying(true)
    setDeployResult(null)
    try {
      // 1. Save canvas first
      await updateWorkflow(workflowId, {
        name,
        canvas_json: { nodes, edges },
      })

      // 2. Compile DAG
      const result = compileWorkflow(nodes, edges)
      if (result.errors.length > 0) {
        setDeployResult({ ok: false, message: result.errors.join('\n') })
        return
      }

      // 3. Get existing endpoints
      const existingEndpoints = await listEndpoints()

      // 4. For each compiled path, create endpoint + subscription
      let created = 0
      for (const path of result.paths) {
        // Find or create endpoint
        const destMeta = NODE_TYPE_MAP[path.destinationType]
        const endpointType = path.destinationType.replace('dest_', '') as
          | 'webhook'
          | 'discord'
          | 'slack'
          | 'telegram'
          | 'email'
        const url =
          path.destinationConfig.url ||
          path.destinationConfig.webhook_url ||
          `${endpointType}://${path.destinationConfig.chat_id || path.destinationConfig.to || 'default'}`

        let endpoint: Endpoint | undefined = existingEndpoints.find(
          (ep) => ep.url === url && ep.endpoint_type === endpointType
        )
        if (!endpoint) {
          endpoint = await createEndpoint(
            url,
            `${destMeta?.label ?? endpointType} (from workflow)`,
            endpointType,
            path.destinationConfig
          )
        }

        // Create subscription
        await createSubscription(endpoint.id, path.eventType, path.conditions)
        created++
      }

      // 5. Mark workflow as active
      await deployWorkflow(workflowId)

      setDeployResult({
        ok: true,
        message: `Deployed ${created} subscription${created !== 1 ? 's' : ''}`,
      })
    } catch (err) {
      setDeployResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Deploy failed',
      })
    } finally {
      setDeploying(false)
    }
  }, [workflowId, name, nodes, edges])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm shrink-0">
        <Link
          to="/developer/subscriptions"
          className="p-1.5 rounded-lg text-zinc-500 dark:text-neutral-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-neutral-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>

        {editingName ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setEditingName(false)
              }}
              className="px-2 py-1 bg-zinc-100 dark:bg-neutral-800 border border-zinc-300 dark:border-neutral-700 rounded text-sm text-zinc-900 dark:text-white focus:outline-none focus:border-[#00ef8b]/50"
            />
            <button
              onClick={() => setEditingName(false)}
              className="p-1 text-[#00ef8b]"
            >
              <Check className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditingName(true)}
            className="flex items-center gap-1.5 text-sm font-medium text-zinc-900 dark:text-white hover:text-[#00ef8b] transition-colors"
          >
            {name}
            <Pencil className="w-3 h-3 text-zinc-400 dark:text-neutral-500" />
          </button>
        )}

        <div className="flex-1" />

        {deployResult && (
          <span
            className={`text-xs px-2 py-1 rounded ${deployResult.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}
          >
            {deployResult.message}
          </span>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 dark:bg-neutral-800 border border-zinc-300 dark:border-neutral-700 text-zinc-600 dark:text-neutral-300 text-sm rounded-lg hover:bg-zinc-200 dark:hover:bg-neutral-700 transition-colors disabled:opacity-50"
        >
          {saving ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Save className="w-3.5 h-3.5" />
          )}
          Save
        </button>

        <button
          onClick={handleDeploy}
          disabled={deploying}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#00ef8b] text-black text-sm font-medium rounded-lg hover:bg-[#00ef8b]/90 transition-colors disabled:opacity-50"
        >
          {deploying ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Rocket className="w-3.5 h-3.5" />
          )}
          Deploy
        </button>
      </div>

      {/* AI Prompt Bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-200 dark:border-neutral-800 bg-zinc-50/80 dark:bg-neutral-900/50 shrink-0">
        <Sparkles className="w-4 h-4 text-[#00ef8b] shrink-0" />
        <input
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleAIGenerate()
            }
          }}
          placeholder="Describe your workflow... e.g. 'Alert me on Slack when 0x1234 receives FLOW'"
          disabled={aiGenerating}
          className="flex-1 px-3 py-1.5 bg-white dark:bg-neutral-800 border border-zinc-300 dark:border-neutral-700 rounded-lg text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-neutral-500 focus:outline-none focus:border-[#00ef8b]/50 focus:ring-1 focus:ring-[#00ef8b]/25 transition-colors disabled:opacity-50"
        />
        <button
          onClick={handleAIGenerate}
          disabled={aiGenerating || !aiPrompt.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#00ef8b] text-black text-sm font-medium rounded-lg hover:bg-[#00ef8b]/90 transition-colors disabled:opacity-50 shrink-0"
        >
          {aiGenerating ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          Build
        </button>
        {aiError && (
          <span className="text-xs text-red-500 dark:text-red-400 truncate max-w-[200px]" title={aiError}>
            {aiError}
          </span>
        )}
      </div>

      {/* Canvas area */}
      <div className="flex-1 flex min-h-0">
        <NodePalette onAddNode={addNode} />

        <div
          className="flex-1 min-w-0"
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onInit={(instance: ReactFlowInstance) => {
              reactFlowRef.current = instance
            }}
            nodeTypes={nodeTypes}
            fitView
            snapToGrid
            snapGrid={[16, 16]}
            deleteKeyCode={['Backspace', 'Delete']}
            defaultEdgeOptions={{
              animated: true,
              style: { stroke: '#525252', strokeWidth: 2 },
              markerEnd: { type: MarkerType.ArrowClosed, color: '#525252', width: 16, height: 16 },
            }}
            className="bg-zinc-100 dark:bg-neutral-950"
          >
            <Background
              variant={BackgroundVariant.Dots}
              color="var(--rf-dots, #333)"
              gap={16}
              size={1}
              className="[--rf-dots:#ccc] dark:[--rf-dots:#333]"
            />
            <Controls className="!bg-white dark:!bg-neutral-800 !border-zinc-300 dark:!border-neutral-700 !rounded-lg [&>button]:!bg-white dark:[&>button]:!bg-neutral-800 [&>button]:!border-zinc-300 dark:[&>button]:!border-neutral-700 [&>button]:!text-zinc-500 dark:[&>button]:!text-neutral-400 [&>button:hover]:!bg-zinc-100 dark:[&>button:hover]:!bg-neutral-700" />
            <MiniMap
              nodeColor={(n: Node) => {
                const meta = NODE_TYPE_MAP[n.data?.nodeType]
                return meta?.color ?? '#525252'
              }}
              className="!bg-white dark:!bg-neutral-900 !border-zinc-300 dark:!border-neutral-800 !rounded-lg"
              maskColor="rgba(0,0,0,0.15)"
            />
          </ReactFlow>
        </div>

        <NodeConfigPanel
          selectedNodeId={selectedNodeId}
          nodeType={selectedNode?.data?.nodeType ?? null}
          config={selectedNode?.data?.config ?? {}}
          nodes={nodes}
          edges={edges}
          onConfigChange={handleConfigChange}
          onClose={() => setSelectedNodeId(null)}
          onDelete={handleDeleteNode}
        />
      </div>
    </div>
  )
}

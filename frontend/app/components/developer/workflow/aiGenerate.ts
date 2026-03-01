// ---------------------------------------------------------------------------
// AI Workflow Generator — calls backend /ai/workflow-generate which proxies
// to Anthropic. Keeps API key server-side.
// ---------------------------------------------------------------------------

import type { Node, Edge } from 'reactflow'
import { MarkerType } from 'reactflow'
import { ALL_NODE_TYPES, NODE_TYPE_MAP } from './nodeTypes'
import { resolveApiBaseUrl } from '../../../api'

// Build a compact schema description of all node types for the system prompt
function buildNodeCatalog(): string {
  const lines: string[] = []
  for (const n of ALL_NODE_TYPES) {
    const fields = n.configFields.map((f) => {
      let desc = `${f.key} (${f.type})`
      if (f.key === 'token_contract') {
        desc += ' [format: A.<address>.<ContractName>, e.g. A.1654653399040a61.FlowToken for FLOW, A.b19436aae4d94622.FiatToken for USDC]'
      } else if (f.key === 'collection') {
        desc += ' [format: A.<address>.<ContractName>, e.g. A.0b2a3299cc857e29.TopShot for NBA Top Shot]'
      } else if (f.key === 'contract_address' && f.type === 'searchable') {
        desc += ' [Flow contract identifier, e.g. A.1654653399040a61.FlowToken]'
      } else if (f.key === 'event_names') {
        desc += ' [comma-separated event names from the contract]'
      } else if (f.options) {
        const opts =
          typeof f.options[0] === 'string'
            ? (f.options as string[]).join('|')
            : (f.options as { value: string; label: string }[]).map((o) => o.value).join('|')
        desc += ` [${opts}]`
      }
      if (f.isArray) desc += ' (comma-separated)'
      return desc
    })
    lines.push(
      `- type: "${n.type}" | label: "${n.label}" | category: ${n.category}${n.eventType ? ` | eventType: "${n.eventType}"` : ''}${
        n.outputs === 2 ? ' | outputs: 2 (true/false)' : ''
      }\n  config: ${fields.length ? fields.join(', ') : '(none)'}`
    )
  }
  return lines.join('\n')
}

const SYSTEM_PROMPT = `You are a workflow builder assistant for FlowIndex, a Flow blockchain explorer.
Your job is to convert natural language workflow descriptions into a structured JSON workflow.

## Available Node Types
${buildNodeCatalog()}

## Rules
- Each node needs a unique id (node_1, node_2, etc.)
- Triggers have no incoming edges; destinations have no outgoing edges.
- IF condition nodes have two output handles: use sourceHandle "true" or "false" in edges.
- Filter nodes pass matching events through and drop non-matching ones.
- Fill config fields based on user intent. Leave blank if not specified.
- For Flow addresses, use the format "0x..." (e.g., "0x1654653399040a61").
- For FT tokens, use the contract identifier (e.g., "A.1654653399040a61.FlowToken").
- If the user says "FLOW", use token_contract: "A.1654653399040a61.FlowToken".
- If the user says "USDC", use token_contract: "A.b19436aae4d94622.FiatToken".
- Keep workflows simple — don't add unnecessary condition nodes unless asked.
- The "name" field should be a 2-5 word description of the workflow.
- For destination nodes, populate the message_template field with a useful default using {{variable}} placeholders from the trigger's output schema.

## Smart Merge
If the user says "add" or "also" or "connect to existing", the intent is to ADD nodes to an existing workflow.
If existing_nodes is provided, create new nodes that connect to the existing ones via edges.
Otherwise, create a complete standalone workflow.

## Examples

User: "Alert me on Slack when address 0x1234 receives FLOW"
{
  "nodes": [
    { "id": "node_1", "type": "trigger_ft_transfer", "data": { "nodeType": "trigger_ft_transfer", "config": { "addresses": "0x1234", "direction": "in", "token_contract": "A.1654653399040a61.FlowToken" } } },
    { "id": "node_2", "type": "dest_slack", "data": { "nodeType": "dest_slack", "config": { "webhook_url": "", "message_template": "💰 {{amount}} FLOW received by 0x1234 from {{from_address}} (tx: {{tx_id}})" } } }
  ],
  "edges": [{ "source": "node_1", "target": "node_2" }],
  "name": "FLOW Receive Alert"
}

User: "When any NFT is transferred from 0xabc, send to Discord if it's a TopShot, email me otherwise"
{
  "nodes": [
    { "id": "node_1", "type": "trigger_nft_transfer", "data": { "nodeType": "trigger_nft_transfer", "config": { "addresses": "0xabc", "direction": "out" } } },
    { "id": "node_2", "type": "condition_if", "data": { "nodeType": "condition_if", "config": { "field": "collection_name", "operator": "==", "value": "TopShot" } } },
    { "id": "node_3", "type": "dest_discord", "data": { "nodeType": "dest_discord", "config": { "webhook_url": "", "message_template": "🖼️ TopShot NFT #{{nft_id}} transferred from {{from_address}} to {{to_address}}" } } },
    { "id": "node_4", "type": "dest_email", "data": { "nodeType": "dest_email", "config": { "to": "", "subject": "NFT Transfer Alert", "message_template": "NFT #{{nft_id}} from collection {{collection_name}} was transferred from {{from_address}} to {{to_address}} in tx {{tx_id}}" } } }
  ],
  "edges": [
    { "source": "node_1", "target": "node_2" },
    { "source": "node_2", "target": "node_3", "sourceHandle": "true" },
    { "source": "node_2", "target": "node_4", "sourceHandle": "false" }
  ],
  "name": "NFT Transfer Router"
}`

interface AIWorkflowResult {
  nodes: Array<{
    id: string
    type: string
    data: { nodeType: string; config: Record<string, string> }
  }>
  edges: Array<{
    source: string
    target: string
    sourceHandle?: string
  }>
  name?: string
}

/**
 * Auto-layout nodes left-to-right using a simple topological sort.
 * Triggers at x=100, each subsequent layer +280, vertical spacing 130.
 */
function autoLayout(
  nodes: AIWorkflowResult['nodes'],
  edges: AIWorkflowResult['edges'],
  offsetX = 100,
  offsetY = 80,
): Node[] {
  // Build adjacency
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const n of nodes) {
    inDegree.set(n.id, 0)
    adj.set(n.id, [])
  }
  for (const e of edges) {
    adj.get(e.source)?.push(e.target)
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1)
  }

  // BFS layering
  const layers: string[][] = []
  const queue = nodes.filter((n) => (inDegree.get(n.id) ?? 0) === 0).map((n) => n.id)
  const visited = new Set<string>()
  let currentLayer = [...queue]

  while (currentLayer.length > 0) {
    layers.push(currentLayer)
    const nextLayer: string[] = []
    for (const id of currentLayer) {
      visited.add(id)
      for (const target of adj.get(id) ?? []) {
        if (!visited.has(target) && !nextLayer.includes(target)) {
          // Check all predecessors are visited
          const ready = edges
            .filter((e) => e.target === target)
            .every((e) => visited.has(e.source) || currentLayer.includes(e.source))
          if (ready) nextLayer.push(target)
        }
      }
    }
    currentLayer = nextLayer
  }

  // Handle any unvisited nodes (disconnected)
  for (const n of nodes) {
    if (!visited.has(n.id)) {
      layers.push([n.id])
      visited.add(n.id)
    }
  }

  // Assign positions
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const result: Node[] = []
  for (let layer = 0; layer < layers.length; layer++) {
    const ids = layers[layer]
    const layerHeight = ids.length * 130
    const startY = offsetY + (ids.length > 1 ? -layerHeight / 2 + 65 : 0)
    for (let i = 0; i < ids.length; i++) {
      const n = nodeMap.get(ids[i])!
      result.push({
        id: n.id,
        type: n.type,
        position: { x: offsetX + layer * 280, y: startY + i * 130 },
        data: n.data,
      })
    }
  }

  return result
}

/**
 * Generate workflow nodes + edges from a natural language description.
 * Smart merge: if existingNodes is non-empty, AI will try to connect new nodes to them.
 */
export async function generateWorkflow(
  prompt: string,
  existingNodes: Node[] = [],
): Promise<{ nodes: Node[]; edges: Edge[]; name?: string }> {
  const userMessage = existingNodes.length > 0
    ? `Existing nodes on canvas:\n${JSON.stringify(
        existingNodes.map((n) => ({ id: n.id, type: n.type, data: n.data })),
        null,
        2,
      )}\n\nUser request: ${prompt}`
    : prompt

  const baseUrl = await resolveApiBaseUrl()

  const res = await fetch(`${baseUrl}/ai/workflow-generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_prompt: SYSTEM_PROMPT,
      user_message: userMessage,
    }),
  })

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    throw new Error((errBody as any)?.error || `AI request failed: ${res.status}`)
  }

  const parsed: AIWorkflowResult = await res.json()

  // Validate node types
  for (const n of parsed.nodes) {
    if (!NODE_TYPE_MAP[n.type]) {
      throw new Error(`Unknown node type: ${n.type}`)
    }
  }

  // Auto-layout new nodes
  const offsetX = existingNodes.length > 0
    ? Math.max(...existingNodes.map((n) => n.position.x)) + 300
    : 100
  const offsetY = existingNodes.length > 0
    ? Math.min(...existingNodes.map((n) => n.position.y))
    : 150

  const layoutedNodes = autoLayout(parsed.nodes, parsed.edges, offsetX, offsetY)

  // Build edges with styling
  const styledEdges: Edge[] = parsed.edges.map((e, i) => ({
    id: `ai_edge_${Date.now()}_${i}`,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    animated: true,
    style: { stroke: '#525252', strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#525252', width: 16, height: 16 },
  }))

  return { nodes: layoutedNodes, edges: styledEdges, name: parsed.name }
}

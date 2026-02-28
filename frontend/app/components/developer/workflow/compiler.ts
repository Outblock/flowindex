import type { Node, Edge } from 'reactflow'
import { NODE_TYPE_MAP } from './nodeTypes'

export interface CompiledPath {
  triggerNodeId: string
  eventType: string
  conditions: Record<string, unknown>
  destinationNodeId: string
  destinationType: string
  destinationConfig: Record<string, string>
}

export interface CompileResult {
  paths: CompiledPath[]
  errors: string[]
}

/**
 * Normalize trigger config values to match backend matcher expectations:
 * - "addresses" string → string[] (split on comma)
 * - "min_amount" string → number
 * - Other numeric-looking values stay as strings (backend handles them)
 */
function normalizeTriggerConfig(config: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined || value === '') continue
    if (key === 'addresses') {
      // Backend expects string array
      result[key] = value.split(',').map((s) => s.trim()).filter(Boolean)
    } else if (key === 'min_amount') {
      // Backend expects number
      const n = parseFloat(value)
      result[key] = isNaN(n) ? 0 : n
    } else {
      result[key] = value
    }
  }
  return result
}

/**
 * Walk the DAG from each trigger node to each reachable destination node.
 * Collect conditions from IF/Filter nodes along the way.
 * Returns a list of compiled paths ready to become subscriptions.
 */
export function compileWorkflow(nodes: Node[], edges: Edge[]): CompileResult {
  const errors: string[] = []
  const paths: CompiledPath[] = []

  // Build adjacency list
  const adj = new Map<string, { targetId: string; sourceHandle?: string | null }[]>()
  for (const edge of edges) {
    const list = adj.get(edge.source) || []
    list.push({ targetId: edge.target, sourceHandle: edge.sourceHandle })
    adj.set(edge.source, list)
  }

  // Find trigger nodes
  const triggerNodes = nodes.filter((n) => {
    const meta = NODE_TYPE_MAP[n.data?.nodeType]
    return meta?.category === 'trigger'
  })

  if (triggerNodes.length === 0) {
    errors.push('Workflow has no trigger nodes')
    return { paths, errors }
  }

  // DFS from each trigger
  for (const trigger of triggerNodes) {
    const meta = NODE_TYPE_MAP[trigger.data.nodeType]
    if (!meta?.eventType) continue

    const visited = new Set<string>()

    function dfs(nodeId: string, conditions: Record<string, unknown>) {
      if (visited.has(nodeId)) return
      visited.add(nodeId)

      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return

      const nodeMeta = NODE_TYPE_MAP[node.data?.nodeType]
      if (!nodeMeta) return

      // If destination, record path
      if (nodeMeta.category === 'destination') {
        paths.push({
          triggerNodeId: trigger.id,
          eventType: meta.eventType!,
          conditions: { ...conditions, ...normalizeTriggerConfig(trigger.data.config ?? {}) },
          destinationNodeId: node.id,
          destinationType: nodeMeta.type,
          destinationConfig: node.data.config ?? {},
        })
        return
      }

      // If condition, merge conditions
      const mergedConditions = { ...conditions }
      if (nodeMeta.category === 'condition') {
        const cfg = node.data.config ?? {}
        if (cfg.field && cfg.operator && cfg.value !== undefined) {
          mergedConditions[`${cfg.field}_${cfg.operator}`] = cfg.value
        }
      }

      // Continue DFS
      const neighbors = adj.get(nodeId) || []
      for (const neighbor of neighbors) {
        dfs(neighbor.targetId, mergedConditions)
      }

      visited.delete(nodeId) // Allow revisiting via different paths
    }

    dfs(trigger.id, {})
  }

  // Validate: check for orphan nodes (not connected)
  const connectedNodes = new Set<string>()
  for (const edge of edges) {
    connectedNodes.add(edge.source)
    connectedNodes.add(edge.target)
  }
  for (const node of nodes) {
    if (!connectedNodes.has(node.id)) {
      const nodeMeta = NODE_TYPE_MAP[node.data?.nodeType]
      errors.push(`"${nodeMeta?.label ?? node.id}" is not connected`)
    }
  }

  if (paths.length === 0 && errors.length === 0) {
    errors.push('No complete trigger → destination paths found')
  }

  return { paths, errors }
}

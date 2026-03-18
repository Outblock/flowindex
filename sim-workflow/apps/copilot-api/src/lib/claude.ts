import Anthropic from '@anthropic-ai/sdk'
import type { ToolSchema, ToolResult } from './types.js'
import { createSSEWriter } from './sse.js'
import { toolState } from './tool-state.js'
import { WORKFLOW_TOOL_NAMES } from './workflow-tools.js'
import { v4 as uuid } from 'uuid'

const anthropic = new Anthropic()

/** Subagent tool names — when Claude calls these, we emit subagent_start */
const SUBAGENT_TOOLS = new Set([
  'debug', 'edit', 'build', 'plan', 'test', 'deploy', 'auth',
  'research', 'knowledge', 'custom_tool', 'tour', 'info',
  'workflow', 'evaluate', 'superagent', 'discovery',
])

/** Respond tools — internal signals, not sent to frontend */
const RESPOND_TOOLS = new Set([
  'plan_respond', 'edit_respond', 'build_respond', 'debug_respond',
  'info_respond', 'research_respond', 'deploy_respond', 'superagent_respond',
  'discovery_respond', 'tour_respond', 'auth_respond', 'workflow_respond',
  'knowledge_respond', 'custom_tool_respond', 'test_respond',
])

/** Tools handled server-side (not forwarded to frontend) */
const SERVER_HANDLED_TOOLS = new Set(['search_available_tools', 'load_tool'])

interface StreamChatOptions {
  model: string
  system: string
  messages: Anthropic.MessageParam[]
  tools?: Anthropic.Tool[]
  maxTurns?: number
  onEvent?: (writer: ReturnType<typeof createSSEWriter>) => void
  subagentName?: string
  toolRegistry?: ToolRegistry
}

/** Valid JSON Schema types per draft 2020-12 */
const VALID_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object', 'null'])

/** Map of common non-standard types to valid JSON Schema types */
const TYPE_FIXES: Record<string, string> = {
  str: 'string',
  text: 'string',
  file: 'string',
  float: 'number',
  int: 'integer',
  bool: 'boolean',
  list: 'array',
  dict: 'object',
  map: 'object',
  any: 'string',
}

/**
 * Sanitize a JSON schema to be compatible with Claude's JSON Schema draft 2020-12.
 * Fixes non-standard types, removes invalid keywords, and handles nested schemas.
 */
function sanitizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {} }
  }

  const cleaned: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(schema)) {
    // Skip known-invalid or unsupported keywords
    if (['$schema', 'definitions', '$defs', 'id', '$id', 'examples',
         'default', 'title', '$comment', 'markdownDescription',
         'deprecationMessage', 'errorMessage']
        .includes(key) || key.startsWith('x-')) {
      continue
    }

    // Fix invalid type values
    if (key === 'type') {
      if (typeof value === 'string') {
        if (VALID_TYPES.has(value)) {
          cleaned[key] = value
        } else if (TYPE_FIXES[value]) {
          cleaned[key] = TYPE_FIXES[value]
        } else {
          cleaned[key] = 'string' // fallback
        }
      } else if (Array.isArray(value)) {
        // type arrays like ["string", "null"]
        cleaned[key] = value.map(v =>
          typeof v === 'string' ? (VALID_TYPES.has(v) ? v : (TYPE_FIXES[v] ?? 'string')) : v
        )
      } else {
        cleaned[key] = 'string'
      }
      continue
    }

    // Recursively sanitize nested objects
    if (key === 'properties' && value && typeof value === 'object') {
      const props: Record<string, unknown> = {}
      for (const [pk, pv] of Object.entries(value as Record<string, unknown>)) {
        if (pv && typeof pv === 'object') {
          props[pk] = sanitizeSchema(pv as Record<string, unknown>)
        } else {
          props[pk] = pv
        }
      }
      cleaned[key] = props
    } else if (key === 'items' && value && typeof value === 'object') {
      cleaned[key] = sanitizeSchema(value as Record<string, unknown>)
    } else if (key === 'anyOf' || key === 'oneOf' || key === 'allOf') {
      if (Array.isArray(value)) {
        cleaned[key] = value.map(v =>
          v && typeof v === 'object' ? sanitizeSchema(v as Record<string, unknown>) : v
        )
      }
    } else if (key === 'additionalProperties' && value && typeof value === 'object') {
      cleaned[key] = sanitizeSchema(value as Record<string, unknown>)
    } else {
      cleaned[key] = value
    }
  }

  // Ensure type is present
  if (!cleaned['type'] && !cleaned['anyOf'] && !cleaned['oneOf'] && !cleaned['allOf']) {
    cleaned['type'] = 'object'
  }

  return cleaned
}

/**
 * In-memory tool registry for the current request.
 * Claude discovers tools via search_available_tools, then calls them by name.
 * We hold the full schemas here so we can resolve on demand.
 */
export class ToolRegistry {
  private tools: Map<string, ToolSchema> = new Map()

  constructor(integrationTools: ToolSchema[]) {
    for (const t of integrationTools) {
      this.tools.set(t.name, t)
    }
    console.log(`[registry] Loaded ${this.tools.size} integration tools`)
  }

  /** Search tools by keyword (matches name or description) */
  search(query: string, limit = 20): Array<{ name: string; description: string }> {
    const q = query.toLowerCase()
    const results: Array<{ name: string; description: string }> = []

    for (const [name, tool] of this.tools) {
      if (results.length >= limit) break
      const desc = tool.description || ''
      if (name.toLowerCase().includes(q) || desc.toLowerCase().includes(q)) {
        results.push({ name, description: desc.slice(0, 120) })
      }
    }

    return results
  }

  /** Get a tool's full schema by name, sanitized for Claude */
  getToolForClaude(name: string): Anthropic.Tool | null {
    const t = this.tools.get(name)
    if (!t) return null

    try {
      const sanitized = sanitizeSchema(t.input_schema ?? { type: 'object', properties: {} })
      return {
        name: t.name,
        description: t.description || t.name,
        input_schema: sanitized as Anthropic.Tool.InputSchema,
      }
    } catch {
      return null
    }
  }

  /** List all tool names (for the system prompt summary) */
  listNames(): string[] {
    return Array.from(this.tools.keys())
  }

  get size() { return this.tools.size }
}

/**
 * Build the tool discovery tool that Claude uses to find integration tools.
 */
export function buildToolDiscoveryTool(): Anthropic.Tool {
  return {
    name: 'search_available_tools',
    description: 'Search for available integration tools by keyword. Returns tool names and descriptions. Use this to discover what tools are available before trying to use them.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search keyword (e.g., "gmail", "slack", "twitter", "image", "webhook")',
        },
      },
      required: ['query'],
    },
  }
}

/**
 * Build the tool loader — loads a specific tool's full schema so Claude can call it.
 */
export function buildLoadToolTool(): Anthropic.Tool {
  return {
    name: 'load_tool',
    description: 'Load a specific integration tool by name so you can use it. Call search_available_tools first to find the tool name, then load it here.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tool_name: {
          type: 'string',
          description: 'Exact tool name to load',
        },
      },
      required: ['tool_name'],
    },
  }
}

/**
 * Build subagent tool definitions for the main chat agent.
 */
export function buildSubagentTools(): Anthropic.Tool[] {
  return Array.from(SUBAGENT_TOOLS).map(name => ({
    name,
    description: `Delegate to the ${name} subagent for specialized ${name} tasks.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        task: {
          type: 'string',
          description: `Description of the ${name} task to perform`,
        },
      },
      required: ['task'],
    },
  }))
}

/**
 * Build respond tool definitions for subagents.
 */
export function buildRespondTool(agentId: string): Anthropic.Tool {
  const respondName = `${agentId}_respond`
  return {
    name: respondName,
    description: `Signal that the ${agentId} task is complete. Call this when you have finished the work.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        result: {
          type: 'string',
          description: 'Summary of what was accomplished',
        },
        success: {
          type: 'boolean',
          description: 'Whether the task was completed successfully',
        },
      },
      required: ['result'],
    },
  }
}

/**
 * Stream a Claude conversation with tool call loop.
 *
 * This is the core function that:
 * 1. Calls Claude with streaming
 * 2. Emits SSE events for text, thinking, tool calls
 * 3. Waits for tool results via mark-complete
 * 4. Feeds results back to Claude
 * 5. Repeats until end_turn or max turns
 */
export async function streamChat(
  writer: ReturnType<typeof createSSEWriter>,
  options: StreamChatOptions,
): Promise<void> {
  const { model, system, messages, tools, maxTurns = 10, subagentName, toolRegistry } = options
  // Track dynamically loaded tools so Claude can call them
  const dynamicTools: Map<string, Anthropic.Tool> = new Map()
  const conversationMessages = [...messages]
  let turn = 0

  while (turn < maxTurns) {
    turn++

    const useThinking = model.includes('opus')
    const maxTokens = useThinking ? 16000 : 8192

    // Merge base tools + any dynamically loaded tools
    const allTools = [
      ...(tools ?? []),
      ...Array.from(dynamicTools.values()),
    ]

    const response = anthropic.messages.stream({
      model,
      system,
      messages: conversationMessages,
      max_tokens: maxTokens,
      ...(allTools.length ? { tools: allTools } : {}),
      ...(useThinking ? {
        thinking: { type: 'enabled' as const, budget_tokens: 10000 },
      } : {}),
    })

    const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = []
    let hasText = false
    let inThinking = false

    // Process streaming events
    for await (const event of response) {
      if (event.type === 'content_block_start') {
        const block = event.content_block
        if (block.type === 'thinking') {
          inThinking = true
          writer.write({
            type: 'reasoning',
            phase: 'start',
            ...(subagentName ? { subagent: subagentName } : {}),
          })
        } else if (block.type === 'text') {
          // If we were in thinking, close it first
          if (inThinking) {
            inThinking = false
            writer.write({
              type: 'reasoning',
              phase: 'end',
              ...(subagentName ? { subagent: subagentName } : {}),
            })
          }
        }
      } else if (event.type === 'content_block_stop') {
        // If a thinking block just ended, close it
        if (inThinking) {
          inThinking = false
          writer.write({
            type: 'reasoning',
            phase: 'end',
            ...(subagentName ? { subagent: subagentName } : {}),
          })
        }
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta
        if (delta.type === 'text_delta') {
          hasText = true
          writer.write({
            type: 'content',
            data: delta.text,
            ...(subagentName ? { subagent: subagentName } : {}),
          })
        } else if (delta.type === 'thinking_delta') {
          writer.write({
            type: 'reasoning',
            content: delta.thinking,
            phase: 'thinking',
            ...(subagentName ? { subagent: subagentName } : {}),
          })
        } else if (delta.type === 'input_json_delta') {
          // Part of tool call input — handled by finalMessage
        }
      }
    }

    // Get the final message to extract tool calls
    const finalMessage = await response.finalMessage()

    // Collect tool use blocks
    for (const block of finalMessage.content) {
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        })
      }
    }

    // If no tool calls, we're done
    if (toolCalls.length === 0 || finalMessage.stop_reason === 'end_turn') {
      if (toolCalls.length === 0) break
    }

    // Process tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = []

    for (const tc of toolCalls) {
      // Handle server-side tools (search_available_tools, load_tool)
      if (SERVER_HANDLED_TOOLS.has(tc.name) && toolRegistry) {
        if (tc.name === 'search_available_tools') {
          const query = (tc.input as { query: string }).query
          const results = toolRegistry.search(query)
          console.log(`[tools] search_available_tools query="${query}" → ${results.length} results`)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tc.id,
            content: JSON.stringify({
              tools: results,
              total: results.length,
              hint: 'Use load_tool with the exact tool name to get its full schema and be able to call it.',
            }),
          })
          continue
        }

        if (tc.name === 'load_tool') {
          const toolName = (tc.input as { tool_name: string }).tool_name
          const loaded = toolRegistry.getToolForClaude(toolName)
          if (loaded) {
            dynamicTools.set(toolName, loaded)
            console.log(`[tools] load_tool "${toolName}" → loaded (schema: ${JSON.stringify(loaded.input_schema).length} chars)`)
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tc.id,
              content: JSON.stringify({
                loaded: true,
                tool: { name: loaded.name, description: loaded.description },
                hint: `Tool "${toolName}" is now available. You can call it directly by name.`,
              }),
            })
          } else {
            console.log(`[tools] load_tool "${toolName}" → not found`)
            toolResults.push({
              type: 'tool_result',
              tool_use_id: tc.id,
              content: JSON.stringify({ loaded: false, error: `Tool "${toolName}" not found. Use search_available_tools first.` }),
            })
          }
          continue
        }
      }

      // Check if it's a respond tool (internal signal)
      if (RESPOND_TOOLS.has(tc.name)) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: JSON.stringify({ acknowledged: true }),
        })
        // Respond tool means subagent is done — break after processing
        continue
      }

      // Subagent tool — run internally, stream results on same SSE connection
      if (SUBAGENT_TOOLS.has(tc.name)) {
        const agentId = tc.name
        const task = (tc.input as { task?: string }).task ?? JSON.stringify(tc.input)

        console.log(`[subagent] Running "${agentId}" internally: "${task.slice(0, 80)}..."`)
        writer.write({ type: 'subagent_start', subagent: agentId, toolCallId: tc.id })

        try {
          // Import agent config dynamically to avoid circular deps
          const { getAgentConfig, getAgentTools: getAgentToolDefs } = await import('../agents/index.js')
          const agentConfig = getAgentConfig(agentId)

          if (!agentConfig) {
            throw new Error(`Unknown subagent: ${agentId}`)
          }

          // Run the subagent as an inner streamChat call
          // It writes to the same SSE writer with subagent prefix
          await streamChat(writer, {
            model,
            system: agentConfig.system,
            messages: [{ role: 'user', content: task }],
            tools: getAgentToolDefs(agentId),
            maxTurns: 8,
            subagentName: agentId,
          })

          writer.write({ type: 'subagent_end', subagent: agentId })

          toolResults.push({
            type: 'tool_result',
            tool_use_id: tc.id,
            content: JSON.stringify({ success: true, message: `Subagent ${agentId} completed.` }),
          })
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Subagent failed'
          console.error(`[subagent] "${agentId}" error:`, errorMsg)
          writer.write({ type: 'subagent_end', subagent: agentId })
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tc.id,
            content: JSON.stringify({ error: errorMsg }),
            is_error: true,
          })
        }
        continue
      }

      // Regular tool call (workflow tool, integration tool, etc.)
      // Format: data.data = { id, name, arguments } — matches what sim-workflow server-side handler expects
      console.log(`[tool_call] ${tc.name} id=${tc.id}`)
      writer.write({
        type: 'tool_call',
        toolCallId: tc.id,
        toolName: tc.name,
        data: { id: tc.id, name: tc.name, arguments: tc.input },
        ...(subagentName ? { subagent: subagentName } : {}),
      })

      // Wait for mark-complete from frontend
      try {
        const result = await toolState.waitForResult(tc.id, tc.name)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: typeof result.output === 'string'
            ? result.output
            : JSON.stringify(result.output ?? { success: result.success }),
        })
        writer.write({
          type: 'tool_result',
          toolCallId: tc.id,
          success: result.success,
          result: result.output,
          ...(subagentName ? { subagent: subagentName } : {}),
        })
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Tool execution failed'
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: JSON.stringify({ error: errorMsg }),
          is_error: true,
        })
        writer.write({
          type: 'tool_error',
          toolCallId: tc.id,
          error: errorMsg,
          ...(subagentName ? { subagent: subagentName } : {}),
        })
      }
    }

    // If a respond tool was called, we're done
    if (toolCalls.some(tc => RESPOND_TOOLS.has(tc.name))) {
      break
    }

    // Add assistant message + tool results to conversation for next turn
    conversationMessages.push({
      role: 'assistant',
      content: finalMessage.content,
    })
    conversationMessages.push({
      role: 'user',
      content: toolResults,
    })

    // If stop_reason is end_turn (even with tool calls), we're done
    if (finalMessage.stop_reason === 'end_turn') break
  }
}

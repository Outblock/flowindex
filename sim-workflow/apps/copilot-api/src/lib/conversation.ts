import type Anthropic from '@anthropic-ai/sdk'
import type { ChatRequest, ConversationMessage } from './types.js'

/**
 * Convert the sim-workflow conversation history into Claude Messages API format.
 */
export function buildMessages(req: ChatRequest): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = []

  // Add conversation history if present
  if (req.conversationHistory?.length) {
    for (const msg of req.conversationHistory) {
      if (msg.role === 'user') {
        messages.push({ role: 'user', content: msg.content })
      } else if (msg.role === 'assistant') {
        // Reconstruct assistant message with any tool calls
        const blocks: Anthropic.ContentBlockParam[] = []
        if (msg.content) {
          blocks.push({ type: 'text', text: msg.content })
        }
        if (msg.tool_calls?.length) {
          for (const tc of msg.tool_calls) {
            blocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.arguments ?? {},
            })
          }
        }
        if (blocks.length > 0) {
          messages.push({ role: 'assistant', content: blocks })
        }

        // If there were tool results, add them as user messages
        if (msg.tool_results?.length) {
          const resultBlocks: Anthropic.ToolResultBlockParam[] = msg.tool_results.map(tr => ({
            type: 'tool_result' as const,
            tool_use_id: tr.tool_call_id,
            content: typeof tr.output === 'string' ? tr.output : JSON.stringify(tr.output),
          }))
          messages.push({ role: 'user', content: resultBlocks })
        }
      }
    }
  }

  // Add the current user message
  messages.push({ role: 'user', content: req.message })

  return messages
}

/**
 * Build context string from request contexts.
 */
export function buildContextString(req: ChatRequest): string {
  if (!req.context?.length) return ''

  const parts: string[] = []
  for (const ctx of req.context) {
    parts.push(`## ${ctx.type}\n${ctx.content}`)
  }
  return '\n\n' + parts.join('\n\n')
}

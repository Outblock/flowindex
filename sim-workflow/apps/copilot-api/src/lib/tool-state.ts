import type { ToolResult } from './types.js'

interface PendingTool {
  resolve: (result: ToolResult) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
  toolName: string
  createdAt: number
}

/** Default timeout for tool execution: 5 minutes */
const TOOL_TIMEOUT_MS = 300_000

/**
 * In-memory store for pending tool calls.
 *
 * When Claude requests a tool call, we create a Promise and store it here.
 * When the frontend calls mark-complete, we resolve the Promise.
 */
class ToolStateManager {
  private pending = new Map<string, PendingTool>()

  /**
   * Wait for a tool result. Returns a Promise that resolves when
   * mark-complete is called for this toolCallId.
   */
  waitForResult(toolCallId: string, toolName: string): Promise<ToolResult> {
    return new Promise<ToolResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(toolCallId)
        reject(new Error(`Tool ${toolName} (${toolCallId}) timed out after ${TOOL_TIMEOUT_MS}ms`))
      }, TOOL_TIMEOUT_MS)

      this.pending.set(toolCallId, {
        resolve,
        reject,
        timeout,
        toolName,
        createdAt: Date.now(),
      })
    })
  }

  /**
   * Mark a tool call as complete. Resolves the waiting Promise.
   */
  complete(toolCallId: string, status: number, data?: unknown, message?: unknown): boolean {
    const entry = this.pending.get(toolCallId)
    if (!entry) return false

    clearTimeout(entry.timeout)
    this.pending.delete(toolCallId)

    const success = status === 200
    entry.resolve({
      success,
      output: data ?? message,
      error: !success ? (typeof message === 'string' ? message : 'Tool execution failed') : undefined,
    })
    return true
  }

  /**
   * Cancel a pending tool (e.g., on stream abort).
   */
  cancel(toolCallId: string, reason?: string) {
    const entry = this.pending.get(toolCallId)
    if (!entry) return
    clearTimeout(entry.timeout)
    this.pending.delete(toolCallId)
    entry.reject(new Error(reason ?? 'Tool call cancelled'))
  }

  /**
   * Cancel all pending tools for cleanup.
   */
  cancelAll(reason?: string) {
    for (const [id] of this.pending) {
      this.cancel(id, reason)
    }
  }

  get size() {
    return this.pending.size
  }
}

export const toolState = new ToolStateManager()

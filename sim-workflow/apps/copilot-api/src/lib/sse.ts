import type { SSEEvent } from './types.js'

/**
 * Format an SSE event object as a `data: {...}\n\n` line.
 */
export function formatSSE(event: SSEEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

/**
 * Create an SSE-compatible ReadableStream writer helper.
 */
export function createSSEWriter(controller: ReadableStreamDefaultController<Uint8Array>) {
  const encoder = new TextEncoder()

  return {
    write(event: SSEEvent) {
      controller.enqueue(encoder.encode(formatSSE(event)))
    },
    writeDone() {
      controller.enqueue(encoder.encode(formatSSE({ type: 'done' })))
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
    },
    writeError(error: string) {
      controller.enqueue(encoder.encode(formatSSE({ type: 'error', error })))
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
    },
    close() {
      try { controller.close() } catch { /* already closed */ }
    },
  }
}

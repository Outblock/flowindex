import type { ToolConfig } from '@/tools/types'
import type { FlowDecodeEventParams } from '@/tools/flow/types'

export interface FlowDecodeEventResponse {
  success: boolean
  output: {
    content: string
    eventType: string
    fields: Record<string, unknown>
  }
}

export const flowDecodeEventTool: ToolConfig<FlowDecodeEventParams, FlowDecodeEventResponse> = {
  id: 'flow_decode_event',
  name: 'Flow Decode Event',
  description: 'Parse a Cadence event JSON string into structured fields',
  version: '1.0.0',

  params: {
    eventData: {
      type: 'string',
      required: true,
      description: 'Cadence event JSON string',
    },
  },

  request: {
    url: '/api/tools/flow/decode-event',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({ eventData: params.eventData }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'Failed to decode event', eventType: '', fields: {} },
        error: data.error,
      } as FlowDecodeEventResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Decoded event summary' },
    eventType: { type: 'string', description: 'Event type identifier' },
    fields: { type: 'json', description: 'Parsed event fields' },
  },
}

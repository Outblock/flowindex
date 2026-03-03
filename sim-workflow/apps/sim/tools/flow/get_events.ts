import type { ToolConfig } from '@/tools/types'
import type { FlowGetEventsParams } from '@/tools/flow/types'

export interface FlowGetEventsResponse {
  success: boolean
  output: {
    content: string
    events: Array<Record<string, unknown>>
    count: string
  }
}

export const flowGetEventsTool: ToolConfig<FlowGetEventsParams, FlowGetEventsResponse> = {
  id: 'flow_get_events',
  name: 'Flow Get Events',
  description: 'Search Flow events by type and block range',
  version: '1.0.0',

  params: {
    eventType: {
      type: 'string',
      required: true,
      description: 'Event type (e.g. A.1654653399040a61.FlowToken.TokensDeposited)',
    },
    startHeight: {
      type: 'string',
      required: false,
      description: 'Start block height',
    },
    endHeight: {
      type: 'string',
      required: false,
      description: 'End block height',
    },
    limit: {
      type: 'string',
      required: false,
      description: 'Max results (default 100)',
    },
  },

  request: {
    url: '/api/tools/flow/get-events',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      eventType: params.eventType,
      startHeight: params.startHeight,
      endHeight: params.endHeight,
      limit: params.limit,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'Failed to get events' },
        error: data.error,
      } as FlowGetEventsResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Events summary' },
    events: { type: 'array', description: 'Event records' },
    count: { type: 'string', description: 'Number of events returned' },
  },
}

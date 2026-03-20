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
  name: 'Flow Search Events',
  description: 'Search Flow event types by name pattern (e.g. "TokensDeposited", "FlowToken")',
  version: '1.1.0',

  params: {
    eventType: {
      type: 'string',
      required: true,
      description: 'Event name or pattern to search (e.g. TokensDeposited, FlowToken)',
    },
    limit: {
      type: 'string',
      required: false,
      description: 'Max results (default 20)',
    },
  },

  request: {
    url: '/api/tools/flow/get-events',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      eventType: params.eventType,
      limit: params.limit,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'Failed to search events' },
        error: data.error,
      } as unknown as FlowGetEventsResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Search results summary' },
    events: { type: 'array', description: 'Matching event types with occurrence counts' },
    count: { type: 'string', description: 'Number of event types found' },
  },
}

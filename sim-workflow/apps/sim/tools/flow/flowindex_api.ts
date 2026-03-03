import type { ToolConfig } from '@/tools/types'
import type { FlowFlowIndexApiParams } from '@/tools/flow/types'

export interface FlowFlowIndexApiResponse {
  success: boolean
  output: {
    content: string
    data: unknown
  }
}

export const flowFlowIndexApiTool: ToolConfig<FlowFlowIndexApiParams, FlowFlowIndexApiResponse> = {
  id: 'flow_flowindex_api',
  name: 'Flow FlowIndex API',
  description: 'Generic FlowIndex API query',
  version: '1.0.0',

  params: {
    endpoint: {
      type: 'string',
      required: true,
      description: 'API endpoint path (e.g. /flow/v1/blocks)',
    },
    method: {
      type: 'string',
      required: false,
      description: 'HTTP method: GET or POST (default: GET)',
    },
    body: {
      type: 'string',
      required: false,
      description: 'Request body (JSON string)',
    },
  },

  request: {
    url: '/api/tools/flow/flowindex-api',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      endpoint: params.endpoint,
      method: params.method ?? 'GET',
      body: params.body,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'FlowIndex API request failed', data: null },
        error: data.error,
      } as FlowFlowIndexApiResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'API response summary' },
    data: { type: 'json', description: 'Full API response' },
  },
}

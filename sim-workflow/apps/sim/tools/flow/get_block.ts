import type { ToolConfig } from '@/tools/types'
import type { FlowGetBlockParams } from '@/tools/flow/types'

export interface FlowGetBlockResponse {
  success: boolean
  output: {
    content: string
    height: string
    id: string
    parentId: string
    timestamp: string
    transactionCount: string
  }
}

export const flowGetBlockTool: ToolConfig<FlowGetBlockParams, FlowGetBlockResponse> = {
  id: 'flow_get_block',
  name: 'Flow Get Block',
  description: 'Get Flow block by height or ID',
  version: '1.0.0',

  params: {
    height: {
      type: 'string',
      required: false,
      description: 'Block height',
    },
    id: {
      type: 'string',
      required: false,
      description: 'Block ID',
    },
  },

  request: {
    url: '/api/tools/flow/get-block',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({ height: params.height, id: params.id }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'Failed to get block' },
        error: data.error,
      } as FlowGetBlockResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Block summary' },
    height: { type: 'string', description: 'Block height' },
    id: { type: 'string', description: 'Block ID' },
    parentId: { type: 'string', description: 'Parent block ID' },
    timestamp: { type: 'string', description: 'Block timestamp' },
    transactionCount: { type: 'string', description: 'Transaction count' },
  },
}

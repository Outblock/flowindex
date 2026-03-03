import type { ToolConfig } from '@/tools/types'
import type { FlowEncodeArgumentsParams } from '@/tools/flow/types'

export interface FlowEncodeArgumentsResponse {
  success: boolean
  output: {
    content: string
    encoded: Array<{ type: string; value: string }>
  }
}

export const flowEncodeArgumentsTool: ToolConfig<
  FlowEncodeArgumentsParams,
  FlowEncodeArgumentsResponse
> = {
  id: 'flow_encode_arguments',
  name: 'Flow Encode Arguments',
  description: 'Convert JSON values to FCL argument format',
  version: '1.0.0',

  params: {
    arguments: {
      type: 'string',
      required: true,
      description: 'JSON array of argument values',
    },
    types: {
      type: 'string',
      required: true,
      description: 'JSON array of Cadence type names (e.g. ["UFix64", "Address"])',
    },
  },

  request: {
    url: '/api/tools/flow/encode-arguments',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      arguments: params.arguments,
      types: params.types,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'Failed to encode arguments', encoded: [] },
        error: data.error,
      } as FlowEncodeArgumentsResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Encoded arguments summary' },
    encoded: { type: 'json', description: 'FCL-formatted arguments' },
  },
}

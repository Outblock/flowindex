import type { ToolConfig } from '@/tools/types'
import type { FlowResolveNameParams } from '@/tools/flow/types'

export interface FlowResolveNameResponse {
  success: boolean
  output: {
    content: string
    name: string
    address: string
  }
}

export const flowResolveNameTool: ToolConfig<FlowResolveNameParams, FlowResolveNameResponse> = {
  id: 'flow_resolve_name',
  name: 'Flow Resolve Name',
  description: 'Resolve .find / .fn name to Flow address',
  version: '1.0.0',

  params: {
    name: {
      type: 'string',
      required: true,
      description: 'Name to resolve (e.g. dapper.find)',
    },
  },

  request: {
    url: '/api/tools/flow/resolve-name',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({ name: params.name }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'Failed to resolve name' },
        error: data.error,
      } as FlowResolveNameResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Resolution summary' },
    name: { type: 'string', description: 'Input name' },
    address: { type: 'string', description: 'Resolved Flow address' },
  },
}

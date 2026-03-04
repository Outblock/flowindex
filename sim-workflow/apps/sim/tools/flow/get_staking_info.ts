import type { ToolConfig } from '@/tools/types'
import type { FlowGetStakingInfoParams } from '@/tools/flow/types'

export interface FlowGetStakingInfoResponse {
  success: boolean
  output: {
    content: string
    address: string
    delegations: Array<Record<string, unknown>>
  }
}

export const flowGetStakingInfoTool: ToolConfig<FlowGetStakingInfoParams, FlowGetStakingInfoResponse> = {
  id: 'flow_get_staking_info',
  name: 'Flow Get Staking Info',
  description: 'Get staking and delegation details for an account',
  version: '1.0.0',

  params: {
    address: {
      type: 'string',
      required: true,
      description: 'Flow address (with or without 0x prefix)',
    },
  },

  request: {
    url: '/api/tools/flow/get-staking-info',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({ address: params.address }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'Failed to get staking info' },
        error: data.error,
      } as unknown as FlowGetStakingInfoResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Staking summary' },
    address: { type: 'string', description: 'Flow address' },
    delegations: { type: 'array', description: 'Delegation records' },
  },
}

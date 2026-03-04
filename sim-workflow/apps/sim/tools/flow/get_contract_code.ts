import type { ToolConfig } from '@/tools/types'
import type { FlowGetContractCodeParams } from '@/tools/flow/types'

export interface FlowGetContractCodeResponse {
  success: boolean
  output: {
    content: string
    address: string
    contractName: string
    code: string
  }
}

export const flowGetContractCodeTool: ToolConfig<FlowGetContractCodeParams, FlowGetContractCodeResponse> = {
  id: 'flow_get_contract_code',
  name: 'Flow Get Contract Code',
  description: 'Get deployed contract source code',
  version: '1.0.0',

  params: {
    address: {
      type: 'string',
      required: true,
      description: 'Flow address (with or without 0x prefix)',
    },
    contractName: {
      type: 'string',
      required: true,
      description: 'Name of the deployed contract',
    },
  },

  request: {
    url: '/api/tools/flow/get-contract-code',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({ address: params.address, contractName: params.contractName }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'Failed to get contract code' },
        error: data.error,
      } as unknown as FlowGetContractCodeResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Contract summary' },
    address: { type: 'string', description: 'Flow address' },
    contractName: { type: 'string', description: 'Contract name' },
    code: { type: 'string', description: 'Cadence source code' },
  },
}

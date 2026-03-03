import type { ToolConfig } from '@/tools/types'
import type { FlowEvmCallParams } from '@/tools/flow/types'

export interface FlowEvmCallResponse {
  success: boolean
  output: {
    content: string
    result: string
  }
}

export const flowEvmCallTool: ToolConfig<FlowEvmCallParams, FlowEvmCallResponse> = {
  id: 'flow_evm_call',
  name: 'Flow EVM Call',
  description: 'Call an EVM contract on Flow (read-only)',
  version: '1.0.0',

  params: {
    to: {
      type: 'string',
      required: true,
      description: 'EVM contract address',
    },
    data: {
      type: 'string',
      required: true,
      description: 'Hex-encoded calldata',
    },
    value: {
      type: 'string',
      required: false,
      description: 'Value in wei (default: 0x0)',
    },
    network: {
      type: 'string',
      required: false,
      description: 'Flow network: mainnet or testnet (default: mainnet)',
    },
  },

  request: {
    url: '/api/tools/flow/evm-call',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      to: params.to,
      data: params.data,
      value: params.value ?? '0x0',
      network: params.network ?? 'mainnet',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'EVM call failed', result: '' },
        error: data.error,
      } as FlowEvmCallResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Call result summary' },
    result: { type: 'string', description: 'Hex-encoded return data' },
  },
}

import type { ToolConfig } from '@/tools/types'
import type { FlowMultiSignParams } from '@/tools/flow/types'

export interface FlowMultiSignResponse {
  success: boolean
  output: {
    content: string
    transactionId: string
    status: string
  }
}

export const flowMultiSignTool: ToolConfig<FlowMultiSignParams, FlowMultiSignResponse> = {
  id: 'flow_multi_sign',
  name: 'Flow Multi-Sign',
  description: 'Send a multi-signature transaction on Flow',
  version: '1.0.0',

  params: {
    script: {
      type: 'string',
      required: true,
      description: 'Cadence transaction script',
    },
    arguments: {
      type: 'string',
      required: false,
      description: 'JSON array of arguments (default: [])',
    },
    signers: {
      type: 'string',
      required: true,
      description: 'JSON array of {address, privateKey, keyIndex} signer objects',
    },
    network: {
      type: 'string',
      required: false,
      description: 'Flow network: mainnet or testnet (default: mainnet)',
    },
  },

  request: {
    url: '/api/tools/flow/multi-sign',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      script: params.script,
      arguments: params.arguments ?? '[]',
      signers: params.signers,
      network: params.network ?? 'mainnet',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: {
          content: data.error || 'Multi-sign transaction failed',
          transactionId: '',
          status: 'ERROR',
        },
        error: data.error,
      } as unknown as FlowMultiSignResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Transaction summary' },
    transactionId: { type: 'string', description: 'Flow transaction ID' },
    status: { type: 'string', description: 'Transaction status' },
  },
}

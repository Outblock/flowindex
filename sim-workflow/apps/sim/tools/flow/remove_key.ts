import type { ToolConfig } from '@/tools/types'
import type { FlowRemoveKeyParams } from '@/tools/flow/types'

export interface FlowRemoveKeyResponse {
  success: boolean
  output: {
    content: string
    transactionId: string
    status: string
  }
}

export const flowRemoveKeyTool: ToolConfig<FlowRemoveKeyParams, FlowRemoveKeyResponse> = {
  id: 'flow_remove_key',
  name: 'Flow Remove Key',
  description: 'Remove a key from a Flow account',
  version: '1.0.0',

  params: {
    keyIndex: {
      type: 'string',
      required: true,
      description: 'Index of the key to remove',
    },
    signerAddress: {
      type: 'string',
      required: true,
      description: 'Flow address of the signer',
    },
    signerPrivateKey: {
      type: 'string',
      required: true,
      description: 'Hex-encoded private key of the signer',
    },
    network: {
      type: 'string',
      required: false,
      description: 'Flow network: mainnet or testnet (default: mainnet)',
    },
  },

  request: {
    url: '/api/tools/flow/remove-key',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      keyIndex: params.keyIndex,
      signerAddress: params.signerAddress,
      signerPrivateKey: params.signerPrivateKey,
      network: params.network ?? 'mainnet',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'Failed to remove key', transactionId: '', status: 'ERROR' },
        error: data.error,
      } as FlowRemoveKeyResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Key removal summary' },
    transactionId: { type: 'string', description: 'Flow transaction ID' },
    status: { type: 'string', description: 'Transaction status' },
  },
}

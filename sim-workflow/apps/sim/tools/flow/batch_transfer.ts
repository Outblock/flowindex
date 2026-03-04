import type { ToolConfig } from '@/tools/types'
import type { FlowBatchTransferParams } from '@/tools/flow/types'

export interface FlowBatchTransferResponse {
  success: boolean
  output: {
    content: string
    transactionId: string
    status: string
  }
}

export const flowBatchTransferTool: ToolConfig<
  FlowBatchTransferParams,
  FlowBatchTransferResponse
> = {
  id: 'flow_batch_transfer',
  name: 'Flow Batch Transfer',
  description: 'Batch transfer FLOW to multiple recipients',
  version: '1.0.0',

  params: {
    recipients: {
      type: 'string',
      required: true,
      description: 'JSON array of {address, amount} objects',
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
    url: '/api/tools/flow/batch-transfer',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      recipients: params.recipients,
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
        output: {
          content: data.error || 'Batch transfer failed',
          transactionId: '',
          status: 'ERROR',
        },
        error: data.error,
      } as unknown as FlowBatchTransferResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Transaction summary' },
    transactionId: { type: 'string', description: 'Flow transaction ID' },
    status: { type: 'string', description: 'Transaction status' },
  },
}

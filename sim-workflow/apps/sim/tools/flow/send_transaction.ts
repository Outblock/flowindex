import type { ToolConfig } from '@/tools/types'
import type { FlowSendTransactionParams } from '@/tools/flow/types'

export interface FlowSendTransactionResponse {
  success: boolean
  output: {
    content: string
    transactionId: string
    status: string
  }
}

export const flowSendTransactionTool: ToolConfig<
  FlowSendTransactionParams,
  FlowSendTransactionResponse
> = {
  id: 'flow_send_transaction',
  name: 'Flow Send Transaction',
  description: 'Send a Cadence transaction to the Flow blockchain',
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
    signerAddress: {
      type: 'string',
      required: true,
      description: 'Flow address of the signer (with or without 0x prefix)',
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
    url: '/api/tools/flow/send-transaction',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      script: params.script,
      arguments: params.arguments ?? '[]',
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
        output: { content: data.error || 'Failed to send transaction', transactionId: '', status: 'ERROR' },
        error: data.error,
      } as FlowSendTransactionResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Transaction summary' },
    transactionId: { type: 'string', description: 'Flow transaction ID' },
    status: { type: 'string', description: 'Transaction status' },
  },
}

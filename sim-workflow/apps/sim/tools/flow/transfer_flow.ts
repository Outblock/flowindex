import type { ToolConfig } from '@/tools/types'
import type { FlowTransferFlowParams } from '@/tools/flow/types'

export interface FlowTransferFlowResponse {
  success: boolean
  output: {
    content: string
    transactionId: string
    status: string
  }
}

export const flowTransferFlowTool: ToolConfig<FlowTransferFlowParams, FlowTransferFlowResponse> = {
  id: 'flow_transfer_flow',
  name: 'Flow Transfer FLOW',
  description: 'Transfer FLOW tokens to another account',
  version: '1.0.0',

  params: {
    recipient: {
      type: 'string',
      required: true,
      description: 'Recipient Flow address',
    },
    amount: {
      type: 'string',
      required: true,
      description: 'Amount of FLOW to transfer',
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
    url: '/api/tools/flow/transfer-flow',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      recipient: params.recipient,
      amount: params.amount,
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
        output: { content: data.error || 'Failed to transfer FLOW', transactionId: '', status: 'ERROR' },
        error: data.error,
      } as unknown as FlowTransferFlowResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Transaction summary' },
    transactionId: { type: 'string', description: 'Flow transaction ID' },
    status: { type: 'string', description: 'Transaction status' },
  },
}

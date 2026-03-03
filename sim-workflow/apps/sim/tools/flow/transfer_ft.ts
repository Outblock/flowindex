import type { ToolConfig } from '@/tools/types'
import type { FlowTransferFtParams } from '@/tools/flow/types'

export interface FlowTransferFtResponse {
  success: boolean
  output: {
    content: string
    transactionId: string
    status: string
  }
}

export const flowTransferFtTool: ToolConfig<FlowTransferFtParams, FlowTransferFtResponse> = {
  id: 'flow_transfer_ft',
  name: 'Flow Transfer FT',
  description: 'Transfer fungible tokens on Flow',
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
      description: 'Amount to transfer',
    },
    vaultPath: {
      type: 'string',
      required: true,
      description: 'Storage path of the token vault (e.g. /storage/flowTokenVault)',
    },
    receiverPath: {
      type: 'string',
      required: true,
      description: 'Public path of the receiver (e.g. /public/flowTokenReceiver)',
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
    url: '/api/tools/flow/transfer-ft',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      recipient: params.recipient,
      amount: params.amount,
      vaultPath: params.vaultPath,
      receiverPath: params.receiverPath,
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
        output: { content: data.error || 'Failed to transfer tokens', transactionId: '', status: 'ERROR' },
        error: data.error,
      } as FlowTransferFtResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Transaction summary' },
    transactionId: { type: 'string', description: 'Flow transaction ID' },
    status: { type: 'string', description: 'Transaction status' },
  },
}

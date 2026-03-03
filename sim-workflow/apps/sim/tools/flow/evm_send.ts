import type { ToolConfig } from '@/tools/types'
import type { FlowEvmSendParams } from '@/tools/flow/types'

export interface FlowEvmSendResponse {
  success: boolean
  output: {
    content: string
    transactionId: string
    status: string
  }
}

export const flowEvmSendTool: ToolConfig<FlowEvmSendParams, FlowEvmSendResponse> = {
  id: 'flow_evm_send',
  name: 'Flow EVM Send',
  description: 'Send an EVM transaction on Flow via Cadence',
  version: '1.0.0',

  params: {
    to: {
      type: 'string',
      required: true,
      description: 'EVM destination address',
    },
    data: {
      type: 'string',
      required: false,
      description: 'Hex-encoded calldata',
    },
    value: {
      type: 'string',
      required: false,
      description: 'Value in wei (default: 0)',
    },
    gasLimit: {
      type: 'string',
      required: false,
      description: 'Gas limit (default: 300000)',
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
    url: '/api/tools/flow/evm-send',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      to: params.to,
      data: params.data ?? '',
      value: params.value ?? '0',
      gasLimit: params.gasLimit ?? '300000',
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
        output: { content: data.error || 'EVM transaction failed', transactionId: '', status: 'ERROR' },
        error: data.error,
      } as FlowEvmSendResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Transaction summary' },
    transactionId: { type: 'string', description: 'Flow transaction ID' },
    status: { type: 'string', description: 'Transaction status' },
  },
}

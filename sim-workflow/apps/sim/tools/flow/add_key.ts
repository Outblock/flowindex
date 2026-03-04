import type { ToolConfig } from '@/tools/types'
import type { FlowAddKeyParams } from '@/tools/flow/types'

export interface FlowAddKeyResponse {
  success: boolean
  output: {
    content: string
    transactionId: string
    status: string
  }
}

export const flowAddKeyTool: ToolConfig<FlowAddKeyParams, FlowAddKeyResponse> = {
  id: 'flow_add_key',
  name: 'Flow Add Key',
  description: 'Add a key to a Flow account',
  version: '1.0.0',

  params: {
    publicKey: {
      type: 'string',
      required: true,
      description: 'Hex-encoded public key to add',
    },
    sigAlgo: {
      type: 'string',
      required: false,
      description: 'Signature algorithm (default: ECDSA_P256)',
    },
    hashAlgo: {
      type: 'string',
      required: false,
      description: 'Hash algorithm (default: SHA3_256)',
    },
    weight: {
      type: 'string',
      required: false,
      description: 'Key weight (default: 1000)',
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
    url: '/api/tools/flow/add-key',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      publicKey: params.publicKey,
      sigAlgo: params.sigAlgo ?? 'ECDSA_P256',
      hashAlgo: params.hashAlgo ?? 'SHA3_256',
      weight: params.weight ?? '1000',
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
        output: { content: data.error || 'Failed to add key', transactionId: '', status: 'ERROR' },
        error: data.error,
      } as unknown as FlowAddKeyResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Key addition summary' },
    transactionId: { type: 'string', description: 'Flow transaction ID' },
    status: { type: 'string', description: 'Transaction status' },
  },
}

import type { ToolConfig } from '@/tools/types'
import type { FlowCreateAccountParams } from '@/tools/flow/types'

export interface FlowCreateAccountResponse {
  success: boolean
  output: {
    content: string
    transactionId: string
    address: string
    status: string
  }
}

export const flowCreateAccountTool: ToolConfig<
  FlowCreateAccountParams,
  FlowCreateAccountResponse
> = {
  id: 'flow_create_account',
  name: 'Flow Create Account',
  description: 'Create a new Flow account',
  version: '1.0.0',

  params: {
    publicKey: {
      type: 'string',
      required: true,
      description: 'Hex-encoded public key for the new account',
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
    signerAddress: {
      type: 'string',
      required: true,
      description: 'Payer Flow address',
    },
    signerPrivateKey: {
      type: 'string',
      required: true,
      description: 'Hex-encoded private key of the payer',
    },
    network: {
      type: 'string',
      required: false,
      description: 'Flow network: mainnet or testnet (default: mainnet)',
    },
  },

  request: {
    url: '/api/tools/flow/create-account',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      publicKey: params.publicKey,
      sigAlgo: params.sigAlgo ?? 'ECDSA_P256',
      hashAlgo: params.hashAlgo ?? 'SHA3_256',
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
          content: data.error || 'Failed to create account',
          transactionId: '',
          address: '',
          status: 'ERROR',
        },
        error: data.error,
      } as FlowCreateAccountResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Account creation summary' },
    transactionId: { type: 'string', description: 'Flow transaction ID' },
    address: { type: 'string', description: 'New account address' },
    status: { type: 'string', description: 'Transaction status' },
  },
}

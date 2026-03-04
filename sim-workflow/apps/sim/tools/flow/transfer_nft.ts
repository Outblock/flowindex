import type { ToolConfig } from '@/tools/types'
import type { FlowTransferNftParams } from '@/tools/flow/types'

export interface FlowTransferNftResponse {
  success: boolean
  output: {
    content: string
    transactionId: string
    status: string
  }
}

export const flowTransferNftTool: ToolConfig<FlowTransferNftParams, FlowTransferNftResponse> = {
  id: 'flow_transfer_nft',
  name: 'Flow Transfer NFT',
  description: 'Transfer an NFT on Flow',
  version: '1.0.0',

  params: {
    recipient: {
      type: 'string',
      required: true,
      description: 'Recipient Flow address',
    },
    nftId: {
      type: 'string',
      required: true,
      description: 'NFT ID to transfer',
    },
    collectionStoragePath: {
      type: 'string',
      required: true,
      description: 'Storage path of the NFT collection',
    },
    collectionPublicPath: {
      type: 'string',
      required: true,
      description: 'Public path of the NFT collection',
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
    url: '/api/tools/flow/transfer-nft',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      recipient: params.recipient,
      nftId: params.nftId,
      collectionStoragePath: params.collectionStoragePath,
      collectionPublicPath: params.collectionPublicPath,
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
        output: { content: data.error || 'Failed to transfer NFT', transactionId: '', status: 'ERROR' },
        error: data.error,
      } as unknown as FlowTransferNftResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Transaction summary' },
    transactionId: { type: 'string', description: 'Flow transaction ID' },
    status: { type: 'string', description: 'Transaction status' },
  },
}

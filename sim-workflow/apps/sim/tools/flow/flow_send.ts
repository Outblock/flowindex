import type { ToolConfig } from '@/tools/types'
import type { FlowSendParams } from '@/tools/flow/types'

export interface FlowSendResponse {
  success: boolean
  output: {
    content: string
    transactionId: string
    status: string
  }
}

export const flowSendTool: ToolConfig<FlowSendParams, FlowSendResponse> = {
  id: 'flow_send',
  name: 'Flow Send',
  description: 'Send tokens or NFTs on the Flow blockchain using a configured wallet signer',
  version: '1.0.0',

  params: {
    signer: {
      type: 'string',
      required: true,
      description: 'JSON-encoded signer configuration (mode, address, key ID, etc.)',
    },
    sendType: {
      type: 'string',
      required: true,
      description: 'Type of send: "token" or "nft"',
    },
    sender: {
      type: 'string',
      required: true,
      description: 'Sender address (Flow 16-hex or EVM 40-hex)',
    },
    receiver: {
      type: 'string',
      required: true,
      description: 'Receiver address (Flow 16-hex or EVM 40-hex)',
    },
    flowIdentifier: {
      type: 'string',
      required: true,
      description: 'Token/NFT identifier (e.g. A.1654653399040a61.FlowToken)',
    },
    amount: {
      type: 'string',
      required: false,
      description: 'Amount to send (required for token sends)',
    },
    nftIds: {
      type: 'string',
      required: false,
      description: 'Comma-separated NFT IDs to transfer (required for NFT sends)',
    },
    network: {
      type: 'string',
      required: false,
      description: 'Flow network: mainnet or testnet (default: mainnet)',
    },
  },

  request: {
    url: '/api/tools/flow/send',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      signer: params.signer,
      sendType: params.sendType,
      sender: params.sender,
      receiver: params.receiver,
      flowIdentifier: params.flowIdentifier,
      amount: params.amount,
      nftIds: params.nftIds,
      network: params.network ?? 'mainnet',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'Failed to send', transactionId: '', status: 'ERROR' },
        error: data.error,
      } as unknown as FlowSendResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Transaction summary' },
    transactionId: { type: 'string', description: 'Flow transaction ID' },
    status: { type: 'string', description: 'Transaction status' },
  },
}

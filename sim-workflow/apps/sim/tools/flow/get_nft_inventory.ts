import type { ToolConfig } from '@/tools/types'
import type { FlowGetNftInventoryParams } from '@/tools/flow/types'

export interface FlowGetNftInventoryResponse {
  success: boolean
  output: {
    content: string
    address: string
    collections: Array<Record<string, unknown>>
  }
}

export const flowGetNftInventoryTool: ToolConfig<FlowGetNftInventoryParams, FlowGetNftInventoryResponse> = {
  id: 'flow_get_nft_inventory',
  name: 'Flow Get NFT Inventory',
  description: 'Get all NFTs owned by an account',
  version: '1.0.0',

  params: {
    address: {
      type: 'string',
      required: true,
      description: 'Flow address (with or without 0x prefix)',
    },
  },

  request: {
    url: '/api/tools/flow/get-nft-inventory',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({ address: params.address }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!data.success) {
      return {
        success: false,
        output: { content: data.error || 'Failed to get NFT inventory' },
        error: data.error,
      } as unknown as FlowGetNftInventoryResponse
    }
    return { success: true, output: data.output }
  },

  outputs: {
    content: { type: 'string', description: 'Inventory summary' },
    address: { type: 'string', description: 'Flow address' },
    collections: { type: 'array', description: 'NFT collections' },
  },
}

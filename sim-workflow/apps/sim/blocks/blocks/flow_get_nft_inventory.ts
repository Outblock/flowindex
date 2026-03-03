import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowGetNftInventoryBlock: BlockConfig = {
  type: 'flow_get_nft_inventory',
  name: 'Flow Get NFT Inventory',
  description: 'Get all NFTs owned by an account',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'address',
      title: 'Address',
      type: 'short-input',
      placeholder: '0x1654653399040a61',
      required: true,
    },
  ],
  tools: {
    access: ['flow_get_nft_inventory'],
    config: {
      tool: () => 'flow_get_nft_inventory',
      params: (params) => ({ address: params.address }),
    },
  },
  inputs: {
    address: { type: 'string', description: 'Flow address' },
  },
  outputs: {
    content: { type: 'string', description: 'Inventory summary' },
    address: { type: 'string', description: 'Flow address' },
    collections: { type: 'array', description: 'NFT collections' },
  },
}

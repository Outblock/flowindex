import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowGetNftBlock: BlockConfig = {
  type: 'flow_get_nft',
  name: 'Flow Get NFT',
  description: 'Get NFT metadata and ownership details',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'nftType',
      title: 'NFT Type',
      type: 'short-input',
      placeholder: 'TopShot',
      required: true,
    },
    {
      id: 'nftId',
      title: 'NFT ID',
      type: 'short-input',
      placeholder: '12345',
      required: true,
    },
  ],
  tools: {
    access: ['flow_get_nft'],
    config: {
      tool: () => 'flow_get_nft',
      params: (params) => ({ nftType: params.nftType, nftId: params.nftId }),
    },
  },
  inputs: {
    nftType: { type: 'string', description: 'NFT collection type' },
    nftId: { type: 'string', description: 'NFT item ID' },
  },
  outputs: {
    content: { type: 'string', description: 'NFT summary' },
    nftType: { type: 'string', description: 'NFT collection type' },
    nftId: { type: 'string', description: 'NFT item ID' },
    metadata: { type: 'json', description: 'NFT metadata' },
  },
}

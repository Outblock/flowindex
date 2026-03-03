import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowGetFtHoldingsBlock: BlockConfig = {
  type: 'flow_get_ft_holdings',
  name: 'Flow Get FT Holdings',
  description: 'Get all fungible token holdings for an account',
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
    access: ['flow_get_ft_holdings'],
    config: {
      tool: () => 'flow_get_ft_holdings',
      params: (params) => ({ address: params.address }),
    },
  },
  inputs: {
    address: { type: 'string', description: 'Flow address' },
  },
  outputs: {
    content: { type: 'string', description: 'Holdings summary' },
    address: { type: 'string', description: 'Flow address' },
    holdings: { type: 'array', description: 'Token holdings' },
  },
}

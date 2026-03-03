import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowGetDefiPositionsBlock: BlockConfig = {
  type: 'flow_get_defi_positions',
  name: 'Flow Get DeFi Positions',
  description: 'Get DeFi positions (IncrementFi, etc.) for an account',
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
    access: ['flow_get_defi_positions'],
    config: {
      tool: () => 'flow_get_defi_positions',
      params: (params) => ({ address: params.address }),
    },
  },
  inputs: {
    address: { type: 'string', description: 'Flow address' },
  },
  outputs: {
    content: { type: 'string', description: 'DeFi positions summary' },
    address: { type: 'string', description: 'Flow address' },
    positions: { type: 'array', description: 'DeFi position records' },
  },
}

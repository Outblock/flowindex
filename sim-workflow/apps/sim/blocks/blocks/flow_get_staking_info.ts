import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowGetStakingInfoBlock: BlockConfig = {
  type: 'flow_get_staking_info',
  name: 'Flow Get Staking Info',
  description: 'Get staking and delegation details for an account',
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
    access: ['flow_get_staking_info'],
    config: {
      tool: () => 'flow_get_staking_info',
      params: (params) => ({ address: params.address }),
    },
  },
  inputs: {
    address: { type: 'string', description: 'Flow address' },
  },
  outputs: {
    content: { type: 'string', description: 'Staking summary' },
    address: { type: 'string', description: 'Flow address' },
    delegations: { type: 'array', description: 'Delegation records' },
  },
}

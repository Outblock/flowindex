import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowGetAccountBlock: BlockConfig = {
  type: 'flow_get_account',
  name: 'Flow Get Account',
  description: 'Get Flow account details including balance, keys, and contracts',
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
    access: ['flow_get_account'],
    config: {
      tool: () => 'flow_get_account',
      params: (params) => ({ address: params.address }),
    },
  },
  inputs: {
    address: { type: 'string', description: 'Flow address' },
  },
  outputs: {
    content: { type: 'string', description: 'Account summary' },
    address: { type: 'string', description: 'Flow address' },
    balance: { type: 'string', description: 'FLOW balance' },
    keys: { type: 'array', description: 'Account keys' },
    contracts: { type: 'array', description: 'Deployed contract names' },
  },
}

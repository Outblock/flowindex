import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowGetBalanceBlock: BlockConfig = {
  type: 'flow_get_balance',
  name: 'Flow Get Balance',
  description: 'Get Flow token balances for an account',
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
    {
      id: 'token',
      title: 'Token',
      type: 'short-input',
      placeholder: 'FLOW',
    },
  ],
  tools: {
    access: ['flow_get_balance'],
    config: {
      tool: () => 'flow_get_balance',
      params: (params) => ({ address: params.address, token: params.token }),
    },
  },
  inputs: {
    address: { type: 'string', description: 'Flow address' },
    token: { type: 'string', description: 'Token symbol filter' },
  },
  outputs: {
    content: { type: 'string', description: 'Balance summary' },
    address: { type: 'string', description: 'Flow address' },
    balances: { type: 'array', description: 'Token balances' },
  },
}

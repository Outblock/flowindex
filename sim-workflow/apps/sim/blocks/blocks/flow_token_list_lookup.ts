import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowTokenListLookupBlock: BlockConfig = {
  type: 'flow_token_list_lookup',
  name: 'Flow Token List Lookup',
  description: 'Look up token info from the FlowIndex token list',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'symbol',
      title: 'Token Symbol',
      type: 'short-input',
      placeholder: 'FLOW',
    },
    {
      id: 'address',
      title: 'Contract Address',
      type: 'short-input',
      placeholder: '0x1654653399040a61',
    },
  ],
  tools: {
    access: ['flow_token_list_lookup'],
    config: {
      tool: () => 'flow_token_list_lookup',
      params: (params) => ({ symbol: params.symbol, address: params.address }),
    },
  },
  inputs: {
    symbol: { type: 'string', description: 'Token symbol filter' },
    address: { type: 'string', description: 'Contract address filter' },
  },
  outputs: {
    content: { type: 'string', description: 'Token info summary' },
    tokens: { type: 'array', description: 'Matching tokens' },
  },
}

import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowGetTokenPriceBlock: BlockConfig = {
  type: 'flow_get_token_price',
  name: 'Flow Token Price',
  description: 'Get current token prices on Flow (FLOW, USDC, stFLOW, etc.)',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'symbol',
      title: 'Token Symbol',
      type: 'short-input',
      placeholder: 'FLOW (leave empty for all)',
    },
  ],
  tools: {
    access: ['flow_get_token_price'],
    config: {
      tool: () => 'flow_get_token_price',
      params: (params) => ({ symbol: params.symbol }),
    },
  },
  inputs: {
    symbol: { type: 'string', description: 'Token symbol (e.g. FLOW, USDC)' },
  },
  outputs: {
    content: { type: 'string', description: 'Price summary' },
    symbol: { type: 'string', description: 'Token symbol' },
    price: { type: 'string', description: 'Current USD price' },
    priceChange24h: { type: 'string', description: '24h price change %' },
    prices: { type: 'array', description: 'All price entries' },
  },
}

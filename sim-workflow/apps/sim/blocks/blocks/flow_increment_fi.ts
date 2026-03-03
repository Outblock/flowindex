import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowIncrementFiBlock: BlockConfig = {
  type: 'flow_increment_fi',
  name: 'Flow IncrementFi Quote',
  description: 'Get a swap quote from IncrementFi DEX',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'tokenIn',
      title: 'Token In',
      type: 'short-input',
      placeholder: 'A.1654653399040a61.FlowToken',
      required: true,
    },
    {
      id: 'tokenOut',
      title: 'Token Out',
      type: 'short-input',
      placeholder: 'A.3c5959b568896393.FUSD',
      required: true,
    },
    {
      id: 'amountIn',
      title: 'Amount In',
      type: 'short-input',
      placeholder: '10.0',
      required: true,
    },
  ],
  tools: {
    access: ['flow_increment_fi'],
    config: {
      tool: () => 'flow_increment_fi',
      params: (params) => ({
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountIn: params.amountIn,
      }),
    },
  },
  inputs: {
    tokenIn: { type: 'string', description: 'Input token identifier' },
    tokenOut: { type: 'string', description: 'Output token identifier' },
    amountIn: { type: 'string', description: 'Amount of input token' },
  },
  outputs: {
    content: { type: 'string', description: 'Swap quote summary' },
    quote: { type: 'json', description: 'Full quote data' },
  },
}

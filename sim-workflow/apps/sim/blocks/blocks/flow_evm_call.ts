import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowEvmCallBlock: BlockConfig = {
  type: 'flow_evm_call',
  name: 'Flow EVM Call',
  description: 'Call an EVM contract on Flow (read-only)',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'to',
      title: 'Contract Address',
      type: 'short-input',
      placeholder: '0x1234...abcd',
      required: true,
    },
    {
      id: 'data',
      title: 'Calldata (hex)',
      type: 'short-input',
      placeholder: '0x70a08231000000000000000000000000...',
      required: true,
    },
    {
      id: 'value',
      title: 'Value (wei)',
      type: 'short-input',
      placeholder: '0',
    },
    {
      id: 'network',
      title: 'Network',
      type: 'dropdown',
      options: [
        { label: 'Mainnet', id: 'mainnet' },
        { label: 'Testnet', id: 'testnet' },
      ],
    },
  ],
  tools: {
    access: ['flow_evm_call'],
    config: {
      tool: () => 'flow_evm_call',
      params: (params) => ({
        to: params.to,
        data: params.data,
        value: params.value,
        network: params.network ?? 'mainnet',
      }),
    },
  },
  inputs: {
    to: { type: 'string', description: 'EVM contract address' },
    data: { type: 'string', description: 'Hex-encoded calldata' },
    value: { type: 'string', description: 'Value in wei' },
    network: { type: 'string', description: 'Flow network' },
  },
  outputs: {
    content: { type: 'string', description: 'Call result summary' },
    result: { type: 'string', description: 'Hex-encoded return data' },
  },
}

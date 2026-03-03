import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowExecuteScriptBlock: BlockConfig = {
  type: 'flow_execute_script',
  name: 'Flow Execute Script',
  description: 'Execute a Cadence script on the Flow blockchain and return the result',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'script',
      title: 'Cadence Script',
      type: 'code',
      placeholder: `access(all) fun main(): String {\n  return "Hello, Flow!"\n}`,
      required: true,
    },
    {
      id: 'arguments',
      title: 'Arguments (JSON)',
      type: 'code',
      placeholder: '[]',
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
    access: ['flow_execute_script'],
    config: {
      tool: () => 'flow_execute_script',
      params: (params) => ({
        script: params.script,
        arguments: params.arguments ?? '[]',
        network: params.network ?? 'mainnet',
      }),
    },
  },
  inputs: {
    script: { type: 'string', description: 'Cadence script' },
    arguments: { type: 'string', description: 'Arguments (JSON array)' },
    network: { type: 'string', description: 'Flow network' },
  },
  outputs: {
    content: { type: 'string', description: 'JSON stringified result' },
    result: { type: 'json', description: 'Raw script result' },
  },
}

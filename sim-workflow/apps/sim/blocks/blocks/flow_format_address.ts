import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowFormatAddressBlock: BlockConfig = {
  type: 'flow_format_address',
  name: 'Flow Format Address',
  description: 'Validate and format a Flow address',
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
      id: 'format',
      title: 'Format',
      type: 'dropdown',
      options: [
        { label: 'With 0x Prefix', id: 'with_prefix' },
        { label: 'Without Prefix', id: 'without_prefix' },
        { label: 'Padded (16 chars)', id: 'padded' },
      ],
    },
  ],
  tools: {
    access: ['flow_format_address'],
    config: {
      tool: () => 'flow_format_address',
      params: (params) => ({
        address: params.address,
        format: params.format ?? 'with_prefix',
      }),
    },
  },
  inputs: {
    address: { type: 'string', description: 'Flow address to format' },
    format: { type: 'string', description: 'Output format' },
  },
  outputs: {
    content: { type: 'string', description: 'Formatted address summary' },
    formatted: { type: 'string', description: 'Formatted address' },
    isValid: { type: 'boolean', description: 'Whether the address is valid' },
  },
}

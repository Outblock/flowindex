import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowGetContractCodeBlock: BlockConfig = {
  type: 'flow_get_contract_code',
  name: 'Flow Get Contract Code',
  description: 'Get deployed contract source code',
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
      id: 'contractName',
      title: 'Contract Name',
      type: 'short-input',
      placeholder: 'FlowToken',
      required: true,
    },
  ],
  tools: {
    access: ['flow_get_contract_code'],
    config: {
      tool: () => 'flow_get_contract_code',
      params: (params) => ({ address: params.address, contractName: params.contractName }),
    },
  },
  inputs: {
    address: { type: 'string', description: 'Flow address' },
    contractName: { type: 'string', description: 'Contract name' },
  },
  outputs: {
    content: { type: 'string', description: 'Contract summary' },
    address: { type: 'string', description: 'Flow address' },
    contractName: { type: 'string', description: 'Contract name' },
    code: { type: 'string', description: 'Cadence source code' },
  },
}

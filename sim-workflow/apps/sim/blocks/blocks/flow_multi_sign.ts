import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowMultiSignBlock: BlockConfig = {
  type: 'flow_multi_sign',
  name: 'Flow Multi-Sign',
  description: 'Send a multi-signature transaction on Flow',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'script',
      title: 'Cadence Transaction',
      type: 'code',
      placeholder: `transaction {\n  prepare(signer: auth(Storage) &Account) {\n    // ...\n  }\n}`,
      required: true,
    },
    {
      id: 'arguments',
      title: 'Arguments (JSON)',
      type: 'code',
      placeholder: '[]',
    },
    {
      id: 'signers',
      title: 'Signers (JSON)',
      type: 'code',
      placeholder: '[{"address": "0x1234", "privateKey": "abc123", "keyIndex": 0}]',
      required: true,
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
    access: ['flow_multi_sign'],
    config: {
      tool: () => 'flow_multi_sign',
      params: (params) => ({
        script: params.script,
        arguments: params.arguments ?? '[]',
        signers: params.signers,
        network: params.network ?? 'mainnet',
      }),
    },
  },
  inputs: {
    script: { type: 'string', description: 'Cadence transaction script' },
    arguments: { type: 'string', description: 'Arguments (JSON array)' },
    signers: { type: 'string', description: 'JSON array of {address, privateKey, keyIndex} objects' },
    network: { type: 'string', description: 'Flow network' },
  },
  outputs: {
    content: { type: 'string', description: 'Transaction summary' },
    transactionId: { type: 'string', description: 'Flow transaction ID' },
    status: { type: 'string', description: 'Transaction status' },
  },
}

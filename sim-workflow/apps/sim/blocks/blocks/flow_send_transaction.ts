import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowSendTransactionBlock: BlockConfig = {
  type: 'flow_send_transaction',
  name: 'Flow Send Transaction',
  description: 'Send a Cadence transaction to the Flow blockchain',
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
      id: 'signerAddress',
      title: 'Signer Address',
      type: 'short-input',
      placeholder: '0x...',
      required: true,
    },
    {
      id: 'signerPrivateKey',
      title: 'Signer Private Key',
      type: 'short-input',
      placeholder: 'Hex-encoded private key',
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
    access: ['flow_send_transaction'],
    config: {
      tool: () => 'flow_send_transaction',
      params: (params) => ({
        script: params.script,
        arguments: params.arguments ?? '[]',
        signerAddress: params.signerAddress,
        signerPrivateKey: params.signerPrivateKey,
        network: params.network ?? 'mainnet',
      }),
    },
  },
  inputs: {
    script: { type: 'string', description: 'Cadence transaction script' },
    arguments: { type: 'string', description: 'Arguments (JSON array)' },
    signerAddress: { type: 'string', description: 'Signer Flow address' },
    signerPrivateKey: { type: 'string', description: 'Signer private key' },
    network: { type: 'string', description: 'Flow network' },
  },
  outputs: {
    content: { type: 'string', description: 'Transaction summary' },
    transactionId: { type: 'string', description: 'Flow transaction ID' },
    status: { type: 'string', description: 'Transaction status' },
  },
}

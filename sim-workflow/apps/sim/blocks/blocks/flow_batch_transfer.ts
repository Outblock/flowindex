import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowBatchTransferBlock: BlockConfig = {
  type: 'flow_batch_transfer',
  name: 'Flow Batch Transfer',
  description: 'Batch transfer FLOW to multiple recipients',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'recipients',
      title: 'Recipients (JSON)',
      type: 'code',
      placeholder: '[{"address": "0x1234", "amount": "10.0"}, {"address": "0x5678", "amount": "20.0"}]',
      required: true,
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
    access: ['flow_batch_transfer'],
    config: {
      tool: () => 'flow_batch_transfer',
      params: (params) => ({
        recipients: params.recipients,
        signerAddress: params.signerAddress,
        signerPrivateKey: params.signerPrivateKey,
        network: params.network ?? 'mainnet',
      }),
    },
  },
  inputs: {
    recipients: { type: 'string', description: 'JSON array of {address, amount} objects' },
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

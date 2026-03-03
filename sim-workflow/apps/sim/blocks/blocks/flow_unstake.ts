import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowUnstakeBlock: BlockConfig = {
  type: 'flow_unstake',
  name: 'Flow Unstake',
  description: 'Unstake FLOW tokens via FlowIDTableStaking',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'amount',
      title: 'Amount',
      type: 'short-input',
      placeholder: '100.0',
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
    access: ['flow_unstake'],
    config: {
      tool: () => 'flow_unstake',
      params: (params) => ({
        amount: params.amount,
        signerAddress: params.signerAddress,
        signerPrivateKey: params.signerPrivateKey,
        network: params.network ?? 'mainnet',
      }),
    },
  },
  inputs: {
    amount: { type: 'string', description: 'Amount of FLOW to unstake' },
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

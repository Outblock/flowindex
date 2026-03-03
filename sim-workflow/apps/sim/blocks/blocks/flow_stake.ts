import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowStakeBlock: BlockConfig = {
  type: 'flow_stake',
  name: 'Flow Stake',
  description: 'Stake FLOW tokens via FlowIDTableStaking',
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
      id: 'nodeId',
      title: 'Node ID (optional for delegator)',
      type: 'short-input',
      placeholder: 'Node ID hex string',
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
    access: ['flow_stake'],
    config: {
      tool: () => 'flow_stake',
      params: (params) => ({
        amount: params.amount,
        nodeId: params.nodeId,
        signerAddress: params.signerAddress,
        signerPrivateKey: params.signerPrivateKey,
        network: params.network ?? 'mainnet',
      }),
    },
  },
  inputs: {
    amount: { type: 'string', description: 'Amount of FLOW to stake' },
    nodeId: { type: 'string', description: 'Node ID for delegator staking' },
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

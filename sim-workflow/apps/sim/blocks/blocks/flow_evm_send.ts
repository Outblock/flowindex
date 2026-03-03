import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowEvmSendBlock: BlockConfig = {
  type: 'flow_evm_send',
  name: 'Flow EVM Send',
  description: 'Send an EVM transaction on Flow',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'to',
      title: 'To Address',
      type: 'short-input',
      placeholder: '0x1234...abcd',
      required: true,
    },
    {
      id: 'data',
      title: 'Calldata (hex)',
      type: 'short-input',
      placeholder: '0x...',
    },
    {
      id: 'value',
      title: 'Value (wei)',
      type: 'short-input',
      placeholder: '0',
    },
    {
      id: 'gasLimit',
      title: 'Gas Limit',
      type: 'short-input',
      placeholder: '300000',
    },
    {
      id: 'signerAddress',
      title: 'Signer Address (Flow)',
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
    access: ['flow_evm_send'],
    config: {
      tool: () => 'flow_evm_send',
      params: (params) => ({
        to: params.to,
        data: params.data,
        value: params.value,
        gasLimit: params.gasLimit,
        signerAddress: params.signerAddress,
        signerPrivateKey: params.signerPrivateKey,
        network: params.network ?? 'mainnet',
      }),
    },
  },
  inputs: {
    to: { type: 'string', description: 'EVM destination address' },
    data: { type: 'string', description: 'Hex-encoded calldata' },
    value: { type: 'string', description: 'Value in wei' },
    gasLimit: { type: 'string', description: 'Gas limit for the transaction' },
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

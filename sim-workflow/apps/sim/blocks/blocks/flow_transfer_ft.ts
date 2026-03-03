import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowTransferFtBlock: BlockConfig = {
  type: 'flow_transfer_ft',
  name: 'Flow Transfer FT',
  description: 'Transfer fungible tokens on Flow',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'recipient',
      title: 'Recipient Address',
      type: 'short-input',
      placeholder: '0x1654653399040a61',
      required: true,
    },
    {
      id: 'amount',
      title: 'Amount',
      type: 'short-input',
      placeholder: '10.0',
      required: true,
    },
    {
      id: 'vaultPath',
      title: 'Vault Storage Path',
      type: 'short-input',
      placeholder: '/storage/flowTokenVault',
      required: true,
    },
    {
      id: 'receiverPath',
      title: 'Receiver Public Path',
      type: 'short-input',
      placeholder: '/public/flowTokenReceiver',
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
    access: ['flow_transfer_ft'],
    config: {
      tool: () => 'flow_transfer_ft',
      params: (params) => ({
        recipient: params.recipient,
        amount: params.amount,
        vaultPath: params.vaultPath,
        receiverPath: params.receiverPath,
        signerAddress: params.signerAddress,
        signerPrivateKey: params.signerPrivateKey,
        network: params.network ?? 'mainnet',
      }),
    },
  },
  inputs: {
    recipient: { type: 'string', description: 'Recipient Flow address' },
    amount: { type: 'string', description: 'Amount to transfer' },
    vaultPath: { type: 'string', description: 'Storage path of the token vault' },
    receiverPath: { type: 'string', description: 'Public path of the receiver' },
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

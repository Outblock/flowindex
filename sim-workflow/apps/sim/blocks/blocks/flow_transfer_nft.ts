import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowTransferNftBlock: BlockConfig = {
  type: 'flow_transfer_nft',
  name: 'Flow Transfer NFT',
  description: 'Transfer an NFT on Flow',
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
      id: 'nftId',
      title: 'NFT ID',
      type: 'short-input',
      placeholder: '42',
      required: true,
    },
    {
      id: 'collectionStoragePath',
      title: 'Collection Storage Path',
      type: 'short-input',
      placeholder: '/storage/exampleNFTCollection',
      required: true,
    },
    {
      id: 'collectionPublicPath',
      title: 'Collection Public Path',
      type: 'short-input',
      placeholder: '/public/exampleNFTCollection',
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
    access: ['flow_transfer_nft'],
    config: {
      tool: () => 'flow_transfer_nft',
      params: (params) => ({
        recipient: params.recipient,
        nftId: params.nftId,
        collectionStoragePath: params.collectionStoragePath,
        collectionPublicPath: params.collectionPublicPath,
        signerAddress: params.signerAddress,
        signerPrivateKey: params.signerPrivateKey,
        network: params.network ?? 'mainnet',
      }),
    },
  },
  inputs: {
    recipient: { type: 'string', description: 'Recipient Flow address' },
    nftId: { type: 'string', description: 'NFT ID to transfer' },
    collectionStoragePath: { type: 'string', description: 'Storage path of NFT collection' },
    collectionPublicPath: { type: 'string', description: 'Public path of NFT collection' },
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

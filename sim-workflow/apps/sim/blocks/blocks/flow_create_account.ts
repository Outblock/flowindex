import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'

export const FlowCreateAccountBlock: BlockConfig = {
  type: 'flow_create_account',
  name: 'Flow Create Account',
  description: 'Create a new Flow account',
  category: 'tools',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  subBlocks: [
    {
      id: 'publicKey',
      title: 'Public Key (hex)',
      type: 'short-input',
      placeholder: 'Hex-encoded public key',
      required: true,
    },
    {
      id: 'sigAlgo',
      title: 'Signature Algorithm',
      type: 'dropdown',
      options: [
        { label: 'ECDSA_P256', id: 'ECDSA_P256' },
        { label: 'ECDSA_secp256k1', id: 'ECDSA_secp256k1' },
      ],
    },
    {
      id: 'hashAlgo',
      title: 'Hash Algorithm',
      type: 'dropdown',
      options: [
        { label: 'SHA3_256', id: 'SHA3_256' },
        { label: 'SHA2_256', id: 'SHA2_256' },
      ],
    },
    {
      id: 'signerAddress',
      title: 'Signer Address (payer)',
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
    access: ['flow_create_account'],
    config: {
      tool: () => 'flow_create_account',
      params: (params) => ({
        publicKey: params.publicKey,
        sigAlgo: params.sigAlgo ?? 'ECDSA_P256',
        hashAlgo: params.hashAlgo ?? 'SHA3_256',
        signerAddress: params.signerAddress,
        signerPrivateKey: params.signerPrivateKey,
        network: params.network ?? 'mainnet',
      }),
    },
  },
  inputs: {
    publicKey: { type: 'string', description: 'Hex-encoded public key for the new account' },
    sigAlgo: { type: 'string', description: 'Signature algorithm' },
    hashAlgo: { type: 'string', description: 'Hash algorithm' },
    signerAddress: { type: 'string', description: 'Payer Flow address' },
    signerPrivateKey: { type: 'string', description: 'Payer private key' },
    network: { type: 'string', description: 'Flow network' },
  },
  outputs: {
    content: { type: 'string', description: 'Account creation summary' },
    transactionId: { type: 'string', description: 'Flow transaction ID' },
    address: { type: 'string', description: 'New account address' },
    status: { type: 'string', description: 'Transaction status' },
  },
}

import { FlowIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import { getTrigger } from '@/triggers'

export const FlowTriggerBlock: BlockConfig = {
  type: 'flow_trigger',
  name: 'Flow Blockchain',
  description: 'Trigger workflows from Flow blockchain events',
  longDescription:
    'Monitor Flow blockchain events in real-time. Trigger workflows on token transfers, NFT activity, contract deployments, staking events, EVM transactions, and more.',
  category: 'triggers',
  bgColor: '#00EF8B',
  icon: FlowIcon,
  triggerAllowed: true,
  docsLink: 'https://docs.flowindex.io/triggers/flow',
  subBlocks: [
    ...getTrigger('flow_ft_transfer').subBlocks,
    ...getTrigger('flow_nft_transfer').subBlocks,
    ...getTrigger('flow_tx_sealed').subBlocks,
    ...getTrigger('flow_contract_event').subBlocks,
    ...getTrigger('flow_account_event').subBlocks,
    ...getTrigger('flow_balance_change').subBlocks,
    ...getTrigger('flow_staking_event').subBlocks,
    ...getTrigger('flow_evm_tx').subBlocks,
    ...getTrigger('flow_defi_event').subBlocks,
    ...getTrigger('flow_schedule').subBlocks,
    ...getTrigger('flow_large_transfer').subBlocks,
    ...getTrigger('flow_whale_activity').subBlocks,
    ...getTrigger('flow_contract_deploy').subBlocks,
    ...getTrigger('flow_new_account').subBlocks,
  ],

  tools: {
    access: [],
  },

  inputs: {},

  outputs: {},

  triggers: {
    enabled: true,
    available: [
      'flow_ft_transfer',
      'flow_nft_transfer',
      'flow_tx_sealed',
      'flow_contract_event',
      'flow_account_event',
      'flow_balance_change',
      'flow_staking_event',
      'flow_evm_tx',
      'flow_defi_event',
      'flow_schedule',
      'flow_large_transfer',
      'flow_whale_activity',
      'flow_contract_deploy',
      'flow_new_account',
    ],
  },
}

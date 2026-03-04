import { FlowIcon } from '@/components/icons'
import type { BlockConfig, SubBlockConfig } from '@/blocks/types'
import { getTrigger } from '@/triggers'

/**
 * Creates a standalone Flow trigger block for a single trigger type.
 * Injects a hidden single-option dropdown so condition-based subBlock
 * visibility works correctly without user interaction.
 */
function createFlowTriggerBlock(opts: {
  type: string
  name: string
  description: string
  triggerId: string
  triggerLabel: string
}): BlockConfig {
  const trigger = getTrigger(opts.triggerId)
  const subBlocks: SubBlockConfig[] = [
    {
      id: 'selectedTriggerId',
      title: '',
      type: 'dropdown',
      mode: 'trigger',
      options: [{ label: opts.triggerLabel, id: opts.triggerId }],
      value: () => opts.triggerId,
      hidden: true,
    },
    ...trigger.subBlocks.filter((sb) => sb.id !== 'selectedTriggerId'),
  ]

  return {
    type: opts.type,
    name: opts.name,
    description: opts.description,
    category: 'triggers',
    bgColor: '#00EF8B',
    icon: FlowIcon,
    triggerAllowed: true,
    subBlocks,
    tools: { access: [] },
    inputs: {},
    outputs: {},
    triggers: { enabled: true, available: [opts.triggerId] },
  }
}

export const FlowFtTransferTriggerBlock = createFlowTriggerBlock({
  type: 'flow_ft_transfer_trigger',
  name: 'Flow FT Transfer',
  description: 'Trigger on fungible token transfers on Flow',
  triggerId: 'flow_ft_transfer',
  triggerLabel: 'FT Transfer',
})

export const FlowNftTransferTriggerBlock = createFlowTriggerBlock({
  type: 'flow_nft_transfer_trigger',
  name: 'Flow NFT Transfer',
  description: 'Trigger on NFT transfers on Flow',
  triggerId: 'flow_nft_transfer',
  triggerLabel: 'NFT Transfer',
})

export const FlowTxSealedTriggerBlock = createFlowTriggerBlock({
  type: 'flow_tx_sealed_trigger',
  name: 'Flow TX Sealed',
  description: 'Trigger when a transaction is sealed on Flow',
  triggerId: 'flow_tx_sealed',
  triggerLabel: 'Transaction Sealed',
})

export const FlowContractEventTriggerBlock = createFlowTriggerBlock({
  type: 'flow_contract_event_trigger',
  name: 'Flow Contract Event',
  description: 'Trigger on smart contract events on Flow',
  triggerId: 'flow_contract_event',
  triggerLabel: 'Contract Event',
})

export const FlowAccountEventTriggerBlock = createFlowTriggerBlock({
  type: 'flow_account_event_trigger',
  name: 'Flow Account Event',
  description: 'Trigger on account events on Flow',
  triggerId: 'flow_account_event',
  triggerLabel: 'Account Event',
})

export const FlowBalanceChangeTriggerBlock = createFlowTriggerBlock({
  type: 'flow_balance_change_trigger',
  name: 'Flow Balance Change',
  description: 'Trigger on balance changes on Flow',
  triggerId: 'flow_balance_change',
  triggerLabel: 'Balance Change',
})

export const FlowStakingEventTriggerBlock = createFlowTriggerBlock({
  type: 'flow_staking_event_trigger',
  name: 'Flow Staking Event',
  description: 'Trigger on staking events on Flow',
  triggerId: 'flow_staking_event',
  triggerLabel: 'Staking Event',
})

export const FlowEvmTxTriggerBlock = createFlowTriggerBlock({
  type: 'flow_evm_tx_trigger',
  name: 'Flow EVM TX',
  description: 'Trigger on EVM transactions on Flow',
  triggerId: 'flow_evm_tx',
  triggerLabel: 'EVM Transaction',
})

export const FlowDefiEventTriggerBlock = createFlowTriggerBlock({
  type: 'flow_defi_event_trigger',
  name: 'Flow DeFi Event',
  description: 'Trigger on DeFi events on Flow',
  triggerId: 'flow_defi_event',
  triggerLabel: 'DeFi Event',
})

export const FlowScheduleTriggerBlock = createFlowTriggerBlock({
  type: 'flow_schedule_trigger',
  name: 'Flow Schedule',
  description: 'Trigger on a schedule for Flow data',
  triggerId: 'flow_schedule',
  triggerLabel: 'Schedule',
})

export const FlowLargeTransferTriggerBlock = createFlowTriggerBlock({
  type: 'flow_large_transfer_trigger',
  name: 'Flow Large Transfer',
  description: 'Trigger on large token transfers on Flow',
  triggerId: 'flow_large_transfer',
  triggerLabel: 'Large Transfer',
})

export const FlowWhaleActivityTriggerBlock = createFlowTriggerBlock({
  type: 'flow_whale_activity_trigger',
  name: 'Flow Whale Activity',
  description: 'Trigger on whale activity on Flow',
  triggerId: 'flow_whale_activity',
  triggerLabel: 'Whale Activity',
})

export const FlowContractDeployTriggerBlock = createFlowTriggerBlock({
  type: 'flow_contract_deploy_trigger',
  name: 'Flow Contract Deploy',
  description: 'Trigger on contract deployments on Flow',
  triggerId: 'flow_contract_deploy',
  triggerLabel: 'Contract Deploy',
})

export const FlowNewAccountTriggerBlock = createFlowTriggerBlock({
  type: 'flow_new_account_trigger',
  name: 'Flow New Account',
  description: 'Trigger on new account creation on Flow',
  triggerId: 'flow_new_account',
  triggerLabel: 'New Account',
})

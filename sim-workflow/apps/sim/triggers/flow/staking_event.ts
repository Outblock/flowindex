import { FlowIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import { FLOW_TRIGGER_OPTIONS, flowSetupInstructions } from './constants'

export const flowStakingEventTrigger: TriggerConfig = {
  id: 'flow_staking_event',
  name: 'Flow Staking Event',
  provider: 'flow',
  description: 'Triggered when a staking-related event occurs on Flow',
  version: '1.0.0',
  icon: FlowIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'flow_staking_event',
    triggerOptions: FLOW_TRIGGER_OPTIONS,
    setupInstructions: flowSetupInstructions('staking event'),
    hideWebhookUrl: true,
    extraFields: [
      {
        id: 'delegatorAddress',
        title: 'Delegator Address',
        type: 'short-input',
        placeholder: '0x... (optional)',
        description: 'Filter by delegator address',
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'flow_staking_event' },
      },
      {
        id: 'stakingEventType',
        title: 'Event Type',
        type: 'dropdown',
        options: [
          { label: 'Any Staking Event', id: 'any' },
          { label: 'Tokens Staked', id: 'tokens_staked' },
          { label: 'Tokens Unstaked', id: 'tokens_unstaked' },
          { label: 'Rewards Withdrawn', id: 'rewards_withdrawn' },
          { label: 'Delegation Changed', id: 'delegation_changed' },
        ],
        value: () => 'any',
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'flow_staking_event' },
      },
    ],
  }),

  outputs: {
    eventType: { type: 'string', description: 'Staking event type' },
    address: { type: 'string', description: 'Delegator address' },
    nodeId: { type: 'string', description: 'Staking node ID' },
    amount: { type: 'string', description: 'Amount involved' },
    transactionId: { type: 'string', description: 'Transaction ID' },
    blockHeight: { type: 'number', description: 'Block height' },
    timestamp: { type: 'string', description: 'Block timestamp' },
  },

  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  },
}

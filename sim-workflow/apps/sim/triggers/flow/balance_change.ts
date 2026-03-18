import { FlowIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import { FLOW_TRIGGER_OPTIONS, flowSetupInstructions } from './constants'

const SAMPLE_BALANCE_EVENT = {
  event_type: 'balance.check',
  timestamp: '2026-03-18T06:20:23Z',
  data: {
    address: '1654653399040a61',
    balance: '90.0',
    previous_balance: '120.0',
    change: '-30.0',
    token: 'FLOW',
    token_contract: 'A.1654653399040a61.FlowToken',
    contract_address: '1654653399040a61',
    contract_name: 'FlowToken',
  },
}

export const flowBalanceChangeTrigger: TriggerConfig = {
  id: 'flow_balance_change',
  name: 'Flow Balance Change',
  provider: 'flow',
  description: 'Triggered when an account balance crosses a threshold',
  version: '1.0.0',
  icon: FlowIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'flow_balance_change',
    triggerOptions: FLOW_TRIGGER_OPTIONS,
    setupInstructions: flowSetupInstructions('balance change'),
    hideWebhookUrl: true,
    extraFields: [
      {
        id: 'addressFilter',
        title: 'Account Address',
        type: 'short-input',
        placeholder: '0x...',
        description: 'Account to monitor',
        required: true,
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'flow_balance_change' },
      },
      {
        id: 'token',
        title: 'Token',
        type: 'dropdown',
        options: [
          { label: 'FLOW', id: 'flow' },
          { label: 'USDC', id: 'usdc' },
          { label: 'stFlow', id: 'stflow' },
        ],
        value: () => 'flow',
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'flow_balance_change' },
      },
      {
        id: 'threshold',
        title: 'Threshold',
        type: 'short-input',
        placeholder: '100',
        description: 'Trigger when balance drops below this value',
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'flow_balance_change' },
      },
      {
        id: 'direction',
        title: 'Direction',
        type: 'dropdown',
        options: [
          { label: 'Below Threshold', id: 'below' },
          { label: 'Above Threshold', id: 'above' },
          { label: 'Any Change', id: 'any' },
        ],
        value: () => 'below',
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'flow_balance_change' },
      },
    ],
  }),

  outputs: {
    eventType: { type: 'string', description: 'Normalized Flow event type' },
    address: { type: 'string', description: 'Account address' },
    token: { type: 'string', description: 'Token type' },
    balance: { type: 'string', description: 'Current balance' },
    previousBalance: { type: 'string', description: 'Previous balance' },
    change: { type: 'string', description: 'Balance change amount' },
    blockHeight: { type: 'number', description: 'Block height' },
    timestamp: { type: 'string', description: 'Block timestamp' },
  },

  samplePayload: {
    eventType: 'balance.check',
    address: '0x1654653399040a61',
    token: 'FLOW',
    balance: '90.0',
    previousBalance: '120.0',
    change: '-30.0',
    blockHeight: 0,
    timestamp: '2026-03-18T06:20:23Z',
    data: SAMPLE_BALANCE_EVENT.data,
    raw: JSON.stringify(SAMPLE_BALANCE_EVENT),
  },

  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  },
}

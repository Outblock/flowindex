import { FlowIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import { FLOW_TRIGGER_OPTIONS, flowSetupInstructions } from './constants'

const SAMPLE_RAW_EVENT = {
  block_height: 145558608,
  data: {
    block_height: 145558608,
    created_at: '0001-01-01T00:00:00Z',
    event_index: 0,
    event_name: 'AccountCreated',
    id: 0,
    payload: {
      address: '998eb404705ce617',
    },
    timestamp: '2026-03-18T06:20:23.558Z',
    transaction_id: 'c32a14889b9904b0890d9bc9a1f6309e7caa34b76c683014ea7df8b45f567dd7',
    transaction_index: 1,
    type: 'flow.AccountCreated',
  },
  event_type: 'account.created',
  timestamp: '2026-03-18T06:20:23Z',
}

export const flowNewAccountTrigger: TriggerConfig = {
  id: 'flow_new_account',
  name: 'Flow New Account',
  provider: 'flow',
  description: 'Triggered when a new account is created on Flow',
  version: '1.0.0',
  icon: FlowIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'flow_new_account',
    triggerOptions: FLOW_TRIGGER_OPTIONS,
    setupInstructions: flowSetupInstructions('new account creation'),
    hideWebhookUrl: true,
  }),

  outputs: {
    eventType: { type: 'string', description: 'Normalized Flow event type' },
    eventName: { type: 'string', description: 'Raw Flow event name' },
    address: { type: 'string', description: 'Newly created account address' },
    transactionId: { type: 'string', description: 'Transaction ID' },
    blockHeight: { type: 'number', description: 'Block height' },
    timestamp: { type: 'string', description: 'Block timestamp' },
    data: { type: 'json', description: 'Underlying Flow event payload' },
    raw: {
      type: 'string',
      description: 'Original webhook body as JSON string',
    },
  },

  samplePayload: {
    eventType: 'account.created',
    eventName: 'AccountCreated',
    address: '0x998eb404705ce617',
    transactionId: 'c32a14889b9904b0890d9bc9a1f6309e7caa34b76c683014ea7df8b45f567dd7',
    blockHeight: 145558608,
    timestamp: '2026-03-18T06:20:23.558Z',
    data: SAMPLE_RAW_EVENT.data,
    raw: JSON.stringify(SAMPLE_RAW_EVENT),
  },

  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  },
}

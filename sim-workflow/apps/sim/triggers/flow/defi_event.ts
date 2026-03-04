import { FlowIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import { FLOW_TRIGGER_OPTIONS, flowSetupInstructions } from './constants'

export const flowDefiEventTrigger: TriggerConfig = {
  id: 'flow_defi_event',
  name: 'Flow DeFi Event',
  provider: 'flow',
  description: 'Triggered when a DeFi swap or liquidity event occurs on Flow',
  version: '1.0.0',
  icon: FlowIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'flow_defi_event',
    triggerOptions: FLOW_TRIGGER_OPTIONS,
    setupInstructions: flowSetupInstructions('DeFi event'),
    hideWebhookUrl: true,
    extraFields: [
      {
        id: 'pool',
        title: 'Pool',
        type: 'short-input',
        placeholder: 'e.g. FLOW/USDC (optional)',
        description: 'Filter by trading pair',
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'flow_defi_event' },
      },
      {
        id: 'defiDirection',
        title: 'Event Type',
        type: 'dropdown',
        options: [
          { label: 'Any DeFi Event', id: 'any' },
          { label: 'Swap', id: 'swap' },
          { label: 'Add Liquidity', id: 'add_liquidity' },
          { label: 'Remove Liquidity', id: 'remove_liquidity' },
        ],
        value: () => 'any',
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'flow_defi_event' },
      },
    ],
  }),

  outputs: {
    eventType: { type: 'string', description: 'DeFi event type (swap, add_liquidity, etc.)' },
    pool: { type: 'string', description: 'Trading pair' },
    tokenIn: { type: 'string', description: 'Input token' },
    tokenOut: { type: 'string', description: 'Output token' },
    amountIn: { type: 'string', description: 'Input amount' },
    amountOut: { type: 'string', description: 'Output amount' },
    transactionId: { type: 'string', description: 'Transaction ID' },
    blockHeight: { type: 'number', description: 'Block height' },
    timestamp: { type: 'string', description: 'Block timestamp' },
  },

  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  },
}

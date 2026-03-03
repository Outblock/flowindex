import { FlowIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import { FLOW_TRIGGER_OPTIONS, flowSetupInstructions } from './constants'

export const flowEvmTxTrigger: TriggerConfig = {
  id: 'flow_evm_tx',
  name: 'Flow EVM Transaction',
  provider: 'flow',
  description: 'Triggered when an EVM transaction occurs on Flow',
  version: '1.0.0',
  icon: FlowIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'flow_evm_tx',
    triggerOptions: FLOW_TRIGGER_OPTIONS,
    setupInstructions: flowSetupInstructions('EVM transaction'),
    extraFields: [
      {
        id: 'fromAddress',
        title: 'From Address',
        type: 'short-input',
        placeholder: '0x... (EVM address, optional)',
        description: 'Filter by sender EVM address',
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'flow_evm_tx' },
      },
      {
        id: 'toAddress',
        title: 'To Address',
        type: 'short-input',
        placeholder: '0x... (EVM address, optional)',
        description: 'Filter by recipient EVM address',
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'flow_evm_tx' },
      },
    ],
  }),

  outputs: {
    transactionId: { type: 'string', description: 'Flow transaction ID' },
    evmHash: { type: 'string', description: 'EVM transaction hash' },
    from: { type: 'string', description: 'Sender EVM address' },
    to: { type: 'string', description: 'Recipient EVM address' },
    value: { type: 'string', description: 'Value transferred (wei)' },
    gasUsed: { type: 'number', description: 'Gas used' },
    blockHeight: { type: 'number', description: 'Block height' },
    timestamp: { type: 'string', description: 'Block timestamp' },
  },

  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  },
}

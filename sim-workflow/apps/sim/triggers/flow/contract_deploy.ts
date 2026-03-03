import { FlowIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import type { TriggerConfig } from '@/triggers/types'
import { FLOW_TRIGGER_OPTIONS, flowSetupInstructions } from './constants'

export const flowContractDeployTrigger: TriggerConfig = {
  id: 'flow_contract_deploy',
  name: 'Flow Contract Deploy',
  provider: 'flow',
  description: 'Triggered when a new contract is deployed on Flow',
  version: '1.0.0',
  icon: FlowIcon,

  subBlocks: buildTriggerSubBlocks({
    triggerId: 'flow_contract_deploy',
    triggerOptions: FLOW_TRIGGER_OPTIONS,
    setupInstructions: flowSetupInstructions('contract deployment'),
    extraFields: [
      {
        id: 'addressFilter',
        title: 'Address Filter',
        type: 'short-input',
        placeholder: '0x... (optional)',
        description: 'Only trigger for deployments to this address',
        mode: 'trigger',
        condition: { field: 'selectedTriggerId', value: 'flow_contract_deploy' },
      },
    ],
  }),

  outputs: {
    address: { type: 'string', description: 'Account address' },
    contractName: { type: 'string', description: 'Deployed contract name' },
    transactionId: { type: 'string', description: 'Transaction ID' },
    blockHeight: { type: 'number', description: 'Block height' },
    timestamp: { type: 'string', description: 'Block timestamp' },
  },

  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  },
}

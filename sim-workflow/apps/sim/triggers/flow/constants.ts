export const FLOW_TRIGGER_OPTIONS = [
  { label: 'FT Transfer', id: 'flow_ft_transfer' },
  { label: 'NFT Transfer', id: 'flow_nft_transfer' },
  { label: 'Transaction Sealed', id: 'flow_tx_sealed' },
  { label: 'Contract Event', id: 'flow_contract_event' },
  { label: 'Account Event', id: 'flow_account_event' },
  { label: 'Balance Change', id: 'flow_balance_change' },
  { label: 'Staking Event', id: 'flow_staking_event' },
  { label: 'EVM Transaction', id: 'flow_evm_tx' },
  { label: 'DeFi Event', id: 'flow_defi_event' },
  { label: 'Schedule', id: 'flow_schedule' },
  { label: 'Large Transfer', id: 'flow_large_transfer' },
  { label: 'Whale Activity', id: 'flow_whale_activity' },
  { label: 'Contract Deploy', id: 'flow_contract_deploy' },
  { label: 'New Account', id: 'flow_new_account' },
]

export function flowSetupInstructions(eventType: string): string {
  const steps = [
    `This trigger fires when a <strong>${eventType}</strong> event is detected on the Flow blockchain.`,
    'Configure the filter fields above to narrow which events trigger the workflow.',
    'Events are automatically pushed from FlowIndex as matching blockchain events are indexed.',
    'Deploy the workflow to activate the trigger. Events are delivered in near-real-time as blocks are sealed.',
  ]
  return steps
    .map((s, i) => `<div class="mb-3"><strong>${i + 1}.</strong> ${s}</div>`)
    .join('')
}

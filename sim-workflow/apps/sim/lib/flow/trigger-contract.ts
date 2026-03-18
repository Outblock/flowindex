export const FLOW_TRIGGER_EVENT_TYPES = {
  flow_ft_transfer: 'ft.transfer',
  flow_nft_transfer: 'nft.transfer',
  flow_tx_sealed: 'address.activity',
  flow_contract_event: 'contract.event',
  flow_account_event: 'account.event',
  flow_balance_change: 'balance.check',
  flow_staking_event: 'staking.event',
  flow_evm_tx: 'evm.transaction',
  flow_defi_event: 'defi.event',
  flow_large_transfer: 'ft.large_transfer',
  flow_whale_activity: 'address.activity',
  flow_contract_deploy: 'contract.event',
  flow_new_account: 'account.created',
} as const

export const FLOW_TRIGGER_IDS_WITHOUT_SUBSCRIPTIONS = ['flow_schedule'] as const

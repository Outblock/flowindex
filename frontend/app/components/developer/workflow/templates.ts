import { Waves, DollarSign, Shield, FileCode, Image, Landmark, Wallet, Package, Clock } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  category: 'whale' | 'project' | 'personal'
  icon: LucideIcon
  nodes: Array<{
    id: string
    type: string
    data: { nodeType: string; config: Record<string, string> }
  }>
  edges: Array<{
    source: string
    target: string
    sourceHandle?: string
  }>
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  // — Whale Monitoring —
  {
    id: 'whale_flow',
    name: 'Large FLOW Transfer',
    description: 'Alert when FLOW transfers exceed 100,000',
    category: 'whale',
    icon: Waves,
    nodes: [
      { id: 'node_1', type: 'trigger_ft_transfer', data: { nodeType: 'trigger_ft_transfer', config: { addresses: '', direction: 'both', token_contract: 'A.1654653399040a61.FlowToken', min_amount: '100000' } } },
      { id: 'node_2', type: 'dest_discord', data: { nodeType: 'dest_discord', config: { webhook_url: '' } } },
    ],
    edges: [{ source: 'node_1', target: 'node_2' }],
  },
  {
    id: 'whale_usdc',
    name: 'Large USDC Transfer',
    description: 'Alert when USDC transfers exceed 50,000',
    category: 'whale',
    icon: DollarSign,
    nodes: [
      { id: 'node_1', type: 'trigger_ft_transfer', data: { nodeType: 'trigger_ft_transfer', config: { addresses: '', direction: 'both', token_contract: 'A.b19436aae4d94622.FiatToken', min_amount: '50000' } } },
      { id: 'node_2', type: 'dest_slack', data: { nodeType: 'dest_slack', config: { webhook_url: '' } } },
    ],
    edges: [{ source: 'node_1', target: 'node_2' }],
  },
  {
    id: 'whale_activity',
    name: 'Whale Address Activity',
    description: 'Monitor transactions from/to specific addresses',
    category: 'whale',
    icon: Shield,
    nodes: [
      { id: 'node_1', type: 'trigger_tx_sealed', data: { nodeType: 'trigger_tx_sealed', config: { addresses: '', roles: 'PROPOSER,PAYER,AUTHORIZER' } } },
      { id: 'node_2', type: 'dest_email', data: { nodeType: 'dest_email', config: { to: '', subject: 'Whale Activity Alert' } } },
    ],
    edges: [{ source: 'node_1', target: 'node_2' }],
  },
  // — Project Monitoring —
  {
    id: 'contract_deploy',
    name: 'Contract Deploy Notification',
    description: 'Get notified when new contracts are deployed',
    category: 'project',
    icon: FileCode,
    nodes: [
      { id: 'node_1', type: 'trigger_account_event', data: { nodeType: 'trigger_account_event', config: { addresses: '', subtypes: 'contract.added' } } },
      { id: 'node_2', type: 'dest_discord', data: { nodeType: 'dest_discord', config: { webhook_url: '' } } },
    ],
    edges: [{ source: 'node_1', target: 'node_2' }],
  },
  {
    id: 'nft_topshot',
    name: 'TopShot Trade Monitor',
    description: 'Track NBA Top Shot NFT transfers',
    category: 'project',
    icon: Image,
    nodes: [
      { id: 'node_1', type: 'trigger_nft_transfer', data: { nodeType: 'trigger_nft_transfer', config: { addresses: '', collection: 'A.0b2a3299cc857e29.TopShot', direction: 'both' } } },
      { id: 'node_2', type: 'dest_webhook', data: { nodeType: 'dest_webhook', config: { url: '', method: 'POST' } } },
    ],
    edges: [{ source: 'node_1', target: 'node_2' }],
  },
  {
    id: 'staking_changes',
    name: 'Staking Changes',
    description: 'Monitor FlowIDTableStaking contract events',
    category: 'project',
    icon: Landmark,
    nodes: [
      { id: 'node_1', type: 'trigger_contract_event', data: { nodeType: 'trigger_contract_event', config: { contract_address: '0x8624b52f9ddcd04a', event_names: 'DelegatorTokensCommitted,DelegatorRewardTokensWithdrawn' } } },
      { id: 'node_2', type: 'dest_telegram', data: { nodeType: 'dest_telegram', config: { bot_token: '', chat_id: '' } } },
    ],
    edges: [{ source: 'node_1', target: 'node_2' }],
  },
  // — Personal Alerts —
  {
    id: 'low_balance',
    name: 'Low Balance Warning',
    description: 'Alert when FLOW balance drops below threshold',
    category: 'personal',
    icon: Wallet,
    nodes: [
      { id: 'node_1', type: 'trigger_balance_change', data: { nodeType: 'trigger_balance_change', config: { addresses: '', token_contract: 'A.1654653399040a61.FlowToken', min_amount: '0' } } },
      { id: 'node_2', type: 'condition_if', data: { nodeType: 'condition_if', config: { field: 'amount', operator: '<', value: '1000' } } },
      { id: 'node_3', type: 'dest_email', data: { nodeType: 'dest_email', config: { to: '', subject: 'Low FLOW Balance Alert' } } },
    ],
    edges: [
      { source: 'node_1', target: 'node_2' },
      { source: 'node_2', target: 'node_3', sourceHandle: 'true' },
    ],
  },
  {
    id: 'nft_received',
    name: 'NFT Received',
    description: 'Notify when your address receives any NFT',
    category: 'personal',
    icon: Package,
    nodes: [
      { id: 'node_1', type: 'trigger_nft_transfer', data: { nodeType: 'trigger_nft_transfer', config: { addresses: '', collection: '', direction: 'in' } } },
      { id: 'node_2', type: 'dest_discord', data: { nodeType: 'dest_discord', config: { webhook_url: '' } } },
    ],
    edges: [{ source: 'node_1', target: 'node_2' }],
  },
  {
    id: 'daily_report',
    name: 'Daily Balance Report',
    description: 'Send daily balance check via webhook',
    category: 'personal',
    icon: Clock,
    nodes: [
      { id: 'node_1', type: 'trigger_schedule', data: { nodeType: 'trigger_schedule', config: { cron: '0 9 * * *', timezone: 'UTC' } } },
      { id: 'node_2', type: 'dest_webhook', data: { nodeType: 'dest_webhook', config: { url: '', method: 'POST' } } },
    ],
    edges: [{ source: 'node_1', target: 'node_2' }],
  },
]

export const TEMPLATE_CATEGORIES = [
  { key: 'whale' as const, label: 'Whale Monitoring', emoji: '🐋' },
  { key: 'project' as const, label: 'Project Monitoring', emoji: '📡' },
  { key: 'personal' as const, label: 'Personal Alerts', emoji: '🔔' },
]

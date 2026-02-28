import type { ComponentType } from 'react'
import {
  Zap, Image, User, FileCheck, Box, Monitor, ScrollText, Wallet, Clock,
  GitBranch, Filter,
  Globe, MessageSquare, Hash, Send, Mail,
} from 'lucide-react'
import { COLORS } from './constants'

export type NodeCategory = 'trigger' | 'condition' | 'destination'

export interface NodeTypeMeta {
  type: string           // ReactFlow node type id, e.g. 'trigger_ft_transfer'
  label: string          // Human label, e.g. 'FT Transfer'
  category: NodeCategory
  icon: ComponentType<{ className?: string; style?: React.CSSProperties }>
  color: string
  eventType?: string     // maps to subscription event_type (triggers only)
  /** Config field definitions for the right panel form */
  configFields: ConfigFieldDef[]
  /** Number of output handles (default 1). IF node has 2. */
  outputs?: number
}

export interface ConfigFieldDef {
  key: string
  label: string
  type: 'text' | 'number' | 'select'
  placeholder?: string
  options?: { value: string; label: string }[] | string[]
  isArray?: boolean
}

// ---------------------------------------------------------------------------
// FT_TOKENS and NFT_COLLECTIONS imported from constants.ts
// ---------------------------------------------------------------------------
import { FT_TOKENS, NFT_COLLECTIONS } from './constants'

// ---------------------------------------------------------------------------
// Trigger nodes
// ---------------------------------------------------------------------------

const TRIGGER_NODES: NodeTypeMeta[] = [
  {
    type: 'trigger_ft_transfer', label: 'FT Transfer', category: 'trigger',
    icon: Zap, color: COLORS.trigger, eventType: 'ft.transfer',
    configFields: [
      { key: 'addresses', label: 'Addresses', type: 'text', placeholder: '0x1,0x2', isArray: true },
      { key: 'direction', label: 'Direction', type: 'select', options: ['in', 'out', 'both'] },
      { key: 'token_contract', label: 'Token', type: 'select', options: FT_TOKENS },
      { key: 'min_amount', label: 'Min Amount', type: 'number', placeholder: '0' },
    ],
  },
  {
    type: 'trigger_nft_transfer', label: 'NFT Transfer', category: 'trigger',
    icon: Image, color: COLORS.trigger, eventType: 'nft.transfer',
    configFields: [
      { key: 'addresses', label: 'Addresses', type: 'text', placeholder: '0x1,0x2', isArray: true },
      { key: 'collection', label: 'Collection', type: 'select', options: NFT_COLLECTIONS },
      { key: 'direction', label: 'Direction', type: 'select', options: ['in', 'out', 'both'] },
    ],
  },
  {
    type: 'trigger_account_event', label: 'Account Event', category: 'trigger',
    icon: User, color: COLORS.trigger, eventType: 'account.created',
    configFields: [
      { key: 'addresses', label: 'Addresses', type: 'text', placeholder: '0x1,0x2', isArray: true },
      { key: 'subtypes', label: 'Subtypes', type: 'text', placeholder: 'created,key.added', isArray: true },
    ],
  },
  {
    type: 'trigger_tx_sealed', label: 'TX Sealed', category: 'trigger',
    icon: FileCheck, color: COLORS.trigger, eventType: 'transaction.sealed',
    configFields: [
      { key: 'addresses', label: 'Addresses', type: 'text', placeholder: '0x1,0x2', isArray: true },
      { key: 'roles', label: 'Roles', type: 'text', placeholder: 'PROPOSER,PAYER', isArray: true },
    ],
  },
  {
    type: 'trigger_block_sealed', label: 'Block Sealed', category: 'trigger',
    icon: Box, color: COLORS.trigger, eventType: 'block.sealed',
    configFields: [],
  },
  {
    type: 'trigger_evm_tx', label: 'EVM Transaction', category: 'trigger',
    icon: Monitor, color: COLORS.trigger, eventType: 'evm.transaction',
    configFields: [
      { key: 'from', label: 'From', type: 'text', placeholder: '0x...' },
      { key: 'to', label: 'To', type: 'text', placeholder: '0x...' },
      { key: 'min_value', label: 'Min Value (wei)', type: 'number', placeholder: '0' },
    ],
  },
  {
    type: 'trigger_contract_event', label: 'Contract Event', category: 'trigger',
    icon: ScrollText, color: COLORS.trigger, eventType: 'contract.event',
    configFields: [
      { key: 'contract_address', label: 'Contract', type: 'text', placeholder: '0x...' },
      { key: 'event_names', label: 'Events', type: 'text', placeholder: 'Deposit,Withdraw', isArray: true },
    ],
  },
  {
    type: 'trigger_balance_change', label: 'Balance Change', category: 'trigger',
    icon: Wallet, color: COLORS.trigger, eventType: 'ft.large_transfer',
    configFields: [
      { key: 'addresses', label: 'Addresses', type: 'text', placeholder: '0x1', isArray: true },
      { key: 'token_contract', label: 'Token', type: 'select', options: FT_TOKENS },
      { key: 'min_amount', label: 'Threshold', type: 'number', placeholder: '1000' },
    ],
  },
  {
    type: 'trigger_schedule', label: 'Schedule', category: 'trigger',
    icon: Clock, color: COLORS.trigger, eventType: 'schedule',
    configFields: [
      { key: 'cron', label: 'Cron Expression', type: 'text', placeholder: '0 * * * *' },
      { key: 'timezone', label: 'Timezone', type: 'text', placeholder: 'UTC' },
    ],
  },
]

// ---------------------------------------------------------------------------
// Condition nodes
// ---------------------------------------------------------------------------

const CONDITION_NODES: NodeTypeMeta[] = [
  {
    type: 'condition_if', label: 'IF', category: 'condition',
    icon: GitBranch, color: COLORS.condition, outputs: 2,
    configFields: [
      { key: 'field', label: 'Field', type: 'text', placeholder: 'amount' },
      { key: 'operator', label: 'Operator', type: 'select', options: ['==', '!=', '>', '<', '>=', '<=', 'contains', 'starts_with'] },
      { key: 'value', label: 'Value', type: 'text', placeholder: '' },
    ],
  },
  {
    type: 'condition_filter', label: 'Filter', category: 'condition',
    icon: Filter, color: COLORS.condition,
    configFields: [
      { key: 'field', label: 'Field', type: 'text', placeholder: 'token' },
      { key: 'operator', label: 'Operator', type: 'select', options: ['==', '!=', '>', '<', 'contains'] },
      { key: 'value', label: 'Value', type: 'text', placeholder: '' },
    ],
  },
]

// ---------------------------------------------------------------------------
// Destination nodes
// ---------------------------------------------------------------------------

const DESTINATION_NODES: NodeTypeMeta[] = [
  {
    type: 'dest_webhook', label: 'Webhook', category: 'destination',
    icon: Globe, color: COLORS.destination,
    configFields: [
      { key: 'url', label: 'URL', type: 'text', placeholder: 'https://...' },
      { key: 'method', label: 'Method', type: 'select', options: ['POST', 'PUT', 'PATCH'] },
    ],
  },
  {
    type: 'dest_slack', label: 'Slack', category: 'destination',
    icon: MessageSquare, color: COLORS.destination,
    configFields: [
      { key: 'webhook_url', label: 'Webhook URL', type: 'text', placeholder: 'https://hooks.slack.com/...' },
    ],
  },
  {
    type: 'dest_discord', label: 'Discord', category: 'destination',
    icon: Hash, color: COLORS.destination,
    configFields: [
      { key: 'webhook_url', label: 'Webhook URL', type: 'text', placeholder: 'https://discord.com/api/webhooks/...' },
    ],
  },
  {
    type: 'dest_telegram', label: 'Telegram', category: 'destination',
    icon: Send, color: COLORS.destination,
    configFields: [
      { key: 'bot_token', label: 'Bot Token', type: 'text', placeholder: '123456:ABC-DEF...' },
      { key: 'chat_id', label: 'Chat ID', type: 'text', placeholder: '-100...' },
    ],
  },
  {
    type: 'dest_email', label: 'Email', category: 'destination',
    icon: Mail, color: COLORS.destination,
    configFields: [
      { key: 'to', label: 'To', type: 'text', placeholder: 'user@example.com' },
      { key: 'subject', label: 'Subject', type: 'text', placeholder: 'Alert: {{event_type}}' },
    ],
  },
]

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const ALL_NODE_TYPES: NodeTypeMeta[] = [
  ...TRIGGER_NODES,
  ...CONDITION_NODES,
  ...DESTINATION_NODES,
]

/** Lookup by ReactFlow node type string */
export const NODE_TYPE_MAP: Record<string, NodeTypeMeta> = Object.fromEntries(
  ALL_NODE_TYPES.map((n) => [n.type, n])
)

export const TRIGGER_NODE_TYPES = TRIGGER_NODES
export const CONDITION_NODE_TYPES = CONDITION_NODES
export const DESTINATION_NODE_TYPES = DESTINATION_NODES

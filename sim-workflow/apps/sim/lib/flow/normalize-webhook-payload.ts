function normalizeFlowAddress(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return ''
  return value.startsWith('0x') ? value : `0x${value}`
}

function extractEventName(data: Record<string, unknown>): string {
  if (typeof data.event_name === 'string' && data.event_name.length > 0) {
    return data.event_name
  }

  if (typeof data.type === 'string' && data.type.length > 0) {
    const parts = data.type.split('.')
    return parts[parts.length - 1] || data.type
  }

  return ''
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

export function formatFlowWebhookInput(
  body: Record<string, unknown>,
  triggerId?: string
): Record<string, unknown> {
  const eventType = typeof body.event_type === 'string' ? body.event_type : ''
  const data = asObject(body.data) ?? body
  const payload = asObject(data.payload)

  const timestamp =
    typeof data.timestamp === 'string'
      ? data.timestamp
      : typeof body.timestamp === 'string'
        ? body.timestamp
        : ''

  const transactionId =
    typeof data.transaction_id === 'string'
      ? data.transaction_id
      : typeof data.tx_hash === 'string'
        ? data.tx_hash
        : ''

  const address =
    normalizeFlowAddress(data.address) ||
    normalizeFlowAddress(data.contract_address) ||
    normalizeFlowAddress(payload?.address)

  const eventName = extractEventName(data)

  const normalized = {
    eventType,
    eventName,
    address,
    blockHeight:
      typeof data.block_height === 'number'
        ? data.block_height
        : typeof body.block_height === 'number'
          ? body.block_height
          : 0,
    timestamp,
    transactionId,
    from: normalizeFlowAddress(data.from_address || data.sender),
    to: normalizeFlowAddress(data.to_address || data.receiver),
    amount: String(data.amount ?? ''),
    token:
      typeof data.token_symbol === 'string'
        ? data.token_symbol
        : typeof data.token === 'string'
          ? data.token
          : '',
    nftId: typeof data.nft_id === 'string' ? data.nft_id : '',
    collection:
      typeof data.collection === 'string'
        ? data.collection
        : typeof data.nft_type === 'string'
          ? data.nft_type
          : '',
    proposer: normalizeFlowAddress(data.proposer),
    payer: normalizeFlowAddress(data.payer),
    authorizers: Array.isArray(data.authorizers)
      ? data.authorizers.map(normalizeFlowAddress).filter(Boolean)
      : [],
    status: typeof data.status === 'string' ? data.status : '',
    isEvm: Boolean(data.is_evm),
    nodeId: typeof data.node_id === 'string' ? data.node_id : '',
    delegatorId:
      typeof data.delegator_id === 'string' || typeof data.delegator_id === 'number'
        ? String(data.delegator_id)
        : '',
    stakingAmount: String(data.staking_amount ?? ''),
    pool:
      typeof data.pool === 'string'
        ? data.pool
        : typeof data.pair_address === 'string'
          ? data.pair_address
          : '',
    swapAmountIn: String(data.amount_in ?? ''),
    swapAmountOut: String(data.amount_out ?? ''),
    evmHash: typeof data.evm_hash === 'string' ? data.evm_hash : '',
    gasUsed: typeof data.gas_used === 'number' ? data.gas_used : 0,
    data,
    raw: JSON.stringify(body),
  }

  if (triggerId === 'flow_new_account') {
    return {
      eventType: normalized.eventType,
      eventName: normalized.eventName,
      address: normalized.address,
      blockHeight: normalized.blockHeight,
      timestamp: normalized.timestamp,
      transactionId: normalized.transactionId,
      data: normalized.data,
      raw: normalized.raw,
    }
  }

  if (triggerId === 'flow_balance_change') {
    return {
      eventType: normalized.eventType,
      address: normalized.address,
      token: normalized.token,
      balance: typeof data.balance === 'string' ? data.balance : '',
      previousBalance: typeof data.previous_balance === 'string' ? data.previous_balance : '',
      change: typeof data.change === 'string' ? data.change : '',
      blockHeight: normalized.blockHeight,
      timestamp: normalized.timestamp,
      data: normalized.data,
      raw: normalized.raw,
    }
  }

  return normalized
}

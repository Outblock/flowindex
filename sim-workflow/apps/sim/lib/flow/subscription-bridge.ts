/**
 * Flow Subscription Bridge
 *
 * Registers and manages webhook subscriptions with the FlowIndex Go backend.
 * When a workflow with Flow triggers is deployed, this bridge creates
 * subscriptions so that matching blockchain events are forwarded to the
 * Sim Studio webhook trigger URL.
 *
 * Uses per-user FlowIndex API keys, auto-provisioned on first deploy and
 * encrypted at rest in Studio's database.
 */
import { db } from '@sim/db'
import { flowindexApiKey } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { encryptApiKeyForStorage, decryptApiKeyFromStorage } from '@/lib/api-key/auth'
import { createLogger } from '@sim/logger'
import { env } from '@/lib/core/config/env'

const logger = createLogger('FlowSubscriptionBridge')

const FLOW_API_BASE = env.FLOWINDEX_API_URL || 'http://127.0.0.1:8080'

/**
 * Map from Sim Studio trigger IDs to FlowIndex event types.
 */
const TRIGGER_TO_EVENT_TYPE: Record<string, string> = {
  flow_ft_transfer: 'ft.transfer',
  flow_nft_transfer: 'nft.transfer',
  flow_tx_sealed: 'address.activity',
  flow_contract_event: 'contract.event',
  flow_account_event: 'account.key_change',
  flow_balance_change: 'ft.transfer',
  flow_staking_event: 'staking.event',
  flow_evm_tx: 'evm.transaction',
  flow_defi_event: 'defi.swap',
  flow_large_transfer: 'ft.large_transfer',
  flow_whale_activity: 'address.activity',
  flow_contract_deploy: 'account.key_change',
  flow_new_account: 'account.key_change',
  // flow_schedule is handled by cron, not webhook subscriptions
}

interface FlowIndexApiResponse {
  id: string
  [key: string]: unknown
}

interface FlowIndexApiKeyResult {
  apiKey: string
  endpointId?: string
  signingSecret?: string
}

/**
 * Makes an authenticated request to the FlowIndex API.
 */
async function flowIndexFetch<T = FlowIndexApiResponse>(
  path: string,
  apiKey: string,
  options?: { method?: string; body?: unknown }
): Promise<T> {
  const res = await fetch(`${FLOW_API_BASE}${path}`, {
    method: options?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`FlowIndex API ${res.status}: ${text}`)
  }

  return (await res.json()) as T
}

/**
 * Retrieves or provisions a FlowIndex API key for the given user.
 *
 * On first call for a user, creates a new API key via the FlowIndex API
 * (authenticated with the user's Supabase JWT), encrypts the key, and
 * stores it in Studio's database. Subsequent calls return the cached key.
 */
export async function getOrCreateFlowIndexApiKey(
  userId: string,
  supabaseJwt?: string
): Promise<FlowIndexApiKeyResult> {
  const existing = await db
    .select()
    .from(flowindexApiKey)
    .where(eq(flowindexApiKey.userId, userId))
    .limit(1)

  if (existing.length > 0) {
    const row = existing[0]
    const apiKey = await decryptApiKeyFromStorage(row.encryptedKey)
    return {
      apiKey,
      endpointId: row.endpointId ?? undefined,
      signingSecret: row.signingSecret ?? undefined,
    }
  }

  // Provision a new API key via FlowIndex
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (supabaseJwt) {
    headers['Authorization'] = `Bearer ${supabaseJwt}`
  }

  const res = await fetch(`${FLOW_API_BASE}/api/v1/api-keys`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: `sim-studio-${userId}` }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Failed to provision FlowIndex API key: ${res.status} ${text}`)
  }

  const data = (await res.json()) as { key: string; prefix: string; id: string }

  const encrypted = await encryptApiKeyForStorage(data.key)

  try {
    await db.insert(flowindexApiKey).values({
      id: crypto.randomUUID(),
      userId,
      encryptedKey: encrypted,
      keyPrefix: data.prefix ?? data.key.slice(0, 8),
    })
  } catch (error: unknown) {
    // Race condition: another request created the key first
    const msg = error instanceof Error ? error.message : ''
    if (msg.includes('unique') || msg.includes('duplicate') || msg.includes('constraint')) {
      const [existing] = await db
        .select()
        .from(flowindexApiKey)
        .where(eq(flowindexApiKey.userId, userId))
        .limit(1)
      if (existing) {
        return {
          apiKey: await decryptApiKeyFromStorage(existing.encryptedKey),
          endpointId: existing.endpointId ?? undefined,
          signingSecret: existing.signingSecret ?? undefined,
        }
      }
    }
    throw error
  }

  logger.info('Provisioned FlowIndex API key for user', {
    userId,
    keyPrefix: data.prefix ?? data.key.slice(0, 8),
  })

  return { apiKey: data.key }
}

/**
 * Updates the stored endpoint ID and signing secret for a user's FlowIndex key.
 */
async function updateEndpointInfo(
  userId: string,
  endpointId: string,
  signingSecret?: string
): Promise<void> {
  await db
    .update(flowindexApiKey)
    .set({
      endpointId,
      signingSecret: signingSecret ?? null,
      updatedAt: new Date(),
    })
    .where(eq(flowindexApiKey.userId, userId))
}

/**
 * Ensures a webhook endpoint exists for the given callback URL.
 * Returns the endpoint ID and signing secret.
 */
async function ensureEndpoint(
  callbackUrl: string,
  workflowId: string,
  apiKey: string,
  userId: string,
  storedEndpointId?: string,
  storedSigningSecret?: string
): Promise<{ endpointId: string; signingSecret?: string }> {
  // If we already have a stored endpoint, verify it still exists
  if (storedEndpointId) {
    try {
      await flowIndexFetch(`/api/v1/endpoints/${storedEndpointId}`, apiKey)
      return { endpointId: storedEndpointId, signingSecret: storedSigningSecret }
    } catch {
      // Endpoint was deleted, create a new one
      logger.warn('Stored endpoint no longer exists, creating new one', {
        endpointId: storedEndpointId,
        userId,
      })
    }
  }

  // Try to find existing endpoint for this callback URL
  const endpoints = await flowIndexFetch<{ data: Array<{ id: string; url: string; signing_secret?: string }> }>(
    '/api/v1/endpoints',
    apiKey
  )

  const existing = endpoints.data?.find((ep) => ep.url === callbackUrl)
  if (existing) {
    await updateEndpointInfo(userId, existing.id, existing.signing_secret)
    return { endpointId: existing.id, signingSecret: existing.signing_secret }
  }

  // Create new endpoint
  const result = await flowIndexFetch<{ id: string; signing_secret?: string }>(
    '/api/v1/endpoints',
    apiKey,
    {
      method: 'POST',
      body: {
        url: callbackUrl,
        description: `Sim Studio workflow ${workflowId}`,
        endpoint_type: 'direct',
      },
    }
  )

  await updateEndpointInfo(userId, result.id, result.signing_secret)

  return { endpointId: result.id, signingSecret: result.signing_secret }
}

/**
 * Registers Flow blockchain subscriptions for a deployed workflow.
 * Called when a workflow containing Flow trigger blocks is deployed.
 */
export async function registerFlowSubscriptions(params: {
  workflowId: string
  triggerId: string
  conditions: Record<string, unknown>
  callbackUrl: string
  userId: string
  supabaseJwt?: string
}): Promise<{ subscriptionId: string; signingSecret?: string } | null> {
  const eventType = TRIGGER_TO_EVENT_TYPE[params.triggerId]
  if (!eventType) {
    // Trigger doesn't need a webhook subscription (e.g., flow_schedule)
    return null
  }

  try {
    const keyResult = await getOrCreateFlowIndexApiKey(params.userId, params.supabaseJwt)

    const { endpointId, signingSecret } = await ensureEndpoint(
      params.callbackUrl,
      params.workflowId,
      keyResult.apiKey,
      params.userId,
      keyResult.endpointId,
      keyResult.signingSecret
    )

    const sub = await flowIndexFetch<FlowIndexApiResponse>(
      '/api/v1/subscriptions',
      keyResult.apiKey,
      {
        method: 'POST',
        body: {
          endpoint_id: endpointId,
          event_type: eventType,
          conditions: params.conditions,
          workflow_id: params.workflowId,
        },
      }
    )

    logger.info('Registered Flow subscription', {
      subscriptionId: sub.id,
      workflowId: params.workflowId,
      triggerId: params.triggerId,
      eventType,
    })

    return { subscriptionId: sub.id, signingSecret }
  } catch (error) {
    logger.error('Failed to register Flow subscription', {
      workflowId: params.workflowId,
      triggerId: params.triggerId,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Deletes a single Flow subscription.
 */
export async function deleteFlowSubscription(
  subscriptionId: string,
  workflow: { userId: string }
): Promise<void> {
  try {
    const keyResult = await getOrCreateFlowIndexApiKey(workflow.userId)
    await flowIndexFetch(`/api/v1/subscriptions/${subscriptionId}`, keyResult.apiKey, {
      method: 'DELETE',
    })
    logger.info('Deleted Flow subscription', { subscriptionId })
  } catch (error) {
    logger.warn('Failed to delete Flow subscription', {
      subscriptionId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Removes all Flow subscriptions for a workflow.
 * Called when a workflow is undeployed.
 */
export async function deleteFlowSubscriptionsForWorkflow(
  workflowId: string,
  userId: string
): Promise<void> {
  try {
    const keyResult = await getOrCreateFlowIndexApiKey(userId)

    const subs = await flowIndexFetch<{ data: Array<{ id: string; workflow_id: string }> }>(
      '/api/v1/subscriptions',
      keyResult.apiKey
    )

    const workflowSubs = subs.data?.filter((s) => s.workflow_id === workflowId) || []

    for (const sub of workflowSubs) {
      await flowIndexFetch(`/api/v1/subscriptions/${sub.id}`, keyResult.apiKey, {
        method: 'DELETE',
      })
    }

    if (workflowSubs.length > 0) {
      logger.info('Deleted Flow subscriptions for workflow', {
        workflowId,
        count: workflowSubs.length,
      })
    }
  } catch (error) {
    logger.warn('Failed to delete Flow subscriptions', {
      workflowId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Extracts Flow trigger conditions from block subBlocks config.
 * Converts the UI field values into the conditions format expected
 * by FlowIndex matcher.
 */
export function extractFlowConditions(
  triggerId: string,
  subBlockValues: Record<string, unknown>
): Record<string, unknown> {
  const conditions: Record<string, unknown> = {}

  switch (triggerId) {
    case 'flow_ft_transfer':
    case 'flow_large_transfer':
      if (subBlockValues.token && subBlockValues.token !== 'any') {
        conditions.token = subBlockValues.token
      }
      if (subBlockValues.minAmount) {
        conditions.min_amount = subBlockValues.minAmount
      }
      if (subBlockValues.threshold) {
        conditions.min_amount = subBlockValues.threshold
      }
      if (subBlockValues.addressFilter) {
        conditions.address = String(subBlockValues.addressFilter).replace(/^0x/, '').toLowerCase()
      }
      break

    case 'flow_nft_transfer':
      if (subBlockValues.collection) {
        conditions.nft_type = subBlockValues.collection
      }
      if (subBlockValues.addressFilter) {
        conditions.address = String(subBlockValues.addressFilter).replace(/^0x/, '').toLowerCase()
      }
      break

    case 'flow_tx_sealed':
    case 'flow_whale_activity':
      if (subBlockValues.addressFilter) {
        conditions.address = String(subBlockValues.addressFilter).replace(/^0x/, '').toLowerCase()
      }
      if (subBlockValues.addressList) {
        conditions.addresses = String(subBlockValues.addressList)
          .split('\n')
          .map((a) => a.trim().replace(/^0x/, '').toLowerCase())
          .filter(Boolean)
      }
      break

    case 'flow_contract_event':
      if (subBlockValues.eventType) {
        conditions.event_type = subBlockValues.eventType
      }
      break

    case 'flow_account_event':
      if (subBlockValues.eventCategory && subBlockValues.eventCategory !== 'any') {
        conditions.event_category = subBlockValues.eventCategory
      }
      if (subBlockValues.addressFilter) {
        conditions.address = String(subBlockValues.addressFilter).replace(/^0x/, '').toLowerCase()
      }
      break

    case 'flow_balance_change':
      if (subBlockValues.addressFilter) {
        conditions.address = String(subBlockValues.addressFilter).replace(/^0x/, '').toLowerCase()
      }
      if (subBlockValues.token) {
        conditions.token = subBlockValues.token
      }
      if (subBlockValues.threshold) {
        conditions.threshold = subBlockValues.threshold
      }
      if (subBlockValues.direction) {
        conditions.direction = subBlockValues.direction
      }
      break

    case 'flow_staking_event':
      if (subBlockValues.delegatorAddress) {
        conditions.address = String(subBlockValues.delegatorAddress)
          .replace(/^0x/, '')
          .toLowerCase()
      }
      if (subBlockValues.stakingEventType && subBlockValues.stakingEventType !== 'any') {
        conditions.event_type = subBlockValues.stakingEventType
      }
      break

    case 'flow_evm_tx':
      if (subBlockValues.fromAddress) {
        conditions.from = String(subBlockValues.fromAddress).toLowerCase()
      }
      if (subBlockValues.toAddress) {
        conditions.to = String(subBlockValues.toAddress).toLowerCase()
      }
      break

    case 'flow_defi_event':
      if (subBlockValues.pool) {
        conditions.pool = subBlockValues.pool
      }
      if (subBlockValues.defiDirection && subBlockValues.defiDirection !== 'any') {
        conditions.direction = subBlockValues.defiDirection
      }
      break

    case 'flow_contract_deploy':
      if (subBlockValues.addressFilter) {
        conditions.address = String(subBlockValues.addressFilter).replace(/^0x/, '').toLowerCase()
      }
      conditions.event_category = 'account.contract.added'
      break

    case 'flow_new_account':
      conditions.event_category = 'account.created'
      break
  }

  return conditions
}

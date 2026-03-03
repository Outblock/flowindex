import { db, customTools, mcpServers, skill, workflow, workspaceEnvironment } from '@sim/db'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { isFlowIndexSupabaseCookieAuth } from '@/lib/core/config/feature-flags'
import {
  buildDefaultWorkflowArtifacts,
  type StartInputFormatField,
} from '@/lib/workflows/defaults'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/persistence/utils'

const logger = createLogger('FlowIndexWorkspaceSeed')
const seededWorkspaceCache = new Set<string>()

interface McpTemplate {
  name: string
  description: string
  transport: string
  url: string
  timeout: number
  retries: number
}

interface CustomToolTemplate {
  title: string
  schema: Record<string, unknown>
  code: string
}

interface SkillTemplate {
  name: string
  description: string
  content: string
}

interface WorkflowTemplate {
  name: string
  description: string
  color: string
  inputFormat: StartInputFormatField[]
}

const MCP_TEMPLATES: McpTemplate[] = [
  {
    name: 'Flow EVM MCP',
    description: 'Flow EVM tools for contracts, events, and transactions',
    transport: 'streamable-http',
    url: 'https://flow-evm-mcp.up.railway.app/mcp',
    timeout: 30000,
    retries: 3,
  },
  {
    name: 'Cadence MCP',
    description: 'Cadence tools for contracts, docs, and static analysis',
    transport: 'streamable-http',
    url: 'https://cadence-mcp.up.railway.app/mcp',
    timeout: 30000,
    retries: 3,
  },
]

const CUSTOM_TOOL_TEMPLATES: CustomToolTemplate[] = [
  {
    title: 'Flow Onchain Events',
    schema: {
      type: 'object',
      properties: {
        event_type: { type: 'string', description: 'Event type to query' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 25 },
      },
      required: ['event_type'],
    },
    code: `export default async function run(input) {
  const eventType = input?.event_type
  const limit = Number(input?.limit ?? 25)
  if (!eventType) throw new Error('event_type is required')
  const boundedLimit = Math.min(Math.max(limit, 1), 200)
  const url = 'https://flowindex.io/api/v1/events?type=' + encodeURIComponent(eventType) + '&limit=' + boundedLimit
  const res = await fetch(url)
  if (!res.ok) throw new Error('Flow event query failed: ' + res.status)
  return await res.json()
}`,
  },
  {
    title: 'Cadence Contract Events',
    schema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Contract address, e.g. 0x1' },
        contract_name: { type: 'string', description: 'Contract name' },
        event_name: { type: 'string', description: 'Event name' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 25 },
      },
      required: ['address', 'contract_name', 'event_name'],
    },
    code: `export default async function run(input) {
  const address = input?.address
  const contractName = input?.contract_name
  const eventName = input?.event_name
  const limit = Number(input?.limit ?? 25)
  if (!address || !contractName || !eventName) {
    throw new Error('address, contract_name, and event_name are required')
  }
  const query = address + '.' + contractName + '.' + eventName
  const boundedLimit = Math.min(Math.max(limit, 1), 200)
  const url = 'https://flowindex.io/api/v1/events?type=' + encodeURIComponent(query) + '&limit=' + boundedLimit
  const res = await fetch(url)
  if (!res.ok) throw new Error('Cadence event query failed: ' + res.status)
  return await res.json()
}`,
  },
  {
    title: 'Cadence Account Events',
    schema: {
      type: 'object',
      properties: {
        account: { type: 'string', description: 'Flow account address (e.g. 0x1)' },
        event_type: { type: 'string', description: 'Optional full event type' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      },
      required: ['account'],
    },
    code: `export default async function run(input) {
  const account = input?.account
  const eventType = input?.event_type
  const limit = Number(input?.limit ?? 50)
  if (!account) throw new Error('account is required')
  const q = new URLSearchParams()
  q.set('account', account)
  q.set('limit', String(Math.min(Math.max(limit, 1), 200)))
  if (eventType) q.set('type', eventType)
  const url = 'https://flowindex.io/api/v1/events?' + q.toString()
  const res = await fetch(url)
  if (!res.ok) throw new Error('Cadence account event query failed: ' + res.status)
  return await res.json()
}`,
  },
  {
    title: 'Cadence Events By Block Range',
    schema: {
      type: 'object',
      properties: {
        event_type: { type: 'string', description: 'Full event type' },
        from_block_height: { type: 'integer', description: 'Start block height' },
        to_block_height: { type: 'integer', description: 'End block height' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
      },
      required: ['event_type'],
    },
    code: `export default async function run(input) {
  const eventType = input?.event_type
  const fromBlock = input?.from_block_height
  const toBlock = input?.to_block_height
  const limit = Number(input?.limit ?? 100)
  if (!eventType) throw new Error('event_type is required')
  const q = new URLSearchParams()
  q.set('type', eventType)
  q.set('limit', String(Math.min(Math.max(limit, 1), 200)))
  if (fromBlock !== undefined && fromBlock !== null && fromBlock !== '') {
    q.set('from_block_height', String(fromBlock))
  }
  if (toBlock !== undefined && toBlock !== null && toBlock !== '') {
    q.set('to_block_height', String(toBlock))
  }
  const url = 'https://flowindex.io/api/v1/events?' + q.toString()
  const res = await fetch(url)
  if (!res.ok) throw new Error('Cadence block range query failed: ' + res.status)
  return await res.json()
}`,
  },
  {
    title: 'Cadence Transaction Events',
    schema: {
      type: 'object',
      properties: {
        tx_id: { type: 'string', description: 'Flow transaction id' },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      },
      required: ['tx_id'],
    },
    code: `export default async function run(input) {
  const txId = input?.tx_id
  const limit = Number(input?.limit ?? 50)
  if (!txId) throw new Error('tx_id is required')
  const q = new URLSearchParams()
  q.set('tx_id', txId)
  q.set('limit', String(Math.min(Math.max(limit, 1), 200)))
  const url = 'https://flowindex.io/api/v1/events?' + q.toString()
  const res = await fetch(url)
  if (!res.ok) throw new Error('Cadence tx event query failed: ' + res.status)
  return await res.json()
}`,
  },
]

const SKILL_TEMPLATES: SkillTemplate[] = [
  {
    name: 'Cadence MCP Operator',
    description: 'How to use Cadence MCP + Flow EVM MCP together for contract/event debugging.',
    content: `# Cadence MCP Operator

Goal: Debug contracts and events with a repeatable loop.

1. Use Cadence MCP to inspect contract interface and event signatures.
2. Use Flow EVM MCP for tx and execution context.
3. Use Cadence Contract Events custom tool to fetch indexed events.
4. Correlate tx_id + block height + event payload.

Output checklist:
- Contract address
- Event signature
- tx_id
- block height range
- decoded payload summary
`,
  },
  {
    name: 'Cadence Trigger Playbook',
    description: 'Trigger patterns for schedule/webhook/API based Cadence automations.',
    content: `# Cadence Trigger Playbook

## Schedule trigger
- Run every N minutes.
- Use Cadence Events By Block Range with stored last height.
- Persist checkpoint after each successful run.

## Webhook trigger
- Accept incoming event payloads from relayers.
- Validate signature/token before processing.
- Normalize payload into standard {event_type, tx_id, block_height, payload} schema.

## API trigger
- Expose query workflow for ad-hoc investigations.
- Accept address, contract_name, event_name, limit.
- Return compact JSON for dashboards.
`,
  },
  {
    name: 'Cadence Event Investigation',
    description: 'Incident-response workflow for missing or malformed onchain events.',
    content: `# Cadence Event Investigation

When an expected event is missing:

1. Verify tx execution status and block inclusion.
2. Query by tx_id using Cadence Transaction Events.
3. Query by event signature + block range using Cadence Events By Block Range.
4. Check account-scoped events with Cadence Account Events.
5. Record root cause: emit failure, index lag, filter mismatch, or decode mismatch.

Template RCA fields:
- incident_id
- expected_event
- observed_event_count
- affected_range
- mitigation
`,
  },
]

const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    name: 'flow-event-starter',
    description: 'Flow event polling starter',
    color: '#2ed96a',
    inputFormat: [
      {
        name: 'event_type',
        type: 'string',
        value: 'A.0ae53cb6e3f42a79.FlowToken.TokensDeposited',
      },
      { name: 'limit', type: 'number', value: 100 },
    ],
  },
  {
    name: 'cadence-schedule-trigger',
    description: 'Cadence event polling starter (schedule-friendly)',
    color: '#2563eb',
    inputFormat: [
      {
        name: 'event_type',
        type: 'string',
        value: 'A.0ae53cb6e3f42a79.FlowToken.TokensDeposited',
      },
      { name: 'from_block_height', type: 'number', value: 0 },
      { name: 'to_block_height', type: 'number', value: 0 },
      { name: 'limit', type: 'number', value: 100 },
    ],
  },
  {
    name: 'cadence-webhook-trigger',
    description: 'Cadence webhook ingestion starter',
    color: '#0ea5e9',
    inputFormat: [
      { name: 'event_type', type: 'string', value: '' },
      { name: 'payload', type: 'string', value: '' },
      { name: 'source', type: 'string', value: 'webhook' },
    ],
  },
  {
    name: 'cadence-api-trigger',
    description: 'Cadence API starter for contract event lookups',
    color: '#7c3aed',
    inputFormat: [
      { name: 'address', type: 'string', value: '0x1' },
      { name: 'contract_name', type: 'string', value: 'FlowToken' },
      { name: 'event_name', type: 'string', value: 'TokensDeposited' },
      { name: 'limit', type: 'number', value: 50 },
    ],
  },
]

function getCacheKey(userId: string, workspaceId: string): string {
  return `${userId}:${workspaceId}`
}

async function upsertWorkspaceEnvironment(workspaceId: string, now: Date): Promise<void> {
  await db
    .insert(workspaceEnvironment)
    .values({
      id: crypto.randomUUID(),
      workspaceId,
      variables: {},
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: workspaceEnvironment.workspaceId,
    })
}

async function upsertMcpServers(workspaceId: string, userId: string, now: Date): Promise<void> {
  const existingRows = await db
    .select({
      id: mcpServers.id,
      name: mcpServers.name,
    })
    .from(mcpServers)
    .where(eq(mcpServers.workspaceId, workspaceId))

  const existingByName = new Map(existingRows.map((row) => [row.name, row.id]))

  for (const template of MCP_TEMPLATES) {
    const existingId = existingByName.get(template.name)

    if (existingId) {
      await db
        .update(mcpServers)
        .set({
          createdBy: userId,
          description: template.description,
          transport: template.transport,
          url: template.url,
          headers: {},
          timeout: template.timeout,
          retries: template.retries,
          enabled: true,
          deletedAt: null,
          updatedAt: now,
        })
        .where(eq(mcpServers.id, existingId))
      continue
    }

    await db.insert(mcpServers).values({
      id: crypto.randomUUID(),
      workspaceId,
      createdBy: userId,
      name: template.name,
      description: template.description,
      transport: template.transport,
      url: template.url,
      headers: {},
      timeout: template.timeout,
      retries: template.retries,
      enabled: true,
      connectionStatus: 'disconnected',
      toolCount: 0,
      statusConfig: {},
      createdAt: now,
      updatedAt: now,
    })
  }
}

async function upsertCustomTools(workspaceId: string, userId: string, now: Date): Promise<void> {
  for (const toolTemplate of CUSTOM_TOOL_TEMPLATES) {
    await db
      .insert(customTools)
      .values({
        id: crypto.randomUUID(),
        workspaceId,
        userId,
        title: toolTemplate.title,
        schema: toolTemplate.schema,
        code: toolTemplate.code,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [customTools.workspaceId, customTools.title],
        set: {
          userId,
          schema: toolTemplate.schema,
          code: toolTemplate.code,
          updatedAt: now,
        },
      })
  }
}

async function upsertSkills(workspaceId: string, userId: string, now: Date): Promise<void> {
  for (const skillTemplate of SKILL_TEMPLATES) {
    await db
      .insert(skill)
      .values({
        id: crypto.randomUUID(),
        workspaceId,
        userId,
        name: skillTemplate.name,
        description: skillTemplate.description,
        content: skillTemplate.content,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [skill.workspaceId, skill.name],
        set: {
          userId,
          description: skillTemplate.description,
          content: skillTemplate.content,
          updatedAt: now,
        },
      })
  }
}

async function ensureStarterWorkflows(workspaceId: string, userId: string, now: Date): Promise<void> {
  const existingRows = await db
    .select({
      name: workflow.name,
      sortOrder: workflow.sortOrder,
    })
    .from(workflow)
    .where(eq(workflow.workspaceId, workspaceId))

  const existingNames = new Set(existingRows.map((row) => row.name))
  let nextSortOrder = existingRows.reduce((max, row) => Math.max(max, row.sortOrder || 0), -1) + 1

  for (const template of WORKFLOW_TEMPLATES) {
    if (existingNames.has(template.name)) {
      continue
    }

    const workflowId = crypto.randomUUID()

    await db.insert(workflow).values({
      id: workflowId,
      userId,
      workspaceId,
      folderId: null,
      sortOrder: nextSortOrder,
      name: template.name,
      description: template.description,
      color: template.color,
      lastSynced: now,
      createdAt: now,
      updatedAt: now,
      isDeployed: false,
      runCount: 0,
      variables: {},
      isPublicApi: false,
    })

    const { workflowState } = buildDefaultWorkflowArtifacts({
      startInputFormatFields: template.inputFormat,
    })
    const seedResult = await saveWorkflowToNormalizedTables(workflowId, workflowState)
    if (!seedResult.success) {
      throw new Error(seedResult.error || `Failed to seed starter workflow: ${template.name}`)
    }

    existingNames.add(template.name)
    nextSortOrder += 1
  }
}

export async function ensureFlowIndexWorkspaceSeedPack(params: {
  workspaceId: string
  userId: string
  force?: boolean
}): Promise<void> {
  const { workspaceId, userId, force = false } = params

  if (!isFlowIndexSupabaseCookieAuth) return
  if (!workspaceId || !userId) return

  const cacheKey = getCacheKey(userId, workspaceId)
  if (!force && seededWorkspaceCache.has(cacheKey)) {
    return
  }

  const now = new Date()

  try {
    await upsertWorkspaceEnvironment(workspaceId, now)
    await upsertMcpServers(workspaceId, userId, now)
    await upsertCustomTools(workspaceId, userId, now)
    await upsertSkills(workspaceId, userId, now)
    await ensureStarterWorkflows(workspaceId, userId, now)
    seededWorkspaceCache.add(cacheKey)
  } catch (error) {
    seededWorkspaceCache.delete(cacheKey)
    logger.error('Failed to seed FlowIndex workspace pack', {
      workspaceId,
      userId,
      error,
    })
    throw error
  }
}

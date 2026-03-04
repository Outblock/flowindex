import { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { seedFlowTemplates } from '@/lib/flow/seed'

const logger = createLogger('FlowIndexWorkspace')

const checkedUsers = new Set<string>()
const pendingUsers = new Map<string, Promise<void>>()

/**
 * Ensures a FlowIndex user has a personal workspace.
 * Called during session resolution — skips quickly if already checked.
 * Uses per-user Promise lock to prevent concurrent duplicate creation.
 */
export async function ensurePersonalWorkspace(
  userId: string,
  name: string
): Promise<void> {
  if (checkedUsers.has(userId)) return

  // Per-user lock: if another request is already creating for this user, wait for it
  const pending = pendingUsers.get(userId)
  if (pending) {
    await pending
    return
  }

  const promise = doEnsurePersonalWorkspace(userId, name)
  pendingUsers.set(userId, promise)

  try {
    await promise
  } finally {
    pendingUsers.delete(userId)
  }
}

async function doEnsurePersonalWorkspace(userId: string, name: string): Promise<void> {
  // Re-check after acquiring lock
  if (checkedUsers.has(userId)) return

  // Always seed Flow templates (idempotent — skips existing rows)
  await seedFlowTemplates()

  // Check if user already has any workspace permission
  const existingPermission = await db.query.permissions.findFirst({
    where: eq(schema.permissions.userId, userId),
    columns: { id: true },
  })

  if (existingPermission) {
    checkedUsers.add(userId)
    return
  }

  // Create personal workspace + permission atomically
  const workspaceId = crypto.randomUUID()
  const now = new Date()

  await db.transaction(async (tx) => {
    await tx.insert(schema.workspace).values({
      id: workspaceId,
      name: `${name}'s Workspace`,
      ownerId: userId,
      billedAccountUserId: userId,
      createdAt: now,
      updatedAt: now,
    })

    await tx.insert(schema.permissions).values({
      id: crypto.randomUUID(),
      userId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin',
      createdAt: now,
      updatedAt: now,
    })
  })

  logger.info('Created personal workspace for FlowIndex user', { userId, workspaceId })
  checkedUsers.add(userId)
}

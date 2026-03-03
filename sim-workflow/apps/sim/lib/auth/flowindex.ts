import { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { env } from '@/lib/core/config/env'
import {
  extractFlowIndexAccessTokenFromCookieHeader,
  type FlowIndexJwtPayload,
  verifyFlowIndexAccessToken,
} from './flowindex-cookie'

const logger = createLogger('FlowIndexAuth')

const DEFAULT_WORKSPACE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

let checkedDefaultWorkspace = false
let hasDefaultWorkspace = false

export interface FlowIndexSession {
  user: {
    id: string
    name: string
    email: string
    emailVerified: boolean
    image: string | null
    createdAt: Date
    updatedAt: Date
  }
  session: {
    id: string
    userId: string
    expiresAt: Date
    createdAt: Date
    updatedAt: Date
    token: string
    ipAddress: null
    userAgent: null
    activeOrganizationId: string | null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function claimToString(payload: FlowIndexJwtPayload, key: string): string | null {
  const value = payload[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function resolveEmail(payload: FlowIndexJwtPayload, userId: string): string {
  const email = claimToString(payload, 'email')
  if (email) return email.toLowerCase()
  return `${userId}@flowindex.local`
}

function resolveName(payload: FlowIndexJwtPayload, email: string): string {
  const userMetadata = asRecord(payload.user_metadata)
  const appMetadata = asRecord(payload.app_metadata)

  const candidates: Array<unknown> = [
    userMetadata?.full_name,
    userMetadata?.name,
    userMetadata?.display_name,
    appMetadata?.full_name,
    appMetadata?.name,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return email.split('@')[0] || 'FlowIndex User'
}

function resolveAvatar(payload: FlowIndexJwtPayload): string | null {
  const userMetadata = asRecord(payload.user_metadata)
  const appMetadata = asRecord(payload.app_metadata)

  const candidates: Array<unknown> = [
    userMetadata?.avatar_url,
    userMetadata?.picture,
    appMetadata?.avatar_url,
    appMetadata?.picture,
    payload.picture,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return null
}

function resolveExpiry(payload: FlowIndexJwtPayload): Date {
  const exp = payload.exp
  if (typeof exp === 'number' && Number.isFinite(exp) && exp > 0) {
    return new Date(exp * 1000)
  }
  return new Date(Date.now() + 60 * 60 * 1000)
}

async function ensureDefaultWorkspacePermission(userId: string): Promise<void> {
  const workspaceId = env.FLOWINDEX_DEFAULT_WORKSPACE_ID || DEFAULT_WORKSPACE_ID
  if (!workspaceId) return

  if (!checkedDefaultWorkspace) {
    const workspace = await db.query.workspace.findFirst({
      where: eq(schema.workspace.id, workspaceId),
      columns: { id: true },
    })
    hasDefaultWorkspace = !!workspace
    checkedDefaultWorkspace = true
  }

  if (!hasDefaultWorkspace) return

  const now = new Date()

  await db
    .insert(schema.permissions)
    .values({
      id: crypto.randomUUID(),
      userId,
      entityType: 'workspace',
      entityId: workspaceId,
      permissionType: 'admin',
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.permissions.userId,
        schema.permissions.entityType,
        schema.permissions.entityId,
      ],
      set: {
        permissionType: 'admin',
        updatedAt: now,
      },
    })
}

async function buildSessionFromPayload(
  payload: FlowIndexJwtPayload,
  accessToken: string
): Promise<FlowIndexSession> {
  const userId = payload.sub as string
  const now = new Date()

  const email = resolveEmail(payload, userId)
  const name = resolveName(payload, email)
  const image = resolveAvatar(payload)
  const emailVerified = payload.email_verified === true

  await db
    .insert(schema.user)
    .values({
      id: userId,
      name,
      email,
      emailVerified,
      image,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.user.id,
      set: {
        name,
        email,
        emailVerified,
        image,
        updatedAt: now,
      },
    })

  await db
    .insert(schema.userStats)
    .values({
      id: crypto.randomUUID(),
      userId,
    })
    .onConflictDoNothing({
      target: schema.userStats.userId,
    })

  try {
    await ensureDefaultWorkspacePermission(userId)
  } catch (error) {
    logger.warn('Failed to ensure default workspace permission for FlowIndex user', {
      userId,
      error,
    })
  }

  return {
    user: {
      id: userId,
      name,
      email,
      emailVerified,
      image,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: `flowindex-session-${userId}`,
      userId,
      expiresAt: resolveExpiry(payload),
      createdAt: now,
      updatedAt: now,
      token: accessToken,
      ipAddress: null,
      userAgent: null,
      activeOrganizationId: null,
    },
  }
}

export async function resolveFlowIndexSessionFromAccessToken(
  accessToken: string
): Promise<FlowIndexSession | null> {
  const payload = await verifyFlowIndexAccessToken(accessToken, env.SUPABASE_JWT_SECRET)
  if (!payload) return null
  return buildSessionFromPayload(payload, accessToken)
}

export async function resolveFlowIndexSessionFromHeaders(
  hdrs: Headers
): Promise<FlowIndexSession | null> {
  const accessToken = extractFlowIndexAccessTokenFromCookieHeader(hdrs.get('cookie'))
  if (!accessToken) return null
  return resolveFlowIndexSessionFromAccessToken(accessToken)
}

export async function resolveFlowIndexSessionFromRequest(
  request: NextRequest
): Promise<FlowIndexSession | null> {
  const accessToken = extractFlowIndexAccessTokenFromCookieHeader(request.headers.get('cookie'))
  if (!accessToken) return null
  return resolveFlowIndexSessionFromAccessToken(accessToken)
}

export function createFlowIndexGetSessionResponse(
  session: FlowIndexSession | null
): FlowIndexSession | null {
  // Return the session object directly (NOT wrapped in {data: ...}).
  // The better-auth client adds its own {data: ...} wrapper, so wrapping here
  // would cause double-wrapping: {data: {data: {user, session}}}, which breaks
  // extractSessionDataFromAuthClientResult.
  return session
}

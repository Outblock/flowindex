import { type JWTPayload, jwtVerify } from 'jose'

export interface FlowIndexJwtPayload extends JWTPayload {
  email?: string
  email_verified?: boolean
  user_metadata?: Record<string, unknown>
  app_metadata?: Record<string, unknown>
}

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function normalizeJwtCandidate(value: string): string | null {
  const trimmed = decodeCookieValue(value)
    .trim()
    .replace(/^"(.*)"$/, '$1')
  if (!trimmed) return null

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      if (typeof parsed.access_token === 'string' && parsed.access_token) {
        return parsed.access_token
      }
    } catch {
      return null
    }
    return null
  }

  if (trimmed.split('.').length === 3) {
    return trimmed
  }

  return null
}

export function extractFlowIndexAccessTokenFromCookieHeader(
  cookieHeader: string | null | undefined
): string | null {
  if (!cookieHeader) return null
  const cookies = cookieHeader.split(';')
  for (const rawCookie of cookies) {
    const part = rawCookie.trim()
    if (!part.startsWith('fi_auth=')) continue
    const rawValue = part.slice('fi_auth='.length)
    return normalizeJwtCandidate(rawValue)
  }
  return null
}

export async function verifyFlowIndexAccessToken(
  accessToken: string,
  jwtSecret: string | undefined = process.env.SUPABASE_JWT_SECRET
): Promise<FlowIndexJwtPayload | null> {
  if (!accessToken || !jwtSecret) return null

  try {
    const { payload } = await jwtVerify(accessToken, new TextEncoder().encode(jwtSecret))
    if (!payload?.sub || typeof payload.sub !== 'string') return null
    return payload as FlowIndexJwtPayload
  } catch {
    return null
  }
}

export async function hasValidFlowIndexAccessTokenFromCookieHeader(
  cookieHeader: string | null | undefined
): Promise<boolean> {
  const accessToken = extractFlowIndexAccessTokenFromCookieHeader(cookieHeader)
  if (!accessToken) return false
  const payload = await verifyFlowIndexAccessToken(accessToken)
  return !!payload
}

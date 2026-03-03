import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { resolveFlowIndexSessionFromHeaders } from '@/lib/auth/flowindex'
import { extractFlowIndexAccessTokenFromCookieHeader } from '@/lib/auth/flowindex-cookie'
import { isAuthDisabled, isFlowIndexSupabaseCookieAuth } from '@/lib/core/config/feature-flags'

export async function POST() {
  if (isFlowIndexSupabaseCookieAuth) {
    const hdrs = await headers()
    const session = await resolveFlowIndexSessionFromHeaders(hdrs)
    const token = extractFlowIndexAccessTokenFromCookieHeader(hdrs.get('cookie'))

    if (!session || !token) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    return NextResponse.json({ token })
  }

  if (isAuthDisabled) {
    return NextResponse.json({ token: 'anonymous-socket-token' })
  }

  try {
    const hdrs = await headers()
    const response = await auth.api.generateOneTimeToken({
      headers: hdrs,
    })

    if (!response?.token) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    return NextResponse.json({ token: response.token })
  } catch {
    return NextResponse.json({ error: 'Failed to generate token' }, { status: 500 })
  }
}

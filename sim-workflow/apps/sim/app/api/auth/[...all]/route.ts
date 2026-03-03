import { toNextJsHandler } from 'better-auth/next-js'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createAnonymousGetSessionResponse, ensureAnonymousUserExists } from '@/lib/auth/anonymous'
import {
  createFlowIndexGetSessionResponse,
  resolveFlowIndexSessionFromRequest,
} from '@/lib/auth/flowindex'
import { isAuthDisabled, isFlowIndexSupabaseCookieAuth } from '@/lib/core/config/feature-flags'

export const dynamic = 'force-dynamic'

const { GET: betterAuthGET, POST: betterAuthPOST } = toNextJsHandler(auth.handler)

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const path = url.pathname.replace('/api/auth/', '')

  if (path === 'get-session' && isAuthDisabled) {
    await ensureAnonymousUserExists()
    return NextResponse.json(createAnonymousGetSessionResponse())
  }

  if (path === 'get-session' && isFlowIndexSupabaseCookieAuth) {
    const session = await resolveFlowIndexSessionFromRequest(request)
    return NextResponse.json(createFlowIndexGetSessionResponse(session))
  }

  return betterAuthGET(request)
}

export const POST = betterAuthPOST

'use client'

import { useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/auth/auth-client'
import { useReferralAttribution } from '@/hooks/use-referral-attribution'

const logger = createLogger('WorkspacePage')
const SESSION_LOAD_TIMEOUT_MS = 12000
const API_REQUEST_TIMEOUT_MS = 12000

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = API_REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

export default function WorkspacePage() {
  const router = useRouter()
  const { data: session, isPending } = useSession()
  useReferralAttribution()
  const [redirectState, setRedirectState] = useState<'idle' | 'working' | 'failed'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [sessionTimedOut, setSessionTimedOut] = useState(false)

  const isWorkspaceRootPath = useMemo(() => {
    if (typeof window === 'undefined') return false
    return /^\/workspace\/?$/.test(window.location.pathname)
  }, [])

  useEffect(() => {
    if (!isWorkspaceRootPath) return

    if (!isPending) {
      setSessionTimedOut(false)
      return
    }

    const timeoutId = window.setTimeout(() => {
      setSessionTimedOut(true)
      setRedirectState('failed')
      setErrorMessage('登录态校验超时，请刷新后重试。')
    }, SESSION_LOAD_TIMEOUT_MS)

    return () => window.clearTimeout(timeoutId)
  }, [isPending, isWorkspaceRootPath])

  useEffect(() => {
    const redirectToFirstWorkspace = async () => {
      // Wait for session to load
      if (isPending || sessionTimedOut) {
        return
      }

      setRedirectState('working')
      setErrorMessage(null)

      // If user is not authenticated, redirect to login
      if (!session?.user) {
        logger.info('User not authenticated, redirecting to login')
        setRedirectState('idle')
        router.replace('/login')
        return
      }

      try {
        // Check if we need to redirect a specific workflow from old URL format
        const urlParams = new URLSearchParams(window.location.search)
        const redirectWorkflowId = urlParams.get('redirect_workflow')

        if (redirectWorkflowId) {
          // Try to get the workspace for this workflow
          try {
            const workflowResponse = await fetchWithTimeout(`/api/workflows/${redirectWorkflowId}`)
            if (workflowResponse.ok) {
              const workflowData = await workflowResponse.json()
              const workspaceId = workflowData.data?.workspaceId

              if (workspaceId) {
                logger.info(
                  `Redirecting workflow ${redirectWorkflowId} to workspace ${workspaceId}`
                )
                router.replace(`/workspace/${workspaceId}/w/${redirectWorkflowId}`)
                return
              }
            }
          } catch (error) {
            logger.error('Error fetching workflow for redirect:', error)
          }
        }

        // Fetch user's workspaces (workspace creation happens in auth middleware)
        let workspaces: Array<{ id: string }> = []
        const maxRetries = 3

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          const response = await fetchWithTimeout('/api/workspaces')
          if (!response.ok) {
            throw new Error('Failed to fetch workspaces')
          }

          const data = await response.json()
          workspaces = data.workspaces || []

          if (workspaces.length > 0) break

          // Auth middleware creates the workspace; wait briefly for it to commit
          if (attempt < maxRetries - 1) {
            logger.info(`No workspaces yet, retrying (${attempt + 1}/${maxRetries})...`)
            await new Promise((r) => globalThis.setTimeout(r, 800))
          }
        }

        if (workspaces.length === 0) {
          logger.error('No workspaces found after retries')
          setRedirectState('failed')
          setErrorMessage('无法加载 workspace，请刷新重试。')
          return
        }

        // Get the first workspace (they should be ordered by most recent)
        const firstWorkspace = workspaces[0]
        if (!firstWorkspace?.id) {
          throw new Error('Workspace list is empty or invalid')
        }
        logger.info(`Redirecting to first workspace: ${firstWorkspace.id}`)

        // Redirect to the first workspace
        router.replace(`/workspace/${firstWorkspace.id}/w`)
      } catch (error) {
        logger.error('Error fetching workspaces for redirect:', error)
        setRedirectState('failed')
        setErrorMessage(
          error instanceof Error && error.name === 'AbortError'
            ? 'workspace 请求超时，请刷新重试。'
            : '获取 workspace 失败，请刷新重试。'
        )
      }
    }

    // Only run this logic when we're at the root /workspace path
    // If we're already in a specific workspace, the children components will handle it
    if (isWorkspaceRootPath) {
      redirectToFirstWorkspace()
    }
  }, [session, isPending, router, isWorkspaceRootPath, sessionTimedOut])

  const showLoading = (!sessionTimedOut && isPending) || redirectState === 'working'

  // Show loading state while we determine where to redirect
  if (showLoading) {
    return (
      <div className='flex h-screen w-full items-center justify-center'>
        <div
          className='h-[18px] w-[18px] animate-spin rounded-full'
          style={{
            background:
              'conic-gradient(from 0deg, hsl(var(--muted-foreground)) 0deg 120deg, transparent 120deg 180deg, hsl(var(--muted-foreground)) 180deg 300deg, transparent 300deg 360deg)',
            mask: 'radial-gradient(farthest-side, transparent calc(100% - 1.5px), black calc(100% - 1.5px))',
            WebkitMask:
              'radial-gradient(farthest-side, transparent calc(100% - 1.5px), black calc(100% - 1.5px))',
          }}
        />
      </div>
    )
  }

  // If user is not authenticated, show nothing (redirect will happen)
  if (!session?.user) {
    return null
  }

  if (redirectState === 'failed') {
    return (
      <div className='flex h-screen w-full items-center justify-center p-6'>
        <div className='max-w-md rounded-lg border border-border bg-card p-6 text-center'>
          <h1 className='mb-2 text-lg font-semibold'>Workspace 加载失败</h1>
          <p className='mb-4 text-sm text-muted-foreground'>
            {errorMessage || '页面未能自动跳转到可用 workspace。'}
          </p>
          <div className='flex items-center justify-center gap-2'>
            <button
              type='button'
              className='rounded-md border border-border px-3 py-2 text-sm'
              onClick={() => window.location.reload()}
            >
              刷新重试
            </button>
            <button
              type='button'
              className='rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground'
              onClick={() => router.replace('/login')}
            >
              返回登录
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='flex h-screen w-full items-center justify-center'>
      <span className='text-sm text-muted-foreground'>正在跳转到你的 workspace...</span>
    </div>
  )
}

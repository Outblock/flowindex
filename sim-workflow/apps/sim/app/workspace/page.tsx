'use client'

import { useEffect, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
import { useSession } from '@/lib/auth/auth-client'
import { useReferralAttribution } from '@/hooks/use-referral-attribution'

const logger = createLogger('WorkspacePage')

export default function WorkspacePage() {
  const router = useRouter()
  const { data: session, isPending } = useSession()
  useReferralAttribution()
  const [redirectState, setRedirectState] = useState<'idle' | 'working' | 'failed'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const isWorkspaceRootPath = useMemo(() => {
    if (typeof window === 'undefined') return false
    return /^\/workspace\/?$/.test(window.location.pathname)
  }, [])

  useEffect(() => {
    const redirectToFirstWorkspace = async () => {
      // Wait for session to load
      if (isPending) {
        return
      }

      setRedirectState('working')
      setErrorMessage(null)

      // If user is not authenticated, redirect to login
      if (!session?.user) {
        logger.info('User not authenticated, redirecting to login')
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
            const workflowResponse = await fetch(`/api/workflows/${redirectWorkflowId}`)
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

        // Fetch user's workspaces
        const response = await fetch('/api/workspaces')

        if (!response.ok) {
          throw new Error('Failed to fetch workspaces')
        }

        const data = await response.json()
        const workspaces = data.workspaces || []

        if (workspaces.length === 0) {
          logger.warn('No workspaces found for user, creating default workspace')

          try {
            const createResponse = await fetch('/api/workspaces', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ name: 'My Workspace' }),
            })

            if (createResponse.ok) {
              const createData = await createResponse.json()
              const newWorkspace = createData.workspace

              if (newWorkspace?.id) {
                logger.info(`Created default workspace: ${newWorkspace.id}`)
                router.replace(`/workspace/${newWorkspace.id}/w`)
                return
              }
            }

            logger.error('Failed to create default workspace')
          } catch (createError) {
            logger.error('Error creating default workspace:', createError)
          }

          setRedirectState('failed')
          setErrorMessage('无法创建默认 workspace，请稍后重试。')
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
        setErrorMessage('获取 workspace 失败，请刷新重试。')
      }
    }

    // Only run this logic when we're at the root /workspace path
    // If we're already in a specific workspace, the children components will handle it
    if (isWorkspaceRootPath) {
      redirectToFirstWorkspace()
    }
  }, [session, isPending, router, isWorkspaceRootPath])

  const showLoading = isPending || redirectState === 'working'

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

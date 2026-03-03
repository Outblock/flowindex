'use client'

import { useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import { ReactFlowProvider } from 'reactflow'
import { Panel, Terminal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('WorkflowsPage')

export default function WorkflowsPage() {
  const router = useRouter()
  const { workflows } = useWorkflowRegistry()
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [isMounted, setIsMounted] = useState(false)
  const [isCreatingDefaultWorkflow, setIsCreatingDefaultWorkflow] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Fetch workflows using React Query
  const { isLoading, isError } = useWorkflows(workspaceId)

  // Track when component is mounted to avoid hydration issues
  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Handle redirection once workflows are loaded and component is mounted
  useEffect(() => {
    // Wait for component to be mounted to avoid hydration mismatches
    if (!isMounted) return

    // Only proceed if workflows are done loading
    if (isLoading) return

    if (isError) {
      logger.error('Failed to load workflows for workspace, fallback to /workspace', { workspaceId })
      setLoadError('无法加载该 workspace，正在返回工作区列表。')
      // Prevent permanent blank/spinner on stale or unauthorized workspace links.
      router.replace('/workspace')
      return
    }

    const workflowIds = Object.keys(workflows)

    // Validate that workflows belong to the current workspace
    const workspaceWorkflows = workflowIds.filter((id) => {
      const workflow = workflows[id]
      return workflow.workspaceId === workspaceId
    })

    // If we have valid workspace workflows, redirect to the first one
    if (workspaceWorkflows.length > 0) {
      const firstWorkflowId = workspaceWorkflows[0]
      router.replace(`/workspace/${workspaceId}/w/${firstWorkflowId}`)
      return
    }

    if (isCreatingDefaultWorkflow) return

    const ensureDefaultWorkflow = async () => {
      setIsCreatingDefaultWorkflow(true)
      try {
        const response = await fetch('/api/workflows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'default-agent',
            description: 'Auto-created default workflow',
            color: '#3972F6',
            workspaceId,
          }),
        })

        if (!response.ok) {
          throw new Error(`Failed to create default workflow (${response.status})`)
        }

        const created = await response.json()
        const workflowId = created?.id

        if (!workflowId) {
          throw new Error('Default workflow creation succeeded but workflow id is missing')
        }

        router.replace(`/workspace/${workspaceId}/w/${workflowId}`)
      } catch (error) {
        logger.error('Failed to create default workflow', { workspaceId, error })
        setLoadError('该 workspace 当前没有可用 workflow，且自动创建失败。请刷新后重试。')
      } finally {
        setIsCreatingDefaultWorkflow(false)
      }
    }

    void ensureDefaultWorkflow()
  }, [
    isMounted,
    isLoading,
    workflows,
    workspaceId,
    router,
    isError,
    isCreatingDefaultWorkflow,
  ])

  if (loadError) {
    return (
      <div className='flex h-full w-full flex-col items-center justify-center gap-3 bg-[var(--bg)] p-6'>
        <p className='text-sm text-muted-foreground'>{loadError}</p>
        <button
          type='button'
          className='rounded-md border border-border px-3 py-2 text-sm'
          onClick={() => router.replace('/workspace')}
        >
          返回 Workspace
        </button>
      </div>
    )
  }

  return (
    <div className='flex h-full w-full flex-col overflow-hidden bg-[var(--bg)]'>
      <div className='relative h-full w-full flex-1 bg-[var(--bg)]'>
        <div className='workflow-container flex h-full items-center justify-center bg-[var(--bg)]'>
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
        <ReactFlowProvider>
          <Panel />
        </ReactFlowProvider>
      </div>
      <Terminal />
    </div>
  )
}

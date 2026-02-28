import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { Node, Edge } from 'reactflow'
import DeveloperLayout from '../../components/developer/DeveloperLayout'
import WorkflowCanvas from '../../components/developer/workflow/WorkflowCanvas'
import { getWorkflow } from '../../lib/webhookApi'

export const Route = createFileRoute('/developer/subscriptions/$id')({
  component: WorkflowEditorPage,
})

function WorkflowEditorPage() {
  const { id } = Route.useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workflowName, setWorkflowName] = useState('Untitled Workflow')
  const [initialNodes, setInitialNodes] = useState<Node[]>([])
  const [initialEdges, setInitialEdges] = useState<Edge[]>([])

  useEffect(() => {
    async function load() {
      try {
        const wf = await getWorkflow(id)
        setWorkflowName(wf.name)
        const canvas = wf.canvas_json as { nodes?: Node[]; edges?: Edge[] }
        setInitialNodes(canvas?.nodes ?? [])
        setInitialEdges(canvas?.edges ?? [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load workflow')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  if (loading) {
    return (
      <DeveloperLayout>
        <div className="flex items-center justify-center flex-1 py-20">
          <Loader2 className="w-5 h-5 animate-spin text-neutral-500" />
        </div>
      </DeveloperLayout>
    )
  }

  if (error) {
    return (
      <DeveloperLayout>
        <div className="flex items-center justify-center flex-1 py-20 text-red-400 text-sm">
          {error}
        </div>
      </DeveloperLayout>
    )
  }

  return (
    <DeveloperLayout>
      <WorkflowCanvas
        workflowId={id}
        initialName={workflowName}
        initialNodes={initialNodes}
        initialEdges={initialEdges}
      />
    </DeveloperLayout>
  )
}

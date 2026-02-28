import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Plus, Trash2, Loader2, GitBranch, CheckCircle, Circle } from 'lucide-react'
import DeveloperLayout from '../../components/developer/DeveloperLayout'
import { listWorkflows, createWorkflow, deleteWorkflow } from '../../lib/webhookApi'
import type { Workflow } from '../../lib/webhookApi'
import { WORKFLOW_TEMPLATES, TEMPLATE_CATEGORIES } from '../../components/developer/workflow/templates'

export const Route = createFileRoute('/developer/subscriptions/')({
  component: WorkflowListPage,
})

function WorkflowListPage() {
  const navigate = useNavigate()
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Workflow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchWorkflows = useCallback(async () => {
    try {
      const data = await listWorkflows()
      setWorkflows(data)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchWorkflows() }, [fetchWorkflows])

  async function handleCreate() {
    setCreating(true)
    try {
      const wf = await createWorkflow()
      navigate({ to: '/developer/subscriptions/$id', params: { id: wf.id } })
    } catch {
      setCreating(false)
    }
  }

  async function handleUseTemplate(template: typeof WORKFLOW_TEMPLATES[0]) {
    setCreating(true)
    try {
      const layoutedNodes = template.nodes.map((n, i) => ({
        ...n,
        position: { x: 100 + i * 280, y: 150 },
      }))
      const edges = template.edges.map((e, i) => ({
        id: `edge_${i}`,
        ...e,
        animated: true,
        style: { stroke: '#525252', strokeWidth: 2 },
        markerEnd: { type: 'arrowclosed', color: '#525252', width: 16, height: 16 },
      }))
      const wf = await createWorkflow(template.name, { nodes: layoutedNodes, edges })
      navigate({ to: '/developer/subscriptions/$id', params: { id: wf.id } })
    } catch {
      setCreating(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteWorkflow(deleteTarget.id)
      setWorkflows((prev) => prev.filter((w) => w.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch {
      // ignore
    } finally {
      setDeleting(false)
    }
  }

  return (
    <DeveloperLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-white">Workflows</h1>
            <p className="text-xs md:text-sm text-neutral-400 mt-1">
              Build event-driven notification pipelines with a visual editor
            </p>
          </div>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="flex items-center gap-2 px-4 py-2 bg-[#00ef8b] text-black font-medium text-sm rounded-lg hover:bg-[#00ef8b]/90 transition-colors disabled:opacity-50"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            New Workflow
          </button>
        </div>

        {/* Templates */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-zinc-500 dark:text-neutral-400 uppercase tracking-wider">Templates</h2>
          {TEMPLATE_CATEGORIES.map((cat) => (
            <div key={cat.key}>
              <p className="text-xs text-zinc-500 dark:text-neutral-500 mb-2">{cat.emoji} {cat.label}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {WORKFLOW_TEMPLATES.filter((t) => t.category === cat.key).map((t) => {
                  const Icon = t.icon
                  return (
                    <button
                      key={t.id}
                      onClick={() => handleUseTemplate(t)}
                      disabled={creating}
                      className="flex items-start gap-3 p-3 bg-zinc-50 dark:bg-neutral-800/50 border border-zinc-200 dark:border-neutral-800 rounded-lg hover:border-[#00ef8b]/40 hover:bg-zinc-100 dark:hover:bg-neutral-800 transition-colors text-left disabled:opacity-50"
                    >
                      <div className="w-8 h-8 rounded-lg bg-zinc-200 dark:bg-neutral-700 flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4 text-zinc-600 dark:text-neutral-300" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-900 dark:text-white">{t.name}</p>
                        <p className="text-xs text-zinc-500 dark:text-neutral-500 mt-0.5">{t.description}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-neutral-500" />
            </div>
          ) : workflows.length === 0 ? (
            <div className="text-center py-16 text-neutral-500">
              <GitBranch className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No workflows yet.</p>
              <p className="text-xs text-neutral-600 mt-1">Create one to get started with visual event pipelines.</p>
            </div>
          ) : (
            <div className="divide-y divide-neutral-800">
              {workflows.map((wf, i) => {
                const nodeCount = (wf.canvas_json as { nodes?: unknown[] })?.nodes?.length ?? 0
                return (
                  <motion.div
                    key={wf.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <Link
                      to="/developer/subscriptions/$id"
                      params={{ id: wf.id }}
                      className="flex items-center gap-4 px-4 py-4 hover:bg-neutral-800/30 transition-colors group"
                    >
                      <div className="w-9 h-9 rounded-lg bg-neutral-800 flex items-center justify-center shrink-0">
                        <GitBranch className="w-4 h-4 text-[#00ef8b]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{wf.name}</p>
                        <p className="text-xs text-neutral-500 mt-0.5">
                          {nodeCount} node{nodeCount !== 1 ? 's' : ''} &middot; {new Date(wf.updated_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {wf.is_active ? (
                          <span className="flex items-center gap-1 text-xs text-emerald-400">
                            <CheckCircle className="w-3.5 h-3.5" /> Active
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-neutral-500">
                            <Circle className="w-3.5 h-3.5" /> Draft
                          </span>
                        )}
                        <button
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setDeleteTarget(wf)
                          }}
                          className="p-1.5 rounded-md text-neutral-600 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </Link>
                  </motion.div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Delete modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setDeleteTarget(null) }}
        >
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl w-full max-w-sm mx-4 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white">Delete Workflow</h2>
            <p className="text-sm text-neutral-400">
              Delete &ldquo;<span className="text-white">{deleteTarget.name}</span>&rdquo;? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2 bg-neutral-800 text-neutral-300 text-sm font-medium rounded-lg hover:bg-neutral-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 py-2 bg-red-500/20 text-red-400 text-sm font-medium rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </DeveloperLayout>
  )
}

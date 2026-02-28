import { useState, useCallback } from 'react'
import { X, Play, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import type { SchemaField } from './nodeTypes'
import { testWorkflow } from '../../../lib/webhookApi'

interface StepResult {
  name: string
  passed: boolean
  actual?: string
  expected?: string
  error?: string
}

interface TestResult {
  trigger: { passed: boolean; error?: string }
  steps: StepResult[]
}

interface TestPanelProps {
  workflowId: string
  outputSchema?: Record<string, SchemaField>
  onClose: () => void
}

export default function TestPanel({
  workflowId,
  outputSchema,
  onClose,
}: TestPanelProps) {
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleOverrideChange = useCallback((key: string, value: string) => {
    setOverrides((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleRunTest = useCallback(async () => {
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      // Filter out empty overrides
      const filtered: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(overrides)) {
        if (v.trim()) filtered[k] = v.trim()
      }

      const data = await testWorkflow(workflowId, filtered)

      // Normalize response into our TestResult shape
      setResult({
        trigger: {
          passed: data.trigger_passed !== false,
          error: typeof data.trigger_error === 'string' ? data.trigger_error : undefined,
        },
        steps: Array.isArray(data.steps)
          ? (data.steps as Array<Record<string, unknown>>).map((s) => ({
              name: String(s.name ?? 'Step'),
              passed: s.passed !== false,
              actual: s.actual != null ? String(s.actual) : undefined,
              expected: s.expected != null ? String(s.expected) : undefined,
              error: typeof s.error === 'string' ? s.error : undefined,
            }))
          : [],
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test failed')
    } finally {
      setRunning(false)
    }
  }, [workflowId, overrides])

  const schemaEntries = outputSchema ? Object.entries(outputSchema) : []

  return (
    <div className="w-80 shrink-0 border-l border-zinc-200 dark:border-white/10 bg-white/80 dark:bg-black/40 backdrop-blur-sm flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-white/10">
        <h3 className="text-sm font-medium text-zinc-900 dark:text-white/80">
          Test Workflow
        </h3>
        <button
          onClick={onClose}
          className="p-1 rounded text-zinc-400 dark:text-white/50 hover:text-zinc-700 dark:hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Override fields */}
        {schemaEntries.length > 0 && (
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-white/10">
            <p className="text-xs font-medium text-zinc-500 dark:text-white/50 uppercase tracking-wider mb-2">
              Mock Event Overrides
            </p>
            <div className="space-y-2">
              {schemaEntries.map(([key, field]) => (
                <div key={key}>
                  <label className="block text-xs text-zinc-600 dark:text-white/50 mb-0.5">
                    {field.label}
                  </label>
                  <input
                    type="text"
                    value={overrides[key] ?? ''}
                    onChange={(e) => handleOverrideChange(key, e.target.value)}
                    placeholder={`${field.type} — optional`}
                    className="w-full px-2 py-1.5 bg-zinc-100 dark:bg-white/5 border border-zinc-300 dark:border-white/10 rounded text-xs text-zinc-900 dark:text-white/80 placeholder-zinc-400 dark:placeholder-white/30 focus:outline-none focus:border-[#00ef8b]/50 transition-colors"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {schemaEntries.length === 0 && (
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-white/10">
            <p className="text-xs text-zinc-500 dark:text-white/50">
              No trigger found. Add a trigger node to configure test overrides.
            </p>
          </div>
        )}

        {/* Run button */}
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-white/10">
          <button
            onClick={handleRunTest}
            disabled={running}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[#00ef8b] text-black text-sm font-medium rounded-lg hover:bg-[#00ef8b]/90 transition-colors disabled:opacity-50"
          >
            {running ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {running ? 'Running...' : 'Run Test'}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-3 border-b border-zinc-200 dark:border-white/10">
            <div className="flex items-start gap-2 p-2 rounded bg-red-500/10 border border-red-500/20">
              <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-400">{error}</p>
            </div>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="px-4 py-3">
            <p className="text-xs font-medium text-zinc-500 dark:text-white/50 uppercase tracking-wider mb-2">
              Results
            </p>
            <div className="space-y-2">
              {/* Trigger result */}
              <div className="flex items-start gap-2 p-2 rounded bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10">
                {result.trigger.passed ? (
                  <CheckCircle2 className="w-4 h-4 text-[#00ef8b] shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <p className="text-xs font-medium text-zinc-900 dark:text-white/80">
                    Trigger
                  </p>
                  {result.trigger.error && (
                    <p className="text-xs text-red-400 mt-0.5">
                      {result.trigger.error}
                    </p>
                  )}
                </div>
              </div>

              {/* Step results */}
              {result.steps.map((step, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 p-2 rounded bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10"
                >
                  {step.passed ? (
                    <CheckCircle2 className="w-4 h-4 text-[#00ef8b] shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-zinc-900 dark:text-white/80">
                      {step.name}
                    </p>
                    {step.error && (
                      <p className="text-xs text-red-400 mt-0.5">{step.error}</p>
                    )}
                    {!step.passed && step.expected != null && (
                      <div className="mt-1 space-y-0.5">
                        <p className="text-xs text-zinc-500 dark:text-white/40">
                          Expected: <span className="text-zinc-700 dark:text-white/60">{step.expected}</span>
                        </p>
                        <p className="text-xs text-zinc-500 dark:text-white/40">
                          Actual: <span className="text-zinc-700 dark:text-white/60">{step.actual ?? '—'}</span>
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {result.steps.length === 0 && result.trigger.passed && (
                <p className="text-xs text-zinc-500 dark:text-white/50">
                  Trigger matched. No condition steps to evaluate.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

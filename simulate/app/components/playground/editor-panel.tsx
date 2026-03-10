import { lazy, Suspense } from 'react'

const MonacoEditor = lazy(() =>
  import('@monaco-editor/react').then((mod) => ({ default: mod.default }))
)

interface EditorPanelProps {
  code: string
  filename: string
  loading: boolean
  onCodeChange: (value: string) => void
  onSimulate: () => void
}

export function EditorPanel({ code, filename, loading, onCodeChange, onSimulate }: EditorPanelProps) {
  return (
    <div className="flex-1 flex flex-col min-w-0 bg-zinc-950">
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
        <span className="text-[10px] text-zinc-600">
          {filename} <span className="text-zinc-800">— editable</span>
        </span>
        <button
          onClick={onSimulate}
          disabled={loading}
          className={`px-4 py-1 rounded text-[11px] font-bold transition-all ${
            loading
              ? 'bg-flow-green text-black animate-pulse cursor-wait'
              : 'bg-flow-green text-black hover:shadow-[0_0_20px_rgba(0,239,139,0.3)]'
          }`}
        >
          {loading ? '◉ Simulating...' : '▶ Simulate'}
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-full text-xs text-zinc-700">
              Loading editor...
            </div>
          }
        >
          <MonacoEditor
            height="100%"
            language="plaintext"
            theme="vs-dark"
            value={code}
            onChange={(v) => onCodeChange(v ?? '')}
            options={{
              minimap: { enabled: false },
              fontSize: 12,
              fontFamily: '"Geist Mono", "SF Mono", monospace',
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              renderLineHighlight: 'none',
              overviewRulerBorder: false,
              padding: { top: 12 },
            }}
          />
        </Suspense>
      </div>
    </div>
  )
}

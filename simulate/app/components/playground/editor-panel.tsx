import { lazy, Suspense, useCallback } from 'react'
import type { editor } from 'monaco-editor'

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

/** Register a basic Cadence language with keyword highlighting */
function registerCadence(monaco: typeof import('monaco-editor')) {
  if (monaco.languages.getLanguages().some((l) => l.id === 'cadence')) return

  monaco.languages.register({ id: 'cadence' })
  monaco.languages.setMonarchTokensProvider('cadence', {
    keywords: [
      'import', 'from', 'transaction', 'prepare', 'execute', 'pre', 'post',
      'let', 'var', 'fun', 'return', 'if', 'else', 'while', 'for', 'in',
      'break', 'continue', 'nil', 'true', 'false', 'self', 'create', 'destroy',
      'emit', 'access', 'all', 'contract', 'resource', 'struct', 'event',
      'interface', 'pub', 'priv', 'auth', 'entitlement',
    ],
    typeKeywords: [
      'Int', 'Int8', 'Int16', 'Int32', 'Int64', 'Int128', 'Int256',
      'UInt', 'UInt8', 'UInt16', 'UInt32', 'UInt64', 'UInt128', 'UInt256',
      'Fix64', 'UFix64', 'String', 'Bool', 'Address', 'Void', 'AnyStruct',
      'AnyResource', 'Account', 'Type', 'Character', 'Path', 'StoragePath',
      'PublicPath', 'PrivatePath',
    ],
    operators: ['<-', '<-!', '??', '=', '+', '-', '*', '/', '%', '!', '<', '>', '&'],
    symbols: /[=><!~?:&|+\-*/^%]+/,
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/"/, 'string', '@string'],
        [/0x[0-9a-fA-F]+/, 'number.hex'],
        [/\d+\.\d+/, 'number.float'],
        [/\d+/, 'number'],
        [/<-!?/, 'keyword.operator.move'],
        [/[a-zA-Z_]\w*/, {
          cases: {
            '@typeKeywords': 'type',
            '@keywords': 'keyword',
            '@default': 'identifier',
          },
        }],
        [/[{}()[\]]/, '@brackets'],
        [/@symbols/, {
          cases: {
            '@operators': 'operator',
            '@default': '',
          },
        }],
      ],
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],
      string: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, 'string', '@pop'],
      ],
    },
  })

  // CRT-themed color rules for Cadence
  monaco.editor.defineTheme('cadence-crt', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: 'c084fc' },           // purple-400
      { token: 'keyword.operator.move', foreground: 'f87171', fontStyle: 'bold' }, // red-400 for <-
      { token: 'type', foreground: '22d3ee' },               // cyan-400
      { token: 'identifier', foreground: 'd4d4d8' },         // zinc-300
      { token: 'number', foreground: '34d399' },             // emerald-400
      { token: 'number.hex', foreground: '34d399' },         // emerald-400
      { token: 'number.float', foreground: '34d399' },       // emerald-400
      { token: 'string', foreground: 'fbbf24' },             // amber-400
      { token: 'string.escape', foreground: 'f59e0b' },      // amber-500
      { token: 'comment', foreground: '525252', fontStyle: 'italic' }, // zinc-600
      { token: 'operator', foreground: 'a1a1aa' },           // zinc-400
      { token: '@brackets', foreground: '71717a' },           // zinc-500
    ],
    colors: {
      'editor.background': '#0a0a0a',
      'editor.foreground': '#d4d4d8',
      'editorLineNumber.foreground': '#3f3f46',
      'editorLineNumber.activeForeground': '#00ef8b',
      'editor.selectionBackground': '#00ef8b22',
      'editor.lineHighlightBackground': '#00ef8b08',
      'editorCursor.foreground': '#00ef8b',
      'editorWidget.background': '#0a0a0a',
      'editorWidget.border': '#27272a',
      'editorIndentGuide.background': '#1a1a1a',
      'scrollbarSlider.background': '#27272a80',
      'scrollbarSlider.hoverBackground': '#3f3f4680',
    },
  })
}

export function EditorPanel({ code, filename, loading, onCodeChange, onSimulate }: EditorPanelProps) {
  const handleMount = useCallback((_editor: editor.IStandaloneCodeEditor, monaco: typeof import('monaco-editor')) => {
    registerCadence(monaco)
    const model = _editor.getModel()
    if (model) {
      monaco.editor.setModelLanguage(model, 'cadence')
    }
    monaco.editor.setTheme('cadence-crt')
  }, [])

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-3 py-2 border-b border-zinc-800/60 flex items-center justify-between bg-black/40">
        <span className="text-[10px] text-zinc-600 flex items-center gap-1.5">
          <span className="text-flow-green/60">$</span>
          {filename} <span className="text-zinc-800">— editable</span>
        </span>
        <button
          onClick={onSimulate}
          disabled={loading}
          className={`px-4 py-1 rounded text-[11px] font-bold transition-all ${
            loading
              ? 'bg-flow-green text-black animate-pulse cursor-wait'
              : 'bg-flow-green text-black hover:shadow-[0_0_20px_rgba(0,239,139,0.4)]'
          }`}
        >
          {loading ? '◉ Simulating...' : '▶ Simulate'}
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-full text-xs text-zinc-700">
              <span className="crt-cursor mr-2" /> Loading editor...
            </div>
          }
        >
          <MonacoEditor
            height="100%"
            defaultLanguage="plaintext"
            theme="vs-dark"
            value={code}
            onChange={(v) => onCodeChange(v ?? '')}
            onMount={handleMount}
            options={{
              minimap: { enabled: false },
              fontSize: 12,
              fontFamily: '"Geist Mono", "SF Mono", monospace',
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              renderLineHighlight: 'gutter',
              overviewRulerBorder: false,
              padding: { top: 12 },
              cursorBlinking: 'phase',
              cursorSmoothCaretAnimation: 'on',
              smoothScrolling: true,
            }}
          />
        </Suspense>
      </div>
    </div>
  )
}

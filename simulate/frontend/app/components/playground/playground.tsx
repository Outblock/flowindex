import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { templates, parseParamsFromCode, type TemplateArg } from '@/lib/templates'
import { simulateTransaction, type SimulateResponse } from '@/lib/simulate'
import { TemplatePanel } from './template-panel'
import { EditorPanel } from './editor-panel'
import { ResultPanel } from './result-panel'

function toCadenceArg(type: string, value: string): Record<string, unknown> {
  return { type, value }
}

/** Decode URL params: ?code=base64&args=base64json&payer=0x... */
function parseUrlParams(): { code?: string; args?: Record<string, string>; payer?: string } | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const codeParam = params.get('code') || params.get('cadence')
  if (!codeParam) return null

  let code: string
  try {
    code = atob(codeParam)
  } catch {
    code = decodeURIComponent(codeParam)
  }

  let args: Record<string, string> | undefined
  const argsParam = params.get('args')
  if (argsParam) {
    try {
      let argsStr: string
      try { argsStr = atob(argsParam) } catch { argsStr = argsParam }
      const parsed = JSON.parse(argsStr)
      if (typeof parsed === 'object' && !Array.isArray(parsed)) {
        args = {}
        for (const [k, v] of Object.entries(parsed)) {
          args[k] = String(v)
        }
      }
    } catch { /* ignore */ }
  }

  const payer = params.get('payer') || undefined
  return { code, args, payer }
}

const CUSTOM_ID = '__custom__'

export function Playground() {
  const urlParams = useMemo(() => parseUrlParams(), [])
  const isCustom = !!urlParams?.code

  const [activeId, setActiveId] = useState(isCustom ? CUSTOM_ID : templates[0].id)
  const [code, setCode] = useState(isCustom ? urlParams!.code! : templates[0].cadence)
  const [customArgs, setCustomArgs] = useState<TemplateArg[]>(() => {
    if (!isCustom) return []
    return parseParamsFromCode(urlParams!.code!)
  })
  const [payer, setPayer] = useState(urlParams?.payer || '0x1654653399040a61')
  const [argValues, setArgValues] = useState<Record<string, string>>(() => {
    if (isCustom) {
      const parsed = parseParamsFromCode(urlParams!.code!)
      const initial: Record<string, string> = {}
      for (const arg of parsed) {
        initial[arg.name] = urlParams?.args?.[arg.name] ?? arg.defaultValue
      }
      return initial
    }
    const initial: Record<string, string> = {}
    for (const arg of templates[0].args) {
      initial[arg.name] = arg.defaultValue
    }
    return initial
  })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SimulateResponse | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  // Auto-scroll to playground when opened via URL params
  useEffect(() => {
    if (isCustom) {
      const el = containerRef.current
      if (el) el.scrollIntoView({ behavior: 'smooth' })
    }
  }, [isCustom])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect() } },
      { rootMargin: '200px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const handleSelectTemplate = useCallback((id: string) => {
    if (id === CUSTOM_ID) return
    const t = templates.find((t) => t.id === id)
    if (!t) return
    setActiveId(id)
    setCode(t.cadence)
    setResult(null)
    setCustomArgs([])
    const newArgs: Record<string, string> = {}
    for (const arg of t.args) {
      newArgs[arg.name] = arg.defaultValue
    }
    setArgValues(newArgs)
  }, [])

  const handleArgChange = useCallback((name: string, value: string) => {
    setArgValues((prev) => ({ ...prev, [name]: value }))
  }, [])

  // When code changes in custom mode, re-parse params
  const handleCodeChange = useCallback((newCode: string) => {
    setCode(newCode)
    if (activeId === CUSTOM_ID) {
      const parsed = parseParamsFromCode(newCode)
      setCustomArgs(parsed)
      setArgValues((prev) => {
        const next: Record<string, string> = {}
        for (const arg of parsed) {
          next[arg.name] = prev[arg.name] ?? arg.defaultValue
        }
        return next
      })
    }
  }, [activeId])

  const handleSimulate = useCallback(async () => {
    const active = activeId === CUSTOM_ID
      ? { args: customArgs }
      : templates.find((t) => t.id === activeId)
    if (!active) return

    setLoading(true)
    setResult(null)

    const args = active.args.map((a) => toCadenceArg(a.type, argValues[a.name] ?? a.defaultValue))

    try {
      const res = await simulateTransaction({
        cadence: code,
        arguments: args,
        authorizers: [payer],
        payer,
      })
      setResult(res)
    } catch (err) {
      setResult({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        events: [],
        balanceChanges: [],
        computationUsed: 0,
        summary: '',
        summaryItems: [],
        transfers: [],
        nftTransfers: [],
        evmExecutions: [],
        evmLogTransfers: [],
        systemEvents: [],
        defiEvents: [],
        stakingEvents: [],
        fee: 0,
        tags: [],
      })
    } finally {
      setLoading(false)
    }
  }, [activeId, code, argValues, customArgs, payer])

  const currentArgs = activeId === CUSTOM_ID
    ? customArgs
    : templates.find((t) => t.id === activeId)?.args ?? []

  const currentFilename = activeId === CUSTOM_ID
    ? 'custom.cdc'
    : templates.find((t) => t.id === activeId)?.filename ?? 'code.cdc'

  return (
    <section id="playground" className="border-t border-zinc-800/50 retro-grid flex flex-col" style={{ height: '100dvh' }} ref={containerRef}>
      <div className="px-4 pt-3 pb-1 shrink-0 flex items-center gap-3">
        <div className="text-[10px] text-flow-green/60 tracking-[3px] crt-glow">// PLAYGROUND</div>
        <h2 className="text-sm font-bold text-zinc-100">Try it now</h2>
      </div>

      <div className="flex-1 px-2 pb-2 flex flex-col min-h-0">
        <div className="crt-bezel flex-1 flex flex-col min-h-0">
          <div className="crt-screen crt-scanlines crt-vignette bg-[#0a0a0a] flex-1 flex flex-col min-h-0">
            <div className="flex flex-1 min-h-0">
              {visible ? (
                <>
                  <TemplatePanel
                    templates={templates}
                    activeId={activeId}
                    argValues={argValues}
                    currentArgs={currentArgs}
                    isCustom={activeId === CUSTOM_ID}
                    payer={payer}
                    onSelectTemplate={handleSelectTemplate}
                    onArgChange={handleArgChange}
                    onPayerChange={setPayer}
                  />
                  <EditorPanel
                    code={code}
                    filename={currentFilename}
                    loading={loading}
                    onCodeChange={handleCodeChange}
                    onSimulate={handleSimulate}
                  />
                  <ResultPanel result={result} />
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-xs text-zinc-500">
                  <span className="crt-cursor mr-2" /> Initializing playground...
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-center gap-2 pt-1.5 pb-0.5">
            <div className="crt-led" />
            <span className="text-[8px] text-zinc-500 tracking-widest uppercase">Simulator</span>
          </div>
        </div>
      </div>
    </section>
  )
}

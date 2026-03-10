import { useState } from 'react'
import type { SimulateResponse } from '@/lib/simulate'

interface ResultPanelProps {
  result: SimulateResponse | null
}

export function ResultPanel({ result }: ResultPanelProps) {
  const [eventsExpanded, setEventsExpanded] = useState(false)

  if (!result) {
    return (
      <div className="w-[300px] border-l border-zinc-800/40 flex items-center justify-center shrink-0">
        <p className="text-[11px] text-zinc-700 flex items-center gap-2">
          <span className="text-flow-green/40">&gt;</span> Run a simulation to see results
        </p>
      </div>
    )
  }

  return (
    <div className="w-[300px] border-l border-zinc-800/40 shrink-0 overflow-y-auto">
      <div className="px-3 py-2 border-b border-zinc-800/60 bg-black/40">
        <span className="text-[10px] text-zinc-600 tracking-wider flex items-center gap-1.5">
          <span className="text-flow-green/60">&gt;</span> RESULT
        </span>
      </div>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${result.success ? 'bg-flow-green shadow-[0_0_6px_rgba(0,239,139,0.6)]' : 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]'}`} />
            <span className={`text-xs font-semibold ${result.success ? 'text-flow-green crt-glow' : 'text-red-400'}`}>
              {result.success ? 'Passed' : 'Failed'}
            </span>
          </div>
          {result.computationUsed > 0 && (
            <span className="text-[10px] text-zinc-600 bg-black/40 border border-zinc-800/40 px-2 py-0.5 rounded">
              {result.computationUsed.toLocaleString()} comp
            </span>
          )}
        </div>

        {result.error && (
          <div className="bg-red-950/20 border border-red-900/30 rounded p-3">
            <pre className="text-[11px] text-red-400 whitespace-pre-wrap break-all">{result.error}</pre>
          </div>
        )}

        {result.balanceChanges.length > 0 && (
          <div>
            <div className="text-[10px] text-zinc-600 tracking-wider mb-2">BALANCE CHANGES</div>
            <div className="space-y-1">
              {result.balanceChanges.map((c, i) => (
                <div key={i} className="flex justify-between bg-black/40 border border-zinc-800/30 rounded px-3 py-1.5 text-[11px]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-zinc-500 font-mono truncate">{c.address}</span>
                    <span className="text-[10px] text-zinc-700">{c.token}</span>
                  </div>
                  <span className={`font-mono font-medium shrink-0 ml-2 ${
                    c.delta.startsWith('-') ? 'text-red-400' : 'text-flow-green crt-glow'
                  }`}>
                    {c.delta.startsWith('-') ? c.delta : `+${c.delta}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {result.events.length > 0 && (
          <div>
            <button
              onClick={() => setEventsExpanded(!eventsExpanded)}
              className="text-[10px] text-zinc-600 tracking-wider hover:text-flow-green transition-colors"
            >
              {eventsExpanded ? '▾' : '▸'} EVENTS ({result.events.length})
            </button>
            {eventsExpanded && (
              <div className="mt-2 space-y-1">
                {result.events.map((evt, i) => (
                  <div key={i} className="bg-black/40 border border-zinc-800/30 rounded p-2">
                    <div className="text-[10px] text-flow-green font-mono truncate">{evt.type}</div>
                    {evt.payload && (
                      <pre className="text-[10px] text-zinc-600 mt-1 whitespace-pre-wrap break-all max-h-20 overflow-auto">
                        {typeof evt.payload === 'string' ? evt.payload : JSON.stringify(evt.payload, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

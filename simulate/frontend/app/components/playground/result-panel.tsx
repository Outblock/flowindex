import { useState } from 'react'
import type { SimulateResponse } from '@/lib/simulate'

interface ResultPanelProps {
  result: SimulateResponse | null
}

export function ResultPanel({ result }: ResultPanelProps) {
  const [eventsExpanded, setEventsExpanded] = useState(false)

  if (!result) {
    return (
      <div className="w-full md:w-[340px] border-t md:border-t-0 md:border-l border-zinc-800/40 flex items-center justify-center shrink-0">
        <p className="text-[11px] text-zinc-500 flex items-center gap-2">
          <span className="text-flow-green/40">&gt;</span> Run a simulation to see results
        </p>
      </div>
    )
  }

  return (
    <div className="w-full md:w-[340px] border-t md:border-t-0 md:border-l border-zinc-800/40 shrink-0 overflow-y-auto">
      <div className="px-3 py-2 border-b border-zinc-800/60 bg-black/40">
        <span className="text-[10px] text-zinc-500 tracking-wider flex items-center gap-1.5">
          <span className="text-flow-green/60">&gt;</span> RESULT
        </span>
      </div>
      <div className="p-4 space-y-4">
        {/* Status + computation */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${result.success ? 'bg-flow-green shadow-[0_0_6px_rgba(0,239,139,0.6)]' : 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]'}`} />
            <span className={`text-xs font-semibold ${result.success ? 'text-flow-green crt-glow' : 'text-red-400'}`}>
              {result.success ? 'Passed' : 'Failed'}
            </span>
          </div>
          {result.computationUsed > 0 && (
            <span className="text-[10px] text-zinc-500 bg-black/40 border border-zinc-800/40 px-2 py-0.5 rounded">
              {result.computationUsed.toLocaleString()} comp
            </span>
          )}
        </div>

        {/* Error */}
        {result.error && (
          <div className="bg-red-950/20 border border-red-900/30 rounded p-3">
            <pre className="text-[11px] text-red-400 whitespace-pre-wrap break-all">{result.error}</pre>
          </div>
        )}

        {/* Summary */}
        {result.summary && (
          <div className="bg-flow-green/5 border border-flow-green/20 rounded px-3 py-2">
            <span className="text-[11px] text-flow-green">{result.summary}</span>
          </div>
        )}

        {/* Summary items */}
        {result.summaryItems.length > 0 && (
          <div>
            <div className="text-[10px] text-zinc-500 tracking-wider mb-2">SUMMARY</div>
            <div className="space-y-1">
              {result.summaryItems.map((item, i) => (
                <div key={i} className="flex items-center gap-2 bg-black/40 border border-zinc-800/30 rounded px-3 py-1.5">
                  <span className="text-[9px] text-zinc-500 uppercase w-14 shrink-0">{item.icon}</span>
                  <span className="text-[11px] text-zinc-300">{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Token transfers */}
        {result.transfers.length > 0 && (
          <div>
            <div className="text-[10px] text-zinc-500 tracking-wider mb-2">TOKEN TRANSFERS</div>
            <div className="space-y-1">
              {result.transfers.map((ft, i) => {
                const tokenName = ft.token.split('.').pop() || ft.token
                const amount = Number(ft.amount).toLocaleString(undefined, { maximumFractionDigits: 4 })
                const typeColor = ft.transfer_type === 'mint' ? 'text-flow-green' : ft.transfer_type === 'burn' ? 'text-red-400' : 'text-zinc-400'
                const typeLabel = ft.transfer_type === 'mint' ? 'Mint' : ft.transfer_type === 'burn' ? 'Burn' : 'Transfer'
                return (
                  <div key={i} className="bg-black/40 border border-zinc-800/30 rounded px-3 py-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-[9px] font-medium ${typeColor}`}>{typeLabel}</span>
                        <span className="text-[11px] text-zinc-200 font-mono">{amount} {tokenName}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 text-[9px] text-zinc-500 font-mono mt-0.5">
                      {ft.from_address && <span>{ft.from_address.slice(0, 10)}...</span>}
                      {ft.from_address && ft.to_address && <span className="text-zinc-500">&rarr;</span>}
                      {ft.to_address && <span>{ft.to_address.slice(0, 10)}...</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* NFT transfers */}
        {result.nftTransfers.length > 0 && (
          <div>
            <div className="text-[10px] text-zinc-500 tracking-wider mb-2">NFT TRANSFERS</div>
            <div className="space-y-1">
              {result.nftTransfers.map((nft, i) => {
                const name = nft.token.split('.').pop() || nft.token
                const typeColor = nft.transfer_type === 'mint' ? 'text-flow-green' : nft.transfer_type === 'burn' ? 'text-red-400' : 'text-zinc-400'
                const typeLabel = nft.transfer_type === 'mint' ? 'Mint' : nft.transfer_type === 'burn' ? 'Burn' : 'Transfer'
                return (
                  <div key={i} className="bg-black/40 border border-zinc-800/30 rounded px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] font-medium ${typeColor}`}>{typeLabel}</span>
                      <span className="text-[11px] text-zinc-200 font-mono">{name} #{nft.token_id}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[9px] text-zinc-500 font-mono mt-0.5">
                      {nft.from_address && <span>{nft.from_address.slice(0, 10)}...</span>}
                      {nft.from_address && nft.to_address && <span className="text-zinc-500">&rarr;</span>}
                      {nft.to_address && <span>{nft.to_address.slice(0, 10)}...</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* System events (account changes) */}
        {result.systemEvents.length > 0 && (
          <div>
            <div className="text-[10px] text-zinc-500 tracking-wider mb-2">ACCOUNT CHANGES</div>
            <div className="space-y-1">
              {result.systemEvents.map((evt, i) => (
                <div key={i} className="flex items-center gap-2 bg-black/40 border border-zinc-800/30 rounded px-3 py-1.5">
                  <span className="text-[9px] text-zinc-500 uppercase w-14 shrink-0">{evt.category}</span>
                  <span className="text-[11px] text-zinc-300">{evt.detail}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Balance changes */}
        {result.balanceChanges.length > 0 && (
          <div>
            <div className="text-[10px] text-zinc-500 tracking-wider mb-2">BALANCE CHANGES</div>
            <div className="space-y-1">
              {result.balanceChanges.map((c, i) => (
                <div key={i} className="flex justify-between bg-black/40 border border-zinc-800/30 rounded px-3 py-1.5 text-[11px]">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-zinc-400 font-mono truncate">{c.address}</span>
                    <span className="text-[10px] text-zinc-500">{c.token}</span>
                  </div>
                  <div className="flex flex-col items-end shrink-0 ml-2">
                    <span className={`font-mono font-medium ${
                      c.delta.startsWith('-') ? 'text-red-400' : 'text-flow-green crt-glow'
                    }`}>
                      {c.delta.startsWith('-') ? c.delta : `+${c.delta}`}
                    </span>
                    {c.before && c.after && (
                      <span className="text-[10px] text-zinc-500 font-mono">
                        {c.before} {'->'} {c.after}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {result.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {result.tags.map((tag, i) => (
              <span key={i} className="text-[9px] bg-zinc-800/60 border border-zinc-700/40 text-zinc-400 px-1.5 py-0.5 rounded">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Fee */}
        {result.fee > 0 && (
          <div className="text-[10px] text-zinc-500">
            Fee: <span className="text-zinc-400 font-mono">{result.fee.toFixed(8)} FLOW</span>
          </div>
        )}

        {/* Raw events (collapsed) */}
        {result.events.length > 0 && (
          <div>
            <button
              onClick={() => setEventsExpanded(!eventsExpanded)}
              className="text-[10px] text-zinc-500 tracking-wider hover:text-flow-green transition-colors"
            >
              {eventsExpanded ? '▾' : '▸'} RAW EVENTS ({result.events.length})
            </button>
            {eventsExpanded && (
              <div className="mt-2 space-y-1">
                {result.events.map((evt, i) => (
                  <div key={i} className="bg-black/40 border border-zinc-800/30 rounded p-2">
                    <div className="text-[10px] text-flow-green font-mono truncate">{evt.type}</div>
                    {evt.payload && (
                      <pre className="text-[10px] text-zinc-500 mt-1 whitespace-pre-wrap break-all max-h-20 overflow-auto">
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

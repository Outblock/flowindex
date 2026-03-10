function CurlHighlighted() {
  return (
    <pre className="p-5 text-[11px] leading-relaxed overflow-x-auto">
      <code>
        <span className="text-yellow-300">curl</span>
        <span className="text-zinc-400"> -X </span>
        <span className="text-cyan-400">POST</span>
        <span className="text-zinc-400"> https://simulate.flowindex.io/api/simulate \{'\n'}</span>
        <span className="text-zinc-400">  -H </span>
        <span className="text-emerald-400">"Content-Type: application/json"</span>
        <span className="text-zinc-400"> \{'\n'}</span>
        <span className="text-zinc-400">  -d </span>
        <span className="text-emerald-400">{"'"}</span>
        <span className="text-zinc-500">{'{'}{'\n'}</span>
        <span className="text-zinc-500">{'    '}</span>
        <span className="text-purple-400">"cadence"</span>
        <span className="text-zinc-500">: </span>
        <span className="text-emerald-400">"transaction(amount: UFix64) {'{ ... }'}"</span>
        <span className="text-zinc-500">,{'\n'}</span>
        <span className="text-zinc-500">{'    '}</span>
        <span className="text-purple-400">"arguments"</span>
        <span className="text-zinc-500">: [{'{'}</span>
        <span className="text-purple-400">"type"</span>
        <span className="text-zinc-500">: </span>
        <span className="text-emerald-400">"UFix64"</span>
        <span className="text-zinc-500">, </span>
        <span className="text-purple-400">"value"</span>
        <span className="text-zinc-500">: </span>
        <span className="text-emerald-400">"10.0"</span>
        <span className="text-zinc-500">{'}'}],{'\n'}</span>
        <span className="text-zinc-500">{'    '}</span>
        <span className="text-purple-400">"authorizers"</span>
        <span className="text-zinc-500">: [</span>
        <span className="text-emerald-400">"0x1654653399040a61"</span>
        <span className="text-zinc-500">],{'\n'}</span>
        <span className="text-zinc-500">{'    '}</span>
        <span className="text-purple-400">"payer"</span>
        <span className="text-zinc-500">: </span>
        <span className="text-emerald-400">"0x1654653399040a61"</span>
        <span className="text-zinc-500">{'\n'}{'  }'}</span>
        <span className="text-emerald-400">{"'"}</span>
      </code>
    </pre>
  )
}

function ResponseHighlighted() {
  return (
    <pre className="p-5 text-[11px] leading-relaxed overflow-x-auto">
      <code>
        <span className="text-zinc-500">{'{'}{'\n'}</span>
        <span className="text-zinc-500">{'  '}</span>
        <span className="text-purple-400">"success"</span>
        <span className="text-zinc-500">: </span>
        <span className="text-cyan-400">true</span>
        <span className="text-zinc-500">,{'\n'}</span>
        <span className="text-zinc-500">{'  '}</span>
        <span className="text-purple-400">"events"</span>
        <span className="text-zinc-500">: [...],{'\n'}</span>
        <span className="text-zinc-500">{'  '}</span>
        <span className="text-purple-400">"balanceChanges"</span>
        <span className="text-zinc-500">: [{'\n'}</span>
        <span className="text-zinc-500">{'    {'} </span>
        <span className="text-purple-400">"address"</span>
        <span className="text-zinc-500">: </span>
        <span className="text-emerald-400">"1654653399040a61"</span>
        <span className="text-zinc-500">, </span>
        <span className="text-purple-400">"token"</span>
        <span className="text-zinc-500">: </span>
        <span className="text-emerald-400">"FlowToken"</span>
        <span className="text-zinc-500">, </span>
        <span className="text-purple-400">"delta"</span>
        <span className="text-zinc-500">: </span>
        <span className="text-red-400">"-10.0"</span>
        <span className="text-zinc-500"> {'}'},{'\n'}</span>
        <span className="text-zinc-500">{'    {'} </span>
        <span className="text-purple-400">"address"</span>
        <span className="text-zinc-500">: </span>
        <span className="text-emerald-400">"f8d6e0586b0a20c7"</span>
        <span className="text-zinc-500">, </span>
        <span className="text-purple-400">"token"</span>
        <span className="text-zinc-500">: </span>
        <span className="text-emerald-400">"FlowToken"</span>
        <span className="text-zinc-500">, </span>
        <span className="text-purple-400">"delta"</span>
        <span className="text-zinc-500">: </span>
        <span className="text-flow-green">"+10.0"</span>
        <span className="text-zinc-500"> {'}'}{'\n'}</span>
        <span className="text-zinc-500">{'  '}],{'\n'}</span>
        <span className="text-zinc-500">{'  '}</span>
        <span className="text-purple-400">"computationUsed"</span>
        <span className="text-zinc-500">: </span>
        <span className="text-orange-300">1204</span>
        <span className="text-zinc-500">{'\n'}{'}'}</span>
      </code>
    </pre>
  )
}

export function ApiSection() {
  return (
    <section className="py-24 px-6 border-t border-zinc-800/50">
      <div className="mx-auto max-w-4xl">
        <div className="text-[10px] text-flow-green/40 tracking-[3px] mb-4 crt-glow">// REST API</div>
        <h2 className="text-xl font-bold text-zinc-100 mb-2">Programmatic Access</h2>
        <p className="text-xs text-zinc-500 mb-8">
          Use the simulate endpoint directly from your scripts, CI pipelines, or dApps.{' '}
          <a href="https://docs.flowindex.io" target="_blank" rel="noopener" className="text-flow-green hover:underline">
            Full API docs &rarr;
          </a>
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="crt-bezel">
            <div className="crt-screen crt-scanlines bg-[#0a0a0a] overflow-hidden">
              <div className="px-4 py-2 border-b border-zinc-800/60 text-[10px] text-zinc-600 tracking-wider flex items-center gap-1.5 bg-black/40">
                <span className="text-flow-green/60">$</span> REQUEST
              </div>
              <CurlHighlighted />
            </div>
          </div>
          <div className="crt-bezel">
            <div className="crt-screen crt-scanlines bg-[#0a0a0a] overflow-hidden">
              <div className="px-4 py-2 border-b border-zinc-800/60 text-[10px] text-zinc-600 tracking-wider flex items-center gap-1.5 bg-black/40">
                <span className="text-flow-green/60">&gt;</span> RESPONSE
              </div>
              <ResponseHighlighted />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

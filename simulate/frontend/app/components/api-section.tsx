import { useState } from 'react'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      className="absolute top-2 right-2 px-2 py-1 text-[10px] rounded border border-zinc-700/50 bg-zinc-900/80 text-zinc-400 hover:text-flow-green hover:border-flow-green/40 transition-all z-10"
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  )
}

const CURL_TEXT = `curl -X POST https://simulator.flowindex.io/api/simulate \\
  -H "Content-Type: application/json" \\
  -d '{
    "cadence": "transaction(amount: UFix64) { ... }",
    "arguments": [{"type": "UFix64", "value": "10.0"}],
    "authorizers": ["0x1654653399040a61"],
    "payer": "0x1654653399040a61",
    "scheduled": {
      "advance_seconds": 2.5,
      "advance_blocks": 2
    }
  }'`

const RESPONSE_TEXT = `{
  "success": true,
  "summary": "Transfer 10.0 FLOW",
  "summaryItems": [{ "icon": "💸", "text": "Transfer 10.0 FlowToken" }],
  "transfers": [
    {
      "token": "A.1654653399040a61.FlowToken",
      "amount": "10.00000000",
      "from_address": "0x1654653399040a61",
      "to_address": "0xf8d6e0586b0a20c7",
      "transfer_type": "transfer"
    }
  ],
  "nftTransfers": [],
  "balanceChanges": [
    { "address": "1654653399040a61", "token": "FlowToken", "delta": "-10.0", "before": "100.0", "after": "90.0" },
    { "address": "f8d6e0586b0a20c7", "token": "FlowToken", "delta": "10.0", "before": "25.0", "after": "35.0" }
  ],
  "scheduledResults": [
    {
      "tx_id": "a9ca...e14f",
      "success": true,
      "events": [...],
      "computation_used": 318
    }
  ],
  "computationUsed": 1204,
  "fee": 0.00001,
  "tags": ["ft-transfer"],
  "events": [...]
}`

function CurlHighlighted() {
  return (
    <div className="relative">
      <CopyButton text={CURL_TEXT} />
    <pre className="p-5 text-[11px] leading-relaxed overflow-x-auto">
      <code>
        <span className="text-yellow-300">curl</span>
        <span className="text-zinc-400"> -X </span>
        <span className="text-cyan-400">POST</span>
        <span className="text-zinc-400"> https://simulator.flowindex.io/api/simulate \{'\n'}</span>
        <span className="text-zinc-400">  -H </span>
        <span className="text-emerald-400">"Content-Type: application/json"</span>
        <span className="text-zinc-400"> \{'\n'}</span>
        <span className="text-zinc-400">  -d </span>
        <span className="text-emerald-400">{"'"}</span>
        <span className="text-zinc-400">{'{'}{'\n'}</span>
        <span className="text-zinc-400">{'    '}</span>
        <span className="text-purple-400">"cadence"</span>
        <span className="text-zinc-400">: </span>
        <span className="text-emerald-400">"transaction(amount: UFix64) {'{ ... }'}"</span>
        <span className="text-zinc-400">,{'\n'}</span>
        <span className="text-zinc-400">{'    '}</span>
        <span className="text-purple-400">"arguments"</span>
        <span className="text-zinc-400">: [{'{'}</span>
        <span className="text-purple-400">"type"</span>
        <span className="text-zinc-400">: </span>
        <span className="text-emerald-400">"UFix64"</span>
        <span className="text-zinc-400">, </span>
        <span className="text-purple-400">"value"</span>
        <span className="text-zinc-400">: </span>
        <span className="text-emerald-400">"10.0"</span>
        <span className="text-zinc-400">{'}'}],{'\n'}</span>
        <span className="text-zinc-400">{'    '}</span>
        <span className="text-purple-400">"authorizers"</span>
        <span className="text-zinc-400">: [</span>
        <span className="text-emerald-400">"0x1654653399040a61"</span>
        <span className="text-zinc-400">],{'\n'}</span>
        <span className="text-zinc-400">{'    '}</span>
        <span className="text-purple-400">"payer"</span>
        <span className="text-zinc-400">: </span>
        <span className="text-emerald-400">"0x1654653399040a61"</span>
        <span className="text-zinc-400">,{'\n'}</span>
        <span className="text-zinc-400">{'    '}</span>
        <span className="text-purple-400">"scheduled"</span>
        <span className="text-zinc-400">: {'{'}{'\n'}</span>
        <span className="text-zinc-400">{'      '}</span>
        <span className="text-purple-400">"advance_seconds"</span>
        <span className="text-zinc-400">: </span>
        <span className="text-orange-300">2.5</span>
        <span className="text-zinc-400">,{'\n'}</span>
        <span className="text-zinc-400">{'      '}</span>
        <span className="text-purple-400">"advance_blocks"</span>
        <span className="text-zinc-400">: </span>
        <span className="text-orange-300">2</span>
        <span className="text-zinc-400">{'\n'}{'    }'}{'\n'}{'  }'}</span>
        <span className="text-emerald-400">{"'"}</span>
      </code>
    </pre>
    </div>
  )
}

function ResponseHighlighted() {
  return (
    <div className="relative">
      <CopyButton text={RESPONSE_TEXT} />
    <pre className="p-5 text-[11px] leading-relaxed overflow-x-auto">
      <code>
        <span className="text-zinc-400">{'{'}{'\n'}</span>
        <span className="text-zinc-400">{'  '}</span>
        <span className="text-purple-400">"success"</span>
        <span className="text-zinc-400">: </span>
        <span className="text-cyan-400">true</span>
        <span className="text-zinc-400">,{'\n'}</span>
        <span className="text-zinc-400">{'  '}</span>
        <span className="text-purple-400">"summary"</span>
        <span className="text-zinc-400">: </span>
        <span className="text-emerald-400">"Transfer 10.0 FLOW"</span>
        <span className="text-zinc-400">,{'\n'}</span>
        <span className="text-zinc-400">{'  '}</span>
        <span className="text-purple-400">"transfers"</span>
        <span className="text-zinc-400">: [{'{'}{'\n'}</span>
        <span className="text-zinc-400">{'    '}</span>
        <span className="text-purple-400">"token"</span>
        <span className="text-zinc-400">: </span>
        <span className="text-emerald-400">"A.1654653399040a61.FlowToken"</span>
        <span className="text-zinc-400">,{'\n'}</span>
        <span className="text-zinc-400">{'    '}</span>
        <span className="text-purple-400">"amount"</span>
        <span className="text-zinc-400">: </span>
        <span className="text-emerald-400">"10.00000000"</span>
        <span className="text-zinc-400">,{'\n'}</span>
        <span className="text-zinc-400">{'    '}</span>
        <span className="text-purple-400">"from_address"</span>
        <span className="text-zinc-400">: </span>
        <span className="text-emerald-400">"0x1654653399040a61"</span>
        <span className="text-zinc-400">,{'\n'}</span>
        <span className="text-zinc-400">{'    '}</span>
        <span className="text-purple-400">"to_address"</span>
        <span className="text-zinc-400">: </span>
        <span className="text-emerald-400">"0xf8d6e0586b0a20c7"</span>
        <span className="text-zinc-400">,{'\n'}</span>
        <span className="text-zinc-400">{'    '}</span>
        <span className="text-purple-400">"transfer_type"</span>
        <span className="text-zinc-400">: </span>
        <span className="text-emerald-400">"transfer"</span>
        <span className="text-zinc-400">{'\n'}{'  '}],{'\n'}</span>
        <span className="text-zinc-400">{'  '}</span>
        <span className="text-purple-400">"balanceChanges"</span>
        <span className="text-zinc-400">: [{'\n'}</span>
        <span className="text-zinc-400">{'    {'} </span>
        <span className="text-purple-400">"address"</span>
        <span className="text-zinc-400">: </span>
        <span className="text-emerald-400">"1654653399040a61"</span>
        <span className="text-zinc-400">, </span>
        <span className="text-purple-400">"delta"</span>
        <span className="text-zinc-400">: </span>
        <span className="text-red-400">"-10.0"</span>
        <span className="text-zinc-400"> {'}'},{'\n'}</span>
        <span className="text-zinc-400">{'    {'} </span>
        <span className="text-purple-400">"address"</span>
        <span className="text-zinc-400">: </span>
        <span className="text-emerald-400">"f8d6e0586b0a20c7"</span>
        <span className="text-zinc-400">, </span>
        <span className="text-purple-400">"delta"</span>
        <span className="text-zinc-400">: </span>
        <span className="text-flow-green">"+10.0"</span>
        <span className="text-zinc-400"> {'}'}{'\n'}</span>
        <span className="text-zinc-400">{'  '}],{'\n'}</span>
        <span className="text-zinc-400">{'  '}</span>
        <span className="text-purple-400">"scheduledResults"</span>
        <span className="text-zinc-400">: [{'{'}{'\n'}</span>
        <span className="text-zinc-400">{'    '}</span>
        <span className="text-purple-400">"tx_id"</span>
        <span className="text-zinc-400">: </span>
        <span className="text-emerald-400">"a9ca...e14f"</span>
        <span className="text-zinc-400">,{'\n'}</span>
        <span className="text-zinc-400">{'    '}</span>
        <span className="text-purple-400">"success"</span>
        <span className="text-zinc-400">: </span>
        <span className="text-cyan-400">true</span>
        <span className="text-zinc-400">,{'\n'}</span>
        <span className="text-zinc-400">{'    '}</span>
        <span className="text-purple-400">"computation_used"</span>
        <span className="text-zinc-400">: </span>
        <span className="text-orange-300">318</span>
        <span className="text-zinc-400">{'\n'}{'  '}],{'\n'}</span>
        <span className="text-zinc-400">{'  '}</span>
        <span className="text-purple-400">"computationUsed"</span>
        <span className="text-zinc-400">: </span>
        <span className="text-orange-300">1204</span>
        <span className="text-zinc-400">,{'\n'}</span>
        <span className="text-zinc-400">{'  '}</span>
        <span className="text-purple-400">"fee"</span>
        <span className="text-zinc-400">: </span>
        <span className="text-orange-300">0.00001</span>
        <span className="text-zinc-400">,{'\n'}</span>
        <span className="text-zinc-400">{'  '}</span>
        <span className="text-purple-400">"tags"</span>
        <span className="text-zinc-400">: [</span>
        <span className="text-emerald-400">"ft-transfer"</span>
        <span className="text-zinc-400">],{'\n'}</span>
        <span className="text-zinc-400">{'  '}</span>
        <span className="text-purple-400">"events"</span>
        <span className="text-zinc-400">: [...]</span>
        <span className="text-zinc-400">{'\n'}{'}'}</span>
      </code>
    </pre>
    </div>
  )
}

export function ApiSection() {
  return (
    <section className="py-24 px-6 border-t border-zinc-800/50 glow-divider">
      <div className="mx-auto max-w-5xl">
        <div className="text-[10px] text-flow-green/60 tracking-[3px] mb-4 crt-glow">// REST API</div>
        <h2 className="text-xl font-bold text-zinc-100 mb-2">Programmatic Access</h2>
        <p className="text-xs text-zinc-400 mb-8">
          Use the simulate endpoint directly from your scripts, CI pipelines, or dApps.{' '}
          <a href="https://docs.flowindex.io" target="_blank" rel="noopener" className="text-flow-green hover:underline">
            Full API docs &rarr;
          </a>
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="crt-bezel">
            <div className="crt-screen crt-scanlines bg-[#0a0a0a] overflow-hidden">
              <div className="px-4 py-2 border-b border-zinc-800/60 text-[10px] text-zinc-500 tracking-wider flex items-center gap-1.5 bg-black/40">
                <span className="text-flow-green/60">$</span> REQUEST
              </div>
              <CurlHighlighted />
            </div>
          </div>
          <div className="crt-bezel">
            <div className="crt-screen crt-scanlines bg-[#0a0a0a] overflow-hidden">
              <div className="px-4 py-2 border-b border-zinc-800/60 text-[10px] text-zinc-500 tracking-wider flex items-center gap-1.5 bg-black/40">
                <span className="text-flow-green/60">&gt;</span> RESPONSE
              </div>
              <ResponseHighlighted />
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded border border-zinc-800/60 bg-black/30 px-4 py-3">
            <div className="text-[10px] tracking-[2px] text-flow-green/70 mb-1">SCHEDULED OPTIONS</div>
            <p className="text-[11px] leading-relaxed text-zinc-400">
              Add <span className="text-zinc-200 font-mono">scheduled.advance_seconds</span> to wait before advancing
              extra blocks, and <span className="text-zinc-200 font-mono">scheduled.advance_blocks</span> to decide how
              many scheduled callback rounds can execute in the same isolated simulation. In practice,{' '}
              <span className="text-zinc-200 font-mono">advance_blocks</span> is the main control for
              &quot;simulate N scheduled calls&quot;.
            </p>
          </div>
          <div className="rounded border border-zinc-800/60 bg-black/30 px-4 py-3">
            <div className="text-[10px] tracking-[2px] text-flow-green/70 mb-1">CURRENT LIMITS</div>
            <p className="text-[11px] leading-relaxed text-zinc-400">
              The simulator currently caps waits at <span className="text-zinc-200 font-mono">5s</span> and extra
              blocks at <span className="text-zinc-200 font-mono">20</span>. This prevents one request from holding the
              single emulator lane for minutes or hours.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

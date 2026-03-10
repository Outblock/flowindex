const CURL_EXAMPLE = `curl -X POST https://simulate.flowindex.io/api/simulate \\
  -H "Content-Type: application/json" \\
  -d '{
    "cadence": "transaction(amount: UFix64) { ... }",
    "arguments": [{"type": "UFix64", "value": "10.0"}],
    "authorizers": ["0x1654653399040a61"],
    "payer": "0x1654653399040a61"
  }'`

const RESPONSE_EXAMPLE = `{
  "success": true,
  "events": [...],
  "balanceChanges": [
    { "address": "1654653399040a61", "token": "FlowToken", "delta": "-10.0" },
    { "address": "f8d6e0586b0a20c7", "token": "FlowToken", "delta": "10.0" }
  ],
  "computationUsed": 1204
}`

export function ApiSection() {
  return (
    <section className="py-24 px-6 border-t border-zinc-800/50">
      <div className="mx-auto max-w-4xl">
        <div className="text-[10px] text-zinc-600 tracking-[3px] mb-4">// REST API</div>
        <h2 className="text-xl font-bold text-zinc-100 mb-2">Programmatic Access</h2>
        <p className="text-xs text-zinc-500 mb-8">
          Use the simulate endpoint directly from your scripts, CI pipelines, or dApps.{' '}
          <a href="https://docs.flowindex.io" target="_blank" rel="noopener" className="text-flow-green hover:underline">
            Full API docs →
          </a>
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950">
            <div className="px-4 py-2 border-b border-zinc-800 text-[10px] text-zinc-600 tracking-wider">REQUEST</div>
            <pre className="p-4 text-[11px] text-zinc-400 leading-relaxed overflow-x-auto">
              <code>{CURL_EXAMPLE}</code>
            </pre>
          </div>
          <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950">
            <div className="px-4 py-2 border-b border-zinc-800 text-[10px] text-zinc-600 tracking-wider">RESPONSE</div>
            <pre className="p-4 text-[11px] text-zinc-400 leading-relaxed overflow-x-auto">
              <code>{RESPONSE_EXAMPLE}</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  )
}

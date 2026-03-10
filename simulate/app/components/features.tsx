const FEATURES = [
  {
    title: 'Mainnet Fork',
    desc: 'Fork real mainnet state via Flow Emulator. Your simulation runs against actual on-chain data.',
  },
  {
    title: 'Snapshot Isolation',
    desc: 'Every simulation creates a snapshot, executes, then reverts. Zero side effects.',
  },
  {
    title: 'Balance Detection',
    desc: 'Automatically parses token transfer events to show balance deltas per address.',
  },
  {
    title: 'Zero Risk Preview',
    desc: 'See balance changes, events, and errors — before signing anything.',
  },
]

export function Features() {
  return (
    <section className="py-24 px-6">
      <div className="mx-auto max-w-5xl">
        <div className="text-[10px] text-zinc-600 tracking-[3px] mb-8">// FEATURES</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="border border-zinc-800 rounded-lg p-5 bg-zinc-950 hover:border-zinc-700 transition-colors">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1.5 h-1.5 rounded-full bg-flow-green" />
                <h3 className="text-sm font-semibold text-zinc-200">{f.title}</h3>
              </div>
              <p className="text-xs text-zinc-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

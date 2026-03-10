const FEATURES = [
  {
    title: 'Mainnet Fork',
    desc: 'Fork real mainnet state via Flow Emulator. Your simulation runs against actual on-chain data.',
    icon: '⎔',
  },
  {
    title: 'Snapshot Isolation',
    desc: 'Every simulation creates a snapshot, executes, then reverts. Zero side effects.',
    icon: '◫',
  },
  {
    title: 'Balance Detection',
    desc: 'Automatically parses token transfer events to show balance deltas per address.',
    icon: '⊞',
  },
  {
    title: 'Zero Risk Preview',
    desc: 'See balance changes, events, and errors — before signing anything.',
    icon: '◉',
  },
]

export function Features() {
  return (
    <section className="py-24 px-6">
      <div className="mx-auto max-w-5xl">
        <div className="text-[10px] text-flow-green/40 tracking-[3px] mb-8 crt-glow">// FEATURES</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="crt-bezel group">
              <div className="crt-screen crt-scanlines bg-[#0a0a0a] p-5 h-full">
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="text-flow-green text-sm crt-glow">{f.icon}</span>
                  <h3 className="text-sm font-semibold text-zinc-200 group-hover:text-flow-green transition-colors">{f.title}</h3>
                </div>
                <p className="text-xs text-zinc-500 leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

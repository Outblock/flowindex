import { useEffect, useRef, useState } from 'react'

const CODE_LINES = [
  { tokens: [{ text: 'import', cl: 'text-purple-400' }, { text: ' FungibleToken', cl: 'text-yellow-300' }, { text: ' from ', cl: 'text-purple-400' }, { text: '0xf233dcee88fe0abe', cl: 'text-green-400' }] },
  { tokens: [{ text: 'import', cl: 'text-purple-400' }, { text: ' FlowToken', cl: 'text-yellow-300' }, { text: ' from ', cl: 'text-purple-400' }, { text: '0x1654653399040a61', cl: 'text-green-400' }] },
  { tokens: [] },
  { tokens: [{ text: 'transaction', cl: 'text-purple-400' }, { text: '(amount: ', cl: 'text-zinc-400' }, { text: 'UFix64', cl: 'text-yellow-300' }, { text: ', to: ', cl: 'text-zinc-400' }, { text: 'Address', cl: 'text-yellow-300' }, { text: ') {', cl: 'text-zinc-400' }] },
  { tokens: [{ text: '  prepare', cl: 'text-purple-400' }, { text: '(signer: &', cl: 'text-zinc-400' }, { text: 'Account', cl: 'text-yellow-300' }, { text: ') {', cl: 'text-zinc-400' }] },
  { tokens: [{ text: '    let', cl: 'text-purple-400' }, { text: ' vault ', cl: 'text-zinc-400' }, { text: '<-', cl: 'text-purple-400' }, { text: ' signer', cl: 'text-zinc-400' }] },
  { tokens: [{ text: '      .storage.borrow<...>()', cl: 'text-zinc-500' }] },
  { tokens: [{ text: '      .withdraw(', cl: 'text-zinc-400' }, { text: 'amount', cl: 'text-yellow-300' }, { text: ')', cl: 'text-zinc-400' }] },
  { tokens: [{ text: '    recipient.deposit(', cl: 'text-zinc-400' }, { text: '<-', cl: 'text-purple-400' }, { text: ' vault)', cl: 'text-zinc-400' }] },
  { tokens: [{ text: '  }', cl: 'text-zinc-400' }] },
  { tokens: [{ text: '}', cl: 'text-zinc-400' }] },
]

type Phase = 'idle' | 'typing' | 'ready' | 'running' | 'done'

export function Hero() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [visibleLines, setVisibleLines] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearTimers = () => {
    timerRef.current.forEach(clearTimeout)
    timerRef.current = []
  }

  const schedule = (fn: () => void, ms: number) => {
    timerRef.current.push(setTimeout(fn, ms))
  }

  useEffect(() => {
    const run = () => {
      clearTimers()
      setPhase('typing')
      setVisibleLines(0)

      CODE_LINES.forEach((_, i) => {
        schedule(() => setVisibleLines(i + 1), 150 * (i + 1))
      })

      schedule(() => setPhase('ready'), 150 * CODE_LINES.length + 400)
      schedule(() => setPhase('running'), 150 * CODE_LINES.length + 1200)
      schedule(() => setPhase('done'), 150 * CODE_LINES.length + 2200)
      schedule(() => {
        setPhase('idle')
        setVisibleLines(0)
        schedule(run, 600)
      }, 150 * CODE_LINES.length + 6500)
    }

    schedule(run, 500)
    return clearTimers
  }, [])

  const scrollToPlayground = () => {
    document.getElementById('playground')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <section className="min-h-screen flex flex-col items-center justify-center px-6 pt-12">
      <div className="flex items-stretch gap-0 w-full max-w-3xl">
        <div className="flex-1 border border-zinc-800 rounded-l-lg bg-zinc-950 overflow-hidden">
          <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
            <span className="text-[10px] text-zinc-600">transfer.cdc</span>
            <button
              className={`px-3 py-1 rounded text-[11px] font-bold transition-all duration-300 ${
                phase === 'ready'
                  ? 'bg-flow-green text-black shadow-[0_0_20px_rgba(0,239,139,0.3)]'
                  : phase === 'running'
                    ? 'bg-flow-green text-black animate-pulse'
                    : phase === 'done'
                      ? 'bg-flow-green text-black'
                      : 'bg-zinc-800 text-zinc-600 border border-zinc-700'
              }`}
            >
              {phase === 'running' ? '◉ Running...' : phase === 'done' ? '✓ Passed' : '▶ Simulate'}
            </button>
          </div>
          <div className="p-4 text-[12px] leading-[1.9]">
            {CODE_LINES.map((line, i) => (
              <div
                key={i}
                className={`transition-all duration-300 ${
                  i < visibleLines ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-5'
                }`}
              >
                <span className="text-zinc-700 mr-3 select-none">{String(i + 1).padStart(2)}</span>
                {line.tokens.map((t, j) => (
                  <span key={j} className={t.cl}>{t.text}</span>
                ))}
                {line.tokens.length === 0 && <span>&nbsp;</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="w-10 flex items-center justify-center">
          <div
            className={`h-[2px] transition-all duration-500 ${
              phase === 'running' || phase === 'done' ? 'w-8 bg-flow-green' : 'w-0 bg-zinc-700'
            }`}
          />
        </div>

        <div className="w-64 border border-zinc-800 rounded-r-lg bg-zinc-950 overflow-hidden">
          <div className="px-3 py-2 border-b border-zinc-800">
            <span className="text-[10px] text-zinc-600 tracking-wider">RESULT</span>
          </div>
          <div
            className={`p-4 transition-all duration-500 ${
              phase === 'done' ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-3'
            }`}
          >
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 rounded-full bg-flow-green" />
              <span className="text-flow-green text-xs font-semibold">Passed</span>
              <span className="ml-auto text-[10px] text-zinc-600 bg-zinc-900 px-2 py-0.5 rounded">1,204 comp</span>
            </div>
            <div className="text-[10px] text-zinc-600 tracking-wider mb-2">BALANCE CHANGES</div>
            <div className="bg-zinc-900 rounded p-2.5 text-[11px] space-y-1.5">
              <div className="flex justify-between">
                <span className="text-zinc-500">0x1654...0a61</span>
                <span className="text-red-400">-10.0 FLOW</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">0xf8d6...20c7</span>
                <span className="text-flow-green">+10.0 FLOW</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        className={`text-center mt-12 transition-opacity duration-800 ${
          phase === 'done' ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tighter text-white">
          See what happens. <span className="text-flow-green">Before it happens.</span>
        </h1>
        <p className="mt-3 text-sm text-zinc-600">
          Real mainnet state. Simulated execution. Full visibility.
        </p>
        <button
          onClick={scrollToPlayground}
          className="mt-8 px-5 py-2 border border-zinc-700 rounded text-xs text-zinc-400 hover:border-flow-green hover:text-flow-green transition-colors"
        >
          Try it below ↓
        </button>
      </div>
    </section>
  )
}

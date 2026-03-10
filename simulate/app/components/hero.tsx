import { useEffect, useRef, useState } from 'react'

/* ── Typewriter tagline ── */
const TAGLINE_1 = 'See what happens. '
const TAGLINE_2 = 'Before it happens.'
const SUBTITLE = 'Real mainnet state. Simulated execution. Full visibility.'

function Typewriter({ phase, onClickPlayground }: { phase: Phase; onClickPlayground: () => void }) {
  const [charIdx, setCharIdx] = useState(0)
  const [subtitleIdx, setSubtitleIdx] = useState(0)
  const [showButton, setShowButton] = useState(false)
  const started = useRef(false)

  const fullTagline = TAGLINE_1 + TAGLINE_2
  const totalChars = fullTagline.length

  useEffect(() => {
    if (phase !== 'done' || started.current) return
    started.current = true
    setCharIdx(0)
    setSubtitleIdx(0)
    setShowButton(false)

    let i = 0
    const taglineTimer = setInterval(() => {
      i++
      setCharIdx(i)
      if (i >= totalChars) {
        clearInterval(taglineTimer)
        setTimeout(() => {
          let j = 0
          const subTimer = setInterval(() => {
            j++
            setSubtitleIdx(j)
            if (j >= SUBTITLE.length) {
              clearInterval(subTimer)
              setTimeout(() => setShowButton(true), 300)
            }
          }, 20)
        }, 400)
      }
    }, 50)

    return () => clearInterval(taglineTimer)
  }, [phase])

  const visibleTagline = fullTagline.slice(0, charIdx)
  const part1 = visibleTagline.slice(0, TAGLINE_1.length)
  const part2 = visibleTagline.slice(TAGLINE_1.length)
  const isTyping = charIdx < totalChars || (subtitleIdx > 0 && subtitleIdx < SUBTITLE.length)
  const showCursor = phase === 'done'
  const visibleSubtitle = SUBTITLE.slice(0, subtitleIdx)

  return (
    <div className={`text-center mt-16 transition-opacity duration-300 ${phase === 'done' ? 'opacity-100' : 'opacity-0'}`}>
      <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tighter text-white">
        {part1}
        {part2 && (
          <span className="text-flow-green" style={{ textShadow: '0 0 30px rgba(0,239,139,0.35)' }}>
            {part2}
          </span>
        )}
        {showCursor && charIdx < totalChars && (
          <span
            className="inline-block w-[0.55em] h-[1.05em] ml-[2px] animate-[cursor-blink_1s_step-end_infinite] align-middle"
            style={{ background: '#00ef8b', boxShadow: '0 0 8px rgba(0,239,139,0.6), 0 0 16px rgba(0,239,139,0.2)' }}
          />
        )}
      </h1>
      <p className="mt-4 text-sm text-zinc-600 h-5">
        {visibleSubtitle}
        {showCursor && charIdx >= totalChars && (
          <span
            className="inline-block w-[0.5em] h-[1.05em] ml-[1px] animate-[cursor-blink_1s_step-end_infinite] align-middle"
            style={{ background: '#00ef8b', boxShadow: '0 0 6px rgba(0,239,139,0.5), 0 0 12px rgba(0,239,139,0.15)' }}
          />
        )}
      </p>
      <button
        onClick={onClickPlayground}
        className={`mt-8 px-6 py-2.5 border border-zinc-700 rounded text-xs text-zinc-400 hover:border-flow-green hover:text-flow-green hover:shadow-[0_0_12px_rgba(0,239,139,0.15)] transition-all ${showButton ? 'opacity-100' : 'opacity-0'}`}
      >
        Try it below &darr;
      </button>
    </div>
  )
}

/* ── Cadence syntax highlighting tokens ── */
const CODE_LINES = [
  { tokens: [{ text: 'import', cl: 'text-purple-400' }, { text: ' FungibleToken ', cl: 'text-yellow-300' }, { text: 'from ', cl: 'text-purple-400' }, { text: '0xf233dcee88fe0abe', cl: 'text-emerald-400' }] },
  { tokens: [{ text: 'import', cl: 'text-purple-400' }, { text: ' FlowToken ', cl: 'text-yellow-300' }, { text: 'from ', cl: 'text-purple-400' }, { text: '0x1654653399040a61', cl: 'text-emerald-400' }] },
  { tokens: [] },
  { tokens: [{ text: 'transaction', cl: 'text-purple-400' }, { text: '(', cl: 'text-zinc-500' }, { text: 'amount', cl: 'text-orange-300' }, { text: ': ', cl: 'text-zinc-500' }, { text: 'UFix64', cl: 'text-cyan-400' }, { text: ', ', cl: 'text-zinc-500' }, { text: 'to', cl: 'text-orange-300' }, { text: ': ', cl: 'text-zinc-500' }, { text: 'Address', cl: 'text-cyan-400' }, { text: ') {', cl: 'text-zinc-500' }] },
  { tokens: [{ text: '  prepare', cl: 'text-purple-400' }, { text: '(', cl: 'text-zinc-500' }, { text: 'signer', cl: 'text-orange-300' }, { text: ': ', cl: 'text-zinc-500' }, { text: 'auth', cl: 'text-purple-400' }, { text: '(BorrowValue) ', cl: 'text-zinc-500' }, { text: '&Account', cl: 'text-cyan-400' }, { text: ') {', cl: 'text-zinc-500' }] },
  { tokens: [{ text: '    let', cl: 'text-purple-400' }, { text: ' vault ', cl: 'text-zinc-300' }, { text: '<- ', cl: 'text-red-400' }, { text: 'signer', cl: 'text-orange-300' }] },
  { tokens: [{ text: '      .storage.borrow', cl: 'text-zinc-400' }, { text: '<...>', cl: 'text-zinc-600' }, { text: '()', cl: 'text-zinc-400' }] },
  { tokens: [{ text: '      .withdraw', cl: 'text-zinc-400' }, { text: '(', cl: 'text-zinc-500' }, { text: 'amount', cl: 'text-orange-300' }, { text: ')', cl: 'text-zinc-500' }] },
  { tokens: [{ text: '    recipient.deposit', cl: 'text-zinc-400' }, { text: '(from: ', cl: 'text-zinc-500' }, { text: '<- ', cl: 'text-red-400' }, { text: 'vault', cl: 'text-zinc-300' }, { text: ')', cl: 'text-zinc-500' }] },
  { tokens: [{ text: '  }', cl: 'text-zinc-500' }] },
  { tokens: [{ text: '}', cl: 'text-zinc-500' }] },
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
    }

    schedule(run, 500)
    return clearTimers
  }, [])

  const scrollToPlayground = () => {
    document.getElementById('playground')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <section className="min-h-screen flex flex-col items-center justify-center px-4 pt-16 pb-8">

      <div className="w-full max-w-5xl">
        {/* ══════ Old beige/cream CRT monitor ══════ */}

        {/* Back depth shadow — the CRT is DEEP */}
        <div
          className="relative"
          style={{
            filter: 'drop-shadow(0 30px 40px rgba(0,0,0,0.6))',
          }}
        >
          {/* ── Outer plastic shell — chunky beige/warm gray ── */}
          <div
            className="relative rounded-[20px]"
            style={{
              background: `linear-gradient(
                180deg,
                #e8e0d0 0%,
                #ddd5c4 4%,
                #d5ccba 10%,
                #ccc3b0 20%,
                #c4baa6 50%,
                #bbb09c 80%,
                #b0a592 95%,
                #a69a86 100%
              )`,
              padding: '36px 36px 0 36px',
              boxShadow: `
                inset 0 2px 0 rgba(255,255,255,0.5),
                inset 0 -2px 0 rgba(0,0,0,0.15),
                inset 2px 0 0 rgba(255,255,255,0.2),
                inset -2px 0 0 rgba(0,0,0,0.08),
                0 0 80px rgba(0,0,0,0.3)
              `,
            }}
          >
            {/* Embossed brand top-center */}
            <div
              className="absolute top-[12px] left-1/2 -translate-x-1/2 text-[10px] tracking-[6px] uppercase font-bold select-none"
              style={{
                color: 'rgba(0,0,0,0.15)',
                textShadow: '0 1px 0 rgba(255,255,255,0.25)',
              }}
            >
              FlowIndex
            </div>

            {/* ── Recessed screen area — dark inner frame ── */}
            <div
              className="relative rounded-[8px] overflow-hidden"
              style={{
                boxShadow: `
                  inset 0 6px 20px rgba(0,0,0,0.7),
                  inset 0 0 60px rgba(0,0,0,0.4),
                  inset 6px 0 20px rgba(0,0,0,0.3),
                  inset -6px 0 20px rgba(0,0,0,0.3),
                  inset 0 -4px 12px rgba(0,0,0,0.5),
                  0 0 0 2px rgba(60,50,35,0.6),
                  0 0 0 4px rgba(80,70,50,0.3)
                `,
                border: '3px solid #5a5040',
              }}
            >
              {/* ── CRT phosphor tube ── */}
              <div
                className="relative overflow-hidden"
                style={{
                  background: '#010a03',
                  minHeight: '460px',
                  borderRadius: '4px',
                }}
              >
                {/* Scanlines — tighter, more visible */}
                <div
                  className="absolute inset-0 pointer-events-none z-[3]"
                  style={{
                    background: `repeating-linear-gradient(
                      0deg,
                      transparent,
                      transparent 1px,
                      rgba(0,0,0,0.3) 1px,
                      rgba(0,0,0,0.3) 2px
                    )`,
                  }}
                />

                {/* Barrel distortion vignette */}
                <div
                  className="absolute inset-0 pointer-events-none z-[4]"
                  style={{
                    background: `radial-gradient(
                      ellipse 65% 65% at 50% 50%,
                      transparent 35%,
                      rgba(0,0,0,0.35) 65%,
                      rgba(0,0,0,0.8) 100%
                    )`,
                  }}
                />

                {/* Glass bulge reflection */}
                <div
                  className="absolute inset-0 pointer-events-none z-[5]"
                  style={{
                    background: `
                      radial-gradient(ellipse 50% 35% at 30% 25%, rgba(255,255,255,0.05) 0%, transparent 100%),
                      radial-gradient(ellipse 80% 60% at 50% 50%, rgba(0,239,139,0.015) 0%, transparent 100%)
                    `,
                  }}
                />

                {/* Phosphor ambient */}
                <div
                  className="absolute inset-0 pointer-events-none z-[2]"
                  style={{
                    boxShadow: `
                      inset 0 0 100px rgba(0, 239, 139, 0.04),
                      inset 0 0 30px rgba(0, 239, 139, 0.02)
                    `,
                  }}
                />

                {/* Screen content */}
                <div className="relative z-[1] flex items-stretch min-h-[460px]">
                  {/* Code panel */}
                  <div className="flex-1 overflow-hidden">
                    <div className="px-5 py-3 border-b border-emerald-900/20 flex items-center justify-between">
                      <span className="text-[11px] text-emerald-700/50 flex items-center gap-2">
                        <span className="text-emerald-500/50">$</span> transfer.cdc
                      </span>
                      <button
                        className={`px-4 py-1.5 rounded text-[12px] font-bold transition-all duration-300 ${
                          phase === 'ready'
                            ? 'bg-flow-green text-black shadow-[0_0_30px_rgba(0,239,139,0.6)]'
                            : phase === 'running'
                              ? 'bg-flow-green text-black animate-pulse shadow-[0_0_20px_rgba(0,239,139,0.4)]'
                              : phase === 'done'
                                ? 'bg-flow-green text-black'
                                : 'bg-emerald-950/30 text-emerald-800/40 border border-emerald-900/20'
                        }`}
                      >
                        {phase === 'running' ? '◉ Running...' : phase === 'done' ? '✓ Passed' : '▶ Simulate'}
                      </button>
                    </div>
                    <div className="p-6 text-[13px] leading-[2]">
                      {CODE_LINES.map((line, i) => (
                        <div
                          key={i}
                          className={`transition-all duration-300 ${
                            i < visibleLines ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-5'
                          }`}
                          style={{ textShadow: i < visibleLines ? '0 0 10px rgba(0, 239, 139, 0.12)' : 'none' }}
                        >
                          <span className="text-emerald-900/30 mr-4 select-none text-[10px] inline-block w-4 text-right">{String(i + 1).padStart(2)}</span>
                          {line.tokens.map((t, j) => (
                            <span key={j} className={t.cl}>{t.text}</span>
                          ))}
                          {line.tokens.length === 0 && <span>&nbsp;</span>}
                        </div>
                      ))}
                      {phase === 'typing' && visibleLines < CODE_LINES.length && (
                        <span
                          className="inline-block w-[8px] h-[15px] bg-flow-green ml-8 animate-[cursor-blink_1s_step-end_infinite]"
                          style={{ boxShadow: '0 0 10px rgba(0,239,139,0.7), 0 0 20px rgba(0,239,139,0.3)' }}
                        />
                      )}
                    </div>
                  </div>

                  {/* Arrow */}
                  <div className="w-14 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-1">
                      <div
                        className={`h-[2px] transition-all duration-500 ${
                          phase === 'running' || phase === 'done' ? 'w-12 bg-flow-green' : 'w-0 bg-emerald-900/20'
                        }`}
                        style={phase === 'running' || phase === 'done' ? { boxShadow: '0 0 16px rgba(0,239,139,0.7), 0 0 4px rgba(0,239,139,0.9)' } : {}}
                      />
                    </div>
                  </div>

                  {/* Result panel */}
                  <div className="w-72 border-l border-emerald-900/15 overflow-hidden">
                    <div className="px-5 py-3 border-b border-emerald-900/20">
                      <span className="text-[11px] text-emerald-700/40 tracking-wider flex items-center gap-1.5">
                        <span className="text-emerald-500/50">&gt;</span> RESULT
                      </span>
                    </div>
                    <div
                      className={`p-5 transition-all duration-500 ${
                        phase === 'done' ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-3'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-5">
                        <div
                          className="w-2.5 h-2.5 rounded-full bg-flow-green"
                          style={{ boxShadow: '0 0 10px rgba(0,239,139,0.9), 0 0 20px rgba(0,239,139,0.4)' }}
                        />
                        <span className="text-flow-green text-sm font-semibold" style={{ textShadow: '0 0 12px rgba(0,239,139,0.6)' }}>Passed</span>
                        <span className="ml-auto text-[10px] text-emerald-700/40 bg-emerald-950/20 px-2 py-0.5 rounded border border-emerald-900/15">1,204 comp</span>
                      </div>
                      <div className="text-[10px] text-emerald-700/40 tracking-wider mb-3">BALANCE CHANGES</div>
                      <div className="rounded-lg p-3 text-[12px] space-y-2 border border-emerald-900/15 bg-emerald-950/10">
                        <div className="flex justify-between">
                          <span className="text-emerald-700/50">0x1654...0a61</span>
                          <span className="text-red-400" style={{ textShadow: '0 0 8px rgba(248,113,113,0.4)' }}>-10.0 FLOW</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-emerald-700/50">0xf8d6...20c7</span>
                          <span className="text-flow-green" style={{ textShadow: '0 0 10px rgba(0,239,139,0.6)' }}>+10.0 FLOW</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Bottom face panel with physical controls ── */}
            <div
              className="flex items-center justify-between px-5 py-4 mt-0"
              style={{
                borderTop: '1px solid rgba(0,0,0,0.1)',
                background: 'linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.12) 100%)',
                borderRadius: '0 0 20px 20px',
              }}
            >
              {/* Left: physical push buttons */}
              <div className="flex items-center gap-2">
                {['PWR', 'MENU'].map((label) => (
                  <div key={label} className="flex flex-col items-center gap-1">
                    <div
                      className="w-[18px] h-[10px] rounded-[2px]"
                      style={{
                        background: 'linear-gradient(180deg, #8a8070 0%, #7a7060 40%, #6a6050 100%)',
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2), 0 2px 3px rgba(0,0,0,0.25), 0 1px 1px rgba(0,0,0,0.15)',
                      }}
                    />
                    <span className="text-[5px] uppercase tracking-wider" style={{ color: 'rgba(0,0,0,0.25)' }}>{label}</span>
                  </div>
                ))}
              </div>

              {/* Center: model badge */}
              <div className="flex items-center gap-3">
                <div
                  className="px-3 py-[2px] rounded-sm text-[8px] tracking-[3px] uppercase font-bold"
                  style={{
                    background: 'linear-gradient(180deg, #b0a590 0%, #a09580 100%)',
                    color: 'rgba(0,0,0,0.3)',
                    textShadow: '0 1px 0 rgba(255,255,255,0.2)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15), 0 1px 2px rgba(0,0,0,0.12)',
                  }}
                >
                  Simulate VM-2000
                </div>
                {/* Power LED */}
                <div
                  className="w-[6px] h-[6px] rounded-full"
                  style={{
                    background: '#00ef8b',
                    boxShadow: '0 0 4px #00ef8b, 0 0 10px rgba(0,239,139,0.6), 0 0 20px rgba(0,239,139,0.2)',
                  }}
                />
              </div>

              {/* Right: round dial knobs */}
              <div className="flex items-center gap-3">
                {['▪ BRIGHT', '▪ CNTRST'].map((label) => (
                  <div key={label} className="flex flex-col items-center gap-1">
                    <div
                      className="w-[20px] h-[20px] rounded-full"
                      style={{
                        background: `radial-gradient(circle at 35% 35%, #908070 0%, #6a6050 50%, #5a5040 100%)`,
                        boxShadow: 'inset 0 2px 3px rgba(255,255,255,0.15), inset 0 -2px 3px rgba(0,0,0,0.25), 0 2px 4px rgba(0,0,0,0.3), 0 0 0 1px rgba(0,0,0,0.15)',
                        border: '1px solid rgba(100,90,70,0.5)',
                      }}
                    >
                      {/* Knob indicator line */}
                      <div className="w-full h-full flex items-start justify-center pt-[3px]">
                        <div className="w-[1px] h-[5px] bg-white/20 rounded-full" />
                      </div>
                    </div>
                    <span className="text-[5px] uppercase tracking-wider" style={{ color: 'rgba(0,0,0,0.25)' }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Chunky stand ── */}
        <div className="flex flex-col items-center -mt-[1px]">
          {/* Neck — thick trapezoidal */}
          <div
            className="w-[70px] h-[35px]"
            style={{
              background: `linear-gradient(180deg, #c0b5a0 0%, #b0a590 50%, #a09580 100%)`,
              clipPath: 'polygon(8% 0%, 92% 0%, 100% 100%, 0% 100%)',
              boxShadow: '4px 0 6px rgba(0,0,0,0.2), -4px 0 6px rgba(0,0,0,0.2)',
            }}
          />
          {/* Base — wide oval */}
          <div
            className="w-[220px] h-[14px] rounded-[7px]"
            style={{
              background: `linear-gradient(180deg, #bbb09c 0%, #b0a590 40%, #a59a86 100%)`,
              boxShadow: '0 4px 12px rgba(0,0,0,0.4), 0 8px 20px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -1px 0 rgba(0,0,0,0.2)',
            }}
          />
        </div>
      </div>

      {/* ── Tagline with typewriter effect ── */}
      <Typewriter phase={phase} onClickPlayground={scrollToPlayground} />
    </section>
  )
}

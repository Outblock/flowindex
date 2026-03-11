import { useEffect, useRef, useState } from 'react'

/* ── Typewriter tagline ── */
const TAGLINE_1 = 'SEE WHAT HAPPENS. '
const TAGLINE_2 = 'BEFORE IT HAPPENS.'
const SUBTITLE = 'REAL MAINNET STATE. SIMULATED EXECUTION. FULL VISIBILITY.'

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
          }, 15)
        }, 300)
      }
    }, 40)

    return () => clearInterval(taglineTimer)
  }, [phase])

  const visibleTagline = fullTagline.slice(0, charIdx)
  const part1 = visibleTagline.slice(0, TAGLINE_1.length)
  const part2 = visibleTagline.slice(TAGLINE_1.length)
  const isTyping = charIdx < totalChars || (subtitleIdx > 0 && subtitleIdx < SUBTITLE.length)
  const showCursor = phase === 'done'
  const visibleSubtitle = SUBTITLE.slice(0, subtitleIdx)

  return (
    <div className={`text-center mt-4 transition-all duration-700 ${phase === 'done' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
      <h1 className="text-3xl sm:text-5xl font-black tracking-[0.02em] text-white font-pixel-circle leading-tight inline-block relative whitespace-pre-wrap">
        {part1}
        {part2 && (
          <span className="text-flow-green" style={{ textShadow: '0 0 20px rgba(0,239,139,0.5)' }}>
            {part2}
          </span>
        )}
        {showCursor && (
          <span className="crt-cursor ml-3 !w-[0.35em] !h-[0.7em] relative -top-[0.08em]" />
        )}
      </h1>
      <p className="mt-3 text-[10px] sm:text-xs text-emerald-500/60 font-mono tracking-[0.2em] h-5 uppercase">
        {visibleSubtitle}
      </p>
      <div className="mt-6 flex flex-col items-center gap-4">
        <button
          onClick={onClickPlayground}
          className={`group relative px-12 py-4 bg-flow-green text-black overflow-hidden transition-all hover:bg-emerald-400 active:scale-95 shadow-[0_0_30px_rgba(0,239,139,0.3)] ${showButton ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
        >
          <div className="relative flex items-center gap-3 text-sm font-black tracking-[4px] uppercase">
            Try it below ↓
          </div>
        </button>
      </div>
    </div>
  )
}

/* ── Cadence syntax highlighting tokens ── */
const CODE_LINES = [
  { tokens: [{ text: '// Transfer FLOW tokens between accounts', cl: 'text-emerald-700/60' }] },
  { tokens: [{ text: 'import', cl: 'text-emerald-500' }, { text: ' FungibleToken ', cl: 'text-emerald-200' }, { text: 'from ', cl: 'text-emerald-500' }, { text: '0xf233dcee88fe0abe', cl: 'text-emerald-400' }] },
  { tokens: [{ text: 'import', cl: 'text-emerald-500' }, { text: ' FlowToken ', cl: 'text-emerald-200' }, { text: 'from ', cl: 'text-emerald-500' }, { text: '0x1654653399040a61', cl: 'text-emerald-400' }] },
  { tokens: [] },
  { tokens: [{ text: 'transaction', cl: 'text-emerald-500' }, { text: '(', cl: 'text-emerald-300' }, { text: 'amount', cl: 'text-emerald-400' }, { text: ': ', cl: 'text-emerald-600' }, { text: 'UFix64', cl: 'text-emerald-300' }, { text: ', ', cl: 'text-emerald-600' }, { text: 'to', cl: 'text-emerald-400' }, { text: ': ', cl: 'text-emerald-600' }, { text: 'Address', cl: 'text-emerald-300' }, { text: ') {', cl: 'text-emerald-300' }] },
  { tokens: [] },
  { tokens: [{ text: '  ', cl: '' }, { text: 'let', cl: 'text-emerald-500' }, { text: ' sentVault', cl: 'text-emerald-200' }, { text: ': ', cl: 'text-emerald-600' }, { text: '@{FungibleToken.Vault}', cl: 'text-emerald-300' }] },
  { tokens: [] },
  { tokens: [{ text: '  ', cl: '' }, { text: 'prepare', cl: 'text-emerald-500' }, { text: '(', cl: 'text-emerald-300' }, { text: 'signer', cl: 'text-emerald-400' }, { text: ': ', cl: 'text-emerald-600' }, { text: 'auth', cl: 'text-emerald-500' }, { text: '(BorrowValue) ', cl: 'text-emerald-600' }, { text: '&Account', cl: 'text-emerald-300' }, { text: ') {', cl: 'text-emerald-300' }] },
  { tokens: [{ text: '    ', cl: '' }, { text: 'let', cl: 'text-emerald-500' }, { text: ' vaultRef', cl: 'text-emerald-200' }, { text: ' = ', cl: 'text-emerald-600' }, { text: 'signer', cl: 'text-emerald-400' }, { text: '.storage.borrow<', cl: 'text-emerald-300' }] },
  { tokens: [{ text: '      auth(FungibleToken.Withdraw)', cl: 'text-emerald-500/80' }] },
  { tokens: [{ text: '      &FlowToken.Vault', cl: 'text-emerald-300' }] },
  { tokens: [{ text: '    >', cl: 'text-emerald-300' }, { text: '(', cl: 'text-emerald-600' }, { text: 'from', cl: 'text-emerald-400' }, { text: ': /storage/flowTokenVault', cl: 'text-emerald-600' }, { text: ')', cl: 'text-emerald-600' }] },
  { tokens: [{ text: '      ?? ', cl: 'text-emerald-600' }, { text: 'panic', cl: 'text-red-500/80' }, { text: '(', cl: 'text-emerald-600' }, { text: '"Could not borrow vault"', cl: 'text-emerald-400' }, { text: ')', cl: 'text-emerald-600' }] },
  { tokens: [] },
  { tokens: [{ text: '    ', cl: '' }, { text: 'self', cl: 'text-emerald-500' }, { text: '.sentVault ', cl: 'text-emerald-200' }, { text: '<- ', cl: 'text-red-500/80' }, { text: 'vaultRef', cl: 'text-emerald-200' }, { text: '.withdraw(', cl: 'text-emerald-300' }] },
  { tokens: [{ text: '      ', cl: '' }, { text: 'amount', cl: 'text-emerald-400' }, { text: ': amount', cl: 'text-emerald-600' }] },
  { tokens: [{ text: '    )', cl: 'text-emerald-600' }] },
  { tokens: [{ text: '  }', cl: 'text-emerald-600' }] },
  { tokens: [] },
  { tokens: [{ text: '  ', cl: '' }, { text: 'execute', cl: 'text-emerald-500' }, { text: ' {', cl: 'text-emerald-600' }] },
  { tokens: [{ text: '    ', cl: '' }, { text: 'let', cl: 'text-emerald-500' }, { text: ' receiver', cl: 'text-emerald-200' }, { text: ' = ', cl: 'text-emerald-600' }, { text: 'getAccount', cl: 'text-emerald-500' }, { text: '(to)', cl: 'text-emerald-300' }] },
  { tokens: [{ text: '      .capabilities.borrow<', cl: 'text-emerald-300' }] },
  { tokens: [{ text: '        &{FungibleToken.Receiver}', cl: 'text-emerald-300' }] },
  { tokens: [{ text: '      >', cl: 'text-emerald-300' }, { text: '(/public/flowTokenReceiver)', cl: 'text-emerald-600' }] },
  { tokens: [{ text: '      ?? ', cl: 'text-emerald-600' }, { text: 'panic', cl: 'text-red-500/80' }, { text: '(', cl: 'text-emerald-600' }, { text: '"Could not borrow receiver"', cl: 'text-emerald-400' }, { text: ')', cl: 'text-emerald-600' }] },
  { tokens: [] },
  { tokens: [{ text: '    receiver.deposit(', cl: 'text-emerald-300' }, { text: 'from', cl: 'text-emerald-400' }, { text: ': ', cl: 'text-emerald-600' }, { text: '<- ', cl: 'text-red-500/80' }, { text: 'self', cl: 'text-emerald-500' }, { text: '.sentVault)', cl: 'text-emerald-200' }] },
  { tokens: [{ text: '  }', cl: 'text-emerald-600' }] },
  { tokens: [{ text: '}', cl: 'text-emerald-600' }] },
]

type Phase = 'idle' | 'boot' | 'typing' | 'ready' | 'running' | 'done'

/* ── Build flat character stream for typewriter ── */
const CHAR_STREAM: { char: string; cl: string; lineIdx: number; isNewline: boolean }[] = []
CODE_LINES.forEach((line, lineIdx) => {
  if (line.tokens.length === 0) {
    CHAR_STREAM.push({ char: '\n', cl: '', lineIdx, isNewline: true })
  } else {
    for (const token of line.tokens) {
      for (const ch of token.text) {
        CHAR_STREAM.push({ char: ch, cl: token.cl, lineIdx, isNewline: false })
      }
    }
    CHAR_STREAM.push({ char: '\n', cl: '', lineIdx, isNewline: true })
  }
})
const TOTAL_CHARS = CHAR_STREAM.length

const BOOT_LOGS = [
  '[ OK ] Initializing core.sys',
  '[ OK ] Loading mainnet.state... 100%',
  '[ OK ] Establishing secure link 0x165...a61',
  '[ OK ] Virtual machine ready',
  '[ OK ] Simulation kernel 1.0.4 loaded',
  '> sh run simulate.sh',
]

function Screw({ className }: { className?: string }) {
  return (
    <div className={`w-3 h-3 rounded-full bg-zinc-800 border border-zinc-700 shadow-inner flex items-center justify-center ${className}`}>
      <div className="w-2 h-[1px] bg-zinc-700 rotate-45" />
    </div>
  )
}

/* ── Physical Monitor Housing ── */
export function Hero() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [bootIdx, setBootIdx] = useState(0)
  const [charIdx, setCharIdx] = useState(0)
  const timerRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const clearTimers = () => {
    timerRef.current.forEach(clearTimeout)
    timerRef.current = []
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }

  const schedule = (fn: () => void, ms: number) => {
    timerRef.current.push(setTimeout(fn, ms))
  }

  useEffect(() => {
    const run = () => {
      clearTimers()
      setPhase('boot')
      
      let bIdx = 0
      const bootInterval = setInterval(() => {
        bIdx++
        setBootIdx(bIdx)
        if (bIdx >= BOOT_LOGS.length) {
          clearInterval(bootInterval)
          setTimeout(() => {
            setPhase('typing')
            startTyping()
          }, 400)
        }
      }, 150)
    }

    const startTyping = () => {
      let idx = 0
      intervalRef.current = setInterval(() => {
        idx += 3
        if (idx >= TOTAL_CHARS) {
          idx = TOTAL_CHARS
          setCharIdx(TOTAL_CHARS)
          if (intervalRef.current) clearInterval(intervalRef.current)
          intervalRef.current = null
          return
        }
        setCharIdx(idx)
      }, 8)

      const typingDuration = Math.ceil(TOTAL_CHARS / 3) * 8
      schedule(() => setPhase('ready'), typingDuration + 300)
      schedule(() => setPhase('running'), typingDuration + 800)
      schedule(() => setPhase('done'), typingDuration + 1600)
    }

    schedule(run, 500)
    return clearTimers
  }, [])

  const scrollToPlayground = () => {
    document.getElementById('playground')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <section className="min-h-screen flex flex-col items-center justify-center px-4 pt-12 pb-8 relative overflow-hidden retro-grid">
      {/* Background ambient lighting */}
      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-transparent via-flow-green/[0.02] to-transparent pointer-events-none z-0" />

      <div className="w-full max-w-5xl mx-auto relative z-10">
        {/* ══════ Physical CRT Monitor Unit ══════ */}
        <div className="relative group perspective-1000">
          
          {/* Main Chassis */}
          <div className="relative z-20 rounded-[2rem] p-3 sm:p-5 bg-[#1a1a1b] border-t-2 border-white/10 border-l border-white/5 shadow-[0_50px_100px_-20px_rgba(0,0,0,0.9),inset_0_2px_10px_rgba(255,255,255,0.05)]">
            
            {/* Top Vents */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 flex gap-2">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="w-6 h-1 bg-black/60 rounded-full shadow-inner" />
              ))}
            </div>

            {/* Screws */}
            <Screw className="absolute top-6 left-6 opacity-40" />
            <Screw className="absolute top-6 right-6 opacity-40" />
            <Screw className="absolute bottom-16 left-6 opacity-40" />
            <Screw className="absolute bottom-16 right-6 opacity-40" />

            {/* The Screen Well */}
            <div className="relative bg-[#080808] rounded-[1rem] sm:rounded-[1.5rem] p-2 sm:p-8 border-2 sm:border-4 border-black shadow-[inset_0_0_40px_rgba(0,0,0,1)]">

              {/* Glass / CRT Layer */}
              <div className="crt-screen crt-scanlines crt-vignette crt-flicker relative bg-[#010a03] h-[360px] sm:h-[520px] flex flex-col border border-emerald-950/40 rounded-[0.8rem] sm:rounded-[1rem]">

                {/* Internal Screen Content */}
                <div className="relative z-[10] p-3 sm:p-8 flex-1 flex flex-col font-mono text-emerald-500 overflow-hidden">

                  {phase === 'boot' ? (
                    <div className="flex flex-col gap-1.5 mt-2 sm:mt-4">
                      {BOOT_LOGS.slice(0, bootIdx).map((log, i) => (
                        <div key={i} className="text-[9px] sm:text-xs tracking-wider crt-boot-line opacity-80">
                          {log}
                        </div>
                      ))}
                      <span className="crt-cursor ml-1" />
                    </div>
                  ) : (
                    <>
                      {/* Header Readout */}
                      <div className="flex items-center justify-between mb-4 sm:mb-6 border-b border-emerald-900/40 pb-2 sm:pb-3 shrink-0">
                        <div className="flex items-center gap-2 sm:gap-4">
                          <div className="flex flex-col">
                            <span className="text-[7px] sm:text-[8px] uppercase tracking-[2px] sm:tracking-[3px] text-emerald-500/40">Sim Unit</span>
                            <span className="text-[8px] sm:text-[10px] text-emerald-400 font-bold tracking-[1px]">ID://F_774</span>
                          </div>
                          <div className="w-px h-4 sm:h-6 bg-emerald-900/30" />
                          <div className="hidden xs:flex flex-col">
                            <span className="text-[7px] sm:text-[8px] uppercase tracking-[2px] sm:tracking-[3px] text-emerald-500/40">Network</span>
                            <span className="text-[8px] sm:text-[10px] text-flow-green animate-pulse tracking-[1px]">MAINNET</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 sm:gap-3">
                          <div className={`px-2 sm:px-4 py-1 sm:py-1.5 text-[8px] sm:text-10px font-bold tracking-[2px] sm:tracking-[3px] uppercase transition-all duration-300 border-2 ${
                            phase === 'ready' ? 'bg-flow-green text-black border-flow-green shadow-[0_0_20px_rgba(0,239,139,0.4)]' : 
                            phase === 'running' ? 'bg-amber-500 text-black border-amber-500' :
                            phase === 'done' ? 'bg-transparent text-flow-green border-flow-green/40' : 'bg-transparent text-emerald-900 border-emerald-900/20'
                          }`}>
                            {phase === 'running' ? 'EXEC' : phase === 'done' ? 'PASSED' : 'READY'}
                          </div>
                        </div>
                      </div>

                      {/* Code Area */}
                      <div className="flex-1 flex min-h-0 gap-4 sm:gap-8 overflow-hidden">
                        <div className="flex-1 overflow-y-auto pr-2 sm:pr-4 scrollbar-hide">
                          <div className="text-[9px] sm:text-[12px] leading-relaxed whitespace-pre font-mono">
                            {(() => {
                              const visible = CHAR_STREAM.slice(0, charIdx)
                              const lines: { char: string; cl: string }[][] = [[]]
                              for (const c of visible) {
                                if (c.isNewline || c.char === '\n') { lines.push([]) }
                                else { lines[lines.length - 1].push(c) }
                              }
                              return lines.map((lineChars, i) => (
                                <div key={i} className="flex group/line">
                                  <span className="text-emerald-900/30 mr-3 sm:mr-6 select-none w-3 sm:w-5 text-right font-bold shrink-0">{String(i + 1).padStart(2, '0')}</span>
                                  <div className="flex-1">
                                    {lineChars.map((c, j) => (
                                      <span key={j} className={`${c.cl} crt-glow brightness-125`}>{c.char}</span>
                                    ))}
                                    {phase === 'typing' && i === lines.length - 1 && charIdx < TOTAL_CHARS && (
                                      <span className="crt-cursor ml-1" />
                                    )}
                                  </div>
                                </div>
                              ))
                            })()}
                          </div>
                        </div>

                        {/* Telemetry Sidebar - Hide on small screens */}
                        <div className={`hidden lg:block w-64 border-l border-emerald-900/30 pl-6 transition-all duration-1000 ${phase === 'done' ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}`}>
                          <div className="space-y-8">
                            <div className="p-3 bg-emerald-950/20 border border-emerald-900/30 rounded">
                              <div className="text-[9px] tracking-[3px] text-emerald-500/60 uppercase mb-3 font-bold">Execution Metrics</div>
                              <div className="space-y-4">
                                <div>
                                  <div className="flex justify-between text-[8px] uppercase mb-1">
                                    <span className="opacity-40">Comp_Load</span>
                                    <span>65%</span>
                                  </div>
                                  <div className="h-1 bg-emerald-950/50 rounded-full overflow-hidden">
                                    <div className="h-full bg-emerald-500 w-[65%] shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                                  </div>
                                </div>
                                <div>
                                  <div className="flex justify-between text-[8px] uppercase mb-1">
                                    <span className="opacity-40">Memory_Leak_Test</span>
                                    <span className="text-flow-green">STABLE</span>
                                  </div>
                                  <div className="h-1 bg-emerald-950/50 rounded-full overflow-hidden">
                                    <div className="h-full bg-emerald-700 w-[20%]" />
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div>
                              <div className="text-[9px] tracking-[3px] text-emerald-500/60 uppercase mb-3 font-bold">State Changes</div>
                              <div className="rounded border-l-2 border-emerald-500/40 p-3 bg-black/40 text-[10px] space-y-2">
                                <div className="flex justify-between items-center">
                                  <span className="opacity-60 text-[8px]">ACCOUNT_A</span>
                                  <span className="text-red-400 font-bold">-10.0 FLOW</span>
                                </div>
                                <div className="flex justify-between items-center">
                                  <span className="opacity-60 text-[8px]">ACCOUNT_B</span>
                                  <span className="text-flow-green font-bold">+10.0 FLOW</span>
                                </div>
                              </div>
                            </div>

                            <div className="pt-6 border-t border-emerald-900/30">
                              <div className="text-[12px] text-flow-green font-bold tracking-[3px]">RESULT://SUCCESS</div>
                              <div className="text-[9px] opacity-40 mt-1 uppercase tracking-widest">Hash: 0xFD...22E</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Control Panel / Branding Strip */}
            <div className="mt-4 sm:mt-8 flex flex-col sm:flex-row items-center sm:items-end justify-between gap-6 sm:gap-0 px-4 sm:px-10 pb-6 sm:pb-4 bg-gradient-to-t from-black/20 to-transparent pt-4 rounded-b-[1.5rem] sm:rounded-b-[2rem]">
              <div className="flex items-center gap-4 sm:gap-8">
                <div className="flex flex-col items-center sm:items-start text-center sm:text-left">
                  <span className="text-lg sm:text-2xl font-black tracking-[4px] sm:tracking-[8px] text-zinc-500 uppercase font-pixel-square leading-none">FlowIndex</span>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="hidden sm:block h-[2px] w-4 bg-zinc-800" />
                    <span className="text-[6px] sm:text-[7px] tracking-[3px] sm:tracking-[5px] text-zinc-600 uppercase font-bold">Strategic Dynamics Simulator</span>
                  </div>
                </div>

                {/* Physical Plate - Clean and Centered */}
                <div className="hidden xs:block px-2 sm:px-4 py-1 sm:py-1.5 bg-zinc-900 border border-zinc-800 rounded-sm shadow-[inset_0_1px_3px_rgba(0,0,0,0.8)]">
                  <span className="text-[6px] sm:text-[8px] font-bold text-zinc-500 tracking-[2px] sm:tracking-[3px] uppercase font-mono">S-774/VX</span>
                </div>
              </div>

              <div className="flex items-center gap-6 sm:gap-10">
                {/* Interface Port - Refined */}
                <div className="hidden sm:flex flex-col items-center gap-2">
                  <div className="w-12 h-7 bg-[#0a0a0a] rounded-sm border-b border-zinc-800 shadow-[inset_0_2px_10px_rgba(0,0,0,1)] flex flex-col justify-around py-1.5 px-2">
                    <div className="w-full h-[1px] bg-zinc-900" />
                    <div className="w-full h-[1px] bg-zinc-900" />
                    <div className="w-full h-[1px] bg-zinc-900" />
                  </div>
                  <span className="text-[7px] tracking-[2px] text-zinc-700 uppercase font-bold">Interface</span>
                </div>

                <div className="flex flex-col items-center sm:items-end gap-2 sm:gap-3">
                  <div className="flex gap-2 sm:gap-2.5">
                    <div className={`w-2 h-2 sm:w-3 sm:h-3 rounded-full transition-all duration-500 ${phase === 'done' ? 'bg-emerald-500 shadow-[0_0_12px_#10b981]' : 'bg-emerald-950/20'}`} />
                    <div className={`w-2 h-2 sm:w-3 sm:h-3 rounded-full transition-all duration-500 ${phase === 'running' ? 'bg-amber-500 shadow-[0_0_12px_#f59e0b]' : 'bg-amber-900/30'}`} />
                    <div className="w-2 h-2 sm:w-3 sm:h-3 rounded-full bg-zinc-900 shadow-inner" />
                  </div>
                  <span className="text-[6px] sm:text-[7px] tracking-[2px] sm:tracking-[3px] text-zinc-700 uppercase font-bold whitespace-nowrap">System Load</span>
                </div>

                {/* Large Power Button - Refined */}
                <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-full bg-[#111] border-b-2 sm:border-b-4 border-black shadow-[0_4px_0_#080808,0_6px_10px_rgba(0,0,0,0.8)] sm:shadow-[0_6px_0_#080808,0_10px_20px_rgba(0,0,0,0.8)] flex items-center justify-center cursor-pointer hover:translate-y-[1px] sm:hover:translate-y-[2px] active:translate-y-[3px] sm:active:translate-y-[4px] transition-all">
                  <div className="w-4 h-4 sm:w-6 sm:h-6 rounded-full bg-red-950 border border-red-900/20 flex items-center justify-center shadow-inner">
                    <div className="w-1.5 h-1.5 sm:w-2.5 sm:h-2.5 rounded-full bg-red-800 shadow-[0_0_5px_rgba(153,27,27,0.8)]" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Heavy Base / Stand */}
          <div className="mx-auto w-[40%] h-6 bg-[#1a1a1b] rounded-b-[2rem] border-x border-b border-black shadow-[0_10px_30px_rgba(0,0,0,0.8)] -mt-1 relative z-10">
            <div className="absolute inset-0 bg-gradient-to-b from-black/40 to-transparent" />
          </div>
          
          {/* Ground Shadow */}
          <div className="mx-auto w-[80%] h-12 bg-black/60 blur-[40px] rounded-full -mt-4 opacity-70" />
        </div>
      </div>

      {/* ── Headline Section ── */}
      <Typewriter phase={phase} onClickPlayground={scrollToPlayground} />
    </section>
  )
}

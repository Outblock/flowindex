export function Navbar() {
  return (
    <nav className="fixed top-0 inset-x-0 z-50 h-12 border-b border-zinc-800/50 bg-black/90 backdrop-blur-sm">
      <div className="mx-auto max-w-6xl h-full flex items-center justify-between px-6">
        <a href="/" className="flex items-center gap-2.5 text-sm font-semibold text-zinc-100">
          <span className="crt-led" />
          <span className="crt-glow text-flow-green">FlowIndex</span>
          <span className="text-zinc-500">Simulate</span>
        </a>
        <div className="flex items-center gap-6 text-xs text-zinc-500">
          <a href="https://docs.flowindex.io" target="_blank" rel="noopener" className="hover:text-flow-green transition-colors">
            Docs
          </a>
          <a href="https://github.com/FlowIndex" target="_blank" rel="noopener" className="hover:text-flow-green transition-colors">
            GitHub
          </a>
          <a
            href="https://run.flowindex.io"
            target="_blank"
            rel="noopener"
            className="px-3 py-1 border border-zinc-700 rounded text-zinc-400 hover:border-flow-green hover:text-flow-green hover:shadow-[0_0_12px_rgba(0,239,139,0.15)] transition-all"
          >
            Open Runner &rarr;
          </a>
        </div>
      </div>
    </nav>
  )
}

export function Footer() {
  const links = [
    { label: 'Explorer', href: 'https://flowindex.io' },
    { label: 'Docs', href: 'https://docs.flowindex.io' },
    { label: 'Runner', href: 'https://run.flowindex.io' },
    { label: 'GitHub', href: 'https://github.com/FlowIndex' },
  ]

  return (
    <footer className="border-t border-zinc-800/50 py-8 px-6">
      <div className="mx-auto max-w-6xl flex items-center justify-between text-xs text-zinc-600">
        <span className="flex items-center gap-2">
          <span className="crt-led" />
          &copy; {new Date().getFullYear()} FlowIndex
        </span>
        <div className="flex gap-6">
          {links.map((l) => (
            <a key={l.label} href={l.href} target="_blank" rel="noopener" className="hover:text-flow-green transition-colors">
              {l.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  )
}

import { BookOpen, Github, SquareTerminal } from 'lucide-react';

function getDocsBaseUrl() {
  if (typeof window !== 'undefined') {
    const runtime = window.__FLOWSCAN_ENV__?.DOCS_URL;
    if (runtime) return runtime;
  }

  return import.meta.env.VITE_DOCS_URL;
}

function stripTrailingSlash(url) {
  return typeof url === 'string' ? url.replace(/\/+$/, '') : url;
}

function Footer() {
  const docsBase = stripTrailingSlash(getDocsBaseUrl());
  const docsHref = docsBase ? `${docsBase}/docs` : null;
  const apiHref = '/api-docs';

  return (
    <footer className="border-t border-white/5 bg-nothing-dark/90">
      <div className="container mx-auto px-4 py-6 flex flex-col md:flex-row items-center justify-between gap-2 text-xs text-zinc-500">
        <div className="flex items-center gap-2 uppercase tracking-widest">
          <span>Built by</span>
          <span className="text-white">Flow Community</span>
        </div>
        <div className="flex items-center gap-5 uppercase tracking-widest">
          {docsHref ? (
            <a
              href={docsHref}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
              aria-label="FlowScan Docs"
            >
              <BookOpen className="h-4 w-4" />
              <span>Docs</span>
            </a>
          ) : null}
          <a
            href={apiHref}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
            aria-label="FlowScan API Reference"
          >
            <SquareTerminal className="h-4 w-4" />
            <span>{docsBase ? 'API' : 'API Spec'}</span>
          </a>
          <a
            href="https://github.com/zenabot27/flowscan-clone"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors"
            aria-label="Open Source on GitHub"
          >
            <Github className="h-4 w-4" />
            <span>Open Source</span>
          </a>
        </div>
      </div>
    </footer>
  );
}

export default Footer;

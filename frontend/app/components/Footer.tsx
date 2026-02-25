import { BookOpen, Github, SquareTerminal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { resolveApiBaseUrl } from '../api';

function getDocsBaseUrl() {
  return import.meta.env.VITE_DOCS_URL;
}

function stripTrailingSlash(url: string | undefined): string | undefined {
  return typeof url === 'string' ? url.replace(/\/+$/, '') : url;
}

const frontendCommit = (typeof import.meta.env.VITE_GIT_COMMIT === 'string' && import.meta.env.VITE_GIT_COMMIT) || '';

function Footer() {
  // IMPORTANT: Keep SSR deterministic. Read runtime overrides after hydration.
  const [docsBase, setDocsBase] = useState(() => stripTrailingSlash(getDocsBaseUrl()));
  const [backendCommit, setBackendCommit] = useState('');

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runtime = (window as any).__FLOWSCAN_ENV__?.DOCS_URL;
    if (typeof runtime === 'string' && runtime.length > 0) {
      const normalized = stripTrailingSlash(runtime);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDocsBase((prev) => (normalized && normalized !== prev ? normalized : prev));
    }

    // Fetch backend commit hash from /status
    resolveApiBaseUrl().then((base) =>
      fetch(`${base}/status`).then((r) => r.json()).then((data) => {
        if (data?.build_commit && data.build_commit !== 'dev') {
          setBackendCommit(data.build_commit);
        }
      }).catch(() => {})
    ).catch(() => {});
  }, []);

  const docsHref = docsBase ? `${docsBase}/docs` : null;
  const apiHref = '/api-docs';

  return (
    <footer className="border-t border-zinc-200 dark:border-white/5 bg-white dark:bg-nothing-dark/90 transition-colors duration-300">
      <div className="container mx-auto px-4 py-6 flex flex-col md:flex-row items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-500">
        <div className="flex items-center gap-2 uppercase tracking-widest">
          <span>Built by</span>
          <span className="text-zinc-900 dark:text-white">Flow Community</span>
          {(frontendCommit || backendCommit) && (
            <span className="text-zinc-400 dark:text-zinc-600 font-mono text-[10px] normal-case tracking-normal">
              {frontendCommit && <span title={`Frontend: ${frontendCommit}`}>fe:{frontendCommit.slice(0, 7)}</span>}
              {frontendCommit && backendCommit && <span className="mx-0.5">/</span>}
              {backendCommit && <span title={`Backend: ${backendCommit}`}>be:{backendCommit.slice(0, 7)}</span>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-5 uppercase tracking-widest">
          {docsHref ? (
            <a
              href={docsHref}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
              aria-label="Flowindex Docs"
            >
              <BookOpen className="h-4 w-4" />
              <span>Docs</span>
            </a>
          ) : null}
          <a
            href={apiHref}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
            aria-label="Flowindex API Reference"
          >
            <SquareTerminal className="h-4 w-4" />
            <span>API</span>
          </a>
          <a
            href="https://github.com/zenabot27/flowscan-clone"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
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

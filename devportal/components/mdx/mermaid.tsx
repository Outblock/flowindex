'use client';

import { useTheme } from 'next-themes';
import { useEffect, useId, useMemo, useState } from 'react';

type MermaidProps = {
  chart: string;
  className?: string;
};

function fnv1aHex(input: string) {
  // Stable, fast, non-crypto hash for DOM ids.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export function Mermaid({ chart, className }: MermaidProps) {
  const { resolvedTheme } = useTheme();
  const reactId = useId();
  const id = useMemo(() => {
    const suffix = reactId.replace(/[^a-zA-Z0-9_-]/g, '');
    return `mmd-${fnv1aHex(chart)}-${suffix}`;
  }, [chart, reactId]);

  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const { default: mermaid } = await import('mermaid');

        mermaid.initialize({
          startOnLoad: false,
          theme: resolvedTheme === 'dark' ? 'dark' : 'default',
        });

        const out = await mermaid.render(id, chart);
        const nextSvg = typeof out === 'string' ? out : out.svg;

        if (!cancelled) {
          setError('');
          setSvg(nextSvg);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!cancelled) {
          setSvg('');
          setError(message);
        }
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [chart, id, resolvedTheme]);

  if (error) {
    return (
      <div className={className}>
        <pre className="overflow-x-auto rounded-md border border-fd-border bg-fd-muted px-3 py-2 text-xs text-fd-muted-foreground">
          Mermaid render error: {error}
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className={className}>
        <div className="rounded-md border border-fd-border bg-fd-card px-3 py-2 text-xs text-fd-muted-foreground">
          Rendering diagram…
        </div>
      </div>
    );
  }

  return <div className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
}


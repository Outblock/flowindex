import { useEffect, useState } from 'react';
import type { Highlighter } from 'shiki';

let highlighterPromise: Promise<Highlighter> | null = null;
let cachedHighlighter: Highlighter | null = null;

const PRELOAD_LANGS = ['cadence', 'javascript', 'typescript', 'json', 'bash', 'python', 'go', 'html', 'css', 'yaml', 'sql', 'markdown', 'swift'];

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(({ createHighlighter }) =>
      createHighlighter({
        themes: ['vitesse-dark'],
        langs: PRELOAD_LANGS,
      })
    ).then((h) => {
      cachedHighlighter = h;
      return h;
    });
  }
  return highlighterPromise;
}

// Start loading immediately on import
getHighlighter();

export function useShikiHighlighter() {
  const [highlighter, setHighlighter] = useState<Highlighter | null>(cachedHighlighter);

  useEffect(() => {
    if (cachedHighlighter) {
      setHighlighter(cachedHighlighter);
      return;
    }
    getHighlighter().then(setHighlighter);
  }, []);

  return highlighter;
}

const KNOWN_LANGS = new Set(PRELOAD_LANGS);

export function highlightCode(highlighter: Highlighter, code: string, lang: string): string {
  const langMap: Record<string, string> = {
    cdc: 'cadence',
    sh: 'bash',
    zsh: 'bash',
    shell: 'bash',
    ts: 'typescript',
    js: 'javascript',
    py: 'python',
    yml: 'yaml',
  };
  const resolved = langMap[lang] || lang || 'text';
  const finalLang = KNOWN_LANGS.has(resolved) ? resolved : 'text';

  return highlighter.codeToHtml(code, {
    lang: finalLang,
    theme: 'vitesse-dark',
  });
}

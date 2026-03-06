import { useEffect, useState } from 'react';
import type { Highlighter } from 'shiki';

let highlighterPromise: Promise<Highlighter> | null = null;
let cachedHighlighter: Highlighter | null = null;

const PRELOAD_LANGS = ['cadence', 'javascript', 'typescript', 'json', 'bash', 'swift', 'go', 'python', 'kotlin'];

/** Custom dark theme matching the Cadence editor color scheme */
const cadenceEditorTheme = {
  name: 'cadence-editor',
  type: 'dark' as const,
  settings: [
    { settings: { foreground: '#D4D4D4', background: '#18181B' } },
    { scope: ['keyword', 'storage.type', 'storage.modifier'], settings: { foreground: '#C792EA', fontStyle: 'bold' } },
    { scope: ['entity.name.type', 'support.type', 'entity.other.inherited-class'], settings: { foreground: '#4EC9B0' } },
    { scope: ['entity.name.function', 'support.function', 'meta.function-call'], settings: { foreground: '#DCDCAA' } },
    { scope: ['variable.parameter', 'variable.other.property'], settings: { foreground: '#9CDCFE' } },
    { scope: ['variable', 'entity.name.variable'], settings: { foreground: '#D4D4D4' } },
    { scope: ['constant.numeric'], settings: { foreground: '#B5CEA8' } },
    { scope: ['string', 'string.quoted'], settings: { foreground: '#CE9178' } },
    { scope: ['constant.character.escape'], settings: { foreground: '#D7BA7D' } },
    { scope: ['comment'], settings: { foreground: '#6A9955', fontStyle: 'italic' } },
    { scope: ['keyword.operator'], settings: { foreground: '#D4D4D4' } },
    { scope: ['punctuation', 'meta.brace', 'meta.delimiter'], settings: { foreground: '#D4D4D4' } },
    { scope: ['punctuation.definition.typeparameters', 'punctuation.bracket'], settings: { foreground: '#FFD700' } },
    { scope: ['entity.name.tag', 'meta.decorator', 'entity.name.function.decorator'], settings: { foreground: '#DCDCAA' } },
    { scope: ['constant.language'], settings: { foreground: '#569CD6' } },
  ],
};

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = Promise.all([
      import('shiki'),
      import('shiki/engine/javascript'),
    ]).then(([{ createHighlighter }, { createJavaScriptRegexEngine }]) =>
      createHighlighter({
        themes: ['vitesse-dark', cadenceEditorTheme],
        langs: PRELOAD_LANGS,
        engine: createJavaScriptRegexEngine({ forgiving: true }),
      })
    ).then((h) => {
      cachedHighlighter = h;
      return h;
    }).catch((err) => {
      console.warn('[shiki] Failed to load highlighter:', err);
      highlighterPromise = null; // allow retry
      throw err;
    });
  }
  return highlighterPromise;
}

export function useShikiHighlighter() {
  const [highlighter, setHighlighter] = useState<Highlighter | null>(cachedHighlighter);

  useEffect(() => {
    if (cachedHighlighter) {
      setHighlighter(cachedHighlighter);
      return;
    }
    getHighlighter().then(setHighlighter).catch(() => {});
  }, []);

  return highlighter;
}

const KNOWN_LANGS = new Set(PRELOAD_LANGS);

export function highlightCode(highlighter: Highlighter, code: string, lang: string, theme: string = 'vitesse-dark'): string {
  const langMap: Record<string, string> = {
    cdc: 'cadence',
    sh: 'bash',
    zsh: 'bash',
    shell: 'bash',
    ts: 'typescript',
    js: 'javascript',
    py: 'python',
    yml: 'yaml',
    kt: 'kotlin',
  };
  const resolved = langMap[lang] || lang || 'text';
  const finalLang = KNOWN_LANGS.has(resolved) ? resolved : 'text';

  return highlighter.codeToHtml(code, {
    lang: finalLang,
    theme,
  });
}

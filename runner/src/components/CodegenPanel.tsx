import { useState, useCallback, useMemo, useRef } from 'react';
import { Play, Loader2, Copy, Check, Download, AlertTriangle } from 'lucide-react';
import { ensureCodegenLoaded, analyzeAndGenerate } from '../codegen/wasmLoader';
import type { CodegenLanguage, CodegenResult } from '../codegen/wasmLoader';
import { useShikiHighlighter, highlightCode } from '../hooks/useShiki';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CodegenPanelProps {
  code: string;
  filename?: string;
}

type GenerationState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; results: Record<CodegenLanguage, CodegenResult>; sourceCode: string }
  | { status: 'error'; message: string };

const LANGUAGES: { key: CodegenLanguage; label: string; ext: string }[] = [
  { key: 'typescript', label: 'TypeScript', ext: '.ts' },
  { key: 'swift', label: 'Swift', ext: '.swift' },
  { key: 'go', label: 'Go', ext: '.go' },
];

const SHIKI_LANG_MAP: Record<CodegenLanguage, string> = {
  typescript: 'typescript',
  swift: 'swift',
  go: 'go',
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded border transition-colors ${
        copied
          ? 'bg-emerald-900/50 text-emerald-400 border-emerald-700'
          : 'bg-zinc-800 text-zinc-500 border-zinc-700 hover:text-zinc-300 hover:border-zinc-600'
      }`}
      title="Copy to clipboard"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function DownloadButton({ text, filename }: { text: string; filename: string }) {
  const handleDownload = useCallback(() => {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [text, filename]);

  return (
    <button
      onClick={handleDownload}
      className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded border transition-colors bg-zinc-800 text-zinc-500 border-zinc-700 hover:text-zinc-300 hover:border-zinc-600"
      title={`Download as ${filename}`}
    >
      <Download className="w-3 h-3" />
      {filename}
    </button>
  );
}

function LanguagePills({
  selected,
  onChange,
}: {
  selected: CodegenLanguage;
  onChange: (lang: CodegenLanguage) => void;
}) {
  return (
    <div className="flex items-center bg-zinc-800 rounded overflow-hidden border border-zinc-700">
      {LANGUAGES.map((lang) => (
        <button
          key={lang.key}
          onClick={() => onChange(lang.key)}
          className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
            selected === lang.key
              ? 'bg-zinc-700 text-zinc-100'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          {lang.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CodegenPanel({ code, filename }: CodegenPanelProps) {
  const [language, setLanguage] = useState<CodegenLanguage>('typescript');
  const [state, setState] = useState<GenerationState>({ status: 'idle' });
  const highlighter = useShikiHighlighter();
  const generatingRef = useRef(false);

  const isStale =
    state.status === 'done' && state.sourceCode !== code;

  const handleGenerate = useCallback(async () => {
    if (generatingRef.current) return;
    generatingRef.current = true;
    setState({ status: 'loading' });

    try {
      await ensureCodegenLoaded();

      // Generate all 3 languages at once so switching is instant
      const results = {} as Record<CodegenLanguage, CodegenResult>;
      for (const lang of LANGUAGES) {
        results[lang.key] = analyzeAndGenerate(code, lang.key, filename);
      }

      setState({ status: 'done', results, sourceCode: code });
    } catch (err: any) {
      setState({ status: 'error', message: err?.message || 'Failed to load codegen WASM' });
    } finally {
      generatingRef.current = false;
    }
  }, [code, filename]);

  // Current result for the selected language
  const currentResult = state.status === 'done' ? state.results[language] : null;
  const hasOutput = currentResult && currentResult.code.length > 0;
  const hasError = currentResult && currentResult.error;

  // Syntax-highlighted HTML
  const highlightedHtml = useMemo(() => {
    if (!highlighter || !currentResult?.code) return null;
    return highlightCode(highlighter, currentResult.code, SHIKI_LANG_MAP[language]);
  }, [highlighter, currentResult?.code, language]);

  // Download filename
  const downloadFilename = useMemo(() => {
    const base = filename?.replace(/\.(cdc|cadence)$/, '') || 'generated';
    const ext = LANGUAGES.find((l) => l.key === language)?.ext || '.ts';
    return `${base}${ext}`;
  }, [filename, language]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800 shrink-0">
        <LanguagePills selected={language} onChange={setLanguage} />

        <button
          onClick={handleGenerate}
          disabled={state.status === 'loading' || !code.trim()}
          className={`flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-medium rounded border transition-colors ${
            state.status === 'loading' || !code.trim()
              ? 'bg-zinc-800 text-zinc-600 border-zinc-700 cursor-not-allowed'
              : 'bg-emerald-900/50 text-emerald-400 border-emerald-700 hover:bg-emerald-900/70 hover:text-emerald-300'
          }`}
        >
          {state.status === 'loading' ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Play className="w-3 h-3" />
          )}
          {state.status === 'loading' ? 'Generating...' : 'Generate'}
        </button>

        <div className="flex-1" />

        {hasOutput && <CopyButton text={currentResult!.code} />}
        {hasOutput && <DownloadButton text={currentResult!.code} filename={downloadFilename} />}
      </div>

      {/* Stale indicator */}
      {isStale && (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-yellow-900/20 border-b border-yellow-800/30 text-yellow-500 text-[10px]">
          <AlertTriangle className="w-3 h-3" />
          Code changed — click Generate to update
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-auto p-3 font-mono text-xs">
        {state.status === 'idle' && (
          <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
            Click Generate to convert your Cadence code
          </div>
        )}

        {state.status === 'loading' && (
          <div className="flex items-center justify-center h-full gap-2 text-zinc-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading codegen...
          </div>
        )}

        {state.status === 'error' && (
          <div className="rounded border border-red-800/50 bg-red-900/20 p-3 text-red-400">
            {state.message}
          </div>
        )}

        {state.status === 'done' && hasError && (
          <div className="rounded border border-red-800/50 bg-red-900/20 p-3 text-red-400">
            {currentResult!.error}
          </div>
        )}

        {state.status === 'done' && hasOutput && (
          <div
            className="shiki-output [&_pre]:!bg-transparent [&_pre]:!p-0 [&_pre]:!m-0 [&_code]:!text-xs leading-relaxed"
            dangerouslySetInnerHTML={{ __html: highlightedHtml || escapeHtml(currentResult!.code) }}
          />
        )}

        {state.status === 'done' && !hasOutput && !hasError && (
          <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
            No output generated. Check that your Cadence code is valid.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

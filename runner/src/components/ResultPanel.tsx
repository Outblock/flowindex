import { useState, useMemo, useCallback } from 'react';
import type { ExecutionResult } from '../flow/execute';
import { Loader2, Code2, List, Copy, Check } from 'lucide-react';
import { JsonView, darkStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';

interface ResultPanelProps {
  results: ExecutionResult[];
  loading: boolean;
}

type Tab = 'result' | 'events' | 'logs';
type ViewMode = 'tree' | 'raw';

function Badge({ children, variant }: { children: React.ReactNode; variant: 'success' | 'error' | 'info' }) {
  const colors = {
    success: 'bg-emerald-900/50 text-emerald-400 border-emerald-700',
    error: 'bg-red-900/50 text-red-400 border-red-700',
    info: 'bg-blue-900/50 text-blue-400 border-blue-700',
  };
  return (
    <span className={`inline-block text-[10px] font-mono px-1.5 py-0.5 rounded border ${colors[variant]}`}>
      {children}
    </span>
  );
}

function resultVariant(type: ExecutionResult['type']): 'success' | 'error' | 'info' {
  if (type === 'error') return 'error';
  if (type === 'script_result' || type === 'tx_sealed') return 'success';
  return 'info';
}

function formatData(data: any): string {
  if (data === null || data === undefined) return 'null';
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

/** Try to parse data into a JSON-viewable object */
function toJsonObject(data: any): object | any[] | null {
  if (data === null || data === undefined) return null;
  if (typeof data === 'object') return data;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      if (typeof parsed === 'object' && parsed !== null) return parsed;
    } catch { /* not JSON */ }
  }
  return null;
}

/** Custom dark theme for the JSON tree viewer matching the editor aesthetic */
const jsonTreeStyles = {
  ...darkStyles,
  container: 'json-tree-container',
  basicChildStyle: 'json-tree-child',
  label: 'json-tree-label',
  nullValue: 'json-tree-null',
  undefinedValue: 'json-tree-null',
  stringValue: 'json-tree-string',
  booleanValue: 'json-tree-boolean',
  numberValue: 'json-tree-number',
  otherValue: 'json-tree-other',
  punctuation: 'json-tree-punctuation',
  expandIcon: 'json-tree-expand',
  collapseIcon: 'json-tree-collapse',
  collapsedContent: 'json-tree-collapsed-content',
  noQuotesForStringValues: false,
};

/** Syntax-highlighted raw JSON */
function RawJsonView({ data, isError }: { data: any; isError?: boolean }) {
  const formatted = useMemo(() => formatData(data), [data]);
  const highlighted = useMemo(() => highlightJson(formatted), [formatted]);

  if (isError) {
    return (
      <pre className="whitespace-pre-wrap break-all text-red-400">{formatted}</pre>
    );
  }

  return (
    <pre
      className="whitespace-pre-wrap break-all leading-relaxed"
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />
  );
}

/** Simple JSON syntax highlighter */
function highlightJson(text: string): string {
  // Escape HTML first
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    // String values (keys and values)
    .replace(
      /("(?:[^"\\]|\\.)*")\s*:/g,
      '<span class="json-hl-key">$1</span>:'
    )
    .replace(
      /:\s*("(?:[^"\\]|\\.)*")/g,
      ': <span class="json-hl-string">$1</span>'
    )
    // Standalone strings (in arrays, top-level)
    .replace(
      /(?<=[\[,\n]\s*)("(?:[^"\\]|\\.)*")(?=\s*[,\]\n])/g,
      '<span class="json-hl-string">$1</span>'
    )
    // Numbers
    .replace(
      /(?<=:\s*)(-?\d+\.?\d*(?:[eE][+-]?\d+)?)(?=\s*[,}\]\n])/g,
      '<span class="json-hl-number">$1</span>'
    )
    // Booleans
    .replace(
      /(?<=:\s*)(true|false)(?=\s*[,}\]\n])/g,
      '<span class="json-hl-boolean">$1</span>'
    )
    // Null
    .replace(
      /(?<=:\s*)(null)(?=\s*[,}\]\n])/g,
      '<span class="json-hl-null">$1</span>'
    );
}

/** Copy-to-clipboard button */
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

/** Toggle button group for switching between tree and raw views */
function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="flex items-center bg-zinc-800 rounded overflow-hidden border border-zinc-700">
      <button
        onClick={() => onChange('tree')}
        className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium transition-colors ${
          mode === 'tree'
            ? 'bg-zinc-700 text-zinc-100'
            : 'text-zinc-500 hover:text-zinc-300'
        }`}
        title="Tree view"
      >
        <List className="w-3 h-3" />
        Tree
      </button>
      <button
        onClick={() => onChange('raw')}
        className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium transition-colors ${
          mode === 'raw'
            ? 'bg-zinc-700 text-zinc-100'
            : 'text-zinc-500 hover:text-zinc-300'
        }`}
        title="Raw JSON"
      >
        <Code2 className="w-3 h-3" />
        Raw
      </button>
    </div>
  );
}

/** Render data with view mode toggle and copy button */
function DataDisplay({ data, isError }: { data: any; isError?: boolean }) {
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const jsonObj = useMemo(() => toJsonObject(data), [data]);
  const hasTreeView = jsonObj !== null && !isError;
  const copyText = useMemo(() => formatData(data), [data]);

  return (
    <div>
      <div className="flex items-center justify-end gap-2 mb-2">
        <CopyButton text={copyText} />
        {hasTreeView && (
          <ViewToggle mode={viewMode} onChange={setViewMode} />
        )}
      </div>

      {hasTreeView && viewMode === 'tree' ? (
        <div className="json-tree-wrapper">
          <JsonView
            data={jsonObj}
            style={jsonTreeStyles}
            shouldExpandNode={(level) => level < 2}
            clickToExpandNode
          />
        </div>
      ) : (
        <RawJsonView data={data} isError={isError} />
      )}
    </div>
  );
}

export default function ResultPanel({ results, loading }: ResultPanelProps) {
  const [tab, setTab] = useState<Tab>('result');

  const lastResult = results.length > 0 ? results[results.length - 1] : null;
  const allEvents = results.flatMap((r) => r.events || []);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'result', label: 'Result' },
    { key: 'events', label: 'Events', count: allEvents.length },
    { key: 'logs', label: 'Logs', count: results.length },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 border-t border-zinc-700 bg-zinc-900">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 pt-1 border-b border-zinc-800 shrink-0">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${
              tab === t.key
                ? 'bg-zinc-800 text-zinc-100 border-b-2 border-emerald-500'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1 text-[10px] text-zinc-500">({t.count})</span>
            )}
          </button>
        ))}
        {loading && (
          <div className="ml-auto flex items-center gap-1.5 text-xs text-zinc-500">
            <Loader2 className="w-3 h-3 animate-spin" />
            Executing...
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3 font-mono text-xs">
        {results.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
            Press Ctrl+Enter or click Run to execute
          </div>
        ) : tab === 'result' ? (
          lastResult && (
            <div>
              <Badge variant={resultVariant(lastResult.type)}>
                {lastResult.type.replace('_', ' ')}
              </Badge>
              {lastResult.txId && (
                <span className="ml-2 text-zinc-500">tx: {lastResult.txId}</span>
              )}
              <div className="mt-2">
                <DataDisplay
                  data={lastResult.data}
                  isError={lastResult.type === 'error'}
                />
              </div>
            </div>
          )
        ) : tab === 'events' ? (
          allEvents.length === 0 ? (
            <div className="text-zinc-600">No events</div>
          ) : (
            <div className="space-y-2">
              {allEvents.map((evt, i) => (
                <div key={i} className="border border-zinc-700 rounded p-2 bg-zinc-800/50">
                  <div className="text-emerald-400 text-[11px] font-semibold mb-1">
                    {evt.type || 'Event'}
                  </div>
                  <DataDisplay data={evt.data || evt} />
                </div>
              ))}
            </div>
          )
        ) : (
          /* logs */
          <div className="space-y-1.5">
            {results.map((r, i) => (
              <div key={i} className="flex items-start gap-2">
                <Badge variant={resultVariant(r.type)}>
                  {r.type.replace('_', ' ')}
                </Badge>
                <span
                  className={`flex-1 break-all ${
                    r.type === 'error' ? 'text-red-400' : 'text-zinc-300'
                  }`}
                >
                  {typeof r.data === 'string' ? r.data : JSON.stringify(r.data)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Inline styles for JSON highlighting */}
      <style>{`
        /* Raw JSON syntax highlighting */
        .json-hl-key { color: #9cdcfe; }
        .json-hl-string { color: #ce9178; }
        .json-hl-number { color: #b5cea8; }
        .json-hl-boolean { color: #569cd6; }
        .json-hl-null { color: #569cd6; font-style: italic; }

        /* JSON tree viewer overrides */
        .json-tree-wrapper {
          font-family: 'GeistMono', 'SF Mono', 'Fira Code', monospace;
          font-size: 12px;
          line-height: 1.6;
        }
        .json-tree-container { background: transparent !important; }
        .json-tree-child { padding-left: 16px; border-left: 1px solid rgba(255,255,255,0.06); }
        .json-tree-label { color: #9cdcfe; }
        .json-tree-string { color: #ce9178; }
        .json-tree-number { color: #b5cea8; }
        .json-tree-boolean { color: #569cd6; }
        .json-tree-null { color: #569cd6; font-style: italic; }
        .json-tree-other { color: #d4d4d4; }
        .json-tree-punctuation { color: #808080; }
        .json-tree-expand,
        .json-tree-collapse { cursor: pointer; color: #808080; user-select: none; display: inline-block; min-width: 14px; text-align: center; margin-right: 4px; font-size: 1.2em; }
        .json-tree-expand::after { content: '\25B8'; }
        .json-tree-collapse::after { content: '\25BE'; }
        .json-tree-expand:hover,
        .json-tree-collapse:hover { color: #d4d4d4; }
        .json-tree-collapsed-content { color: #808080; cursor: pointer; margin-right: 4px; }
        .json-tree-collapsed-content::after { content: '...'; font-size: 0.8em; }
        .json-tree-collapsed-content:hover { color: #d4d4d4; }
      `}</style>
    </div>
  );
}

import { useState } from 'react';
import type { ExecutionResult } from '../flow/execute';
import { Loader2 } from 'lucide-react';

interface ResultPanelProps {
  results: ExecutionResult[];
  loading: boolean;
}

type Tab = 'result' | 'events' | 'logs';

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
    <div className="flex flex-col h-64 border-t border-zinc-700 bg-zinc-900">
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
              <pre
                className={`mt-2 whitespace-pre-wrap break-all ${
                  lastResult.type === 'error' ? 'text-red-400' : 'text-emerald-400'
                }`}
              >
                {formatData(lastResult.data)}
              </pre>
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
                  <pre className="text-zinc-300 whitespace-pre-wrap break-all">
                    {formatData(evt.data || evt)}
                  </pre>
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
    </div>
  );
}

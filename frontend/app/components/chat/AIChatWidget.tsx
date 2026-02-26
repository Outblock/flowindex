import { useState, useRef, useEffect, useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import { MessageSquare, X, Send, Trash2, Loader2, Sparkles, Database, Copy, Check, Download, Search, Bot, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

SyntaxHighlighter.registerLanguage('sql', sql);
SyntaxHighlighter.registerLanguage('swift', swift);
SyntaxHighlighter.registerLanguage('cadence', swift);

const AI_CHAT_URL = import.meta.env.VITE_AI_CHAT_URL || 'https://ai.flowindex.io';

/* ── SQL Result Table (compact, inline) ── */

interface SqlResult {
  columns: string[];
  rows: Record<string, unknown>[];
}

function SqlResultTable({ result }: { result: SqlResult }) {
  const [search, setSearch] = useState('');
  const filtered = search
    ? result.rows.filter((row) =>
        Object.values(row).some((v) =>
          String(v).toLowerCase().includes(search.toLowerCase())
        )
      )
    : result.rows;

  const exportCsv = () => {
    const header = result.columns.join(',');
    const rows = filtered.map((row) =>
      result.columns
        .map((col) => {
          const val = String(row[col] ?? '');
          return val.includes(',') || val.includes('"')
            ? `"${val.replace(/"/g, '""')}"`
            : val;
        })
        .join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'query-results.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-sm border border-zinc-200 dark:border-white/10 overflow-hidden my-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-zinc-50 dark:bg-white/[0.02] border-b border-zinc-200 dark:border-white/10">
        <span className="text-[10px] text-zinc-400 font-mono tabular-nums">
          {filtered.length} row{filtered.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-400" />
            <input
              type="text"
              placeholder="Filter..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-24 focus:w-32 pl-6 pr-2 py-1 text-[10px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-sm text-zinc-700 dark:text-zinc-300 placeholder-zinc-400 focus:outline-none focus:border-nothing-green/40 transition-all"
            />
          </div>
          <button
            onClick={exportCsv}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-sm hover:border-zinc-400 dark:hover:border-white/20 transition-colors"
          >
            <Download size={10} />
            CSV
          </button>
        </div>
      </div>
      {/* Table */}
      <div className="overflow-x-auto max-h-[240px] overflow-y-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr>
              {result.columns.map((col) => (
                <th
                  key={col}
                  className="px-3 py-2 text-[10px] font-bold text-zinc-400 uppercase tracking-wider border-b border-zinc-200 dark:border-white/10 whitespace-nowrap sticky top-0 bg-zinc-50 dark:bg-zinc-900 z-10"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => (
              <tr
                key={i}
                className="border-b border-zinc-100 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors"
              >
                {result.columns.map((col) => (
                  <td
                    key={col}
                    className="px-3 py-1.5 text-[11px] text-zinc-600 dark:text-zinc-400 whitespace-nowrap max-w-[200px] truncate font-mono"
                    title={String(row[col] ?? '')}
                  >
                    {formatCellValue(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && (
        <div className="py-4 text-center text-[11px] text-zinc-400">No matching rows</div>
      )}
    </div>
  );
}

function formatCellValue(val: unknown): React.ReactNode {
  if (val === null || val === undefined)
    return <span className="text-zinc-300 dark:text-zinc-600 italic">null</span>;
  if (typeof val === 'number') return val.toLocaleString();
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'string' && val.startsWith('0x'))
    return <span className="text-nothing-green/70">{val}</span>;
  return String(val);
}

/* ── Code Block with syntax highlighting and copy ── */

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const supportedLangs = ['sql', 'swift', 'cadence'];
  const useSyntax = supportedLangs.includes(language);

  return (
    <div className="relative rounded-sm border border-zinc-200 dark:border-white/10 overflow-hidden my-2">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-100 dark:bg-white/[0.03] border-b border-zinc-200 dark:border-white/10">
        <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-bold">{language}</span>
        <button
          onClick={handleCopy}
          className="text-zinc-400 hover:text-zinc-700 dark:hover:text-white transition-colors"
        >
          {copied ? <Check size={12} className="text-nothing-green" /> : <Copy size={12} />}
        </button>
      </div>
      {useSyntax ? (
        <SyntaxHighlighter
          language={language === 'cadence' ? 'swift' : language}
          style={vscDarkPlus}
          customStyle={{ margin: 0, padding: '12px', fontSize: '11px', lineHeight: '1.6', background: '#18181b', borderRadius: 0 }}
          wrapLongLines
        >
          {code}
        </SyntaxHighlighter>
      ) : (
        <pre className="p-3 text-[11px] leading-relaxed bg-zinc-900 text-zinc-300 overflow-x-auto font-mono whitespace-pre-wrap break-words">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

/* ── Collapsible Code Block for tool outputs ── */

function CollapsibleCode({ code, language, label, icon }: { code: string; language: string; label: string; icon: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const supportedLangs = ['sql', 'swift', 'cadence'];
  const useSyntax = supportedLangs.includes(language);

  return (
    <div className="rounded-sm border border-zinc-200 dark:border-white/10 overflow-hidden my-1.5">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-white/[0.02] hover:bg-zinc-100 dark:hover:bg-white/[0.04] transition-colors text-left"
      >
        <motion.div
          animate={{ rotate: isOpen ? 90 : 0 }}
          transition={{ duration: 0.15 }}
        >
          <ChevronRight size={12} className="text-zinc-400" />
        </motion.div>
        {icon}
        <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-bold flex-1">{label}</span>
        <button
          onClick={handleCopy}
          className="text-zinc-400 hover:text-zinc-700 dark:hover:text-white transition-colors p-0.5"
        >
          {copied ? <Check size={10} className="text-nothing-green" /> : <Copy size={10} />}
        </button>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            {useSyntax ? (
              <SyntaxHighlighter
                language={language === 'cadence' ? 'swift' : language}
                style={vscDarkPlus}
                customStyle={{ margin: 0, padding: '12px', fontSize: '11px', lineHeight: '1.6', background: '#18181b', borderRadius: 0 }}
                wrapLongLines
              >
                {code}
              </SyntaxHighlighter>
            ) : (
              <pre className="p-3 text-[11px] leading-relaxed bg-zinc-900 text-zinc-300 overflow-x-auto font-mono whitespace-pre-wrap break-words">
                <code>{code}</code>
              </pre>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Markdown Renderer ── */

const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="text-base font-bold text-zinc-900 dark:text-white mt-3 mb-1">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-bold text-zinc-900 dark:text-white mt-3 mb-1">{children}</h2>,
  h3: ({ children }) => <h3 className="text-[12px] font-bold text-zinc-900 dark:text-white mt-2 mb-1">{children}</h3>,
  h4: ({ children }) => <h4 className="text-[12px] font-semibold text-zinc-800 dark:text-zinc-100 mt-2 mb-0.5">{children}</h4>,
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-bold text-zinc-900 dark:text-white">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-nothing-green hover:underline">
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="ml-3 mb-2 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="ml-3 mb-2 space-y-0.5 list-decimal list-inside">{children}</ol>,
  li: ({ children }) => (
    <li className="flex gap-1.5">
      <span className="text-nothing-green shrink-0 mt-[1px]">-</span>
      <span className="flex-1">{children}</span>
    </li>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-nothing-green/40 pl-3 my-2 text-zinc-500 dark:text-zinc-400 italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-zinc-200 dark:border-white/10" />,
  table: ({ children }) => (
    <div className="overflow-x-auto my-2 rounded-sm border border-zinc-200 dark:border-white/10">
      <table className="w-full text-left border-collapse text-[11px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-zinc-50 dark:bg-white/[0.03]">{children}</thead>,
  th: ({ children }) => (
    <th className="px-3 py-1.5 text-[10px] font-bold text-zinc-400 uppercase tracking-wider border-b border-zinc-200 dark:border-white/10 whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-1.5 text-zinc-600 dark:text-zinc-400 border-b border-zinc-100 dark:border-white/5 font-mono">
      {children}
    </td>
  ),
  code: ({ className, children }) => {
    const match = /language-(\w+)/.exec(className || '');
    const lang = match ? match[1] : '';
    const codeString = String(children).replace(/\n$/, '');

    if (lang || codeString.includes('\n')) {
      return <CodeBlock code={codeString} language={lang || 'text'} />;
    }

    return (
      <code className="text-[10px] bg-zinc-100 dark:bg-white/10 px-1 py-0.5 rounded font-mono text-purple-600 dark:text-purple-400">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <>{children}</>,
};

function MarkdownContent({ text }: { text: string }) {
  if (!text) return null;
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {text}
    </ReactMarkdown>
  );
}

/* ── Tool Part Renderers ── */

function SqlToolPart({ part }: { part: any }) {
  const toolName = part.toolName ?? part.type?.split('-').slice(1).join('-') ?? '';
  if (toolName !== 'runSQL' && toolName !== 'run_sql' && toolName !== 'run_flowindex_sql' && toolName !== 'run_evm_sql') return null;

  const isDone = part.state === 'output-available' || part.state === 'result';
  const isError = part.state === 'output-error';
  const result = isDone ? part.output : null;
  const hasError = isError || result?.error;
  const hasData = result?.rows && result?.columns;
  const sqlCode: string | undefined = part.input?.sql ?? part.args?.sql;
  const isEvm = toolName === 'run_evm_sql';

  return (
    <div className="space-y-1">
      {sqlCode && (
        <CollapsibleCode
          code={sqlCode}
          language="sql"
          label={isEvm ? 'EVM SQL Query' : 'SQL Query'}
          icon={
            <>
              <Database size={11} className="text-nothing-green" />
              {!isDone && !isError && <Loader2 size={10} className="animate-spin text-zinc-400" />}
            </>
          }
        />
      )}
      {!sqlCode && !isDone && !isError && (
        <div className="flex items-center gap-2 py-1">
          <Database size={12} className="text-nothing-green" />
          <Loader2 size={12} className="animate-spin text-zinc-400" />
        </div>
      )}
      {hasError && (
        <div className="px-3 py-2 text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-sm">
          {isError ? (part.errorText || 'Query failed') : result?.error}
        </div>
      )}
      {hasData && <SqlResultTable result={result} />}
    </div>
  );
}

function CadenceToolPart({ part }: { part: any }) {
  const isDone = part.state === 'output-available' || part.state === 'result';
  const isError = part.state === 'output-error';
  const result = isDone ? part.output : null;
  const hasError = isError || result?.error;
  const script: string | undefined = part.input?.script ?? part.args?.script;

  return (
    <div className="space-y-1">
      {script && (
        <CollapsibleCode
          code={script}
          language="cadence"
          label="Cadence Script"
          icon={
            <>
              <Sparkles size={11} className="text-purple-400" />
              {!isDone && !isError && <Loader2 size={10} className="animate-spin text-zinc-400" />}
            </>
          }
        />
      )}
      {!script && !isDone && !isError && (
        <div className="flex items-center gap-2 py-1">
          <Sparkles size={12} className="text-purple-400" />
          <Loader2 size={12} className="animate-spin text-zinc-400" />
        </div>
      )}
      {hasError && (
        <div className="px-3 py-2 text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-sm">
          {isError ? (part.errorText || 'Script failed') : result?.error}
        </div>
      )}
      {isDone && !hasError && result?.result && (
        <div className="px-3 py-2 text-[11px] text-zinc-300 bg-zinc-900 border border-white/10 rounded-sm font-mono whitespace-pre-wrap">
          {typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2)}
        </div>
      )}
    </div>
  );
}

/* ── Chart Renderer ── */

const CHART_COLORS = [
  '#00ef8b', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899',
  '#10b981', '#6366f1', '#f97316', '#14b8a6',
];

function ChartToolPart({ part }: { part: any }) {
  const isDone = part.state === 'output-available' || part.state === 'result';
  const isError = part.state === 'output-error';
  const result = isDone ? part.output : null;

  if (!isDone && !isError) {
    return (
      <div className="flex items-center gap-2 py-2 text-[10px] text-zinc-400">
        <Loader2 size={12} className="animate-spin" />
        <span className="uppercase tracking-widest font-bold">Creating chart...</span>
      </div>
    );
  }

  if (isError || !result) {
    return (
      <div className="px-3 py-2 text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-sm">
        {isError ? (part.errorText || 'Chart creation failed') : 'No chart data'}
      </div>
    );
  }

  const { chartType, title, labels, datasets } = result;

  // Transform data into recharts format
  const chartData = labels?.map((label: string, i: number) => {
    const point: Record<string, unknown> = { name: label };
    datasets?.forEach((ds: { label: string; data: number[] }) => {
      point[ds.label] = ds.data[i];
    });
    return point;
  }) ?? [];

  return (
    <div className="my-2 rounded-sm border border-zinc-200 dark:border-white/10 overflow-hidden">
      {title && (
        <div className="px-3 py-2 bg-zinc-50 dark:bg-white/[0.02] border-b border-zinc-200 dark:border-white/10">
          <span className="text-[11px] font-bold text-zinc-700 dark:text-zinc-200">{title}</span>
        </div>
      )}
      <div className="p-3 bg-white dark:bg-zinc-950" style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'pie' || chartType === 'doughnut' ? (
            <PieChart>
              <Pie
                data={chartData.map((d: any, i: number) => ({ name: d.name, value: d[datasets?.[0]?.label] ?? 0, fill: CHART_COLORS[i % CHART_COLORS.length] }))}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={chartType === 'doughnut' ? 50 : 0}
                outerRadius={80}
                strokeWidth={1}
                stroke="transparent"
              >
                {chartData.map((_: any, i: number) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ fontSize: 11, background: '#18181b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 2 }}
                itemStyle={{ color: '#a1a1aa' }}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </PieChart>
          ) : chartType === 'line' ? (
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#71717a' }} />
              <YAxis tick={{ fontSize: 10, fill: '#71717a' }} />
              <Tooltip
                contentStyle={{ fontSize: 11, background: '#18181b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 2 }}
                itemStyle={{ color: '#a1a1aa' }}
              />
              {datasets?.map((ds: { label: string }, i: number) => (
                <Line key={ds.label} type="monotone" dataKey={ds.label} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={false} />
              ))}
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </LineChart>
          ) : (
            <BarChart data={chartData} layout={chartType === 'horizontalBar' ? 'vertical' : 'horizontal'}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              {chartType === 'horizontalBar' ? (
                <>
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#71717a' }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#71717a' }} width={80} />
                </>
              ) : (
                <>
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#71717a' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#71717a' }} />
                </>
              )}
              <Tooltip
                contentStyle={{ fontSize: 11, background: '#18181b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 2 }}
                itemStyle={{ color: '#a1a1aa' }}
              />
              {datasets?.map((ds: { label: string }, i: number) => (
                <Bar key={ds.label} dataKey={ds.label} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[2, 2, 0, 0]} />
              ))}
              <Legend wrapperStyle={{ fontSize: 10 }} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ── Chat Message ── */

function ChatMessage({ message }: { message: UIMessage }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[85%] bg-nothing-green/10 border border-nothing-green/20 rounded-sm px-3 py-2">
          <p className="text-[12px] text-zinc-700 dark:text-zinc-200 leading-relaxed">
            {message.parts
              .filter((p) => p.type === 'text')
              .map((p) => (p as any).text)
              .join('')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <div className="flex items-start gap-2">
        <div className="shrink-0 mt-0.5 w-5 h-5 rounded-sm bg-nothing-green/10 border border-nothing-green/20 flex items-center justify-center">
          <Bot size={11} className="text-nothing-green" />
        </div>
        <div className="flex-1 min-w-0">
          {message.parts.map((part, i) => {
            if (part.type === 'text') {
              if (!(part as any).text?.trim()) return null;
              return (
                <div key={i} className="text-[12px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
                  <MarkdownContent text={(part as any).text} />
                </div>
              );
            }

            if (part.type === 'tool-invocation' || (part.type as string) === 'dynamic-tool' || (part.type as string).startsWith('tool-')) {
              const toolPart = part as any;
              const name = toolPart.toolName ?? toolPart.type?.split('-').slice(1).join('-') ?? '';
              if (name === 'run_cadence') return <CadenceToolPart key={i} part={toolPart} />;
              if (name === 'run_sql' || name === 'runSQL' || name === 'run_flowindex_sql' || name === 'run_evm_sql') return <SqlToolPart key={i} part={toolPart} />;
              if (name === 'createChart') return <ChartToolPart key={i} part={toolPart} />;
              // Generic tool fallback
              const toolDone = toolPart.state === 'output-available' || toolPart.state === 'result';
              const toolErr = toolPart.state === 'output-error';
              return (
                <div key={i} className="flex items-center gap-2 py-1 text-[10px] text-zinc-400">
                  {!toolDone && !toolErr ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : toolErr ? (
                    <X size={10} className="text-red-400" />
                  ) : (
                    <Check size={10} className="text-nothing-green" />
                  )}
                  <span className="uppercase tracking-widest">{name}</span>
                </div>
              );
            }

            return null;
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Suggestions ── */

const SUGGESTIONS = [
  'What is the latest block number?',
  'Show me daily transaction counts',
  'How many active accounts today?',
  'Top tokens by transfer volume',
  'What is the current FLOW price?',
  'Show the error rate trend',
];

/* ── Main Widget ── */

const MIN_WIDTH = 360;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 420;

export default function AIChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const isDragging = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Drag-to-resize handler
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent | TouchEvent) => {
      if (!isDragging.current) return;
      const clientX = 'touches' in ev ? ev.touches[0].clientX : ev.clientX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth - clientX));
      setPanelWidth(newWidth);
    };

    const onUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove);
    window.addEventListener('touchend', onUp);
  }, []);

  const { messages, sendMessage, status, stop, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: `${AI_CHAT_URL}/api/chat`,
      credentials: 'omit',
    }),
  });

  const isStreaming = status === 'streaming' || status === 'submitted';

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const handleSend = useCallback((text: string) => {
    if (!text.trim() || isStreaming) return;
    sendMessage({ text });
    setInput('');
  }, [sendMessage, isStreaming]);

  const handleClear = () => {
    setMessages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(input);
    }
  };

  // Don't render during SSR
  if (import.meta.env.SSR) return null;

  return (
    <>
      {/* FAB Button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-6 right-6 z-[70] w-12 h-12 bg-nothing-green text-black rounded-sm shadow-lg shadow-nothing-green/20 hover:shadow-nothing-green/40 hover:scale-105 transition-all flex items-center justify-center"
            aria-label="Open AI Chat"
          >
            <MessageSquare size={20} />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat Panel */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop (mobile) */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[70]"
            />

            {/* Panel */}
            <motion.div
              initial={{ x: '100%', opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '100%', opacity: 0 }}
              transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
              style={{ width: typeof window !== 'undefined' && window.innerWidth >= 768 ? panelWidth : undefined }}
              className="fixed top-0 right-0 h-full z-[71] w-full md:w-auto bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-white/10 flex flex-col shadow-2xl"
            >
              {/* Resize handle */}
              <div
                onMouseDown={handleDragStart}
                onTouchStart={handleDragStart}
                className="hidden md:flex absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize items-center justify-center group hover:bg-nothing-green/10 active:bg-nothing-green/20 transition-colors z-10"
                title="Drag to resize"
              >
                <div className="w-0.5 h-8 rounded-full bg-zinc-300 dark:bg-zinc-600 group-hover:bg-nothing-green group-active:bg-nothing-green transition-colors" />
              </div>
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-white/10 shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-sm bg-nothing-green/10 border border-nothing-green/20 flex items-center justify-center">
                    <Sparkles size={13} className="text-nothing-green" />
                  </div>
                  <div>
                    <h3 className="text-[11px] font-bold text-zinc-900 dark:text-white uppercase tracking-widest">
                      Flow AI
                    </h3>
                    <p className="text-[9px] text-zinc-400 uppercase tracking-widest">
                      Ask anything about Flow
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {messages.length > 0 && (
                    <button
                      onClick={handleClear}
                      className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 rounded-sm transition-colors"
                      title="Clear chat"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => setIsOpen(false)}
                    className="p-1.5 text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5 rounded-sm transition-colors"
                    title="Close"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-4 custom-scrollbar">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full">
                    <div className="relative mb-6">
                      <div className="absolute inset-0 blur-2xl opacity-20 bg-nothing-green rounded-full scale-150" />
                      <div className="relative w-12 h-12 rounded-sm bg-nothing-green/10 border border-nothing-green/20 flex items-center justify-center">
                        <Sparkles size={24} className="text-nothing-green" />
                      </div>
                    </div>
                    <h2 className="text-sm font-bold text-zinc-900 dark:text-white mb-1">Ask Flow AI</h2>
                    <p className="text-[11px] text-zinc-400 mb-6 text-center max-w-[260px]">
                      Query the Flow blockchain with natural language - SQL and Cadence
                    </p>
                    <div className="grid grid-cols-2 gap-2 w-full max-w-[320px]">
                      {SUGGESTIONS.map((s) => (
                        <button
                          key={s}
                          onClick={() => handleSend(s)}
                          className="text-left px-3 py-2.5 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-white/10 rounded-sm hover:border-nothing-green/30 hover:text-zinc-900 dark:hover:text-white hover:bg-nothing-green/5 transition-all"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    {messages.map((msg) => (
                      <ChatMessage key={msg.id} message={msg} />
                    ))}
                    {isStreaming && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
                      <div className="flex items-center gap-2 mb-4">
                        <div className="w-5 h-5 rounded-sm bg-nothing-green/10 border border-nothing-green/20 flex items-center justify-center">
                          <Bot size={11} className="text-nothing-green" />
                        </div>
                        <Loader2 size={14} className="animate-spin text-zinc-400" />
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>

              {/* Input */}
              <div className="shrink-0 border-t border-zinc-200 dark:border-white/10 px-4 py-3">
                <div className="relative flex items-end">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask a question..."
                    rows={1}
                    className="w-full resize-none text-[12px] bg-zinc-50 dark:bg-white/[0.03] border border-zinc-200 dark:border-white/10 rounded-sm pl-3 pr-11 py-2.5 text-zinc-700 dark:text-zinc-200 placeholder-zinc-400 focus:outline-none focus:border-nothing-green/40 transition-colors"
                    style={{ maxHeight: '80px' }}
                  />
                  {isStreaming ? (
                    <button
                      type="button"
                      onClick={() => stop()}
                      className="absolute right-1.5 bottom-1.5 w-7 h-7 flex items-center justify-center bg-zinc-200 dark:bg-white/10 text-zinc-600 dark:text-zinc-400 rounded-sm hover:bg-zinc-300 dark:hover:bg-white/20 transition-colors"
                      title="Stop"
                    >
                      <X size={14} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSend(input)}
                      disabled={!input.trim()}
                      className="absolute right-1.5 bottom-1.5 w-7 h-7 flex items-center justify-center bg-nothing-green text-black rounded-sm hover:bg-nothing-green/80 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                      title="Send"
                    >
                      <Send size={13} />
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

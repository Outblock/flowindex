import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import { MessageSquare, X, Send, Trash2, Loader2, Sparkles, Database, Copy, Check, Download, Search, Bot, ChevronRight, Paperclip, ImageIcon, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
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
        <span className="text-[11px] text-zinc-400 font-mono tabular-nums">
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
              className="w-24 focus:w-32 pl-6 pr-2 py-1 text-[11px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-sm text-zinc-700 dark:text-zinc-300 placeholder-zinc-400 focus:outline-none focus:border-nothing-green/40 transition-all"
            />
          </div>
          <button
            onClick={exportCsv}
            className="flex items-center gap-1 px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-sm hover:border-zinc-400 dark:hover:border-white/20 transition-colors"
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
                  className="px-3 py-2 text-[11px] font-bold text-zinc-400 uppercase tracking-wider border-b border-zinc-200 dark:border-white/10 whitespace-nowrap sticky top-0 bg-zinc-50 dark:bg-zinc-900 z-10"
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
                    className="px-3 py-1.5 text-[12px] text-zinc-600 dark:text-zinc-400 whitespace-nowrap max-w-[200px] truncate font-mono"
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
        <div className="py-4 text-center text-[12px] text-zinc-400">No matching rows</div>
      )}
    </div>
  );
}

/* ── Auto-linking helpers ── */

function classifyHex(val: string): { type: 'cadence-addr' | 'evm-addr' | 'cadence-tx' | 'evm-tx' | 'hex'; url: string | null } {
  const hex = val.toLowerCase();
  // Cadence address: 0x + 16 hex chars
  if (/^0x[0-9a-f]{16}$/.test(hex))
    return { type: 'cadence-addr', url: `https://flowindex.io/accounts/${val}` };
  // EVM address: 0x + 40 hex chars
  if (/^0x[0-9a-f]{40}$/.test(hex))
    return { type: 'evm-addr', url: `https://evm.flowindex.io/address/${val}` };
  // Tx hash: 0x + 64 hex chars — could be Cadence or EVM
  if (/^0x[0-9a-f]{64}$/.test(hex))
    return { type: 'cadence-tx', url: `https://flowindex.io/txs/${val}` };
  return { type: 'hex', url: null };
}

function LinkedHex({ val }: { val: string }) {
  const { url } = classifyHex(val);
  if (!url) return <span className="text-nothing-green/70">{val}</span>;
  const short = val.length > 20 ? `${val.slice(0, 10)}...${val.slice(-8)}` : val;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-nothing-green/90 hover:text-nothing-green hover:underline" title={val}>
      {short}
    </a>
  );
}

function formatCellValue(val: unknown): React.ReactNode {
  if (val === null || val === undefined)
    return <span className="text-zinc-300 dark:text-zinc-600 italic">null</span>;
  if (typeof val === 'number') return val.toLocaleString();
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'string' && val.startsWith('0x'))
    return <LinkedHex val={val} />;
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
        <span className="text-[11px] text-zinc-400 uppercase tracking-widest font-bold">{language}</span>
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
          customStyle={{ margin: 0, padding: '12px', fontSize: '12px', lineHeight: '1.6', background: '#18181b', borderRadius: 0 }}
          wrapLongLines
        >
          {code}
        </SyntaxHighlighter>
      ) : (
        <pre className="p-3 text-[12px] leading-relaxed bg-zinc-900 text-zinc-300 overflow-x-auto font-mono whitespace-pre-wrap break-words">
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
        <span className="text-[11px] text-zinc-400 uppercase tracking-widest font-bold flex-1">{label}</span>
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
                customStyle={{ margin: 0, padding: '12px', fontSize: '12px', lineHeight: '1.6', background: '#18181b', borderRadius: 0 }}
                wrapLongLines
              >
                {code}
              </SyntaxHighlighter>
            ) : (
              <pre className="p-3 text-[12px] leading-relaxed bg-zinc-900 text-zinc-300 overflow-x-auto font-mono whitespace-pre-wrap break-words">
                <code>{code}</code>
              </pre>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Auto-link hex values in text ── */

const HEX_RE = /\b(0x[0-9a-fA-F]{16,64})\b/g;

function AutoLinkText({ children }: { children: React.ReactNode }): React.ReactNode {
  return processChildren(children);
}

function processChildren(children: React.ReactNode): React.ReactNode {
  if (typeof children === 'string') return linkifyHex(children);
  if (Array.isArray(children)) return children.map((c, i) => <span key={i}>{processChildren(c)}</span>);
  return children;
}

function linkifyHex(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  HEX_RE.lastIndex = 0;
  while ((m = HEX_RE.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
    parts.push(<LinkedHex key={m.index} val={m[1]} />);
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

/* ── Markdown Renderer ── */

const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="text-base font-bold text-zinc-900 dark:text-white mt-3 mb-1">{children}</h1>,
  h2: ({ children }) => <h2 className="text-sm font-bold text-zinc-900 dark:text-white mt-3 mb-1">{children}</h2>,
  h3: ({ children }) => <h3 className="text-[13px] font-bold text-zinc-900 dark:text-white mt-2 mb-1">{children}</h3>,
  h4: ({ children }) => <h4 className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-100 mt-2 mb-0.5">{children}</h4>,
  p: ({ children }) => <p className="mb-2 last:mb-0"><AutoLinkText>{children}</AutoLinkText></p>,
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
      <span className="flex-1"><AutoLinkText>{children}</AutoLinkText></span>
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
      <table className="w-full text-left border-collapse text-[12px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-zinc-50 dark:bg-white/[0.03]">{children}</thead>,
  th: ({ children }) => (
    <th className="px-3 py-1.5 text-[11px] font-bold text-zinc-400 uppercase tracking-wider border-b border-zinc-200 dark:border-white/10 whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-1.5 text-zinc-600 dark:text-zinc-400 border-b border-zinc-100 dark:border-white/5 font-mono">
      <AutoLinkText>{children}</AutoLinkText>
    </td>
  ),
  code: ({ className, children }) => {
    const match = /language-(\w+)/.exec(className || '');
    const lang = match ? match[1] : '';
    const codeString = String(children).replace(/\n$/, '');

    if (lang || codeString.includes('\n')) {
      return <CodeBlock code={codeString} language={lang || 'text'} />;
    }

    // Auto-link hex values in inline code
    if (/^0x[0-9a-fA-F]{16,64}$/.test(codeString)) {
      const { url } = classifyHex(codeString);
      if (url) {
        const short = codeString.length > 20 ? `${codeString.slice(0, 10)}...${codeString.slice(-8)}` : codeString;
        return (
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="text-[11px] bg-nothing-green/10 px-1 py-0.5 rounded font-mono text-nothing-green hover:underline"
            title={codeString}
          >
            {short}
          </a>
        );
      }
    }

    return (
      <code className="text-[11px] bg-zinc-100 dark:bg-white/10 px-1 py-0.5 rounded font-mono text-purple-600 dark:text-purple-400">
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
        <div className="px-3 py-2 text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-sm">
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
        <div className="px-3 py-2 text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-sm">
          {isError ? (part.errorText || 'Script failed') : result?.error}
        </div>
      )}
      {isDone && !hasError && result?.result && (
        <div className="px-3 py-2 text-[12px] text-zinc-300 bg-zinc-900 border border-white/10 rounded-sm font-mono whitespace-pre-wrap">
          {typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2)}
        </div>
      )}
    </div>
  );
}

/* ── Chart Renderer ── */

// High-contrast palette — every color is visually distinct, no near-duplicates
const CHART_COLORS = [
  '#00ef8b', // Flow Green
  '#3b82f6', // Blue
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#8b5cf6', // Purple
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#f97316', // Orange
  '#14b8a6', // Teal
  '#a78bfa', // Lavender
  '#fbbf24', // Gold
  '#f43f5e', // Rose
];

// Dim versions for gradient area fills
const CHART_COLORS_DIM = [
  'rgba(0,239,139,0.15)',
  'rgba(59,130,246,0.15)',
  'rgba(245,158,11,0.15)',
  'rgba(239,68,68,0.15)',
  'rgba(139,92,246,0.15)',
  'rgba(236,72,153,0.15)',
  'rgba(6,182,212,0.15)',
  'rgba(249,115,22,0.15)',
  'rgba(20,184,166,0.15)',
  'rgba(167,139,250,0.15)',
  'rgba(251,191,36,0.15)',
  'rgba(244,63,94,0.15)',
];

const CHART_TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: 'rgba(9,9,11,0.95)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '6px',
  color: '#fff',
  fontSize: '12px',
  fontFamily: 'monospace',
  padding: '6px 10px',
};

const CHART_TICK = { fontSize: 11, fill: '#71717a', fontFamily: 'monospace' };

function chartFmtNum(n: number): string {
  if (typeof n !== 'number' || isNaN(n)) return '0';
  if (Math.abs(n) >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n % 1 === 0 ? n.toLocaleString() : n.toFixed(2);
}

function chartTooltipFmt(value: number): string {
  if (typeof value !== 'number' || isNaN(value)) return '0';
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// Pie chart label renderer — show percentage on slices that are big enough
function renderPieLabel(props: any) {
  const percent = props.percent as number;
  if (!percent || percent < 0.04) return null; // skip tiny slices
  return `${(percent * 100).toFixed(0)}%`;
}

function ChartToolPart({ part }: { part: any }) {
  const isDone = part.state === 'output-available' || part.state === 'result';
  const isError = part.state === 'output-error';
  const result = isDone ? part.output : null;

  if (!isDone && !isError) {
    return (
      <div className="flex items-center gap-2 py-2 text-[11px] text-zinc-400">
        <Loader2 size={12} className="animate-spin" />
        <span className="uppercase tracking-widest font-bold">Creating chart...</span>
      </div>
    );
  }

  if (isError || !result) {
    return (
      <div className="px-3 py-2 text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-sm">
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

  const dsCount = datasets?.length ?? 0;

  return (
    <div className="my-2 rounded-md border border-zinc-200 dark:border-white/10 overflow-hidden">
      {title && (
        <div className="px-3 py-2 bg-zinc-50 dark:bg-white/[0.02] border-b border-zinc-200 dark:border-white/10">
          <span className="text-[12px] font-bold text-zinc-700 dark:text-zinc-200">{title}</span>
        </div>
      )}
      <div className="p-3 bg-white dark:bg-zinc-950" style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'pie' || chartType === 'doughnut' ? (
            <PieChart>
              <Pie
                data={chartData.map((d: any, i: number) => ({
                  name: d.name,
                  value: d[datasets?.[0]?.label] ?? 0,
                  fill: CHART_COLORS[i % CHART_COLORS.length],
                }))}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={chartType === 'doughnut' ? 55 : 0}
                outerRadius={85}
                strokeWidth={2}
                stroke="rgba(9,9,11,0.6)"
                label={renderPieLabel}
                labelLine={false}
                animationDuration={600}
              >
                {chartData.map((_: any, i: number) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                formatter={(value: any, name: any) => [chartTooltipFmt(Number(value ?? 0)), String(name)]}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, fontFamily: 'monospace' }}
                iconType="circle"
                iconSize={8}
              />
            </PieChart>
          ) : chartType === 'line' ? (
            <AreaChart data={chartData}>
              <defs>
                {datasets?.map((_ds: { label: string }, i: number) => (
                  <linearGradient key={`grad-${i}`} id={`chatGrad${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="name" tick={CHART_TICK} minTickGap={20} axisLine={false} tickLine={false} />
              <YAxis tick={CHART_TICK} tickFormatter={chartFmtNum} width={45} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                formatter={(value: any, name: any) => [chartTooltipFmt(Number(value ?? 0)), String(name)]}
              />
              {datasets?.map((ds: { label: string }, i: number) => (
                <Area
                  key={ds.label}
                  type="monotone"
                  dataKey={ds.label}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth={2}
                  fill={`url(#chatGrad${i})`}
                  dot={false}
                  activeDot={{ r: 3, strokeWidth: 0, fill: CHART_COLORS[i % CHART_COLORS.length] }}
                  animationDuration={600}
                />
              ))}
              {dsCount > 1 && (
                <Legend
                  wrapperStyle={{ fontSize: 11, fontFamily: 'monospace' }}
                  iconType="circle"
                  iconSize={8}
                />
              )}
            </AreaChart>
          ) : (
            <BarChart
              data={chartData}
              layout={chartType === 'horizontalBar' ? 'vertical' : 'horizontal'}
              barCategoryGap={dsCount > 1 ? '15%' : '20%'}
              barGap={2}
            >
              <CartesianGrid
                vertical={chartType !== 'horizontalBar'}
                horizontal={chartType === 'horizontalBar'}
                stroke="rgba(255,255,255,0.06)"
              />
              {chartType === 'horizontalBar' ? (
                <>
                  <XAxis type="number" tick={CHART_TICK} tickFormatter={chartFmtNum} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={CHART_TICK} width={80} axisLine={false} tickLine={false} />
                </>
              ) : (
                <>
                  <XAxis dataKey="name" tick={CHART_TICK} minTickGap={20} axisLine={false} tickLine={false} />
                  <YAxis tick={CHART_TICK} tickFormatter={chartFmtNum} width={45} axisLine={false} tickLine={false} />
                </>
              )}
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                formatter={(value: any, name: any) => [chartTooltipFmt(Number(value ?? 0)), String(name)]}
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              />
              {datasets?.map((ds: { label: string }, i: number) => (
                <Bar
                  key={ds.label}
                  dataKey={ds.label}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  radius={[3, 3, 0, 0]}
                  animationDuration={600}
                  fillOpacity={0.85}
                />
              ))}
              {dsCount > 1 && (
                <Legend
                  wrapperStyle={{ fontSize: 11, fontFamily: 'monospace' }}
                  iconType="circle"
                  iconSize={8}
                />
              )}
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
    const textContent = message.parts
      .filter((p) => p.type === 'text')
      .map((p) => (p as any).text)
      .join('');
    // Extract image attachments from message
    const allAttachments = (message as any).experimental_attachments || [];
    const images = allAttachments.filter((a: any) => a.contentType?.startsWith('image/'));
    const pdfs = allAttachments.filter((a: any) => a.contentType === 'application/pdf');

    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[85%] bg-nothing-green/10 border border-nothing-green/20 rounded-sm px-3 py-2">
          {(images.length > 0 || pdfs.length > 0) && (
            <div className="flex gap-1.5 mb-2 flex-wrap">
              {images.map((img: any, i: number) => (
                <img
                  key={`img-${i}`}
                  src={img.url}
                  alt={img.name || 'attachment'}
                  className="w-20 h-20 object-cover rounded-sm border border-nothing-green/20"
                />
              ))}
              {pdfs.map((pdf: any, i: number) => (
                <div key={`pdf-${i}`} className="w-20 h-20 rounded-sm border border-nothing-green/20 bg-red-50 dark:bg-red-900/20 flex flex-col items-center justify-center">
                  <FileText size={20} className="text-red-500" />
                  <span className="text-[8px] text-red-500 font-bold mt-0.5 truncate max-w-[70px]">{pdf.name || 'PDF'}</span>
                </div>
              ))}
            </div>
          )}
          {textContent && (
            <p className="text-[13px] text-zinc-700 dark:text-zinc-200 leading-relaxed">
              {textContent}
            </p>
          )}
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
                <div key={i} className="text-[13px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
                  <MarkdownContent text={(part as any).text} />
                </div>
              );
            }

            if (part.type === 'reasoning' || (part.type as string) === 'thinking') {
              const text = (part as any).text || (part as any).reasoning || '';
              if (!text.trim()) return null;
              return (
                <details key={i} className="my-1 group">
                  <summary className="flex items-center gap-1.5 cursor-pointer text-[10px] text-amber-500/70 uppercase tracking-widest font-bold hover:text-amber-500 select-none">
                    <Sparkles size={9} />
                    Thinking
                  </summary>
                  <div className="mt-1 pl-3 border-l-2 border-amber-500/20 text-[11px] text-zinc-400 leading-relaxed whitespace-pre-wrap">
                    {text}
                  </div>
                </details>
              );
            }

            if (part.type === 'tool-invocation' || (part.type as string) === 'dynamic-tool' || (part.type as string).startsWith('tool-')) {
              const toolPart = part as any;
              const name = toolPart.toolName ?? toolPart.type?.split('-').slice(1).join('-') ?? '';
              if (name === 'run_cadence') return <CadenceToolPart key={i} part={toolPart} />;
              if (name === 'run_sql' || name === 'runSQL' || name === 'run_flowindex_sql' || name === 'run_evm_sql') return <SqlToolPart key={i} part={toolPart} />;
              if (name === 'createChart') return <ChartToolPart key={i} part={toolPart} />;
              // Friendly labels for new tools
              if (name === 'web_search' || name === 'fetch_api') {
                const label = name === 'web_search' ? 'Searching the web' : `Fetching ${toolPart.args?.url || toolPart.input?.url || 'API'}`;
                const done = toolPart.state === 'output-available' || toolPart.state === 'result';
                const err = toolPart.state === 'output-error';
                return (
                  <div key={i} className="flex items-center gap-2 py-1.5 px-2.5 my-1 text-[11px] text-zinc-500 bg-zinc-50 dark:bg-white/[0.03] border border-zinc-100 dark:border-white/5 rounded-sm">
                    {!done && !err ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : err ? (
                      <X size={10} className="text-red-400" />
                    ) : (
                      <Search size={10} className="text-nothing-green" />
                    )}
                    <span className="truncate">{done ? (name === 'web_search' ? 'Web search complete' : `Fetched API`) : label}...</span>
                  </div>
                );
              }
              // Generic tool fallback
              const toolDone = toolPart.state === 'output-available' || toolPart.state === 'result';
              const toolErr = toolPart.state === 'output-error';
              return (
                <div key={i} className="flex items-center gap-2 py-1 text-[11px] text-zinc-400">
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

const MIN_WIDTH = 380;
const MAX_WIDTH = 1100;
const DEFAULT_WIDTH = 480;

export default function AIChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [thinkMode, setThinkMode] = useState(false);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const [mobileHeight, setMobileHeight] = useState<number | null>(null);
  const isDragging = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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

  // Mobile keyboard: track visual viewport height so the panel shrinks when keyboard opens
  useEffect(() => {
    if (typeof window === 'undefined' || !isOpen) return;
    const vv = window.visualViewport;
    if (!vv) return;

    const isMobile = window.innerWidth < 768;
    if (!isMobile) { setMobileHeight(null); return; }

    const onResize = () => {
      // visualViewport.height shrinks when the keyboard is open
      setMobileHeight(vv.height);
      // On iOS, the viewport may scroll up; keep the panel pinned to the top
      if (panelRef.current) {
        panelRef.current.style.top = `${vv.offsetTop}px`;
      }
    };

    onResize();
    vv.addEventListener('resize', onResize);
    vv.addEventListener('scroll', onResize);
    return () => {
      vv.removeEventListener('resize', onResize);
      vv.removeEventListener('scroll', onResize);
      setMobileHeight(null);
      if (panelRef.current) {
        panelRef.current.style.top = '';
      }
    };
  }, [isOpen]);

  const [chatError, setChatError] = useState<string | null>(null);

  // File attachments (images + PDFs)
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const MAX_FILES = 4;
  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB (PDFs can be large)
  const ACCEPTED_TYPES = ['image/', 'application/pdf'];

  const isAcceptedFile = useCallback((f: File) => {
    return f.size <= MAX_FILE_SIZE && ACCEPTED_TYPES.some(t => f.type.startsWith(t));
  }, []);

  const addFiles = useCallback((files: FileList | File[]) => {
    const accepted = Array.from(files).filter(isAcceptedFile);
    setAttachments(prev => [...prev, ...accepted].slice(0, MAX_FILES));
  }, [isAcceptedFile]);

  const removeAttachment = useCallback((index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  }, []);

  // Custom fetch: strips user-agent header (Safari CORS workaround) and injects thinking flag.
  // See: https://github.com/vercel/ai/issues/9256
  const thinkModeRef = useRef(thinkMode);
  thinkModeRef.current = thinkMode;

  const safeFetch = useCallback(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.headers) {
      const headers = new Headers(init.headers);
      headers.delete('user-agent');
      init = { ...init, headers };
    }
    // Inject thinking flag into the request body
    if (init?.body && thinkModeRef.current) {
      try {
        const parsed = JSON.parse(init.body as string);
        parsed.thinking = true;
        init = { ...init, body: JSON.stringify(parsed) };
      } catch { /* not JSON, skip */ }
    }
    return globalThis.fetch(url, init);
  }, []);

  const transport = useMemo(
    () => new DefaultChatTransport({
      api: `${AI_CHAT_URL}/api/chat`,
      credentials: 'omit',
      fetch: safeFetch as any,
    }),
    [safeFetch],
  );

  const { messages, sendMessage, status, stop, setMessages } = useChat({
    transport,
    onError: (error) => {
      console.error('[AIChatWidget] streaming error:', error);
      setChatError(error?.message || 'Failed to get response. Please try again.');
    },
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

  const handleSend = useCallback(async (text: string) => {
    if ((!text.trim() && attachments.length === 0) || isStreaming) return;
    setChatError(null);

    // Convert files to data URL attachments for the AI SDK
    const experimental_attachments = await Promise.all(
      attachments.map(async (file) => {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        return { name: file.name, contentType: file.type, url: base64 };
      })
    );

    sendMessage({
      text: text || 'Analyze this file',
      ...(experimental_attachments.length > 0 ? { experimental_attachments } : {}),
    });
    setInput('');
    setAttachments([]);
  }, [sendMessage, isStreaming, attachments]);

  // Listen for external "open chat with message" events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.message) {
        setIsOpen(true);
        setTimeout(() => {
          handleSend(detail.message);
        }, 400);
      } else {
        setIsOpen(true);
      }
    };
    window.addEventListener('ai-chat:open', handler);
    return () => window.removeEventListener('ai-chat:open', handler);
  }, [handleSend]);

  const handleClear = () => {
    setMessages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend(input);
    }
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const pastedFiles: File[] = [];
    for (const item of items) {
      if (item.type.startsWith('image/') || item.type === 'application/pdf') {
        const file = item.getAsFile();
        if (file) pastedFiles.push(file);
      }
    }
    if (pastedFiles.length > 0) {
      addFiles(pastedFiles);
    }
  }, [addFiles]);

  // Drag & drop handlers for the chat panel
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }, [addFiles]);

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
              ref={panelRef}
              initial={{ x: '100%', opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '100%', opacity: 0 }}
              transition={{ type: 'spring', bounce: 0, duration: 0.35 }}
              style={{
                width: typeof window !== 'undefined' && window.innerWidth >= 768 ? panelWidth : undefined,
                height: mobileHeight != null ? `${mobileHeight}px` : undefined,
              }}
              className="ai-chat-panel fixed top-0 right-0 z-[71] w-full md:w-auto bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-white/10 flex flex-col shadow-2xl h-[100dvh] md:h-full font-geist"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
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
              {/* Drag-drop overlay */}
              <AnimatePresence>
                {isDragOver && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-50 bg-nothing-green/10 border-2 border-dashed border-nothing-green flex items-center justify-center backdrop-blur-sm"
                  >
                    <div className="flex flex-col items-center gap-2">
                      <ImageIcon size={32} className="text-nothing-green" />
                      <span className="text-sm font-bold text-nothing-green uppercase tracking-widest">Drop file here</span>
                      <span className="text-[10px] text-nothing-green/60">Images & PDFs</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-white/10 shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-sm bg-nothing-green/10 border border-nothing-green/20 flex items-center justify-center">
                    <Sparkles size={13} className="text-nothing-green" />
                  </div>
                  <div>
                    <h3 className="text-[12px] font-bold text-zinc-900 dark:text-white uppercase tracking-widest">
                      Flow AI
                    </h3>
                    <p className="text-[10px] text-zinc-400 uppercase tracking-widest">
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
                    <p className="text-[12px] text-zinc-400 mb-6 text-center max-w-[260px]">
                      Query the Flow blockchain with natural language - SQL and Cadence
                    </p>
                    <div className="grid grid-cols-2 gap-2 w-full max-w-[320px]">
                      {SUGGESTIONS.map((s) => (
                        <button
                          key={s}
                          onClick={() => handleSend(s)}
                          className="text-left px-3 py-2.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-white/10 rounded-sm hover:border-nothing-green/30 hover:text-zinc-900 dark:hover:text-white hover:bg-nothing-green/5 transition-all"
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
                    {chatError && (
                      <div className="mb-4 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                        {chatError}
                        <button onClick={() => setChatError(null)} className="ml-2 underline">Dismiss</button>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>

              {/* Input */}
              <div className="shrink-0 border-t border-zinc-200 dark:border-white/10 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                {/* File preview thumbnails */}
                {attachments.length > 0 && (
                  <div className="flex gap-2 mb-2 flex-wrap">
                    {attachments.map((file, i) => (
                      <div key={`${file.name}-${i}`} className="relative group w-14 h-14 rounded-sm overflow-hidden border border-zinc-200 dark:border-white/10">
                        {file.type === 'application/pdf' ? (
                          <div className="w-full h-full bg-red-50 dark:bg-red-900/20 flex flex-col items-center justify-center">
                            <FileText size={18} className="text-red-500" />
                            <span className="text-[8px] text-red-500 font-bold mt-0.5">PDF</span>
                          </div>
                        ) : (
                          <img
                            src={URL.createObjectURL(file)}
                            alt={file.name}
                            className="w-full h-full object-cover"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => removeAttachment(i)}
                          className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X size={8} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <form
                  onSubmit={(e) => { e.preventDefault(); handleSend(input); }}
                  className="relative flex items-end"
                >
                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
                  />

                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    onFocus={() => {
                      // On mobile, scroll messages to bottom when keyboard opens
                      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 300);
                    }}
                    placeholder={attachments.length > 0 ? "Add a message or send..." : "Ask a question..."}
                    rows={2}
                    enterKeyHint="send"
                    className="w-full resize-none text-[16px] md:text-[13px] bg-zinc-50 dark:bg-white/[0.03] border border-zinc-200 dark:border-white/10 rounded-sm pl-3 pr-[4.5rem] py-2.5 text-zinc-700 dark:text-zinc-200 placeholder-zinc-400 focus:outline-none focus:border-nothing-green/40 transition-colors"
                    style={{ maxHeight: '120px' }}
                  />

                  {/* Paperclip + Send buttons */}
                  <div className="absolute right-1.5 bottom-1.5 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-8 h-8 md:w-7 md:h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-white/10 rounded-sm transition-colors"
                      title="Attach image or PDF"
                    >
                      <Paperclip size={13} />
                    </button>
                    {isStreaming ? (
                      <button
                        type="button"
                        onClick={() => stop()}
                        className="w-8 h-8 md:w-7 md:h-7 flex items-center justify-center bg-zinc-200 dark:bg-white/10 text-zinc-600 dark:text-zinc-400 rounded-sm hover:bg-zinc-300 dark:hover:bg-white/20 transition-colors"
                        title="Stop"
                      >
                        <X size={14} />
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={!input.trim() && attachments.length === 0}
                        className="w-8 h-8 md:w-7 md:h-7 flex items-center justify-center bg-nothing-green text-black rounded-sm hover:bg-nothing-green/80 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                        title="Send"
                      >
                        <Send size={13} />
                      </button>
                    )}
                  </div>
                </form>

                {/* Think mode toggle */}
                <div className="flex items-center justify-between mt-2">
                  <button
                    type="button"
                    onClick={() => setThinkMode(v => !v)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-sm text-[10px] uppercase tracking-widest font-bold transition-all ${
                      thinkMode
                        ? 'bg-amber-500/10 border border-amber-500/30 text-amber-500'
                        : 'text-zinc-400 hover:text-zinc-500 dark:hover:text-zinc-300 border border-transparent hover:border-zinc-200 dark:hover:border-white/10'
                    }`}
                    title={thinkMode ? 'Extended thinking enabled' : 'Enable extended thinking'}
                  >
                    <Sparkles size={10} />
                    Think
                    {thinkMode && <span className="text-[8px] opacity-60">ON</span>}
                  </button>
                  <span className="text-[9px] text-zinc-400">
                    Shift+Enter for new line
                  </span>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

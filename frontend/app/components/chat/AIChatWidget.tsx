import { useState, useRef, useEffect, useCallback } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import { MessageSquare, X, Send, Trash2, Loader2, Sparkles, Database, Copy, Check, Download, Search, Bot } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';

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

/* ── Code Block with copy ── */

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
      <pre className="p-3 text-[11px] leading-relaxed bg-zinc-900 text-zinc-300 overflow-x-auto font-mono whitespace-pre-wrap break-words">
        <code>{code}</code>
      </pre>
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

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 py-1">
        <Database size={12} className="text-nothing-green" />
        <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-bold">SQL Query</span>
        {!isDone && !isError && (
          <Loader2 size={12} className="animate-spin text-zinc-400" />
        )}
      </div>
      {sqlCode && <CodeBlock code={sqlCode} language="sql" />}
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
      <div className="flex items-center gap-2 py-1">
        <Sparkles size={12} className="text-purple-400" />
        <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-bold">Cadence Script</span>
        {!isDone && !isError && (
          <Loader2 size={12} className="animate-spin text-zinc-400" />
        )}
      </div>
      {script && <CodeBlock code={script} language="swift" />}
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
              // Generic tool fallback
              return (
                <div key={i} className="flex items-center gap-2 py-1 text-[10px] text-zinc-400">
                  <Loader2 size={10} className={toolPart.state === 'call' ? 'animate-spin' : ''} />
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

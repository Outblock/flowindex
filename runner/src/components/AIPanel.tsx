import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import type { UIMessage, LanguageModelUsage } from 'ai';
import {
  Bot, X, Send, Trash2, Loader2, Sparkles, Database, Copy, Check, Download,
  Search, ChevronRight, Code, Wrench, Zap, Scale, Brain, ChevronUp,
  Eye, EyeOff, Square, ReplaceAll, Coins, Image, SendHorizonal,
  ShieldCheck, ShieldOff,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { AnimatedMarkdown } from '@outblock/flowtoken';
import '@outblock/flowtoken/styles.css';
import './aipanel-flowtoken-overrides.css';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { useShikiHighlighter, highlightCode } from '../hooks/useShiki';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { getTemplates, type Template } from '../fs/fileSystem';
import type { FlowNetwork } from '../flow/networks';
import type { SignerOption } from './SignerSelector';
import type { LocalKey, KeyAccount } from '../auth/localKeyManager';
import { executeCustodialTransaction } from '../flow/execute';

const AI_CHAT_URL = import.meta.env.VITE_AI_CHAT_URL || 'https://ai.flowindex.io';
const CONTEXT_WINDOW = 200_000;

function formatCompactTokens(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

function ContextUsageIndicator({ usage, maxTokens, modelLabel }: {
  usage: LanguageModelUsage; maxTokens: number; modelLabel: string;
}) {
  const usedTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
  const usagePct = maxTokens > 0 ? Math.min(usedTokens / maxTokens, 1) : 0;
  const renderedPercent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }).format(usagePct);
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - usagePct);

  return (
    <div className="relative self-center group/context shrink-0">
      <button
        type="button"
        className="flex items-center gap-1 px-1 py-1 rounded text-[10px] uppercase tracking-widest font-bold text-zinc-500 hover:text-zinc-300 transition-all"
        title={`Context window usage (${modelLabel})`}
      >
        <span>{renderedPercent}</span>
        <svg aria-hidden="true" className="shrink-0" width="16" height="16" viewBox="0 0 20 20">
          <circle cx="10" cy="10" r={radius} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
          <circle cx="10" cy="10" r={radius} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={dashOffset} opacity="0.7"
            style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }} />
        </svg>
      </button>
      <div className="absolute bottom-full right-0 mb-1.5 hidden group-hover/context:block group-focus-within/context:block z-50">
        <div className="w-48 rounded border border-zinc-700 bg-zinc-800 shadow-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-zinc-700">
            <div className="flex items-center justify-between gap-3 text-[11px] text-zinc-400">
              <span>{modelLabel}</span>
              <span className="font-mono">{formatCompactTokens(usedTokens)} / {formatCompactTokens(maxTokens)}</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-zinc-700 overflow-hidden">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(usagePct * 100, 100)}%` }} />
            </div>
          </div>
          <div className="px-3 py-2 space-y-1 text-[11px] text-zinc-400">
            <div className="flex justify-between"><span>Input</span><span className="font-mono">{formatCompactTokens(usage.inputTokens ?? 0)}</span></div>
            <div className="flex justify-between"><span>Output</span><span className="font-mono">{formatCompactTokens(usage.outputTokens ?? 0)}</span></div>
            {(usage.reasoningTokens ?? 0) > 0 && (
              <div className="flex justify-between"><span>Reasoning</span><span className="font-mono">{formatCompactTokens(usage.reasoningTokens ?? 0)}</span></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Types ── */

interface FenceEdit {
  path?: string;
  code: string;
  patches?: { search: string; replace: string }[];
}

interface AIPanelProps {
  onInsertCode: (code: string) => void;
  onApplyCodeToFile?: (path: string, code: string) => void;
  onAutoApplyEdits?: (
    edits: FenceEdit[],
    meta?: { assistantId?: string; streaming?: boolean },
  ) => void;
  onLoadTemplate: (template: Template) => void;
  onCreateFile?: (path: string, content: string) => void;
  onDeleteFile?: (path: string) => void;
  onSetActiveFile?: (path: string) => void;
  editorCode?: string;
  projectFiles?: { path: string; content: string; readOnly?: boolean }[];
  activeFile?: string;
  network?: string;
  onClose?: () => void;
  onAutoApproveChange?: (autoApprove: boolean) => void;
  selectedSigner?: SignerOption;
  signWithLocalKey?: (
    keyId: string,
    message: string,
    hashAlgo?: 'SHA2_256' | 'SHA3_256',
    password?: string,
    sigAlgo?: 'ECDSA_P256' | 'ECDSA_secp256k1',
  ) => Promise<string>;
  promptForPassword?: (keyLabel: string) => Promise<string>;
  localKeys?: LocalKey[];
  accountsMap?: Record<string, KeyAccount[]>;
  onCreateAccount?: (
    keyId: string,
    sigAlgo: 'ECDSA_P256' | 'ECDSA_secp256k1',
    hashAlgo: 'SHA2_256' | 'SHA3_256',
    network: 'mainnet' | 'testnet',
  ) => Promise<{ txId: string }>;
  onRefreshAccounts?: (
    keyId: string,
    network: 'mainnet' | 'testnet',
  ) => Promise<KeyAccount[]>;
  onSwitchNetwork?: (network: FlowNetwork) => void;
  onViewAccount?: (address: string) => void;
  /** External message to auto-send (e.g. "Fix with AI" from codegen errors) */
  pendingMessage?: string;
  onPendingMessageConsumed?: () => void;
}

/* ── SQL Result Table ── */

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
    <div className="rounded border border-zinc-700 overflow-hidden my-2">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-zinc-800/50 border-b border-zinc-700">
        <span className="text-[11px] text-zinc-500 font-mono tabular-nums">
          {filtered.length} row{filtered.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500" />
            <input
              type="text"
              placeholder="Filter..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-24 focus:w-32 pl-6 pr-2 py-1 text-[11px] bg-zinc-900 border border-zinc-700 rounded text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/40 transition-all"
            />
          </div>
          <button
            onClick={exportCsv}
            className="flex items-center gap-1 px-2 py-1 text-[11px] text-zinc-500 hover:text-white bg-zinc-900 border border-zinc-700 rounded hover:border-zinc-500 transition-colors"
          >
            <Download size={10} />
            CSV
          </button>
        </div>
      </div>
      <div className="overflow-x-auto max-h-[240px] overflow-y-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr>
              {result.columns.map((col) => (
                <th
                  key={col}
                  className="px-3 py-2 text-[11px] font-bold text-zinc-500 uppercase tracking-wider border-b border-zinc-700 whitespace-nowrap sticky top-0 bg-zinc-900 z-10"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => (
              <tr key={i} className="border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors">
                {result.columns.map((col) => (
                  <td
                    key={col}
                    className="px-3 py-1.5 text-[12px] text-zinc-400 whitespace-nowrap max-w-[200px] truncate font-mono"
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
        <div className="py-4 text-center text-[12px] text-zinc-500">No matching rows</div>
      )}
    </div>
  );
}

/* ── Auto-linking helpers ── */

// Module-level ref so LinkedHex can open the account side panel
let _onViewAccount: ((address: string) => void) | undefined;

function classifyHex(val: string): { type: string; url: string | null } {
  const hex = val.toLowerCase();
  const has0x = hex.startsWith('0x');
  const bare = has0x ? hex.slice(2) : hex;

  if (bare.length === 16 && /^[0-9a-f]+$/.test(bare)) {
    const addr = has0x ? val : `0x${val}`;
    return { type: 'cadence-addr', url: `https://flowindex.io/accounts/${addr}` };
  }
  if (bare.length === 40 && /^[0-9a-f]+$/.test(bare)) {
    const addr = has0x ? val : `0x${val}`;
    return { type: 'evm-addr', url: `https://evm.flowindex.io/address/${addr}` };
  }
  if (bare.length === 64 && /^[0-9a-f]+$/.test(bare)) {
    if (has0x) return { type: 'evm-tx', url: `https://evm.flowindex.io/tx/${val}` };
    return { type: 'cadence-tx', url: `https://flowindex.io/txs/${val}` };
  }
  return { type: 'hex', url: null };
}

function LinkedHex({ val }: { val: string }) {
  const { type, url } = classifyHex(val);
  if (!url) return <span className="text-emerald-400/70">{val}</span>;
  const short = val.length > 20 ? `${val.slice(0, 10)}...${val.slice(-8)}` : val;
  if (type === 'cadence-addr' && _onViewAccount) {
    const addr = val.toLowerCase().startsWith('0x') ? val.slice(2) : val;
    return (
      <button onClick={() => _onViewAccount!(addr)} className="text-emerald-400/90 hover:text-emerald-400 hover:underline" title={val}>
        {short}
      </button>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-emerald-400/90 hover:text-emerald-400 hover:underline" title={val}>
      {short}
    </a>
  );
}

function formatCellValue(val: unknown): React.ReactNode {
  if (val === null || val === undefined)
    return <span className="text-zinc-600 italic">null</span>;
  if (typeof val === 'number') return val.toLocaleString();
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'string') {
    const { url } = classifyHex(val);
    if (url) return <LinkedHex val={val} />;
  }
  return String(val);
}

const HEX_RE = /\b(0x[0-9a-fA-F]{16}|0x[0-9a-fA-F]{40}|0x[0-9a-fA-F]{64}|[0-9a-fA-F]{64})\b/g;

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

/* ── Code Block with syntax highlighting, copy, and replace ── */

function extractPathFromMeta(meta?: string): string | undefined {
  if (!meta) return undefined;
  const match = meta.match(/(?:^|\s)(?:path|file)\s*[:=]\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
  const raw = match?.[1] || match?.[2] || match?.[3];
  if (!raw) return undefined;
  return raw.trim();
}

function extractPathFromFirstLine(code: string): string | undefined {
  const firstLine = code.split('\n', 1)[0]?.trim() || '';
  const match = firstLine.match(/^\/\/\s*(?:path|file)\s*[:=]\s*(.+)$/i);
  if (!match?.[1]) return undefined;
  return match[1].trim().replace(/^['"`]/, '').replace(/['"`]$/, '');
}

function normalizePathCandidate(path?: string): string | undefined {
  if (!path) return undefined;
  const cleaned = path
    .trim()
    .replace(/^['"`]/, '')
    .replace(/['"`]$/, '')
    .replace(/^\.\//, '')
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/');
  if (!cleaned || cleaned.startsWith('/')) return undefined;
  if (cleaned.includes('..')) return undefined;
  return cleaned;
}

function resolveTargetPath(meta: string | undefined, language: string, code: string): string | undefined {
  const fromMeta = normalizePathCandidate(extractPathFromMeta(meta));
  if (fromMeta) return fromMeta;

  const fromComment = normalizePathCandidate(extractPathFromFirstLine(code));
  if (fromComment) return fromComment;

  const maybePathLang = normalizePathCandidate(language);
  if (maybePathLang && maybePathLang.includes('/')) return maybePathLang;
  return undefined;
}

function shortFileName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

/* ── Diff rendering for SEARCH/REPLACE blocks ── */

function DiffView({ code }: { code: string }) {
  const patches = parseSearchReplacePatches(code);
  if (!patches) return null;

  return (
    <div className="bg-zinc-950 font-mono text-[11px] leading-[1.6]">
      {patches.map((patch, i) => (
        <div key={i} className={i > 0 ? 'border-t border-zinc-800' : ''}>
          {patch.search.split('\n').map((line, j) => (
            <div key={`s-${j}`} className="flex bg-red-500/8">
              <span className="select-none w-6 shrink-0 text-right pr-1.5 text-red-400/50">−</span>
              <span className="text-red-300/80 whitespace-pre-wrap break-all px-1.5 py-px">{line}</span>
            </div>
          ))}
          {patch.replace.split('\n').map((line, j) => (
            <div key={`r-${j}`} className="flex bg-emerald-500/8">
              <span className="select-none w-6 shrink-0 text-right pr-1.5 text-emerald-400/50">+</span>
              <span className="text-emerald-300/80 whitespace-pre-wrap break-all px-1.5 py-px">{line}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function CodeBlock({
  code,
  language,
  meta,
  onInsertCode,
  onApplyCodeToFile,
}: {
  code: string;
  language: string;
  meta?: string;
  onInsertCode?: (code: string) => void;
  onApplyCodeToFile?: (path: string, code: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const highlighter = useShikiHighlighter();
  const isCadence = language === 'cadence' || language === 'cdc';
  const targetPath = resolveTargetPath(meta, language, code);
  const canApplyToFile = !!targetPath && !!onApplyCodeToFile;
  const canReplaceActive = isCadence && !!onInsertCode;
  const lineCount = code.split('\n').length;
  const isDiff = code.includes('<<<<<<< SEARCH');
  const patches = isDiff ? parseSearchReplacePatches(code) : null;
  const patchCount = patches?.length ?? 0;
  const [expanded, setExpanded] = useState(false);

  const highlighted = useMemo(() => {
    if (!highlighter || isDiff) return '';
    return highlightCode(highlighter, code, language);
  }, [highlighter, code, language, isDiff]);

  return (
    <div className="rounded border border-zinc-700 overflow-hidden my-2">
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-zinc-800/80 border-b border-zinc-700">
        <div className="min-w-0 flex items-center gap-1.5">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-0.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors"
            title={expanded ? 'Collapse' : 'Expand'}
          >
            <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </button>
          {isDiff ? (
            <span className="text-[10px] text-amber-400/80 uppercase tracking-widest font-bold">diff</span>
          ) : (
            <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">{language || 'code'}</span>
          )}
          {targetPath && (
            <span className="text-[10px] text-zinc-600 font-mono truncate max-w-[160px]" title={targetPath}>
              {targetPath}
            </span>
          )}
          {isDiff && patchCount > 0 && (
            <span className="text-[10px] text-zinc-600">
              {patchCount} change{patchCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {canApplyToFile && targetPath && (
            <button
              onClick={() => onApplyCodeToFile(targetPath, code)}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 rounded transition-colors font-medium"
              title={`Create/update ${targetPath}`}
            >
              <ReplaceAll className="w-3 h-3" />
              Apply {shortFileName(targetPath)}
            </button>
          )}
          {!isDiff && canReplaceActive && (
            <button
              onClick={() => onInsertCode(code)}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 rounded transition-colors font-medium"
              title="Replace editor content"
            >
              <ReplaceAll className="w-3 h-3" />
              Replace
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 rounded transition-colors"
            title="Copy to clipboard"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      {expanded ? (
        isDiff && patches ? (
          <DiffView code={code} />
        ) : highlighted ? (
          <div
            className="shiki-code-block"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        ) : (
          <pre className="m-0 p-2.5 text-[11px] leading-[1.5] bg-[#09090b] text-zinc-300 font-mono overflow-x-auto">
            <code>{code}</code>
          </pre>
        )
      ) : (
        <div className="px-2.5 py-2 bg-zinc-950 text-[11px] text-zinc-500 font-mono">
          {isDiff
            ? `${patchCount} change${patchCount !== 1 ? 's' : ''} — click to view diff`
            : `${lineCount} lines — click to expand`}
        </div>
      )}
    </div>
  );
}

/* ── Collapsible Code Block ── */

function CollapsibleCode({ code, language, label, icon }: { code: string; language: string; label: string; icon: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const highlighter = useShikiHighlighter();
  const highlighted = useMemo(() => {
    if (!highlighter) return '';
    return highlightCode(highlighter, code, language);
  }, [highlighter, code, language]);

  return (
    <div className="rounded border border-zinc-700 overflow-hidden my-1.5">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-zinc-800/50 hover:bg-zinc-800 transition-colors text-left"
      >
        <motion.div animate={{ rotate: isOpen ? 90 : 0 }} transition={{ duration: 0.15 }}>
          <ChevronRight size={12} className="text-zinc-500" />
        </motion.div>
        {icon}
        <span className="text-[11px] text-zinc-500 uppercase tracking-widest font-bold flex-1">{label}</span>
        <button
          onClick={handleCopy}
          className="text-zinc-500 hover:text-white transition-colors p-0.5"
        >
          {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
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
            {highlighted ? (
              <div
                className="shiki-code-block shiki-collapsible"
                dangerouslySetInnerHTML={{ __html: highlighted }}
              />
            ) : (
              <pre className="m-0 p-3 text-xs leading-[1.6] bg-[#09090b] text-zinc-300 font-mono overflow-x-auto">
                <code>{code}</code>
              </pre>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Markdown Components (dark theme, with Replace button) ── */

function createMarkdownComponents(
  onInsertCode?: (code: string) => void,
  onApplyCodeToFile?: (path: string, code: string) => void,
): Components {
  return {
    h1: ({ children }) => <h1 className="text-sm font-bold text-white mt-3 mb-1">{children}</h1>,
    h2: ({ children }) => <h2 className="text-[13px] font-bold text-white mt-3 mb-1">{children}</h2>,
    h3: ({ children }) => <h3 className="text-xs font-bold text-white mt-2 mb-1">{children}</h3>,
    h4: ({ children }) => <h4 className="text-xs font-semibold text-zinc-100 mt-2 mb-0.5">{children}</h4>,
    p: ({ children }) => <p className="mb-2 last:mb-0"><AutoLinkText>{children}</AutoLinkText></p>,
    strong: ({ children }) => <strong className="font-bold text-white">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">{children}</a>
    ),
    ul: ({ children }) => <ul className="ml-3 mb-2 space-y-0.5">{children}</ul>,
    ol: ({ children }) => <ol className="ml-3 mb-2 space-y-0.5 list-decimal list-inside">{children}</ol>,
    li: ({ children }) => (
      <li className="flex gap-1.5">
        <span className="text-emerald-500 shrink-0 mt-[1px]">-</span>
        <span className="flex-1"><AutoLinkText>{children}</AutoLinkText></span>
      </li>
    ),
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-emerald-500/40 pl-3 my-2 text-zinc-400 italic">{children}</blockquote>
    ),
    hr: () => <hr className="my-3 border-zinc-700" />,
    table: ({ children }) => (
      <div className="overflow-x-auto my-2 rounded border border-zinc-700">
        <table className="w-full text-left border-collapse text-[11px]">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-zinc-800/80">{children}</thead>,
    th: ({ children }) => (
      <th className="px-2 py-1.5 text-[10px] font-bold text-zinc-400 uppercase tracking-wider border-b border-zinc-700 whitespace-nowrap">{children}</th>
    ),
    td: ({ children }) => (
      <td className="px-2 py-1.5 text-zinc-300 border-b border-zinc-800 font-mono"><AutoLinkText>{children}</AutoLinkText></td>
    ),
    code: ({ node, className, children }) => {
      const match = /language-(\w+)/.exec(className || '');
      const lang = match ? match[1] : '';
      const codeString = String(children).replace(/\n$/, '');
      const meta = typeof (node as { meta?: unknown } | undefined)?.meta === 'string'
        ? String((node as { meta?: string }).meta)
        : undefined;

      if (lang || codeString.includes('\n')) {
        return (
          <CodeBlock
            code={codeString}
            language={lang || 'text'}
            meta={meta}
            onInsertCode={onInsertCode}
            onApplyCodeToFile={onApplyCodeToFile}
          />
        );
      }

      if (/^0x[0-9a-fA-F]{16,64}$/.test(codeString)) {
        const { type, url } = classifyHex(codeString);
        if (url) {
          const short = codeString.length > 20 ? `${codeString.slice(0, 10)}...${codeString.slice(-8)}` : codeString;
          if (type === 'cadence-addr' && _onViewAccount) {
            const addr = codeString.toLowerCase().startsWith('0x') ? codeString.slice(2) : codeString;
            return (
              <button onClick={() => _onViewAccount!(addr)}
                className="text-[11px] bg-emerald-500/10 px-1 py-0.5 rounded font-mono text-emerald-400 hover:underline"
                title={codeString}
              >
                {short}
              </button>
            );
          }
          return (
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="text-[11px] bg-emerald-500/10 px-1 py-0.5 rounded font-mono text-emerald-400 hover:underline"
              title={codeString}
            >
              {short}
            </a>
          );
        }
      }

      return (
        <code className="text-[11px] bg-zinc-700/60 px-1 py-0.5 rounded font-mono text-purple-400">{children}</code>
      );
    },
    pre: ({ children }) => <>{children}</>,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function createAnimatedMarkdownComponents(
  onInsertCode?: (code: string) => void,
  onApplyCodeToFile?: (path: string, code: string) => void,
): Record<string, any> {
  return {
    h1: ({ animateText, children }: any) => <h1 className="text-sm font-bold text-white mt-3 mb-1">{animateText(children)}</h1>,
    h2: ({ animateText, children }: any) => <h2 className="text-[13px] font-bold text-white mt-3 mb-1">{animateText(children)}</h2>,
    h3: ({ animateText, children }: any) => <h3 className="text-xs font-bold text-white mt-2 mb-1">{animateText(children)}</h3>,
    h4: ({ animateText, children }: any) => <h4 className="text-xs font-semibold text-zinc-100 mt-2 mb-0.5">{animateText(children)}</h4>,
    p: ({ animateText, children }: any) => <p className="mb-2 last:mb-0"><AutoLinkText>{animateText(children)}</AutoLinkText></p>,
    strong: ({ animateText, children }: any) => <strong className="font-bold text-white">{animateText(children)}</strong>,
    em: ({ animateText, children }: any) => <em className="italic">{animateText(children)}</em>,
    a: ({ animateText, children, href }: any) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">{animateText(children)}</a>
    ),
    ul: ({ children }: any) => <ul className="ml-3 mb-2 space-y-0.5">{children}</ul>,
    ol: ({ children }: any) => <ol className="ml-3 mb-2 space-y-0.5 list-decimal list-inside">{children}</ol>,
    li: ({ animateText, children }: any) => (
      <li className="flex gap-1.5">
        <span className="text-emerald-500 shrink-0 mt-[1px]">-</span>
        <span className="flex-1"><AutoLinkText>{animateText(children)}</AutoLinkText></span>
      </li>
    ),
    blockquote: ({ children }: any) => (
      <blockquote className="border-l-2 border-emerald-500/40 pl-3 my-2 text-zinc-400 italic">{children}</blockquote>
    ),
    hr: () => <hr className="my-3 border-zinc-700" />,
    table: ({ children }: any) => (
      <div className="overflow-x-auto my-2 rounded border border-zinc-700">
        <table className="w-full text-left border-collapse text-[11px]">{children}</table>
      </div>
    ),
    thead: ({ children }: any) => <thead className="bg-zinc-800/80">{children}</thead>,
    th: ({ animateText, children }: any) => (
      <th className="px-2 py-1.5 text-[10px] font-bold text-zinc-400 uppercase tracking-wider border-b border-zinc-700 whitespace-nowrap">{animateText(children)}</th>
    ),
    td: ({ animateText, children }: any) => (
      <td className="px-2 py-1.5 text-zinc-300 border-b border-zinc-800 font-mono"><AutoLinkText>{animateText(children)}</AutoLinkText></td>
    ),
    code: ({ node, className, children }: any) => {
      const match = /language-(\w+)/.exec(className || '');
      const lang = match ? match[1] : '';
      const codeString = String(children).replace(/\n$/, '');
      const meta = typeof node?.meta === 'string' ? node.meta : undefined;
      if (lang || codeString.includes('\n')) {
        return (
          <CodeBlock
            code={codeString}
            language={lang || 'text'}
            meta={meta}
            onInsertCode={onInsertCode}
            onApplyCodeToFile={onApplyCodeToFile}
          />
        );
      }
      return (
        <code className="text-[11px] bg-zinc-700/60 px-1 py-0.5 rounded font-mono text-purple-400">{children}</code>
      );
    },
    pre: ({ children }: any) => <>{children}</>,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function MarkdownContent({
  text,
  onInsertCode,
  onApplyCodeToFile,
}: {
  text: string;
  onInsertCode?: (code: string) => void;
  onApplyCodeToFile?: (path: string, code: string) => void;
}) {
  const components = useMemo(
    () => createMarkdownComponents(onInsertCode, onApplyCodeToFile),
    [onInsertCode, onApplyCodeToFile],
  );
  if (!text) return null;
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{text}</ReactMarkdown>;
}

/* ── Tool Part Renderers ── */

/* eslint-disable @typescript-eslint/no-explicit-any */
function SqlToolPart({ part }: { part: any }) {
  const toolName = part.toolName ?? '';
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
              <Database size={11} className="text-emerald-400" />
              {!isDone && !isError && <Loader2 size={10} className="animate-spin text-zinc-400" />}
            </>
          }
        />
      )}
      {!sqlCode && !isDone && !isError && (
        <div className="flex items-center gap-2 py-1">
          <Database size={12} className="text-emerald-400" />
          <Loader2 size={12} className="animate-spin text-zinc-400" />
        </div>
      )}
      {hasError && (
        <div className="px-3 py-2 text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded">
          {isError ? (part.errorText || 'Query failed') : result?.error}
        </div>
      )}
      {hasData && <SqlResultTable result={result} />}
    </div>
  );
}

function CadenceToolPart({
  part,
  onInsertCode,
  onApplyCodeToFile,
}: {
  part: any;
  onInsertCode?: (code: string) => void;
  onApplyCodeToFile?: (path: string, code: string) => void;
}) {
  const isDone = part.state === 'output-available' || part.state === 'result';
  const isError = part.state === 'output-error';
  const result = isDone ? part.output : null;
  const hasError = isError || result?.error;
  const script: string | undefined = part.input?.script ?? part.args?.script ?? part.input?.code ?? part.args?.code;
  const explicitPath = normalizePathCandidate(part.input?.path ?? part.args?.path);
  const parsedPath = script ? resolveTargetPath(undefined, 'cadence', script) : undefined;
  const targetPath = explicitPath || parsedPath;
  const canReplace = !!script && !!onInsertCode;
  const canApplyToFile = !!script && !!targetPath && !!onApplyCodeToFile;

  return (
    <div className="space-y-1">
      {script && (
        <>
          {(canReplace || canApplyToFile) && (
            <div className="flex items-center gap-1.5 pb-1">
              {canApplyToFile && targetPath && (
                <button
                  onClick={() => onApplyCodeToFile(targetPath, script)}
                  className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 rounded transition-colors font-medium"
                  title={`Create/update ${targetPath}`}
                >
                  <ReplaceAll className="w-3 h-3" />
                  Apply {shortFileName(targetPath)}
                </button>
              )}
              {canReplace && (
                <button
                  onClick={() => onInsertCode(script)}
                  className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 rounded transition-colors font-medium"
                  title="Replace editor content"
                >
                  <ReplaceAll className="w-3 h-3" />
                  Replace
                </button>
              )}
            </div>
          )}
          <CollapsibleCode
            code={script}
            language="cadence"
            label="Cadence"
            icon={
              <>
                <Sparkles size={11} className="text-purple-400" />
                {!isDone && !isError && <Loader2 size={10} className="animate-spin text-zinc-400" />}
              </>
            }
          />
        </>
      )}
      {!script && !isDone && !isError && (
        <div className="flex items-center gap-2 py-1">
          <Sparkles size={12} className="text-purple-400" />
          <Loader2 size={12} className="animate-spin text-zinc-400" />
        </div>
      )}
      {hasError && (
        <div className="px-3 py-2 text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded">
          {isError ? (part.errorText || 'Script failed') : result?.error}
        </div>
      )}
      {isDone && !hasError && result?.result && (
        <div className="px-3 py-2 text-[12px] text-zinc-300 bg-zinc-900 border border-zinc-700 rounded font-mono whitespace-pre-wrap">
          {typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2)}
        </div>
      )}
    </div>
  );
}

/* ── Chart Renderer ── */

const CHART_COLORS = [
  '#00ef8b', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899',
  '#06b6d4', '#f97316', '#14b8a6', '#a78bfa', '#fbbf24', '#f43f5e',
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

function renderPieLabel(props: any) {
  const percent = props.percent as number;
  if (!percent || percent < 0.04) return null;
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
      <div className="px-3 py-2 text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded">
        {isError ? (part.errorText || 'Chart creation failed') : 'No chart data'}
      </div>
    );
  }

  const { chartType, title, labels, datasets } = result;
  const chartData = labels?.map((label: string, i: number) => {
    const point: Record<string, unknown> = { name: label };
    datasets?.forEach((ds: { label: string; data: number[] }) => {
      point[ds.label] = ds.data[i];
    });
    return point;
  }) ?? [];

  const dsCount = datasets?.length ?? 0;

  return (
    <div className="my-2 rounded-md border border-zinc-700 overflow-hidden">
      {title && (
        <div className="px-3 py-2 bg-zinc-800/50 border-b border-zinc-700">
          <span className="text-[12px] font-bold text-zinc-200">{title}</span>
        </div>
      )}
      <div className="p-3 bg-zinc-950" style={{ height: 240 }}>
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
                cx="50%" cy="50%"
                innerRadius={chartType === 'doughnut' ? 50 : 0}
                outerRadius={75}
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
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(value: any, name: any) => [chartTooltipFmt(Number(value ?? 0)), String(name)]} />
              <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'monospace' }} iconType="circle" iconSize={8} />
            </PieChart>
          ) : chartType === 'line' ? (
            <AreaChart data={chartData}>
              <defs>
                {datasets?.map((_ds: { label: string }, i: number) => (
                  <linearGradient key={`grad-${i}`} id={`runnerGrad${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="name" tick={CHART_TICK} minTickGap={20} axisLine={false} tickLine={false} />
              <YAxis tick={CHART_TICK} tickFormatter={chartFmtNum} width={45} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(value: any, name: any) => [chartTooltipFmt(Number(value ?? 0)), String(name)]} />
              {datasets?.map((ds: { label: string }, i: number) => (
                <Area key={ds.label} type="monotone" dataKey={ds.label}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2}
                  fill={`url(#runnerGrad${i})`} dot={false}
                  activeDot={{ r: 3, strokeWidth: 0, fill: CHART_COLORS[i % CHART_COLORS.length] }}
                  animationDuration={600}
                />
              ))}
              {dsCount > 1 && <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'monospace' }} iconType="circle" iconSize={8} />}
            </AreaChart>
          ) : (
            <BarChart data={chartData}
              layout={chartType === 'horizontalBar' ? 'vertical' : 'horizontal'}
              barCategoryGap={dsCount > 1 ? '15%' : '20%'} barGap={2}
            >
              <CartesianGrid vertical={chartType !== 'horizontalBar'} horizontal={chartType === 'horizontalBar'} stroke="rgba(255,255,255,0.06)" />
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
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} formatter={(value: any, name: any) => [chartTooltipFmt(Number(value ?? 0)), String(name)]} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              {datasets?.map((ds: { label: string }, i: number) => (
                <Bar key={ds.label} dataKey={ds.label} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[3, 3, 0, 0]} animationDuration={600} fillOpacity={0.85} />
              ))}
              {dsCount > 1 && <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'monospace' }} iconType="circle" iconSize={8} />}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ── Chat Message ── */

/* eslint-disable @typescript-eslint/no-explicit-any */
function ChatMessage({ message, hideTools, isStreamingMsg, onInsertCode, onApplyCodeToFile }: {
  message: UIMessage;
  hideTools?: boolean;
  isStreamingMsg?: boolean;
  onInsertCode?: (code: string) => void;
  onApplyCodeToFile?: (path: string, code: string) => void;
}) {
  const animatedComponents = useMemo(
    () => createAnimatedMarkdownComponents(onInsertCode, onApplyCodeToFile),
    [onInsertCode, onApplyCodeToFile],
  );

  if (message.role === 'user') {
    const textContent = message.parts
      .filter((p) => p.type === 'text')
      .map((p) => (p as any).text)
      .join('');

    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[90%] bg-emerald-700/30 border border-emerald-600/20 rounded-lg px-3 py-2 overflow-hidden break-words">
          {textContent && (
            <div className="text-[12px] text-zinc-100 leading-relaxed whitespace-pre-wrap">
              {textContent}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3">
      <div className="flex items-start gap-2">
        <div className="shrink-0 mt-0.5 w-5 h-5 rounded bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
          <Bot size={11} className="text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0 overflow-hidden break-words">
          {message.parts.map((part, i) => {
            if (part.type === 'text') {
              if (!(part as any).text?.trim()) return null;
              return (
                <div key={i} className="text-[12px] text-zinc-300 leading-relaxed">
                  {isStreamingMsg ? (
                    <AnimatedMarkdown
                      content={(part as any).text}
                      animation={["colorTransition", "blurIn"]}
                      animationDuration="0.6s"
                      animationTimingFunction="ease-out"
                      sep="diff"
                      customComponents={animatedComponents}
                    />
                  ) : (
                    <MarkdownContent
                      text={(part as any).text}
                      onInsertCode={onInsertCode}
                      onApplyCodeToFile={onApplyCodeToFile}
                    />
                  )}
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
                  <div className="mt-1 pl-3 border-l-2 border-amber-500/20 text-[11px] text-zinc-500 leading-relaxed whitespace-pre-wrap">
                    {text}
                  </div>
                </details>
              );
            }

            if (part.type === 'tool-invocation' || (part.type as string) === 'dynamic-tool' || (part.type as string).startsWith('tool-')) {
              if (hideTools) return null;
              const toolPart = part as any;
              const name = toolPart.toolName ?? toolPart.type?.split('-').slice(1).join('-') ?? '';

              // Cadence tools
              if (name === 'run_cadence' || name === 'cadence_check' || name === 'cadence_hover'
                || name === 'cadence_definition' || name === 'cadence_symbols'
                || name === 'cadence_security_scan') {
                return (
                  <CadenceToolPart
                    key={i}
                    part={toolPart}
                    onInsertCode={onInsertCode}
                    onApplyCodeToFile={onApplyCodeToFile}
                  />
                );
              }
              // Editor tools (client-side)
              if (name === 'list_files' || name === 'read_file' || name === 'create_file'
                || name === 'update_file' || name === 'edit_file' || name === 'delete_file'
                || name === 'set_active_file') {
                const done = toolPart.state === 'output-available' || toolPart.state === 'result';
                const args = toolPart.input ?? toolPart.args ?? {};
                const filePath = args.path || '';

                const editorToolLabels: Record<string, string> = {
                  list_files: 'Listed project files',
                  read_file: `Read ${filePath}`,
                  create_file: `Created ${filePath}`,
                  update_file: `Updated ${filePath} (pending review)`,
                  edit_file: `Edited ${filePath} (pending review)`,
                  delete_file: `Deleted ${filePath}`,
                  set_active_file: `Switched to ${filePath}`,
                };
                const pendingLabels: Record<string, string> = {
                  list_files: 'Listing files...',
                  read_file: `Reading ${filePath}...`,
                  create_file: `Creating ${filePath}...`,
                  update_file: `Updating ${filePath}...`,
                  edit_file: `Editing ${filePath}...`,
                  delete_file: `Deleting ${filePath}...`,
                  set_active_file: `Switching to ${filePath}...`,
                };

                return (
                  <div key={i} className="flex items-center gap-2 py-1.5 px-2.5 my-1 text-[11px] text-zinc-500 bg-zinc-800/50 border border-zinc-700/50 rounded">
                    {!done ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : (
                      <Code size={10} className="text-emerald-400" />
                    )}
                    <span className="truncate">{done ? editorToolLabels[name] : pendingLabels[name]}</span>
                  </div>
                );
              }

              // SQL tools
              if (name === 'run_sql' || name === 'runSQL' || name === 'run_flowindex_sql' || name === 'run_evm_sql') {
                return <SqlToolPart key={i} part={toolPart} />;
              }
              // Chart
              if (name === 'createChart') return <ChartToolPart key={i} part={toolPart} />;

              // Friendly labels for known tools
              const toolLabels: Record<string, string> = {
                search_docs: 'Searching documentation',
                get_doc: 'Reading documentation',
                browse_docs: 'Browsing documentation',
                web_search: 'Searching the web',
                fetch_api: 'Fetching data',
                get_contract_source: 'Fetching contract source',
              };

              if (name in toolLabels) {
                const label = toolLabels[name];
                const done = toolPart.state === 'output-available' || toolPart.state === 'result';
                const err = toolPart.state === 'output-error';
                return (
                  <div key={i} className="flex items-center gap-2 py-1.5 px-2.5 my-1 text-[11px] text-zinc-500 bg-zinc-800/50 border border-zinc-700/50 rounded">
                    {!done && !err ? (
                      <Loader2 size={10} className="animate-spin" />
                    ) : err ? (
                      <X size={10} className="text-red-400" />
                    ) : (
                      <Check size={10} className="text-emerald-400" />
                    )}
                    <span className="truncate">{done ? `${label.replace(/ing /, 'ed ').replace('Searching', 'Searched').replace('Browsing', 'Browsed').replace('Fetching', 'Fetched').replace('Reading', 'Read')}` : `${label}...`}</span>
                  </div>
                );
              }

              // Generic tool fallback
              const toolDone = toolPart.state === 'output-available' || toolPart.state === 'result';
              const toolErr = toolPart.state === 'output-error';
              const toolOutput = toolDone ? toolPart.output : toolErr ? (toolPart.errorText || 'Tool call failed') : null;
              const toolInput = toolPart.input ?? toolPart.args;
              const hasDetails = toolInput || toolOutput;
              const friendlyName = name.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
              const inputSummary = toolInput
                ? typeof toolInput === 'string'
                  ? toolInput.slice(0, 60)
                  : (() => { const s = JSON.stringify(toolInput); return s.length > 80 ? s.slice(0, 77) + '...' : s; })()
                : '';
              const truncateOutput = (v: unknown) => {
                const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
                return s.length > 2000 ? s.slice(0, 2000) + '\n...[truncated]' : s;
              };

              return (
                <details key={i} className="my-1 rounded border border-zinc-700/50 overflow-hidden">
                  <summary className="flex items-center gap-2 py-1.5 px-2.5 text-[11px] text-zinc-400 bg-zinc-800/50 cursor-pointer hover:bg-zinc-800 select-none">
                    {!toolDone && !toolErr ? (
                      <Loader2 size={10} className="animate-spin flex-shrink-0" />
                    ) : toolErr ? (
                      <X size={10} className="text-red-400 flex-shrink-0" />
                    ) : (
                      <Check size={10} className="text-emerald-400 flex-shrink-0" />
                    )}
                    <span className="font-bold truncate">{friendlyName}</span>
                    {inputSummary && <span className="text-zinc-600 truncate ml-1 font-mono text-[10px]">{inputSummary}</span>}
                  </summary>
                  {hasDetails && (
                    <div className="px-3 py-2 text-[11px] font-mono space-y-1.5 bg-zinc-900 text-zinc-400 max-h-[200px] overflow-auto">
                      {toolInput && (
                        <div>
                          <span className="text-zinc-600">Input: </span>
                          <pre className="whitespace-pre-wrap break-words text-zinc-300">{typeof toolInput === 'string' ? toolInput : JSON.stringify(toolInput, null, 2)}</pre>
                        </div>
                      )}
                      {toolOutput && (
                        <div>
                          <span className="text-zinc-600">Output: </span>
                          <pre className={`whitespace-pre-wrap break-words ${toolErr ? 'text-red-400' : 'text-zinc-300'}`}>{truncateOutput(toolOutput)}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </details>
              );
            }

            return null;
          })}
        </div>
      </div>
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ── Preset Prompts ── */

const PRESET_PROMPTS = [
  { label: 'Create a Fungible Token', icon: Coins, prompt: 'Write a complete Cadence 1.0 Fungible Token contract that implements FungibleToken standard with mint, burn and transfer capabilities.' },
  { label: 'Create an NFT Collection', icon: Image, prompt: 'Write a complete Cadence 1.0 NFT contract that implements NonFungibleToken and MetadataViews standards with mint function and Display view.' },
  { label: 'Query an account balance', icon: Search, prompt: 'Write a Cadence script to query the FLOW token balance of any address using FungibleToken.Balance capability.' },
  { label: 'Send FLOW tokens', icon: SendHorizonal, prompt: 'Write a Cadence transaction to transfer FLOW tokens from the signer to a recipient address.' },
  { label: 'Fix my code', icon: Zap, prompt: 'Please review my current editor code, identify any issues, and provide the fixed version.' },
];

/* ── Mode Selector ── */

type ChatMode = 'fast' | 'balanced' | 'deep';
const CHAT_MODES: { key: ChatMode; label: string; icon: typeof Zap; desc: string; model: string }[] = [
  { key: 'fast', label: 'Fast', icon: Zap, desc: 'Quick answers', model: 'Haiku' },
  { key: 'balanced', label: 'Balanced', icon: Scale, desc: 'Better quality', model: 'Sonnet' },
  { key: 'deep', label: 'Deep', icon: Brain, desc: 'Extended thinking', model: 'Opus' },
];
const MODE_STORAGE_KEY = 'runner-chat-mode';
const AUTO_APPLY_STORAGE_KEY = 'runner-ai-auto-apply';

function getStoredMode(): ChatMode {
  try {
    const v = localStorage.getItem(MODE_STORAGE_KEY);
    if (v === 'fast' || v === 'balanced' || v === 'deep') return v;
  } catch { /* noop */ }
  return 'balanced';
}

function getStoredAutoApply(): boolean {
  try {
    const v = localStorage.getItem(AUTO_APPLY_STORAGE_KEY);
    if (v === null) return false;
    return v === 'true';
  } catch {
    return false;
  }
}

function parseFenceInfo(infoRaw: string): { language: string; meta?: string } {
  const info = infoRaw.trim();
  if (!info) return { language: '' };
  const tokens = info.split(/\s+/);
  const first = tokens[0];
  if (first.includes('=') || first.includes(':')) {
    return { language: '', meta: info };
  }
  return {
    language: first.toLowerCase(),
    meta: tokens.slice(1).join(' ') || undefined,
  };
}

/* ── SEARCH/REPLACE patch parsing ── */

function parseSearchReplacePatches(code: string): { search: string; replace: string }[] | null {
  const marker = '<<<<<<< SEARCH';
  if (!code.includes(marker)) return null;

  const patches: { search: string; replace: string }[] = [];
  const blocks = code.split(marker);

  for (let i = 1; i < blocks.length; i++) {
    const sepIdx = blocks[i].indexOf('\n=======\n');
    if (sepIdx < 0) continue;
    const endIdx = blocks[i].indexOf('\n>>>>>>> REPLACE', sepIdx);
    if (endIdx < 0) continue;

    const search = blocks[i].slice(0, sepIdx);
    const replace = blocks[i].slice(sepIdx + '\n=======\n'.length, endIdx);
    patches.push({ search, replace });
  }

  return patches.length > 0 ? patches : null;
}

function applySearchReplacePatches(existingCode: string, patches: { search: string; replace: string }[]): string {
  let result = existingCode;
  for (const { search, replace } of patches) {
    const idx = result.indexOf(search);
    if (idx >= 0) {
      result = result.slice(0, idx) + replace + result.slice(idx + search.length);
    }
  }
  return result;
}

function pushFenceEdit(
  edits: { path?: string; code: string; patches?: { search: string; replace: string }[] }[],
  infoRaw: string,
  codeRaw: string,
) {
  const { language, meta } = parseFenceInfo(infoRaw || '');
  const code = (codeRaw || '').replace(/\n$/, '');
  if (!code.trim()) return;

  const maybePath = resolveTargetPath(meta, language, code);
  const path = normalizePathCandidate(maybePath);

  const patches = parseSearchReplacePatches(code);

  if (path) {
    edits.push({ path, code: patches ? '' : code, ...(patches && { patches }) });
    return;
  }

  if (language === 'cadence' || language === 'cdc') {
    edits.push({ code: patches ? '' : code, ...(patches && { patches }) });
  }
}

function extractEditsFromText(text: string, allowPartialFence = false): FenceEdit[] {
  const edits: FenceEdit[] = [];
  const fenceRe = /```([^\n`]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = fenceRe.exec(text)) !== null) {
    pushFenceEdit(edits, match[1] || '', match[2] || '');
  }

  if (allowPartialFence) {
    const fenceCount = (text.match(/```/g) || []).length;
    if (fenceCount % 2 === 1) {
      const start = text.lastIndexOf('```');
      if (start >= 0) {
        const afterFence = text.slice(start + 3);
        const newline = afterFence.indexOf('\n');
        if (newline >= 0) {
          const infoRaw = afterFence.slice(0, newline);
          const partialCode = afterFence.slice(newline + 1);
          pushFenceEdit(edits, infoRaw, partialCode);
        }
      }
    }
  }

  return edits;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function extractEditsFromAssistantMessage(message: UIMessage, allowPartialFence = false): FenceEdit[] {
  const raw: FenceEdit[] = [];

  for (const part of message.parts as any[]) {
    if (part.type === 'text') {
      raw.push(...extractEditsFromText(part.text || '', allowPartialFence));
      continue;
    }

    if (part.type === 'tool-invocation' || String(part.type || '').startsWith('tool-') || part.type === 'dynamic-tool') {
      const toolName = part.toolName ?? String(part.type || '').split('-').slice(1).join('-');
      const isCadenceTool =
        toolName === 'run_cadence' ||
        toolName === 'cadence_check' ||
        toolName === 'cadence_hover' ||
        toolName === 'cadence_definition' ||
        toolName === 'cadence_symbols' ||
        toolName === 'cadence_security_scan';
      if (!isCadenceTool) continue;

      const script: string | undefined =
        part.input?.script ?? part.args?.script ?? part.input?.code ?? part.args?.code;
      if (!script || !script.trim()) continue;

      const explicitPath = normalizePathCandidate(part.input?.path ?? part.args?.path);
      const inferredPath = resolveTargetPath(undefined, 'cadence', script);
      const path = explicitPath || normalizePathCandidate(inferredPath);
      raw.push(path ? { path, code: script } : { code: script });
    }
  }

  // Keep only the latest edit per target (file path or active file)
  const deduped = new Map<string, FenceEdit>();
  for (const edit of raw) {
    deduped.set(edit.path || '__active__', edit);
  }
  return Array.from(deduped.values());
}

function editsSignature(edits: FenceEdit[]): string {
  if (edits.length === 0) return '';
  return edits
    .map((edit) => `${edit.path || '__active__'}\n${edit.patches ? JSON.stringify(edit.patches) : edit.code}`)
    .join('\n---\n');
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ── Mode Dropdown (custom, no shadcn) ── */

function ModeSelector({ mode, onChange }: { mode: ChatMode; onChange: (m: ChatMode) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = CHAT_MODES.find((m) => m.key === mode) || CHAT_MODES[0];
  const CurrentIcon = current.icon;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1 rounded text-[10px] uppercase tracking-widest font-bold transition-all bg-amber-500/10 border border-amber-500/30 text-amber-500 hover:bg-amber-500/20"
      >
        <CurrentIcon size={10} />
        {current.label}
        <ChevronUp size={8} className={`ml-0.5 opacity-60 transition-transform ${open ? '' : 'rotate-180'}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-0 mb-1.5 z-50 bg-zinc-900 border border-zinc-700 rounded shadow-xl p-1 min-w-[180px]"
          >
            <div className="text-[9px] uppercase tracking-widest text-zinc-600 px-2 py-1 font-bold">Model</div>
            <div className="h-px bg-zinc-800 my-0.5" />
            {CHAT_MODES.map(({ key, label, icon: Icon, desc, model }) => (
              <button
                key={key}
                onClick={() => { onChange(key); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded cursor-pointer transition-colors ${
                  mode === key ? 'bg-emerald-500/10 text-emerald-400' : 'text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                <Icon size={14} className="shrink-0" />
                <div className="flex flex-col min-w-0 text-left">
                  <span className="text-[12px] font-medium leading-tight">{label}</span>
                  <span className={`text-[10px] leading-tight ${mode === key ? 'text-emerald-400/60' : 'text-zinc-500'}`}>{model} · {desc}</span>
                </div>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Main Component ── */

export default function AIPanel({
  onInsertCode,
  onApplyCodeToFile,
  onAutoApplyEdits,
  onLoadTemplate,
  onCreateFile,
  onDeleteFile,
  onSetActiveFile,
  editorCode,
  projectFiles,
  activeFile,
  network,
  onClose,
  onAutoApproveChange,
  selectedSigner,
  signWithLocalKey,
  promptForPassword,
  localKeys,
  accountsMap,
  onCreateAccount,
  onRefreshAccounts,
  onSwitchNetwork,
  onViewAccount,
  pendingMessage,
  onPendingMessageConsumed,
}: AIPanelProps) {
  const [input, setInput] = useState('');
  const [chatMode, setChatMode] = useState<ChatMode>(getStoredMode);
  const [autoApply, setAutoApply] = useState<boolean>(getStoredAutoApply);
  const [hideTools, setHideTools] = useState(false);

  // Auto-approve toggle for transaction signing
  const [autoApprove, setAutoApprove] = useState(() => {
    try { return localStorage.getItem('flow-auto-approve') === 'true'; } catch { return false; }
  });

  const toggleAutoApprove = useCallback(() => {
    setAutoApprove(prev => {
      const next = !prev;
      try { localStorage.setItem('flow-auto-approve', String(next)); } catch { /* noop */ }
      onAutoApproveChange?.(next);
      return next;
    });
  }, [onAutoApproveChange]);

  // Notify parent of initial autoApprove value on mount
  useEffect(() => {
    onAutoApproveChange?.(autoApprove);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Pending approval dialog for flow_sign_and_send when auto-approve is OFF
  const [pendingApproval, setPendingApproval] = useState<{
    code: string;
    args?: Array<{ name: string; value: string }>;
    signer: Extract<SignerOption, { type: 'local' }>;
    onApprove: () => void;
    onReject: () => void;
  } | null>(null);

  function showSignApprovalDialog(opts: {
    code: string;
    args?: Array<{ name: string; value: string }>;
    signer: Extract<SignerOption, { type: 'local' }>;
  }): Promise<boolean> {
    return new Promise((resolve) => {
      setPendingApproval({
        ...opts,
        onApprove: () => { setPendingApproval(null); resolve(true); },
        onReject: () => { setPendingApproval(null); resolve(false); },
      });
    });
  }

  // Refs for signer props so onToolCall closure stays stable
  const selectedSignerRef = useRef(selectedSigner);
  selectedSignerRef.current = selectedSigner;
  const signWithLocalKeyRef = useRef(signWithLocalKey);
  signWithLocalKeyRef.current = signWithLocalKey;
  const promptForPasswordRef = useRef(promptForPassword);
  promptForPasswordRef.current = promptForPassword;
  const autoApproveRef = useRef(autoApprove);
  autoApproveRef.current = autoApprove;
  const localKeysRef = useRef(localKeys);
  localKeysRef.current = localKeys;
  const accountsMapRef = useRef(accountsMap);
  accountsMapRef.current = accountsMap;
  const onCreateAccountRef = useRef(onCreateAccount);
  onCreateAccountRef.current = onCreateAccount;
  const onRefreshAccountsRef = useRef(onRefreshAccounts);
  onRefreshAccountsRef.current = onRefreshAccounts;
  const onSwitchNetworkRef = useRef(onSwitchNetwork);
  onSwitchNetworkRef.current = onSwitchNetwork;
  // Keep module-level ref in sync for LinkedHex / inline code links
  _onViewAccount = onViewAccount;
  const [chatError, setChatError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stoppedAtRef = useRef(0);
  const appliedAssistantSignaturesRef = useRef<Map<string, string>>(new Map());

  const handleModeChange = useCallback((m: ChatMode) => {
    setChatMode(m);
    try { localStorage.setItem(MODE_STORAGE_KEY, m); } catch { /* noop */ }
  }, []);

  // Custom fetch: inject mode + editorCode + network
  const chatModeRef = useRef(chatMode);
  chatModeRef.current = chatMode;
  const editorCodeRef = useRef(editorCode);
  editorCodeRef.current = editorCode;
  const projectFilesRef = useRef(projectFiles);
  projectFilesRef.current = projectFiles;
  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile;
  const networkRef = useRef(network);
  networkRef.current = network;

  const safeFetch = useCallback(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.headers) {
      const headers = new Headers(init.headers);
      headers.delete('user-agent');
      init = { ...init, headers };
    }
    if (init?.body) {
      try {
        const parsed = JSON.parse(init.body as string);
        parsed.mode = chatModeRef.current;
        parsed.editorCode = editorCodeRef.current || '';
        parsed.network = networkRef.current || 'mainnet';
        parsed.activeFile = activeFileRef.current || '';
        parsed.projectFiles = (projectFilesRef.current || [])
          .filter((f) => !f.readOnly)
          .map((f) => ({ path: f.path, content: f.content }));
        init = { ...init, body: JSON.stringify(parsed) };
      } catch { /* not JSON, skip */ }
    }
    return globalThis.fetch(url, init);
  }, []);

  const transport = useMemo(
    () => new DefaultChatTransport({
      api: `${AI_CHAT_URL}/api/runner-chat`,
      credentials: 'omit',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetch: safeFetch as any,
    }),
    [safeFetch],
  );

  // Stable refs for onToolCall callbacks
  const onCreateFileRef = useRef(onCreateFile);
  onCreateFileRef.current = onCreateFile;
  const onDeleteFileRef = useRef(onDeleteFile);
  onDeleteFileRef.current = onDeleteFile;
  const onSetActiveFileRef = useRef(onSetActiveFile);
  onSetActiveFileRef.current = onSetActiveFile;
  const onAutoApplyEditsRef = useRef(onAutoApplyEdits);
  onAutoApplyEditsRef.current = onAutoApplyEdits;

  const { messages, sendMessage, status, stop, setMessages, addToolOutput } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async onToolCall({ toolCall }: { toolCall: any }) {
      if (toolCall.dynamic) return;

      const id = toolCall.toolCallId;
      const name = toolCall.toolName;
      const args = toolCall.input ?? {};

      // Schedule addToolOutput via setTimeout to avoid deadlock —
      // onToolCall runs inside the stream job executor lock,
      // and addToolOutput also needs that lock.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const emit = (output: any) => {
        setTimeout(() => addToolOutput({ tool: name, toolCallId: id, output }), 0);
      };
      const emitError = (errorText: string) => {
        setTimeout(() => addToolOutput({ tool: name, toolCallId: id, state: 'output-error' as const, errorText } as any), 0);
      };

      switch (name) {
        case 'list_files': {
          const files = (projectFilesRef.current || [])
            .filter((f: { readOnly?: boolean }) => !f.readOnly)
            .map((f: { path: string; content: string }) => ({ path: f.path, size: f.content.length }));
          emit({ files });
          return;
        }
        case 'read_file': {
          const file = (projectFilesRef.current || []).find(
            (f: { path: string }) => f.path === args.path,
          );
          if (file) emit({ content: file.content });
          else emitError(`File not found: ${args.path}`);
          return;
        }
        case 'create_file': {
          onCreateFileRef.current?.(args.path, args.content);
          emit({ success: true, path: args.path });
          return;
        }
        case 'update_file': {
          onAutoApplyEditsRef.current?.([{ path: args.path, code: args.content }]);
          emit({ success: true, message: 'Diff pending user review' });
          return;
        }
        case 'edit_file': {
          onAutoApplyEditsRef.current?.([{ path: args.path, code: '', patches: args.patches }]);
          emit({ success: true, message: 'Diff pending user review' });
          return;
        }
        case 'delete_file': {
          onDeleteFileRef.current?.(args.path);
          emit({ success: true });
          return;
        }
        case 'set_active_file': {
          onSetActiveFileRef.current?.(args.path);
          emit({ success: true });
          return;
        }
        case 'get_wallet_info': {
          const signer = selectedSignerRef.current;
          if (signer && signer.type === 'local') {
            emit({
              connected: true,
              type: 'local',
              address: signer.account.flowAddress,
              keyLabel: signer.key.label,
              keyId: signer.key.id,
              keyIndex: signer.account.keyIndex,
              sigAlgo: signer.account.sigAlgo,
              hashAlgo: signer.account.hashAlgo,
              network: networkRef.current || 'mainnet',
            });
          } else {
            emit({ connected: false, network: networkRef.current || 'mainnet' });
          }
          return;
        }
        case 'list_local_keys': {
          const keys = (localKeysRef.current || []).map((k) => ({
            id: k.id,
            label: k.label,
            source: k.source,
            publicKeyP256: k.publicKeyP256,
            publicKeySecp256k1: k.publicKeySecp256k1,
            hasPassword: k.hasPassword,
            accounts: (accountsMapRef.current || {})[k.id] || [],
          }));
          emit({ keys });
          return;
        }
        case 'create_flow_account': {
          if (!onCreateAccountRef.current) {
            emitError('Account creation not available.');
            return;
          }
          try {
            const net = (args.network || networkRef.current || 'mainnet') as FlowNetwork;
            if (net === 'emulator') {
              emitError('Account creation is not supported on emulator.');
              return;
            }
            const result = await onCreateAccountRef.current(
              args.keyId,
              'ECDSA_secp256k1',
              'SHA3_256',
              net,
            );
            emit({ success: true, txId: result.txId, network: net });
          } catch (e: any) {
            emitError(e.message || 'Failed to create account');
          }
          return;
        }
        case 'refresh_accounts': {
          if (!onRefreshAccountsRef.current) {
            emitError('Account refresh not available.');
            return;
          }
          try {
            const net = (args.network || networkRef.current || 'mainnet') as FlowNetwork;
            if (net === 'emulator') {
              emitError('Account refresh is not supported on emulator.');
              return;
            }
            const accounts = await onRefreshAccountsRef.current(args.keyId, net);
            emit({ accounts });
          } catch (e: any) {
            emitError(e.message || 'Failed to refresh accounts');
          }
          return;
        }
        case 'sign_message': {
          if (!signWithLocalKeyRef.current) {
            emitError('Local key signing not available.');
            return;
          }
          try {
            const signature = await signWithLocalKeyRef.current(
              args.keyId,
              args.message,
              args.hashAlgo || 'SHA3_256',
              undefined,
              args.sigAlgo || 'ECDSA_secp256k1',
            );
            emit({ signature });
          } catch (e: any) {
            if (e.message === 'PASSWORD_REQUIRED' && promptForPasswordRef.current) {
              try {
                const key = (localKeysRef.current || []).find((k) => k.id === args.keyId);
                const pw = await promptForPasswordRef.current(key?.label || 'key');
                const signature = await signWithLocalKeyRef.current!(
                  args.keyId,
                  args.message,
                  args.hashAlgo || 'SHA3_256',
                  pw,
                  args.sigAlgo || 'ECDSA_secp256k1',
                );
                emit({ signature });
              } catch (e2: any) {
                emitError(e2.message || 'Failed to sign message');
              }
            } else {
              emitError(e.message || 'Failed to sign message');
            }
          }
          return;
        }
        case 'switch_network': {
          if (!onSwitchNetworkRef.current) {
            emitError('Network switching not available.');
            return;
          }
          onSwitchNetworkRef.current(args.network);
          emit({ success: true, network: args.network });
          return;
        }
        case 'flow_sign_and_send': {
          const { code, args: txArgs, network: txNetwork } = args as {
            code: string;
            args?: Array<{ name: string; value: string }>;
            network?: FlowNetwork;
          };

          const signer = selectedSignerRef.current;
          if (!signer || signer.type !== 'local') {
            emit({ error: 'No local key selected. Please select a local key signer.' });
            return;
          }

          if (!signWithLocalKeyRef.current) {
            emit({ error: 'Local key signing not available.' });
            return;
          }

          // If auto-approve is OFF, show approval dialog
          if (!autoApproveRef.current) {
            const approved = await showSignApprovalDialog({ code, args: txArgs, signer });
            if (!approved) {
              emit({ error: 'User rejected the transaction.' });
              return;
            }
          }

          // Execute transaction
          try {
            const { key, account } = signer;
            const paramValues: Record<string, string> = {};
            if (txArgs) for (const a of txArgs) paramValues[a.name] = a.value;

            let finalResult: any;
            await executeCustodialTransaction(
              code,
              paramValues,
              account.flowAddress,
              account.keyIndex,
              async (message: string) => {
                try {
                  return await signWithLocalKeyRef.current!(key.id, message, account.hashAlgo, undefined, account.sigAlgo);
                } catch (e: any) {
                  if (e.message === 'PASSWORD_REQUIRED') {
                    const pw = await promptForPasswordRef.current!(key.label);
                    return signWithLocalKeyRef.current!(key.id, message, account.hashAlgo, pw, account.sigAlgo);
                  }
                  throw e;
                }
              },
              (r) => { finalResult = r; },
            );

            emit(finalResult ?? { success: true });
          } catch (e: any) {
            emit({ error: e.message });
          }
          return;
        }
      }
    },
    onError: (error) => {
      console.error('[AIPanel] streaming error:', error);
      setChatError(error?.message || 'Failed to get response. Please try again.');
    },
  });

  const isStreaming = status === 'streaming' || status === 'submitted';

  // Extract token usage from the last assistant message's metadata
  const lastUsage = useMemo((): LanguageModelUsage | null => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const metadata = (msg as any).metadata as { usage?: LanguageModelUsage; model?: string } | undefined;
      if (msg.role === 'assistant' && metadata?.usage) {
        return metadata.usage;
      }
    }
    return null;
  }, [messages]);

  const handleStop = useCallback(() => {
    stoppedAtRef.current = Date.now();
    stop();
  }, [stop]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    try { localStorage.setItem(AUTO_APPLY_STORAGE_KEY, String(autoApply)); } catch { /* noop */ }
  }, [autoApply]);

  // Fallback: extract edits from code blocks in text ONLY after streaming finishes.
  // Tool-based edits (update_file, edit_file) are handled by onToolCall above.
  useEffect(() => {
    if (!autoApply || !onAutoApplyEdits) return;
    if (status !== 'ready') return;

    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;

    const edits = extractEditsFromAssistantMessage(last, false);
    if (edits.length === 0) return;

    const signature = editsSignature(edits);
    if (!signature) return;
    const prevSignature = appliedAssistantSignaturesRef.current.get(last.id);
    if (prevSignature === signature) return;
    appliedAssistantSignaturesRef.current.set(last.id, signature);

    onAutoApplyEdits(edits, { assistantId: last.id });
  }, [messages, status, autoApply, onAutoApplyEdits]);

  const handleSend = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;
    if (Date.now() - stoppedAtRef.current < 300) return;
    setChatError(null);
    sendMessage({ text });
    setInput('');
  }, [sendMessage, isStreaming]);

  // Auto-send external pending message (e.g. "Fix with AI" from codegen)
  useEffect(() => {
    if (!pendingMessage || isStreaming) return;
    handleSend(pendingMessage);
    onPendingMessageConsumed?.();
  }, [pendingMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend(input);
    }
  };

  const handleClear = () => {
    appliedAssistantSignaturesRef.current.clear();
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900 min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <Sparkles size={11} className="text-emerald-400" />
          </div>
          <div>
            <h3 className="text-[11px] font-bold text-white uppercase tracking-widest">AI Assistant</h3>
            <p className="text-[9px] text-zinc-500 uppercase tracking-widest">Cadence & Flow</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors rounded hover:bg-zinc-800"
              title="Clear chat"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors rounded hover:bg-zinc-800"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 min-h-0">
        {messages.length === 0 ? (
          <div className="space-y-4 mt-2">
            {/* Welcome */}
            <div className="text-center space-y-1.5">
              <div className="relative inline-block">
                <div className="absolute inset-0 blur-xl opacity-20 bg-emerald-400 rounded-full scale-150" />
                <Sparkles className="w-6 h-6 text-emerald-400 relative" />
              </div>
              <p className="text-xs text-zinc-300 font-medium">What would you like to build?</p>
              <p className="text-[10px] text-zinc-600">I can see your editor code and help you write Cadence.</p>
            </div>

            {/* Preset prompts */}
            <div className="space-y-1.5">
              {PRESET_PROMPTS.map((preset) => {
                const Icon = preset.icon;
                return (
                  <button
                    key={preset.label}
                    onClick={() => handleSend(preset.prompt)}
                    className="flex items-center gap-2 w-full px-2.5 py-2 rounded-lg bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/50 hover:border-zinc-600 text-left transition-colors group"
                  >
                    <Icon className="w-3.5 h-3.5 text-emerald-500/70 group-hover:text-emerald-400 shrink-0" />
                    <span className="text-[11px] text-zinc-400 group-hover:text-zinc-200">{preset.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Templates */}
            <div className="pt-2 border-t border-zinc-800">
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium mb-2 px-1">Templates</p>
              <div className="grid grid-cols-2 gap-1.5">
                {getTemplates((network || 'mainnet') as FlowNetwork).map((template) => (
                  <button
                    key={template.label}
                    onClick={() => onLoadTemplate(template)}
                    className="flex flex-col gap-0.5 px-2 py-1.5 rounded-md bg-zinc-800/40 hover:bg-zinc-800 border border-zinc-700/30 hover:border-zinc-600 text-left transition-colors"
                    title={template.description}
                  >
                    <span className="text-[10px] text-zinc-300 font-medium leading-tight">{template.label}</span>
                    <span className="text-[9px] text-zinc-600 leading-tight truncate">{template.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                hideTools={hideTools}
                isStreamingMsg={isStreaming && idx === messages.length - 1 && msg.role === 'assistant'}
                onInsertCode={onInsertCode}
                onApplyCodeToFile={onApplyCodeToFile}
              />
            ))}
            {isStreaming && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
              <div className="flex items-center gap-2 mb-3">
                <div className="w-5 h-5 rounded bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <Bot size={11} className="text-emerald-400" />
                </div>
                <Loader2 size={14} className="animate-spin text-zinc-400" />
              </div>
            )}
            {chatError && (
              <div className="mb-3 px-3 py-2 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                {chatError}
                <button onClick={() => setChatError(null)} className="ml-2 underline">Dismiss</button>
              </div>
            )}
            {/* Transaction approval dialog */}
            {pendingApproval && (
              <div className="mx-4 my-2 p-4 border border-yellow-500/30 bg-yellow-500/10 rounded-lg">
                <h4 className="font-medium text-yellow-400 text-sm mb-2">Transaction Approval Required</h4>
                <pre className="text-xs bg-zinc-900 p-2 rounded mb-2 max-h-40 overflow-auto whitespace-pre-wrap">
                  {pendingApproval.code}
                </pre>
                {pendingApproval.args && pendingApproval.args.length > 0 && (
                  <div className="text-xs text-zinc-400 mb-2">
                    Args: {pendingApproval.args.map(a => `${a.name}=${a.value}`).join(', ')}
                  </div>
                )}
                <p className="text-xs text-zinc-400 mb-3">
                  Signer: {pendingApproval.signer.account.flowAddress} (key #{pendingApproval.signer.account.keyIndex})
                </p>
                <div className="flex gap-2">
                  <button onClick={pendingApproval.onApprove} className="px-3 py-1 bg-green-600 hover:bg-green-500 rounded text-sm text-white transition-colors">
                    Approve
                  </button>
                  <button onClick={pendingApproval.onReject} className="px-3 py-1 bg-red-600 hover:bg-red-500 rounded text-sm text-white transition-colors">
                    Reject
                  </button>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-zinc-700 px-3 py-2">
        <form onSubmit={(e) => { e.preventDefault(); if (!isStreaming) handleSend(input); }}>
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about Cadence..."
              rows={2}
              className="flex-1 min-w-0 resize-none text-[12px] bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/40 transition-colors"
              style={{ maxHeight: '100px' }}
            />
            {lastUsage && (
              <ContextUsageIndicator
                usage={lastUsage}
                maxTokens={CONTEXT_WINDOW}
                modelLabel={CHAT_MODES.find((m) => m.key === chatMode)?.model || 'Claude'}
              />
            )}
            {isStreaming ? (
              <button
                type="button"
                onClick={handleStop}
                className="self-stretch w-9 flex items-center justify-center bg-zinc-700 text-zinc-300 rounded hover:bg-zinc-600 transition-colors shrink-0"
                title="Stop"
              >
                <Square size={14} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="self-stretch w-9 flex items-center justify-center bg-emerald-600 text-white rounded hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 transition-all shrink-0"
                title="Send"
              >
                <Send size={14} />
              </button>
            )}
          </div>
        </form>

        {/* Bottom controls */}
        <div className="flex items-center gap-1.5 mt-1.5">
          <ModeSelector mode={chatMode} onChange={handleModeChange} />
          <button
            type="button"
            onClick={() => setHideTools((v) => !v)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] uppercase tracking-widest font-bold transition-all ${
              hideTools
                ? 'bg-zinc-600/20 border border-zinc-600/40 text-zinc-500'
                : 'text-zinc-500 hover:text-zinc-300 border border-transparent hover:border-zinc-700'
            }`}
            title={hideTools ? 'Show tool calls' : 'Hide tool calls'}
          >
            {hideTools ? <EyeOff size={10} /> : <Eye size={10} />}
            Tools
          </button>
          {/* Auto-approve toggle for transaction signing */}
          <button
            type="button"
            onClick={toggleAutoApprove}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] uppercase tracking-widest font-bold transition-all ${
              autoApprove
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
            }`}
            title={autoApprove ? 'Auto-approve ON: transactions sign automatically' : 'Auto-approve OFF: manual approval required'}
          >
            {autoApprove ? <ShieldCheck size={10} /> : <ShieldOff size={10} />}
            Auto
          </button>
          {/* MCP indicator */}
          <div className="relative group/mcp">
            <button
              type="button"
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] uppercase tracking-widest font-bold text-zinc-500 hover:text-zinc-300 border border-transparent hover:border-zinc-700 transition-all"
              title="Connected MCP tools"
            >
              <Wrench size={10} />
              MCP
            </button>
            <div className="absolute bottom-full left-0 mb-1.5 hidden group-hover/mcp:block z-50">
              <div className="bg-zinc-900 border border-zinc-700 rounded shadow-xl p-2.5 w-52">
                <p className="text-[9px] uppercase tracking-widest font-bold text-zinc-500 mb-2">Connected Tools</p>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Code size={10} className="text-purple-400 shrink-0" />
                    <span className="text-[11px] text-zinc-300">Cadence Check & Docs</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Sparkles size={10} className="text-purple-400 shrink-0" />
                    <span className="text-[11px] text-zinc-300">Security Scanner</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Search size={10} className="text-amber-400 shrink-0" />
                    <span className="text-[11px] text-zinc-300">Documentation Search</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Database size={10} className="text-emerald-400 shrink-0" />
                    <span className="text-[11px] text-zinc-300">Contract Source</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

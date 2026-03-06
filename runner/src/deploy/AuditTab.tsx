// ---------------------------------------------------------------------------
// AuditTab — AI-powered contract security audit with inline annotations
// Uses streaming AI (Opus 4.6 + thinking) via /api/runner-audit endpoint
// Raw SSE parsing for reliable stream completion (useChat hangs with MCP tools)
// Google Docs-style comment sidebar + highlighted code lines
// ---------------------------------------------------------------------------

import { useState, useMemo, useCallback, useRef, memo } from 'react';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Info,
  XCircle,
  Loader2,
  Play,
  Sparkles,
  Wrench,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useShikiHighlighter, highlightCode } from '../hooks/useShiki';
import { AnimatedMarkdown } from '@outblock/flowtoken';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Severity = 'high' | 'medium' | 'low' | 'info' | 'error' | 'warning';

export interface AuditFinding {
  id: string;
  severity: Severity;
  line: number;
  column?: number;
  rule?: string;
  message: string;
  suggestion?: string;
  source: 'security' | 'typecheck' | 'best-practice' | 'ai-review';
}

interface Props {
  code: string;
  contractName: string;
  network: string;
}

type AuditStatus = 'idle' | 'connecting' | 'streaming' | 'done' | 'error';

interface ToolCallInfo {
  name: string;
  done: boolean;
  output?: string;
}

// Ordered stream parts — rendered sequentially as they arrive
type StreamPart =
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool'; toolCallId: string; name: string; done: boolean; output?: string; inputChars: number; inputReady: boolean };

// ---------------------------------------------------------------------------
// Severity config
// ---------------------------------------------------------------------------

const SEVERITY_CONFIG: Record<Severity, {
  icon: typeof ShieldAlert;
  color: string;
  bg: string;
  border: string;
  label: string;
  gutterBg: string;
  lineBg: string;
}> = {
  high: {
    icon: ShieldAlert,
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    label: 'High',
    gutterBg: 'bg-red-500/20',
    lineBg: 'bg-red-500/8',
  },
  error: {
    icon: XCircle,
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    label: 'Error',
    gutterBg: 'bg-red-500/20',
    lineBg: 'bg-red-500/8',
  },
  medium: {
    icon: AlertTriangle,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    label: 'Medium',
    gutterBg: 'bg-amber-500/20',
    lineBg: 'bg-amber-500/8',
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    label: 'Warning',
    gutterBg: 'bg-amber-500/20',
    lineBg: 'bg-amber-500/8',
  },
  low: {
    icon: Info,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    label: 'Low',
    gutterBg: 'bg-blue-500/20',
    lineBg: 'bg-blue-500/8',
  },
  info: {
    icon: Info,
    color: 'text-zinc-400',
    bg: 'bg-zinc-500/10',
    border: 'border-zinc-500/30',
    label: 'Info',
    gutterBg: 'bg-zinc-500/20',
    lineBg: 'bg-zinc-500/8',
  },
};

const SOURCE_LABELS: Record<string, { label: string; className: string }> = {
  security: { label: 'Security Scan', className: 'bg-purple-500/10 text-purple-400' },
  typecheck: { label: 'Type Check', className: 'bg-blue-500/10 text-blue-400' },
  'best-practice': { label: 'Best Practice', className: 'bg-teal-500/10 text-teal-400' },
  'ai-review': { label: 'AI Review', className: 'bg-amber-500/10 text-amber-400' },
};

// ---------------------------------------------------------------------------
// Markdown components for audit output (dark theme, compact)
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
const auditMarkdownComponents: Record<string, any> = {
  h1: ({ children }: any) => <h1 className="text-xs font-bold text-white mt-2 mb-1">{children}</h1>,
  h2: ({ children }: any) => <h2 className="text-[11px] font-bold text-white mt-2 mb-1">{children}</h2>,
  h3: ({ children }: any) => <h3 className="text-[11px] font-semibold text-zinc-200 mt-1.5 mb-0.5">{children}</h3>,
  p: ({ children }: any) => <p className="mb-1.5 last:mb-0">{children}</p>,
  strong: ({ children }: any) => <strong className="font-bold text-white">{children}</strong>,
  em: ({ children }: any) => <em className="italic">{children}</em>,
  ul: ({ children }: any) => <ul className="ml-3 mb-1.5 space-y-0.5">{children}</ul>,
  ol: ({ children }: any) => <ol className="ml-3 mb-1.5 space-y-0.5 list-decimal list-inside">{children}</ol>,
  li: ({ children }: any) => (
    <li className="flex gap-1.5">
      <span className="text-emerald-500 shrink-0 mt-[1px]">-</span>
      <span className="flex-1">{children}</span>
    </li>
  ),
  code: ({ className, children }: any) => {
    const match = /language-(\w+)/.exec(className || '');
    const codeString = String(children).replace(/\n$/, '');
    if (match || codeString.includes('\n')) {
      return <pre className="bg-zinc-950/70 rounded p-2 my-1 overflow-x-auto"><code className="text-[10px] font-mono text-zinc-300">{codeString}</code></pre>;
    }
    return <code className="text-[10px] bg-zinc-700/60 px-1 py-0.5 rounded font-mono text-purple-400">{children}</code>;
  },
  pre: ({ children }: any) => <>{children}</>,
};

const auditAnimatedComponents: Record<string, any> = {
  h1: ({ animateText, children }: any) => <h1 className="text-xs font-bold text-white mt-2 mb-1">{animateText(children)}</h1>,
  h2: ({ animateText, children }: any) => <h2 className="text-[11px] font-bold text-white mt-2 mb-1">{animateText(children)}</h2>,
  h3: ({ animateText, children }: any) => <h3 className="text-[11px] font-semibold text-zinc-200 mt-1.5 mb-0.5">{animateText(children)}</h3>,
  p: ({ animateText, children }: any) => <p className="mb-1.5 last:mb-0">{animateText(children)}</p>,
  strong: ({ animateText, children }: any) => <strong className="font-bold text-white">{animateText(children)}</strong>,
  em: ({ animateText, children }: any) => <em className="italic">{animateText(children)}</em>,
  ul: ({ children }: any) => <ul className="ml-3 mb-1.5 space-y-0.5">{children}</ul>,
  ol: ({ children }: any) => <ol className="ml-3 mb-1.5 space-y-0.5 list-decimal list-inside">{children}</ol>,
  li: ({ animateText, children }: any) => (
    <li className="flex gap-1.5">
      <span className="text-emerald-500 shrink-0 mt-[1px]">-</span>
      <span className="flex-1">{animateText(children)}</span>
    </li>
  ),
  code: ({ className, children }: any) => {
    const match = /language-(\w+)/.exec(className || '');
    const codeString = String(children).replace(/\n$/, '');
    if (match || codeString.includes('\n')) {
      return <pre className="bg-zinc-950/70 rounded p-2 my-1 overflow-x-auto"><code className="text-[10px] font-mono text-zinc-300">{codeString}</code></pre>;
    }
    return <code className="text-[10px] bg-zinc-700/60 px-1 py-0.5 rounded font-mono text-purple-400">{children}</code>;
  },
  pre: ({ children }: any) => <>{children}</>,
};
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Parse structured JSON from AI response text
// ---------------------------------------------------------------------------

function parseAuditResponse(text: string): { findings: AuditFinding[]; summary?: string; score?: string } | null {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*"findings"[\s\S]*\})/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[1].trim());
    if (!parsed.findings || !Array.isArray(parsed.findings)) return null;

    const validSeverities = new Set(['high', 'medium', 'low', 'info', 'error', 'warning']);
    const findings: AuditFinding[] = parsed.findings
      .filter((f: any) => f.line && f.message)
      .map((f: any, i: number) => ({
        id: `finding-${i}`,
        severity: validSeverities.has(f.severity) ? f.severity : 'info',
        line: f.line,
        column: f.column || undefined,
        rule: f.rule || undefined,
        message: f.message,
        suggestion: f.suggestion || undefined,
        source: f.source || 'ai-review',
      }));

    findings.sort((a, b) => a.line - b.line);
    return { findings, summary: parsed.summary, score: parsed.score };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AI Chat URL
// ---------------------------------------------------------------------------

const AI_CHAT_URL = import.meta.env.VITE_AI_CHAT_URL || 'https://ai.flowindex.io';

// ---------------------------------------------------------------------------
// Tool name labels
// ---------------------------------------------------------------------------

function formatToolName(name: string): string {
  const labels: Record<string, string> = {
    cadence_security_scan: 'Security Scan',
    cadence_check: 'Type Check',
    cadence_hover: 'Hover Info',
    cadence_symbols: 'Symbols',
    cadence_definition: 'Definition',
    search_docs: 'Doc Search',
    get_doc: 'Read Doc',
    browse_docs: 'Browse Docs',
  };
  return labels[name] || name;
}

function stripLineWrapper(html: string): string {
  return html.replace(/^<span class="line">/, '').replace(/<\/span>$/, '');
}

// ---------------------------------------------------------------------------
// CodePanel — clean code with syntax highlighting, line numbers, gutter marks
// No inline annotations — findings are shown in the positioned sidebar
// ---------------------------------------------------------------------------

const LINE_HEIGHT = 20; // px — must match the rendered line height

const CodePanel = memo(function CodePanel({
  code,
  highlightedLines,
  findings,
  selectedId,
  onSelectFinding,
}: {
  code: string;
  highlightedLines: string[] | null;
  findings: AuditFinding[];
  selectedId: string | null;
  onSelectFinding: (findingId: string) => void;
}) {
  const codeLines = useMemo(() => code.split('\n'), [code]);

  const lineFindings = useMemo(() => {
    const map = new Map<number, AuditFinding[]>();
    for (const f of findings) {
      const arr = map.get(f.line) || [];
      arr.push(f);
      map.set(f.line, arr);
    }
    return map;
  }, [findings]);

  return (
    <div className="font-mono text-xs">
      {codeLines.map((line, i) => {
        const lineNum = i + 1;
        const lf = lineFindings.get(lineNum);
        const has = !!lf;
        const isSel = lf?.some(f => f.id === selectedId);
        const sevOrder: Severity[] = ['high', 'error', 'medium', 'warning', 'low', 'info'];
        const topSev = lf ? sevOrder.find(s => lf.some(f => f.severity === s)) || 'info' : null;
        const cfg = topSev ? SEVERITY_CONFIG[topSev] : null;

        return (
          <div
            key={lineNum}
            style={{ height: LINE_HEIGHT }}
            className={`flex items-center cursor-default transition-colors ${
              isSel ? `${cfg?.lineBg || ''} ring-1 ring-inset ${cfg?.border || 'ring-zinc-700'}`
                : has ? `${cfg?.lineBg || ''} hover:brightness-125`
                  : 'hover:bg-zinc-800/30'
            }`}
            onClick={() => { if (lf?.[0]) onSelectFinding(lf[0].id); }}
          >
            <div className={`w-1 shrink-0 self-stretch ${has ? cfg?.gutterBg || '' : ''}`} />
            <span className={`inline-block w-10 text-right pr-3 select-none shrink-0 text-[11px] ${
              has ? cfg?.color || 'text-zinc-600' : 'text-zinc-600'
            }`}>{lineNum}</span>
            <span className="flex-1 whitespace-pre pl-1 pr-4 overflow-hidden text-ellipsis">
              {highlightedLines?.[i]
                ? <span dangerouslySetInnerHTML={{ __html: stripLineWrapper(highlightedLines[i]) }} />
                : <span className="text-zinc-300">{line}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
});

// ---------------------------------------------------------------------------
// AuditTab — raw SSE fetch for reliable stream completion
// (useChat hangs indefinitely with server-side MCP dynamic tools)
// ---------------------------------------------------------------------------

export default function AuditTab({ code, contractName, network }: Props) {
  const highlighter = useShikiHighlighter();

  const [status, setStatus] = useState<AuditStatus>('idle');
  const [findings, setFindings] = useState<AuditFinding[]>([]);
  const [summary, setSummary] = useState('');
  const [score, setScore] = useState('');
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Ordered stream parts — rendered sequentially as they arrive
  const [streamParts, setStreamParts] = useState<StreamPart[]>([]);

  // Refs for accumulation (avoid re-render per delta)
  const partsRef = useRef<StreamPart[]>([]);
  const fullTextRef = useRef(''); // accumulates all text-delta for JSON parsing
  const abortRef = useRef<AbortController | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Rule filter: users can hide specific rule types (e.g., unsafe-force-unwrap)
  const [hiddenRules, setHiddenRules] = useState<Set<string>>(new Set());

  // Helper: get or create the last part of a given kind
  const getOrCreatePart = (kind: 'thinking' | 'text'): { kind: 'thinking' | 'text'; text: string } => {
    const parts = partsRef.current;
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) return last as { kind: 'thinking' | 'text'; text: string };
    const newPart = { kind, text: '' } as { kind: 'thinking' | 'text'; text: string };
    parts.push(newPart);
    return newPart;
  };

  // Run audit — raw SSE fetch
  const runAudit = useCallback(async () => {
    if (!code) return;

    // Reset all state
    setFindings([]);
    setSummary('');
    setScore('');
    setSelectedId(null);
    setThinkingExpanded(false);
    setStreamParts([]);
    partsRef.current = [];
    fullTextRef.current = '';

    // Abort previous request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('connecting');

    try {
      const res = await fetch(`${AI_CHAT_URL}/api/runner-audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{
            id: crypto.randomUUID(),
            role: 'user' as const,
            parts: [{
              type: 'text' as const,
              text: 'Audit this Cadence contract for security vulnerabilities, type errors, and best practice violations. Run all available MCP tools first, then provide your comprehensive analysis.',
            }],
          }],
          code,
          contractName,
          network,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        console.error('[audit] HTTP error:', res.status);
        setStatus('error');
        return;
      }

      setStatus('streaming');

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Throttle UI updates via requestAnimationFrame
      let rafId: number | null = null;
      const scheduleUpdate = () => {
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          // Snapshot current parts array for React
          setStreamParts([...partsRef.current]);
        });
      };

      // Map toolCallId → index in partsRef for in-place updates
      const toolIndexMap = new Map<string, number>();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') continue;

          try {
            const evt = JSON.parse(data);
            // Log every event type except high-frequency deltas
            if (!['reasoning-delta', 'text-delta', 'tool-input-delta'].includes(evt.type)) {
              console.log('[audit] event:', evt.type, evt.toolCallId || '', evt.toolName || '', evt.output ? `output:${JSON.stringify(evt.output).slice(0, 120)}` : '');
            }
            switch (evt.type) {
              case 'reasoning-delta': {
                const part = getOrCreatePart('thinking');
                part.text += evt.delta || '';
                scheduleUpdate();
                break;
              }

              case 'text-delta': {
                const delta = evt.delta || '';
                fullTextRef.current += delta;
                const part = getOrCreatePart('text');
                part.text += delta;
                scheduleUpdate();
                break;
              }

              case 'tool-input-start': {
                console.log('[audit] tool-input-start', evt.toolCallId, evt.toolName);
                const toolPart: StreamPart = {
                  kind: 'tool',
                  toolCallId: evt.toolCallId,
                  name: evt.toolName,
                  done: false,
                  inputChars: 0,
                  inputReady: false,
                };
                partsRef.current.push(toolPart);
                toolIndexMap.set(evt.toolCallId, partsRef.current.length - 1);
                scheduleUpdate();
                break;
              }

              case 'tool-input-delta': {
                // Track input streaming progress
                const tidx = toolIndexMap.get(evt.toolCallId);
                if (tidx !== undefined) {
                  const tp = partsRef.current[tidx] as Extract<StreamPart, { kind: 'tool' }>;
                  tp.inputChars += (evt.inputTextDelta || '').length;
                  scheduleUpdate();
                }
                break;
              }

              case 'tool-input-available': {
                console.log('[audit] tool-input-available', evt.toolCallId, evt.toolName);
                const tidx2 = toolIndexMap.get(evt.toolCallId);
                if (tidx2 !== undefined) {
                  const tp = partsRef.current[tidx2] as Extract<StreamPart, { kind: 'tool' }>;
                  tp.inputReady = true;
                } else {
                  const toolPart: StreamPart = {
                    kind: 'tool',
                    toolCallId: evt.toolCallId,
                    name: evt.toolName,
                    done: false,
                    inputChars: 0,
                    inputReady: true,
                  };
                  partsRef.current.push(toolPart);
                  toolIndexMap.set(evt.toolCallId, partsRef.current.length - 1);
                }
                // Force immediate update — important state change
                if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
                setStreamParts([...partsRef.current]);
                break;
              }

              case 'tool-output-available': {
                let outputText = '';
                if (evt.output?.content) {
                  for (const p of evt.output.content) {
                    if (p.type === 'text' && p.text) outputText += p.text;
                  }
                } else if (typeof evt.output === 'string') {
                  outputText = evt.output;
                }
                console.log('[audit] tool-output-available', evt.toolCallId, 'output length:', outputText.length, 'preview:', outputText.slice(0, 80));

                const idx = toolIndexMap.get(evt.toolCallId);
                if (idx !== undefined) {
                  const existing = partsRef.current[idx] as Extract<StreamPart, { kind: 'tool' }>;
                  partsRef.current[idx] = { ...existing, done: true, output: outputText, inputReady: true };
                } else {
                  const toolPart: StreamPart = {
                    kind: 'tool',
                    toolCallId: evt.toolCallId,
                    name: evt.toolName || 'unknown',
                    done: true,
                    output: outputText,
                    inputChars: 0,
                    inputReady: true,
                  };
                  partsRef.current.push(toolPart);
                  toolIndexMap.set(evt.toolCallId, partsRef.current.length - 1);
                }
                // Force immediate update for tool output (important state change)
                if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
                setStreamParts([...partsRef.current]);
                break;
              }
            }
          } catch (parseErr) {
            console.warn('[audit] JSON parse error:', parseErr, 'data:', data.slice(0, 200));
          }
        }
      }

      // Final flush
      if (rafId) cancelAnimationFrame(rafId);
      setStreamParts([...partsRef.current]);

      // Parse findings from the complete response text
      const result = parseAuditResponse(fullTextRef.current);
      if (result) {
        setFindings(result.findings);
        setSummary(result.summary || '');
        setScore(result.score || '');
      }

      setStatus('done');
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('[audit] Stream error:', err);
      setStatus('error');
    }
  }, [code, contractName, network]);

  const isStreaming = status === 'streaming' || status === 'connecting';
  const hasStarted = status !== 'idle';

  // Derived: tool call stats from stream parts
  const toolParts = useMemo(
    () => streamParts.filter((p): p is Extract<StreamPart, { kind: 'tool' }> => p.kind === 'tool'),
    [streamParts],
  );
  const reasoningText = useMemo(
    () => streamParts.filter(p => p.kind === 'thinking').map(p => p.text).join(''),
    [streamParts],
  );

  // Group findings by rule for the filter bar
  const ruleGroups = useMemo(() => {
    const map = new Map<string, { rule: string; count: number; severity: Severity }>();
    for (const f of findings) {
      const key = f.rule || 'other';
      const existing = map.get(key);
      if (existing) {
        existing.count++;
      } else {
        map.set(key, { rule: key, count: 1, severity: f.severity });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [findings]);

  // Findings after applying rule filter
  const filteredFindings = useMemo(
    () => hiddenRules.size === 0
      ? findings
      : findings.filter(f => !hiddenRules.has(f.rule || 'other')),
    [findings, hiddenRules],
  );

  // Position findings in sidebar — stack overlapping ones
  const positionedFindings = useMemo(() => {
    if (filteredFindings.length === 0) return [];
    const CARD_HEIGHT = 72; // approximate card height in px
    const GAP = 4;
    const result: { finding: AuditFinding; top: number }[] = [];
    let lastBottom = -Infinity;
    for (const f of filteredFindings) {
      const idealTop = (f.line - 1) * LINE_HEIGHT;
      const top = Math.max(idealTop, lastBottom + GAP);
      result.push({ finding: f, top });
      lastBottom = top + CARD_HEIGHT;
    }
    return result;
  }, [filteredFindings]);

  // Per-line Shiki HTML (expensive — only depends on code)
  const highlightedLines = useMemo(() => {
    if (!highlighter || !code) return null;
    const html = highlightCode(highlighter, code, 'cadence', 'cadence-editor');
    const lineMatches = html.match(/<span class="line">[^]*?<\/span>(?=<span class="line">|<\/code>)/g);
    if (!lineMatches) {
      const codeContent = html.match(/<code[^>]*>([\s\S]*?)<\/code>/);
      if (codeContent) return codeContent[1].split('\n');
      return null;
    }
    return lineMatches;
  }, [highlighter, code]);

  // Scroll to line in code panel when clicking a finding
  const scrollToLine = useCallback((lineNum: number, findingId: string) => {
    setSelectedId(findingId);
    const container = scrollContainerRef.current;
    if (container) {
      const targetY = (lineNum - 1) * LINE_HEIGHT - container.clientHeight / 3;
      container.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
    }
  }, []);

  // Select finding from code panel click
  const selectFinding = useCallback((findingId: string) => {
    setSelectedId(findingId);
  }, []);

  // Stats
  const stats = useMemo(() => {
    const s = { high: 0, medium: 0, low: 0, info: 0, error: 0, warning: 0 };
    for (const f of findings) s[f.severity]++;
    return s;
  }, [findings]);
  const criticalCount = stats.high + stats.error;
  const warningCount = stats.medium + stats.warning;

  if (!code) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-500">
        <Shield className="w-6 h-6 mr-2 opacity-30" />
        <span className="text-xs">No source code available for audit</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0 rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden" style={{ minHeight: 500 }}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 bg-zinc-950/50">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Shield className="w-3.5 h-3.5" />
            <span className="font-medium">AI Audit</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium">Beta</span>
          </div>

          {score && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${
              score === 'A' ? 'bg-emerald-500/15 text-emerald-400'
                : score === 'B' ? 'bg-blue-500/15 text-blue-400'
                  : score === 'C' ? 'bg-amber-500/15 text-amber-400'
                    : 'bg-red-500/15 text-red-400'
            }`}>
              {score}
            </span>
          )}

          {status === 'done' && (
            <div className="flex items-center gap-2 text-[10px]">
              {criticalCount > 0 && (
                <span className="flex items-center gap-1 text-red-400">
                  <ShieldAlert className="w-3 h-3" />{criticalCount} critical
                </span>
              )}
              {warningCount > 0 && (
                <span className="flex items-center gap-1 text-amber-400">
                  <AlertTriangle className="w-3 h-3" />{warningCount} warning{warningCount > 1 ? 's' : ''}
                </span>
              )}
              {stats.low + stats.info > 0 && (
                <span className="flex items-center gap-1 text-zinc-500">
                  <Info className="w-3 h-3" />{stats.low + stats.info} info
                </span>
              )}
              {findings.length === 0 && (
                <span className="flex items-center gap-1 text-emerald-400">
                  <ShieldCheck className="w-3 h-3" />No issues found
                </span>
              )}
            </div>
          )}

          {status === 'error' && (
            <span className="text-[10px] text-red-400">Audit failed — try again</span>
          )}
        </div>

        <button
          onClick={runAudit}
          disabled={isStreaming}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
            isStreaming
              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
              : hasStarted
                ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
          }`}
        >
          {isStreaming ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" />Scanning...</>
          ) : hasStarted ? (
            <><Play className="w-3 h-3" />Re-scan</>
          ) : (
            <><Play className="w-3 h-3" />Run Audit</>
          )}
        </button>
      </div>

      {/* Streaming progress — sequential parts rendered in order */}
      {isStreaming && (
        <div className="flex-1 flex flex-col overflow-auto">
          {/* Status bar */}
          <div className="px-4 py-2.5 border-b border-zinc-800 bg-zinc-950/30 flex items-center gap-3">
            <Loader2 className="w-4 h-4 text-emerald-400 animate-spin shrink-0" />
            <span className="text-xs text-zinc-300 font-medium">
              {toolParts.length > 0
                ? toolParts.some(t => !t.done)
                  ? `Running ${formatToolName(toolParts.filter(t => !t.done)[0]?.name || '')}...`
                  : 'Processing results...'
                : reasoningText
                  ? 'Thinking...'
                  : 'Connecting to AI...'}
            </span>
            <span className="text-[10px] text-zinc-600 ml-auto">
              {toolParts.length > 0 && `${toolParts.filter(t => t.done).length}/${toolParts.length} checks`}
            </span>
          </div>

          {/* Sequential stream parts */}
          <div className="flex-1 px-4 py-3 space-y-3 overflow-y-auto">
            {streamParts.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 className="w-8 h-8 text-emerald-400/40 animate-spin" />
                <p className="text-xs text-zinc-500">Connecting to AI auditor...</p>
              </div>
            )}

            {streamParts.map((part, i) => {
              if (part.kind === 'thinking') {
                return (
                  <div key={`thinking-${i}`}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Sparkles className="w-3 h-3 text-amber-500/60" />
                      <span className="text-[10px] text-amber-500/60 uppercase tracking-widest font-bold">Thinking</span>
                    </div>
                    <div className="max-h-60 overflow-y-auto rounded-md border border-zinc-800/50 bg-zinc-950/50 p-3">
                      <div className="text-[11px] text-zinc-400 leading-relaxed prose prose-invert prose-xs max-w-none">
                        <AnimatedMarkdown
                          content={part.text}
                          animation={['colorTransition', 'blurIn']}
                          animationDuration="0.5s"
                          animationTimingFunction="ease-out"
                          sep="diff"
                          customComponents={auditAnimatedComponents}
                        />
                      </div>
                    </div>
                  </div>
                );
              }

              if (part.kind === 'tool') {
                const statusText = part.done
                  ? 'Complete'
                  : part.inputReady
                    ? 'Analyzing...'
                    : part.inputChars > 0
                      ? `Sending ${(part.inputChars / 1000).toFixed(1)}k chars...`
                      : 'Starting...';
                return (
                  <div key={`tool-${part.toolCallId}`} className={`rounded-md border overflow-hidden ${
                    part.done
                      ? 'border-emerald-500/20 bg-emerald-500/5'
                      : part.inputReady
                        ? 'border-blue-500/20 bg-blue-500/5'
                        : 'border-amber-500/20 bg-amber-500/5'
                  }`}>
                    <div className="flex items-center gap-2.5 px-3 py-2">
                      {part.done
                        ? <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                        : part.inputReady
                          ? <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
                          : <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />}
                      <span className={`text-xs font-medium ${
                        part.done ? 'text-emerald-300' : part.inputReady ? 'text-blue-300' : 'text-amber-300'
                      }`}>
                        {formatToolName(part.name)}
                      </span>
                      <span className={`text-[10px] ml-auto ${
                        part.done ? 'text-emerald-500' : part.inputReady ? 'text-blue-500' : 'text-amber-500'
                      }`}>
                        {statusText}
                      </span>
                    </div>
                    {part.done && part.output && (
                      <div className="px-3 pb-2.5 pt-0">
                        <div className="text-[11px] leading-relaxed text-zinc-300 bg-zinc-950/50 rounded p-2.5 max-h-64 overflow-y-auto">
                          <AnimatedMarkdown
                            content={part.output}
                            animation={['colorTransition', 'blurIn']}
                            animationDuration="0.5s"
                            animationTimingFunction="ease-out"
                            sep="diff"
                            customComponents={auditAnimatedComponents}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              }

              if (part.kind === 'text') {
                return (
                  <div key={`text-${i}`} className="text-[11px] leading-relaxed text-zinc-300">
                    <AnimatedMarkdown
                      content={part.text}
                      animation={['colorTransition', 'blurIn']}
                      animationDuration="0.5s"
                      animationTimingFunction="ease-out"
                      sep="diff"
                      customComponents={auditAnimatedComponents}
                    />
                  </div>
                );
              }

              return null;
            })}
          </div>
        </div>
      )}

      {/* After streaming: thinking accordion + tool summary */}
      {!isStreaming && reasoningText && (
        <div className="border-b border-zinc-800/50">
          <button
            onClick={() => setThinkingExpanded(!thinkingExpanded)}
            className="w-full px-4 py-1.5 flex items-center gap-1.5 text-[10px] text-amber-500/60 hover:text-amber-500 transition-colors"
          >
            <Sparkles className="w-3 h-3" />
            <span className="uppercase tracking-widest font-bold">Thinking Process</span>
            <span className="text-zinc-600 ml-1 normal-case tracking-normal font-normal">
              ({reasoningText.length.toLocaleString()} chars)
            </span>
            {thinkingExpanded
              ? <ChevronDown className="w-3 h-3 ml-auto" />
              : <ChevronRight className="w-3 h-3 ml-auto" />}
          </button>
          {thinkingExpanded && (
            <div className="px-4 pb-3 max-h-72 overflow-y-auto border-t border-zinc-800/30 pt-2">
              <div className="text-[11px] text-zinc-500 leading-relaxed prose prose-invert prose-xs max-w-none [&_strong]:text-zinc-300 [&_code]:text-purple-400 [&_code]:bg-zinc-800/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[10px]">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{reasoningText}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}

      {!isStreaming && toolParts.length > 0 && (
        <div className="px-4 py-1.5 border-b border-zinc-800/50 flex items-center gap-1.5 flex-wrap">
          {toolParts.map((tc) => (
            <span key={tc.toolCallId} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-emerald-500/10 text-emerald-400">
              <Wrench className="w-2.5 h-2.5" />
              {formatToolName(tc.name)} {'\u2713'}
            </span>
          ))}
        </div>
      )}

      {/* Main content */}
      {status === 'idle' ? (
        <div className="flex-1 flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-16 h-16 rounded-2xl bg-zinc-800/50 flex items-center justify-center">
            <Shield className="w-8 h-8 text-zinc-600" />
          </div>
          <div className="text-center">
            <p className="text-sm text-zinc-300 mb-1">AI Security Audit</p>
            <p className="text-xs text-zinc-500 max-w-md leading-relaxed">
              Powered by Claude Opus 4.6 with extended thinking. Runs Cadence security scan,
              type checking, and AI-powered code review on <span className="text-zinc-400 font-mono">{contractName}.cdc</span>.
            </p>
          </div>
          <button
            onClick={runAudit}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Shield className="w-4 h-4" />
            Run Audit
          </button>
        </div>
      ) : (status === 'done' || status === 'error') && (
        <>
          {/* ── Summary Banner ── */}
          {status === 'done' && (
            <div className="px-5 py-4 border-b border-zinc-800 bg-zinc-950/50">
              <div className="flex items-center gap-5">
                {/* Big score badge */}
                {score && (
                  <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-2xl font-black ${
                    score === 'A' ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30'
                      : score === 'B' ? 'bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/30'
                        : score === 'C' ? 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30'
                          : 'bg-red-500/15 text-red-400 ring-1 ring-red-500/30'
                  }`}>
                    {score}
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  {summary && (
                    <p className="text-xs text-zinc-400 leading-relaxed mb-2">{summary}</p>
                  )}
                  {/* KPI chips */}
                  <div className="flex items-center gap-3">
                    {criticalCount > 0 && (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-500/10 ring-1 ring-red-500/20">
                        <ShieldAlert className="w-3.5 h-3.5 text-red-400" />
                        <span className="text-xs font-bold text-red-400">{criticalCount}</span>
                        <span className="text-[10px] text-red-400/70">Critical</span>
                      </div>
                    )}
                    {warningCount > 0 && (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 ring-1 ring-amber-500/20">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                        <span className="text-xs font-bold text-amber-400">{warningCount}</span>
                        <span className="text-[10px] text-amber-400/70">Warning</span>
                      </div>
                    )}
                    {(stats.low + stats.info) > 0 && (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-500/10 ring-1 ring-zinc-500/20">
                        <Info className="w-3.5 h-3.5 text-zinc-400" />
                        <span className="text-xs font-bold text-zinc-400">{stats.low + stats.info}</span>
                        <span className="text-[10px] text-zinc-400/70">Info</span>
                      </div>
                    )}
                    {findings.length === 0 && (
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 ring-1 ring-emerald-500/20">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-xs font-medium text-emerald-400">No issues found</span>
                      </div>
                    )}
                    <span className="text-[10px] text-zinc-600 ml-auto">
                      {filteredFindings.length !== findings.length
                        ? `${filteredFindings.length} of ${findings.length} shown`
                        : `${findings.length} finding${findings.length !== 1 ? 's' : ''}`}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Rule Filter Bar ── */}
          {ruleGroups.length > 1 && (
            <div className="px-4 py-2 border-b border-zinc-800/50 flex items-center gap-1.5 flex-wrap">
              <span className="text-[9px] text-zinc-600 uppercase tracking-wider font-medium mr-1">Rules:</span>
              {ruleGroups.map(rg => {
                const isHidden = hiddenRules.has(rg.rule);
                const cfg = SEVERITY_CONFIG[rg.severity];
                return (
                  <button
                    key={rg.rule}
                    onClick={() => setHiddenRules(prev => {
                      const next = new Set(prev);
                      if (next.has(rg.rule)) next.delete(rg.rule); else next.add(rg.rule);
                      return next;
                    })}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono transition-all ${
                      isHidden
                        ? 'bg-zinc-800/30 text-zinc-600 line-through opacity-50'
                        : `${cfg.bg} ${cfg.color}`
                    }`}
                  >
                    {isHidden ? <EyeOff className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
                    {rg.rule}
                    <span className="opacity-60">{rg.count}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Code + Positioned Sidebar ── */}
          <div ref={scrollContainerRef} className="flex flex-1 min-h-0 overflow-auto" style={{ minHeight: 400 }}>
            {/* Code panel */}
            <div className="flex-1 min-w-0">
              <CodePanel
                code={code}
                highlightedLines={highlightedLines}
                findings={filteredFindings}
                selectedId={selectedId}
                onSelectFinding={selectFinding}
              />
            </div>

            {/* Positioned comment sidebar — findings aligned to their code lines */}
            <div className="w-80 shrink-0 border-l border-zinc-800 bg-zinc-950/30 relative"
                 style={{ minHeight: code.split('\n').length * LINE_HEIGHT }}>
              {filteredFindings.length === 0 && status === 'done' && (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-zinc-500 sticky top-1/3">
                  <ShieldCheck className="w-6 h-6 text-emerald-500/50" />
                  <p className="text-[11px]">No issues found</p>
                </div>
              )}

              {positionedFindings.map(({ finding: f, top }) => {
                const fc = SEVERITY_CONFIG[f.severity];
                const Icon = fc.icon;
                const isSel = f.id === selectedId;
                const src = SOURCE_LABELS[f.source] || SOURCE_LABELS['ai-review'];

                return (
                  <div
                    key={f.id}
                    onClick={() => scrollToLine(f.line, f.id)}
                    style={{ position: 'absolute', top, left: 0, right: 0 }}
                    className={`mx-2 px-2.5 py-2 rounded-md cursor-pointer transition-all border ${
                      isSel
                        ? `${fc.bg} ${fc.border} shadow-lg shadow-black/20`
                        : `border-zinc-800/50 hover:${fc.bg} hover:border-zinc-700`
                    }`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1">
                        <Icon className={`w-3 h-3 ${fc.color}`} />
                        <span className={`text-[9px] font-semibold uppercase ${fc.color}`}>{fc.label}</span>
                      </div>
                      <span className="text-[9px] text-zinc-600 font-mono">L{f.line}</span>
                    </div>

                    <p className="text-[10px] text-zinc-300 leading-snug line-clamp-2">{f.message}</p>

                    {f.suggestion && isSel && (
                      <p className="text-[9px] text-emerald-400/70 leading-snug mt-1 pl-1.5 border-l border-emerald-500/20">
                        {f.suggestion}
                      </p>
                    )}

                    <div className="mt-1 flex items-center gap-1 flex-wrap">
                      {f.rule && (
                        <span className="text-[8px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 font-mono">{f.rule}</span>
                      )}
                      <span className={`text-[8px] px-1 py-0.5 rounded font-medium ${src.className}`}>{src.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

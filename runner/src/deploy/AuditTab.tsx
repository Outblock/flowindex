// ---------------------------------------------------------------------------
// AuditTab — AI-powered contract security audit with inline annotations
// Uses streaming AI (Opus 4.6 + thinking) via /api/runner-audit endpoint
// Google Docs-style comment sidebar + highlighted code lines
// ---------------------------------------------------------------------------

import { useState, useMemo, useCallback, useRef } from 'react';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Info,
  XCircle,
  Loader2,
  Play,
  MessageSquare,
  Sparkles,
  Wrench,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useShikiHighlighter, highlightCode } from '../hooks/useShiki';

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

interface AuditResult {
  findings: AuditFinding[];
  summary?: string;
  score?: string;
}

interface Props {
  code: string;
  contractName: string;
  network: string;
}

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
// Parse AI JSON response
// ---------------------------------------------------------------------------

function parseAuditResponse(text: string): AuditResult | null {
  // Find JSON block in response (may be wrapped in ```json ... ```)
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

    return {
      findings,
      summary: parsed.summary,
      score: parsed.score,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AI Chat URL
// ---------------------------------------------------------------------------

const AI_CHAT_URL = import.meta.env.VITE_AI_CHAT_URL || 'https://ai.flowindex.io';

// ---------------------------------------------------------------------------
// AuditTab
// ---------------------------------------------------------------------------

export default function AuditTab({ code, contractName, network }: Props) {
  const highlighter = useShikiHighlighter();

  const [findings, setFindings] = useState<AuditFinding[]>([]);
  const [summary, setSummary] = useState<string>('');
  const [score, setScore] = useState<string>('');
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Streaming state
  const [thinkingText, setThinkingText] = useState('');
  const [toolCalls, setToolCalls] = useState<{ name: string; status: string }[]>([]);
  const [statusText, setStatusText] = useState('');
  const [thinkingExpanded, setThinkingExpanded] = useState(false);

  // Selected finding for highlight
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Refs for scrolling
  const commentRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const lineRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const abortRef = useRef<AbortController | null>(null);

  // Run AI audit via streaming endpoint
  const runAudit = useCallback(async () => {
    if (!code) return;

    // Abort any previous run
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setScanning(true);
    setError(null);
    setFindings([]);
    setSummary('');
    setScore('');
    setSelectedId(null);
    setThinkingText('');
    setToolCalls([]);
    setStatusText('Connecting to AI...');
    setThinkingExpanded(false);

    try {
      const resp = await fetch(`${AI_CHAT_URL}/api/runner-audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ id: 'audit-1', role: 'user', content: `Audit this Cadence contract for security vulnerabilities, type errors, and best practice violations. Run all available MCP tools first, then provide your comprehensive analysis.`, parts: [{ type: 'text', text: 'Audit this contract.' }] }],
          code,
          contractName,
          network,
        }),
        signal: ac.signal,
      });

      if (!resp.ok) {
        throw new Error(`Audit request failed: ${resp.status}`);
      }

      // Parse the UI message stream
      const reader = resp.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let fullAssistantText = '';
      let currentThinking = '';
      const tools: { name: string; status: string }[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('0:') && !line.startsWith('g:') && !line.startsWith('a:')
            && !line.startsWith('e:') && !line.startsWith('f:') && !line.startsWith('d:')) continue;

          const prefix = line[0];
          const payload = line.slice(2);

          try {
            if (prefix === '0') {
              // Text delta
              const text = JSON.parse(payload) as string;
              fullAssistantText += text;
              setStatusText('Generating report...');
            } else if (prefix === 'g') {
              // Reasoning/thinking delta
              const text = JSON.parse(payload) as string;
              currentThinking += text;
              setThinkingText(currentThinking);
              setStatusText('Thinking...');
            } else if (prefix === 'a') {
              // Tool call start
              const data = JSON.parse(payload);
              if (data?.toolName) {
                tools.push({ name: data.toolName, status: 'running' });
                setToolCalls([...tools]);
                setStatusText(`Running ${formatToolName(data.toolName)}...`);
              }
            } else if (prefix === 'e') {
              // Tool result
              const lastTool = tools[tools.length - 1];
              if (lastTool) {
                lastTool.status = 'done';
                setToolCalls([...tools]);
              }
            } else if (prefix === 'd') {
              // Finish
              setStatusText('');
            }
          } catch {
            // Skip malformed stream lines
          }
        }
      }

      // Parse the final JSON response from assistant text
      const result = parseAuditResponse(fullAssistantText);
      if (result) {
        setFindings(result.findings);
        setSummary(result.summary || '');
        setScore(result.score || '');
      } else if (fullAssistantText.trim()) {
        // AI didn't output valid JSON — try to extract findings from text
        setError('AI returned non-structured response. Findings may be incomplete.');
      }

      setScanned(true);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Audit failed');
    } finally {
      setScanning(false);
      setStatusText('');
    }
  }, [code, contractName, network]);

  // Build line -> findings map
  const lineFindings = useMemo(() => {
    const map = new Map<number, AuditFinding[]>();
    for (const f of findings) {
      const arr = map.get(f.line) || [];
      arr.push(f);
      map.set(f.line, arr);
    }
    return map;
  }, [findings]);

  // Code lines
  const codeLines = useMemo(() => code.split('\n'), [code]);

  // Per-line highlighted HTML from Shiki
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

  // Scroll helpers
  const scrollToLine = useCallback((lineNum: number, findingId: string) => {
    setSelectedId(findingId);
    const el = lineRefs.current.get(lineNum);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const scrollToComment = useCallback((findingId: string) => {
    setSelectedId(findingId);
    const el = commentRefs.current.get(findingId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

          {/* Score badge */}
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

          {scanned && !scanning && (
            <div className="flex items-center gap-2 text-[10px]">
              {criticalCount > 0 && (
                <span className="flex items-center gap-1 text-red-400">
                  <ShieldAlert className="w-3 h-3" />
                  {criticalCount} critical
                </span>
              )}
              {warningCount > 0 && (
                <span className="flex items-center gap-1 text-amber-400">
                  <AlertTriangle className="w-3 h-3" />
                  {warningCount} warning{warningCount > 1 ? 's' : ''}
                </span>
              )}
              {stats.low + stats.info > 0 && (
                <span className="flex items-center gap-1 text-zinc-500">
                  <Info className="w-3 h-3" />
                  {stats.low + stats.info} info
                </span>
              )}
              {findings.length === 0 && (
                <span className="flex items-center gap-1 text-emerald-400">
                  <ShieldCheck className="w-3 h-3" />
                  No issues found
                </span>
              )}
            </div>
          )}
        </div>

        <button
          onClick={runAudit}
          disabled={scanning}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-md transition-colors ${
            scanning
              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
              : scanned
                ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
          }`}
        >
          {scanning ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Scanning...
            </>
          ) : scanned ? (
            <>
              <Play className="w-3 h-3" />
              Re-scan
            </>
          ) : (
            <>
              <Play className="w-3 h-3" />
              Run Audit
            </>
          )}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Streaming progress bar */}
      {scanning && (
        <div className="border-b border-zinc-800 bg-zinc-950/30">
          {/* Status + tool calls */}
          <div className="px-4 py-2 flex items-center gap-3 text-[11px]">
            <Loader2 className="w-3 h-3 text-emerald-400 animate-spin shrink-0" />
            <span className="text-zinc-400">{statusText}</span>
            {toolCalls.length > 0 && (
              <div className="flex items-center gap-1.5 ml-auto">
                {toolCalls.map((tc, i) => (
                  <span key={i} className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium ${
                    tc.status === 'done'
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : 'bg-amber-500/10 text-amber-400'
                  }`}>
                    <Wrench className="w-2.5 h-2.5" />
                    {formatToolName(tc.name)}
                    {tc.status === 'done' ? ' ✓' : '...'}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Thinking accordion */}
          {thinkingText && (
            <div className="border-t border-zinc-800/50">
              <button
                onClick={() => setThinkingExpanded(!thinkingExpanded)}
                className="w-full px-4 py-1.5 flex items-center gap-1.5 text-[10px] text-amber-500/70 hover:text-amber-500 transition-colors"
              >
                <Sparkles className="w-3 h-3" />
                <span className="uppercase tracking-widest font-bold">Thinking</span>
                {thinkingExpanded ? <ChevronDown className="w-3 h-3 ml-auto" /> : <ChevronRight className="w-3 h-3 ml-auto" />}
              </button>
              {thinkingExpanded && (
                <div className="px-4 pb-2 max-h-40 overflow-y-auto">
                  <p className="text-[11px] text-zinc-500 leading-relaxed whitespace-pre-wrap font-mono">
                    {thinkingText}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Summary bar (after scan) */}
      {scanned && !scanning && summary && (
        <div className="px-4 py-2.5 border-b border-zinc-800 bg-zinc-950/30">
          <p className="text-[11px] text-zinc-400 leading-snug">{summary}</p>
        </div>
      )}

      {/* Thinking (after scan, collapsed) */}
      {scanned && !scanning && thinkingText && (
        <div className="border-b border-zinc-800/50">
          <button
            onClick={() => setThinkingExpanded(!thinkingExpanded)}
            className="w-full px-4 py-1.5 flex items-center gap-1.5 text-[10px] text-amber-500/50 hover:text-amber-500 transition-colors"
          >
            <Sparkles className="w-3 h-3" />
            <span className="uppercase tracking-widest font-bold">Thinking Process</span>
            {thinkingExpanded ? <ChevronDown className="w-3 h-3 ml-auto" /> : <ChevronRight className="w-3 h-3 ml-auto" />}
          </button>
          {thinkingExpanded && (
            <div className="px-4 pb-3 max-h-60 overflow-y-auto">
              <p className="text-[11px] text-zinc-500 leading-relaxed whitespace-pre-wrap font-mono">
                {thinkingText}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Main content */}
      {!scanned && !scanning ? (
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
      ) : (
        // Code + comments split view
        <div className="flex flex-1 min-h-0" style={{ minHeight: 400 }}>
          {/* Code panel */}
          <div className="flex-1 min-w-0 overflow-auto">
            <div className="font-mono text-xs leading-[1.65]">
              {codeLines.map((line, i) => {
                const lineNum = i + 1;
                const lineFindingsArr = lineFindings.get(lineNum);
                const hasFindings = !!lineFindingsArr;
                const isSelected = lineFindingsArr?.some(f => f.id === selectedId);

                const severityOrder: Severity[] = ['high', 'error', 'medium', 'warning', 'low', 'info'];
                const highestSeverity = lineFindingsArr
                  ? severityOrder.find(s => lineFindingsArr.some(f => f.severity === s)) || 'info'
                  : null;
                const config = highestSeverity ? SEVERITY_CONFIG[highestSeverity] : null;

                return (
                  <div key={lineNum}>
                    <div
                      ref={(el) => { if (el) lineRefs.current.set(lineNum, el); }}
                      className={`flex group cursor-default transition-colors ${
                        isSelected
                          ? `${config?.lineBg || ''} ring-1 ring-inset ${config?.border || 'ring-zinc-700'}`
                          : hasFindings
                            ? `${config?.lineBg || ''} hover:brightness-125`
                            : 'hover:bg-zinc-800/30'
                      }`}
                      onClick={() => {
                        if (lineFindingsArr?.[0]) scrollToComment(lineFindingsArr[0].id);
                      }}
                    >
                      {/* Gutter indicator */}
                      <div className={`w-1 shrink-0 ${hasFindings ? config?.gutterBg || '' : ''}`} />

                      {/* Line number */}
                      <span className={`inline-block w-10 text-right pr-3 select-none shrink-0 ${
                        hasFindings ? config?.color || 'text-zinc-600' : 'text-zinc-600'
                      }`}>
                        {lineNum}
                      </span>

                      {/* Annotation indicator */}
                      <span className="w-5 shrink-0 flex items-center justify-center">
                        {hasFindings && config && (
                          <MessageSquare className={`w-3 h-3 ${config.color} opacity-60`} />
                        )}
                      </span>

                      {/* Code content */}
                      <span className="flex-1 whitespace-pre pl-1 pr-4">
                        {highlightedLines?.[i] ? (
                          <span dangerouslySetInnerHTML={{ __html: stripLineWrapper(highlightedLines[i]) }} />
                        ) : (
                          <span className="text-zinc-300">{line}</span>
                        )}
                      </span>
                    </div>

                    {/* Inline annotation below the line */}
                    {hasFindings && lineFindingsArr && (
                      <div className={`flex border-b ${config?.border || 'border-zinc-800'} ${config?.bg || ''}`}>
                        <div className="w-1 shrink-0" />
                        <div className="w-10 shrink-0" />
                        <div className="w-5 shrink-0" />
                        <div className="flex-1 px-2 py-1.5 space-y-1">
                          {lineFindingsArr.map(f => {
                            const fc = SEVERITY_CONFIG[f.severity];
                            const Icon = fc.icon;
                            return (
                              <div
                                key={f.id}
                                className={`flex items-start gap-1.5 text-[11px] leading-snug ${fc.color} ${
                                  f.id === selectedId ? 'font-medium' : 'opacity-80'
                                }`}
                              >
                                <Icon className="w-3 h-3 shrink-0 mt-0.5" />
                                <span>{f.message}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Comment sidebar — Google Docs style */}
          <div className="w-72 shrink-0 border-l border-zinc-800 bg-zinc-950/50 overflow-y-auto">
            <div className="px-3 py-2.5 border-b border-zinc-800 sticky top-0 bg-zinc-950/90 backdrop-blur-sm z-10">
              <div className="flex items-center gap-1.5 text-[10px] font-medium text-zinc-400 uppercase tracking-wider">
                <MessageSquare className="w-3 h-3" />
                Findings ({findings.length})
              </div>
            </div>

            {scanning && (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <Loader2 className="w-4 h-4 text-zinc-500 animate-spin" />
                <p className="text-[10px] text-zinc-600">Analyzing...</p>
              </div>
            )}

            {!scanning && findings.length === 0 && scanned && (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-zinc-500">
                <ShieldCheck className="w-6 h-6 text-emerald-500/50" />
                <p className="text-[11px]">No issues found</p>
              </div>
            )}

            {!scanning && findings.map(f => {
              const fc = SEVERITY_CONFIG[f.severity];
              const Icon = fc.icon;
              const isSelected = f.id === selectedId;
              const sourceInfo = SOURCE_LABELS[f.source] || SOURCE_LABELS['ai-review'];

              return (
                <div
                  key={f.id}
                  ref={(el) => { if (el) commentRefs.current.set(f.id, el); }}
                  onClick={() => scrollToLine(f.line, f.id)}
                  className={`px-3 py-2.5 border-b border-zinc-800/50 cursor-pointer transition-all ${
                    isSelected
                      ? `${fc.bg} border-l-2 ${fc.border}`
                      : 'hover:bg-zinc-800/30 border-l-2 border-transparent'
                  }`}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <Icon className={`w-3.5 h-3.5 ${fc.color}`} />
                      <span className={`text-[10px] font-semibold uppercase tracking-wide ${fc.color}`}>
                        {fc.label}
                      </span>
                    </div>
                    <span className="text-[10px] text-zinc-600 font-mono">
                      L{f.line}{f.column ? `:${f.column}` : ''}
                    </span>
                  </div>

                  {/* Message */}
                  <p className="text-[11px] text-zinc-300 leading-snug">
                    {f.message}
                  </p>

                  {/* Suggestion */}
                  {f.suggestion && (
                    <p className="text-[10px] text-emerald-400/70 leading-snug mt-1 pl-2 border-l-2 border-emerald-500/20">
                      💡 {f.suggestion}
                    </p>
                  )}

                  {/* Tags row */}
                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                    {f.rule && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 font-mono">
                        {f.rule}
                      </span>
                    )}
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${sourceInfo.className}`}>
                      {sourceInfo.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripLineWrapper(html: string): string {
  return html.replace(/^<span class="line">/, '').replace(/<\/span>$/, '');
}

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

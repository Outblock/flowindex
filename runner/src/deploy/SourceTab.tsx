// ---------------------------------------------------------------------------
// SourceTab — contract source code viewer with version sidebar + diff mode
// ---------------------------------------------------------------------------

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ExternalLink,
  Code2,
  GitCompare,
  Loader2,
  Layers,
  ChevronRight,
} from 'lucide-react';
import { diffLines, type Change } from 'diff';
import { useShikiHighlighter, highlightCode } from '../hooks/useShiki';
import { extractShikiLines } from './shikiLines';
import { fetchVersionCode } from './api';
import type { ContractInfo, ContractVersion } from './api';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  contract: ContractInfo | null;
  contractName: string;
  contractId: string;
  versions: ContractVersion[];
  network: string;
}

// ---------------------------------------------------------------------------
// DiffView (adapted from frontend)
// ---------------------------------------------------------------------------

const CONTEXT_LINES = 3;

interface DiffLine {
  type: 'added' | 'removed' | 'context';
  content: string;
  oldNum: number | null;
  newNum: number | null;
}

function DiffView({ codeA, codeB }: { codeA: string; codeB: string }) {
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());

  const { hunks, stats } = useMemo(() => {
    if (!codeA && !codeB) return { hunks: [] as any[], stats: { added: 0, removed: 0 } };

    const changes: Change[] = diffLines(codeA, codeB);
    const allLines: DiffLine[] = [];
    let oldLineNum = 1;
    let newLineNum = 1;

    for (const change of changes) {
      const lines = change.value.replace(/\n$/, '').split('\n');
      for (const line of lines) {
        if (change.added) {
          allLines.push({ type: 'added', content: line, oldNum: null, newNum: newLineNum++ });
        } else if (change.removed) {
          allLines.push({ type: 'removed', content: line, oldNum: oldLineNum++, newNum: null });
        } else {
          allLines.push({ type: 'context', content: line, oldNum: oldLineNum++, newNum: newLineNum++ });
        }
      }
    }

    const changedIndices = new Set<number>();
    allLines.forEach((line, i) => {
      if (line.type !== 'context') changedIndices.add(i);
    });

    if (changedIndices.size === 0) {
      return { hunks: [{ lines: allLines }], stats: { added: 0, removed: 0 } };
    }

    const visibleIndices = new Set<number>();
    for (const idx of changedIndices) {
      for (let j = Math.max(0, idx - CONTEXT_LINES); j <= Math.min(allLines.length - 1, idx + CONTEXT_LINES); j++) {
        visibleIndices.add(j);
      }
    }

    const result: any[] = [];
    let currentHunk: DiffLine[] = [];
    let i = 0;

    while (i < allLines.length) {
      if (visibleIndices.has(i)) {
        currentHunk.push(allLines[i]);
        i++;
      } else {
        if (currentHunk.length > 0) {
          result.push({ lines: currentHunk });
          currentHunk = [];
        }
        const startIdx = i;
        let collapsedCount = 0;
        while (i < allLines.length && !visibleIndices.has(i)) {
          collapsedCount++;
          i++;
        }
        result.push({ collapsed: true, count: collapsedCount, startIdx });
      }
    }
    if (currentHunk.length > 0) {
      result.push({ lines: currentHunk });
    }

    const added = allLines.filter(l => l.type === 'added').length;
    const removed = allLines.filter(l => l.type === 'removed').length;

    return { hunks: result, stats: { added, removed } };
  }, [codeA, codeB]);

  const toggleCollapsed = useCallback((startIdx: number) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(startIdx)) next.delete(startIdx);
      else next.add(startIdx);
      return next;
    });
  }, []);

  if (hunks.length === 0) return null;

  return (
    <div className="font-mono text-[11px] overflow-auto max-h-[700px]">
      <div className="px-4 py-1.5 border-b border-zinc-800 flex items-center gap-3 text-[10px] bg-zinc-900/50">
        <span className="text-green-400">+{stats.added}</span>
        <span className="text-red-400">-{stats.removed}</span>
      </div>
      {hunks.map((hunk: any, hi: number) => {
        if (hunk.collapsed) {
          return (
            <button
              key={`c-${hi}`}
              onClick={() => toggleCollapsed(hunk.startIdx)}
              className="w-full px-4 py-1 text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 border-y border-zinc-800/50 flex items-center gap-1.5 transition-colors"
            >
              <ChevronRight className="h-3 w-3" />
              {hunk.count} unchanged lines
            </button>
          );
        }
        return (
          <div key={`h-${hi}`}>
            {hunk.lines.map((line: DiffLine, li: number) => (
              <div
                key={li}
                className={`flex whitespace-pre ${
                  line.type === 'removed'
                    ? 'bg-red-900/15'
                    : line.type === 'added'
                      ? 'bg-green-900/15'
                      : ''
                }`}
              >
                <span className="inline-block w-[3.5rem] text-right pr-2 text-zinc-600 select-none shrink-0 border-r border-zinc-800/50">
                  {line.oldNum ?? ''}
                </span>
                <span className="inline-block w-[3.5rem] text-right pr-2 text-zinc-600 select-none shrink-0 border-r border-zinc-800/50">
                  {line.newNum ?? ''}
                </span>
                <span className={`inline-block w-4 text-center select-none shrink-0 ${
                  line.type === 'removed'
                    ? 'text-red-400'
                    : line.type === 'added'
                      ? 'text-green-400'
                      : 'text-zinc-600'
                }`}>
                  {line.type === 'removed' ? '-' : line.type === 'added' ? '+' : ' '}
                </span>
                <span className={`pl-2 ${
                  line.type === 'removed'
                    ? 'text-red-300'
                    : line.type === 'added'
                      ? 'text-green-300'
                      : 'text-zinc-400'
                }`}>
                  {line.content}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Line selection helpers — parse/serialize "lines" URL param (e.g. "5,10-15")
// ---------------------------------------------------------------------------

function parseLineParam(param: string | null): Set<number> {
  const set = new Set<number>();
  if (!param) return set;
  for (const part of param.split(',')) {
    const range = part.split('-').map(Number);
    if (range.length === 2 && !isNaN(range[0]) && !isNaN(range[1])) {
      const [a, b] = range[0] <= range[1] ? [range[0], range[1]] : [range[1], range[0]];
      for (let i = a; i <= b; i++) set.add(i);
    } else if (range.length === 1 && !isNaN(range[0]) && range[0] > 0) {
      set.add(range[0]);
    }
  }
  return set;
}

function serializeLines(selected: Set<number>): string {
  if (selected.size === 0) return '';
  const sorted = [...selected].sort((a, b) => a - b);
  const ranges: string[] = [];
  let start = sorted[0], end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      ranges.push(start === end ? String(start) : `${start}-${end}`);
      start = end = sorted[i];
    }
  }
  ranges.push(start === end ? String(start) : `${start}-${end}`);
  return ranges.join(',');
}

// ---------------------------------------------------------------------------
// SourceCodeView — line-numbered, selectable code viewer
// ---------------------------------------------------------------------------

function SourceCodeView({
  code,
  highlightedHtml,
}: {
  code: string;
  highlightedHtml: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState<Set<number>>(() => parseLineParam(searchParams.get('lines')));
  const lastClickedRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync URL → state when param changes externally
  useEffect(() => {
    const fromUrl = parseLineParam(searchParams.get('lines'));
    setSelected(fromUrl);
  }, [searchParams.get('lines')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Parse shiki HTML into per-line HTML strings
  const lines = useMemo(() => {
    if (highlightedHtml) {
      const parsed = extractShikiLines(highlightedHtml);
      if (parsed) return parsed;
    }
    return code.split('\n');
  }, [highlightedHtml, code]);

  const isHighlighted = !!highlightedHtml && !!extractShikiLines(highlightedHtml);

  // Scroll to first selected line on mount
  useEffect(() => {
    if (selected.size === 0 || !containerRef.current) return;
    const first = Math.min(...selected);
    const el = containerRef.current.querySelector(`[data-line="${first}"]`);
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLineClick = useCallback((lineNum: number, e: React.MouseEvent) => {
    e.preventDefault();
    setSelected(prev => {
      let next: Set<number>;

      if (e.shiftKey && lastClickedRef.current != null) {
        // Range select
        const from = Math.min(lastClickedRef.current, lineNum);
        const to = Math.max(lastClickedRef.current, lineNum);
        next = new Set(prev);
        for (let i = from; i <= to; i++) next.add(i);
      } else if (e.metaKey || e.ctrlKey) {
        // Toggle single line
        next = new Set(prev);
        if (next.has(lineNum)) next.delete(lineNum);
        else next.add(lineNum);
      } else {
        // Single select (or deselect if clicking same single line)
        if (prev.size === 1 && prev.has(lineNum)) {
          next = new Set();
        } else {
          next = new Set([lineNum]);
        }
      }

      lastClickedRef.current = lineNum;

      // Update URL
      const serialized = serializeLines(next);
      setSearchParams(sp => {
        const p = new URLSearchParams(sp);
        if (serialized) p.set('lines', serialized);
        else p.delete('lines');
        return p;
      }, { replace: true });

      return next;
    });
  }, [setSearchParams]);

  const gutterWidth = String(lines.length).length;

  return (
    <div ref={containerRef} className="font-mono text-xs leading-relaxed overflow-auto">
      {lines.map((lineHtml, i) => {
        const lineNum = i + 1;
        const isSelected = selected.has(lineNum);
        return (
          <div
            key={i}
            data-line={lineNum}
            className={`flex ${isSelected ? 'bg-blue-500/15' : 'hover:bg-zinc-800/40'} transition-colors`}
          >
            <button
              onClick={(e) => handleLineClick(lineNum, e)}
              className={`shrink-0 text-right select-none px-3 py-0 border-r border-zinc-800/50 cursor-pointer hover:text-zinc-300 transition-colors ${
                isSelected ? 'text-blue-400' : 'text-zinc-600'
              }`}
              style={{ minWidth: `${Math.max(gutterWidth, 2) * 0.6 + 1.5}rem` }}
            >
              {lineNum}
            </button>
            {isHighlighted ? (
              <span
                className="flex-1 whitespace-pre pl-4 pr-4"
                dangerouslySetInnerHTML={{ __html: lineHtml }}
              />
            ) : (
              <span className="flex-1 whitespace-pre pl-4 pr-4 text-zinc-300">{lineHtml}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SourceTab
// ---------------------------------------------------------------------------

export default function SourceTab({ contract, contractName, contractId, versions, network }: Props) {
  const highlighter = useShikiHighlighter();

  // Selected version for viewing code
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [versionCode, setVersionCode] = useState<string>('');
  const [loadingCode, setLoadingCode] = useState(false);

  // Diff mode
  const [diffMode, setDiffMode] = useState(false);
  const [diffVersionA, setDiffVersionA] = useState<number | null>(null);
  const [diffVersionB, setDiffVersionB] = useState<number | null>(null);
  const [diffCodeA, setDiffCodeA] = useState('');
  const [diffCodeB, setDiffCodeB] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);

  // Sort by block_height ascending, then assign display version numbers (1 = oldest, N = newest)
  const sortedVersions = useMemo(() => {
    const byHeight = [...versions].sort((a, b) => (a.block_height ?? 0) - (b.block_height ?? 0));
    // Assign sequential display version: v1 = oldest deploy, vN = newest deploy
    const withDisplay = byHeight.map((v, i) => ({ ...v, displayVersion: i + 1 }));
    // Return descending (newest first for sidebar)
    return withDisplay.reverse();
  }, [versions]);

  // Latest = the most recently deployed (first in sortedVersions)
  const latestVersion = sortedVersions.length > 0 ? sortedVersions[0].displayVersion : (contract?.version ?? 1);

  // Map backend version → display version for toolbar/diff labels
  const toDisplayVersion = useCallback((backendVersion: number) => {
    const found = sortedVersions.find(v => v.version === backendVersion);
    return found ? found.displayVersion : backendVersion;
  }, [sortedVersions]);

  // Current code to display
  const displayCode = selectedVersion != null && versionCode ? versionCode : (contract?.code || '');

  // Load version-specific code
  const loadVersion = useCallback(async (v: number) => {
    // If it's the latest version and we have code from the contract detail, use it
    if (v === latestVersion && contract?.code) {
      setVersionCode('');
      setSelectedVersion(v);
      return;
    }
    setLoadingCode(true);
    setSelectedVersion(v);
    try {
      const code = await fetchVersionCode(contractId, v, network);
      setVersionCode(code);
    } catch {
      setVersionCode('');
    } finally {
      setLoadingCode(false);
    }
  }, [contractId, network, latestVersion, contract?.code]);

  // Load diff when both versions selected
  useEffect(() => {
    if (!diffMode || diffVersionA == null || diffVersionB == null || diffVersionA === diffVersionB) return;
    setDiffLoading(true);

    const loadCode = async (v: number): Promise<string> => {
      if (v === latestVersion && contract?.code) return contract.code;
      return fetchVersionCode(contractId, v, network);
    };

    Promise.all([loadCode(diffVersionA), loadCode(diffVersionB)])
      .then(([a, b]) => {
        setDiffCodeA(a);
        setDiffCodeB(b);
      })
      .finally(() => setDiffLoading(false));
  }, [diffMode, diffVersionA, diffVersionB, contractId, network, latestVersion, contract?.code]);

  // Syntax highlighted HTML
  const highlightedHtml = useMemo(() => {
    if (!highlighter || !displayCode) return '';
    return highlightCode(highlighter, displayCode, 'cadence', 'cadence-editor');
  }, [highlighter, displayCode]);

  const handleDiffVersionClick = useCallback((v: number) => {
    if (diffVersionA == null) {
      setDiffVersionA(v);
    } else if (diffVersionB == null && v !== diffVersionA) {
      setDiffVersionB(v);
    } else {
      setDiffVersionA(v);
      setDiffVersionB(null);
      setDiffCodeA('');
      setDiffCodeB('');
    }
  }, [diffVersionA, diffVersionB]);

  const clearDiff = useCallback(() => {
    setDiffVersionA(null);
    setDiffVersionB(null);
    setDiffCodeA('');
    setDiffCodeB('');
  }, []);

  return (
    <div className="flex gap-0 rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden" style={{ minHeight: 500 }}>
      {/* Version sidebar */}
      <div className="w-52 shrink-0 border-r border-zinc-800 flex flex-col bg-zinc-900/80">
        {/* Header + mode toggle */}
        <div className="px-3 py-2.5 border-b border-zinc-800">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">
              Versions
            </span>
            <button
              onClick={() => {
                setDiffMode(!diffMode);
                clearDiff();
              }}
              className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded transition-colors ${
                diffMode
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <GitCompare className="w-3 h-3" />
              Diff
            </button>
          </div>
          {diffMode && (
            <p className="text-[10px] text-zinc-600 mt-1">
              Select two versions to compare
            </p>
          )}
        </div>

        {/* Version list */}
        <div className="flex-1 overflow-y-auto">
          {sortedVersions.length > 0 ? (
            <div className="py-1">
              {sortedVersions.map((v) => {
                const isSelected = !diffMode && selectedVersion === v.version;
                const isLatest = v.displayVersion === latestVersion;
                const isDiffA = diffVersionA === v.version;
                const isDiffB = diffVersionB === v.version;

                return (
                  <button
                    key={v.version}
                    onClick={() => {
                      if (diffMode) {
                        handleDiffVersionClick(v.version);
                      } else {
                        loadVersion(v.version);
                      }
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                      isDiffA
                        ? 'bg-red-900/20 border-l-2 border-red-400'
                        : isDiffB
                          ? 'bg-green-900/20 border-l-2 border-green-400'
                          : isSelected || (!diffMode && selectedVersion == null && isLatest)
                            ? 'bg-zinc-800 text-zinc-100 border-l-2 border-blue-400'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 border-l-2 border-transparent'
                    }`}
                  >
                    <Layers className="w-3 h-3 shrink-0 text-zinc-500" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono font-medium">v{v.displayVersion}</span>
                        {isLatest && (
                          <span className="text-[9px] px-1 py-px rounded bg-blue-500/20 text-blue-400">
                            latest
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-600 mt-0.5">
                        {v.created_at
                          ? new Date(v.created_at).toLocaleDateString()
                          : `Block #${v.block_height?.toLocaleString()}`}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="py-1">
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-left bg-zinc-800 text-zinc-100 border-l-2 border-blue-400"
              >
                <Layers className="w-3 h-3 shrink-0 text-zinc-500" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-mono font-medium">v{latestVersion}</span>
                  <span className="text-[9px] px-1 py-px rounded bg-blue-500/20 text-blue-400 ml-1.5">
                    latest
                  </span>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Open in Editor link */}
        <div className="border-t border-zinc-800 p-2">
          <Link
            to={`/editor?code=${encodeURIComponent(displayCode)}&name=${encodeURIComponent(contractName || '')}`}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-medium rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 transition-colors w-full"
          >
            <ExternalLink className="w-3 h-3" />
            Open in Editor
          </Link>
        </div>
      </div>

      {/* Code area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-950/50">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            {diffMode && diffVersionA != null && diffVersionB != null ? (
              <>
                <GitCompare className="w-3.5 h-3.5" />
                <span>
                  v{toDisplayVersion(Math.min(diffVersionA, diffVersionB))} → v{toDisplayVersion(Math.max(diffVersionA, diffVersionB))}
                </span>
              </>
            ) : (
              <>
                <Code2 className="w-3.5 h-3.5" />
                <span className="font-mono">{contractName}.cdc</span>
                <span className="text-zinc-600">
                  v{selectedVersion != null ? toDisplayVersion(selectedVersion) : latestVersion}
                </span>
              </>
            )}
          </div>
          {displayCode && !diffMode && (
            <span className="text-[10px] text-zinc-600">
              {displayCode.split('\n').length} lines
            </span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {loadingCode || diffLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
            </div>
          ) : diffMode && diffVersionA != null && diffVersionB != null ? (
            <DiffView codeA={diffCodeA} codeB={diffCodeB} />
          ) : displayCode ? (
            <SourceCodeView code={displayCode} highlightedHtml={highlightedHtml} />
          ) : (
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <Code2 className="w-6 h-6 text-zinc-600 mx-auto mb-2" />
                <p className="text-xs text-zinc-500">Source code not available</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

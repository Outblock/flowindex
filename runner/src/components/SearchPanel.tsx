import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Search, X, ChevronRight, File, Replace, ReplaceAll } from 'lucide-react';
import SolidityIcon from './icons/SolidityIcon';

function CadenceIcon({ className }: { className?: string }) {
  return (
    <img
      src="https://cadence.flowindex.io/favicon.ico"
      alt="cdc"
      className={className}
      style={{ imageRendering: 'auto' }}
    />
  );
}

function FileIcon({ name, className }: { name: string; className?: string }) {
  if (name.endsWith('.cdc')) return <CadenceIcon className={className} />;
  if (name.endsWith('.sol')) return <SolidityIcon className={`${className} text-purple-400`} />;
  return <File className={`${className} text-zinc-500`} />;
}

interface SearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
  matchStart: number;
  matchEnd: number;
}

interface SearchPanelProps {
  files: { path: string; content: string; readOnly?: boolean }[];
  onOpenFileAtLine: (path: string, line: number, column: number) => void;
  onReplaceInFile?: (path: string, search: string, replace: string, line: number) => void;
  onReplaceAll?: (search: string, replace: string) => void;
}

export default function SearchPanel({ files, onOpenFileAtLine, onReplaceInFile, onReplaceAll }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    if (!query || query.length < 2) return [];

    const matches: SearchMatch[] = [];
    let regex: RegExp;
    try {
      regex = useRegex
        ? new RegExp(query, caseSensitive ? 'g' : 'gi')
        : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
    } catch {
      return [];
    }

    for (const file of files) {
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(lines[i])) !== null) {
          matches.push({
            path: file.path,
            line: i + 1,
            column: match.index + 1,
            text: lines[i],
            matchStart: match.index,
            matchEnd: match.index + match[0].length,
          });
          if (matches.length >= 500) return matches;
        }
      }
    }
    return matches;
  }, [query, files, caseSensitive, useRegex]);

  const grouped = useMemo(() => {
    const map = new Map<string, SearchMatch[]>();
    for (const m of results) {
      const arr = map.get(m.path) || [];
      arr.push(m);
      map.set(m.path, arr);
    }
    return map;
  }, [results]);

  const toggleCollapse = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const totalMatches = results.length;
  const totalFiles = grouped.size;

  return (
    <div className="flex flex-col h-full">
      {/* Search input */}
      <div className="px-2 py-2 space-y-1.5 border-b border-zinc-700">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowReplace(!showReplace)}
            className="text-zinc-500 hover:text-zinc-300 p-0.5"
            title="Toggle Replace"
          >
            <ChevronRight className={`w-3 h-3 transition-transform ${showReplace ? 'rotate-90' : ''}`} />
          </button>
          <div className="flex-1 flex items-center bg-zinc-800 border border-zinc-600 rounded px-2">
            <Search className="w-3 h-3 text-zinc-500 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="flex-1 bg-transparent text-xs text-zinc-200 py-1 px-1.5 focus:outline-none placeholder:text-zinc-600"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-zinc-500 hover:text-zinc-300">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <button
            onClick={() => setCaseSensitive(!caseSensitive)}
            className={`px-1 py-0.5 text-[10px] font-bold rounded ${
              caseSensitive ? 'text-emerald-400 bg-emerald-900/30' : 'text-zinc-500 hover:text-zinc-300'
            }`}
            title="Match Case"
          >
            Aa
          </button>
          <button
            onClick={() => setUseRegex(!useRegex)}
            className={`px-1 py-0.5 text-[10px] font-mono font-bold rounded ${
              useRegex ? 'text-emerald-400 bg-emerald-900/30' : 'text-zinc-500 hover:text-zinc-300'
            }`}
            title="Use Regex"
          >
            .*
          </button>
        </div>

        {showReplace && (
          <div className="flex items-center gap-1 pl-5">
            <div className="flex-1 flex items-center bg-zinc-800 border border-zinc-600 rounded px-2">
              <Replace className="w-3 h-3 text-zinc-500 shrink-0" />
              <input
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                placeholder="Replace"
                className="flex-1 bg-transparent text-xs text-zinc-200 py-1 px-1.5 focus:outline-none placeholder:text-zinc-600"
              />
            </div>
            {onReplaceAll && (
              <button
                onClick={() => onReplaceAll(query, replaceText)}
                className="text-zinc-500 hover:text-zinc-300 p-0.5"
                title="Replace All"
                disabled={!query}
              >
                <ReplaceAll className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Results summary */}
      {query.length >= 2 && (
        <div className="px-3 py-1 text-[10px] text-zinc-500 border-b border-zinc-700/50">
          {totalMatches === 0
            ? 'No results'
            : `${totalMatches}${totalMatches >= 500 ? '+' : ''} results in ${totalFiles} file${totalFiles > 1 ? 's' : ''}`}
        </div>
      )}

      {/* Results list */}
      <div className="flex-1 overflow-y-auto">
        {[...grouped.entries()].map(([path, matches]) => {
          const isCollapsed = collapsed.has(path);
          const fileName = path.split('/').pop() || path;
          return (
            <div key={path}>
              {/* File header */}
              <button
                onClick={() => toggleCollapse(path)}
                className="flex items-center gap-1.5 w-full px-2 py-1 text-left hover:bg-zinc-800/50 transition-colors"
              >
                <ChevronRight
                  className={`w-3 h-3 text-zinc-500 shrink-0 transition-transform ${
                    isCollapsed ? '' : 'rotate-90'
                  }`}
                />
                <FileIcon name={fileName} className="w-3.5 h-3.5 shrink-0" />
                <span className="text-[11px] text-zinc-300 truncate flex-1">{path}</span>
                <span className="text-[9px] text-zinc-600 shrink-0 bg-zinc-800 px-1 rounded">
                  {matches.length}
                </span>
              </button>

              {/* Match lines */}
              {!isCollapsed &&
                matches.map((m, i) => (
                  <button
                    key={`${m.line}-${m.column}-${i}`}
                    onClick={() => onOpenFileAtLine(m.path, m.line, m.column)}
                    className="flex items-start gap-1 w-full pl-7 pr-2 py-0.5 text-left hover:bg-zinc-800/40 transition-colors group"
                  >
                    <span className="text-[10px] text-zinc-600 shrink-0 w-6 text-right tabular-nums">
                      {m.line}
                    </span>
                    <span className="text-[11px] text-zinc-400 truncate leading-tight">
                      {m.text.slice(0, m.matchStart)}
                      <span className="bg-amber-500/25 text-amber-300 rounded-sm">
                        {m.text.slice(m.matchStart, m.matchEnd)}
                      </span>
                      {m.text.slice(m.matchEnd)}
                    </span>
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

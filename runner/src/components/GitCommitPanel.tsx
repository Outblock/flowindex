import { useState } from 'react';
import { GitBranch, Loader2 } from 'lucide-react';

interface GitCommitPanelProps {
  changedFiles: { path: string; status: 'modified' | 'new' | 'deleted' }[];
  onCommit: (message: string) => Promise<void>;
  lastCommitSha?: string | null;
  pushing: boolean;
}

const statusConfig = {
  new: { badge: 'A', badgeClass: 'bg-green-900/50 text-green-400', textClass: 'text-green-400' },
  modified: { badge: 'M', badgeClass: 'bg-amber-900/50 text-amber-400', textClass: 'text-amber-400' },
  deleted: { badge: 'D', badgeClass: 'bg-red-900/50 text-red-400', textClass: 'text-red-400' },
};

export default function GitCommitPanel({ changedFiles, onCommit, lastCommitSha, pushing }: GitCommitPanelProps) {
  const [message, setMessage] = useState('');

  async function handleCommit() {
    if (!message.trim() || pushing) return;
    await onCommit(message.trim());
    setMessage('');
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700">
        <GitBranch className="w-3.5 h-3.5 text-zinc-500" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Git Changes
        </span>
        {changedFiles.length > 0 && (
          <span className="ml-auto text-[10px] px-1.5 py-0.5 bg-zinc-800 text-zinc-400 rounded-full">
            {changedFiles.length}
          </span>
        )}
      </div>

      {/* Changed files list */}
      {changedFiles.length === 0 ? (
        <p className="px-3 text-xs text-zinc-500">No changes</p>
      ) : (
        <div className="px-2 max-h-48 overflow-y-auto">
          {changedFiles.map((file) => {
            const cfg = statusConfig[file.status];
            return (
              <div
                key={file.path}
                className="flex items-center gap-2 px-1 py-1 text-xs rounded"
              >
                <span className={`shrink-0 text-[10px] font-mono w-4 text-center rounded ${cfg.badgeClass}`}>
                  {cfg.badge}
                </span>
                <span className={`truncate ${cfg.textClass}`}>{file.path}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Commit message */}
      <div className="px-3">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Commit message..."
          rows={2}
          className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded px-2 py-1.5 resize-none focus:outline-none focus:border-zinc-600 placeholder-zinc-500"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleCommit();
            }
          }}
        />
      </div>

      {/* Commit button */}
      <div className="px-3">
        <button
          onClick={handleCommit}
          disabled={!message.trim() || pushing || changedFiles.length === 0}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
        >
          {pushing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {pushing ? 'Pushing...' : 'Commit & Push'}
        </button>
      </div>

      {/* Last commit */}
      {lastCommitSha && (
        <div className="px-3 pb-2">
          <span className="text-[10px] text-zinc-500">Last commit: </span>
          <span className="text-[10px] text-zinc-400 font-mono">{lastCommitSha.slice(0, 7)}</span>
        </div>
      )}
    </div>
  );
}

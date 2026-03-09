import { useState } from 'react';
import { Github, Loader2, RefreshCw, ExternalLink } from 'lucide-react';
import type { GitHubCommit } from '../github/api';

interface ChangedFile {
  path: string;
  status: 'modified' | 'new' | 'deleted';
}

interface GitHubPanelProps {
  connected: boolean;
  repoOwner?: string;
  repoName?: string;
  branch?: string;
  onConnect: () => void;
  onLogin: () => void;
  isLoggedIn: boolean;
  hasProject: boolean;
  changedFiles: ChangedFile[];
  onFileClick: (path: string) => void;
  selectedFile?: string;
  onCommit: (message: string) => Promise<void>;
  pushing: boolean;
  lastCommitSha?: string | null;
  commits: GitHubCommit[];
  loadingCommits: boolean;
  onRefreshCommits: () => void;
}

const statusConfig = {
  new: { badge: 'A', badgeClass: 'bg-green-900/50 text-green-400', textClass: 'text-green-400' },
  modified: { badge: 'M', badgeClass: 'bg-amber-900/50 text-amber-400', textClass: 'text-amber-400' },
  deleted: { badge: 'D', badgeClass: 'bg-red-900/50 text-red-400', textClass: 'text-red-400' },
};

export default function GitHubPanel(props: GitHubPanelProps) {
  const {
    connected, repoOwner, repoName, branch,
    onConnect, onLogin, isLoggedIn, hasProject,
    changedFiles, onFileClick, selectedFile,
    onCommit, pushing, lastCommitSha,
    commits, loadingCommits, onRefreshCommits,
  } = props;

  const [message, setMessage] = useState('');

  async function handleCommit() {
    if (!message.trim() || pushing) return;
    await onCommit(message.trim());
    setMessage('');
  }

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-4 py-8 text-center">
        <Github className="w-8 h-8 text-zinc-600" />
        <p className="text-xs text-zinc-500">Connect a GitHub repository to enable source control.</p>
        {isLoggedIn && hasProject ? (
          <button
            onClick={onConnect}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded transition-colors"
          >
            <Github className="w-3.5 h-3.5" />
            Connect GitHub
          </button>
        ) : (
          <button
            onClick={onLogin}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded transition-colors"
          >
            Sign in to connect
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Repo header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-700 shrink-0">
        <Github className="w-3.5 h-3.5 text-zinc-500" />
        <a
          href={`https://github.com/${repoOwner}/${repoName}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-zinc-400 hover:text-zinc-200 truncate transition-colors"
        >
          {repoOwner}/{repoName}
        </a>
        <span className="text-[10px] text-zinc-600 ml-auto shrink-0">{branch}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Changes section */}
        <div className="border-b border-zinc-800">
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Changes</span>
            {changedFiles.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 bg-zinc-800 text-zinc-400 rounded-full">
                {changedFiles.length}
              </span>
            )}
          </div>
          {changedFiles.length === 0 ? (
            <p className="px-3 pb-3 text-[11px] text-zinc-600">No changes</p>
          ) : (
            <div className="px-1 pb-2">
              {changedFiles.map((file) => {
                const cfg = statusConfig[file.status];
                return (
                  <button
                    key={file.path}
                    onClick={() => onFileClick(file.path)}
                    className={`flex items-center gap-2 w-full px-2 py-1 text-xs rounded transition-colors text-left ${
                      selectedFile === file.path ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
                    }`}
                  >
                    <span className={`shrink-0 text-[10px] font-mono w-4 text-center rounded ${cfg.badgeClass}`}>
                      {cfg.badge}
                    </span>
                    <span className={`truncate ${cfg.textClass}`}>{file.path}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Commit form */}
          {changedFiles.length > 0 && (
            <div className="px-3 pb-3 space-y-2">
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
              <button
                onClick={handleCommit}
                disabled={!message.trim() || pushing || changedFiles.length === 0}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs rounded transition-colors"
              >
                {pushing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {pushing ? 'Pushing...' : 'Commit & Push'}
              </button>
            </div>
          )}
        </div>

        {/* Commit History section */}
        <div>
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Commit History</span>
            <button
              onClick={onRefreshCommits}
              className="ml-auto p-0.5 text-zinc-600 hover:text-zinc-300 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-3 h-3 ${loadingCommits ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {loadingCommits && commits.length === 0 ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />
            </div>
          ) : commits.length === 0 ? (
            <p className="px-3 pb-3 text-[11px] text-zinc-600">No commits yet</p>
          ) : (
            <div className="px-1 pb-2">
              {commits.map((commit) => (
                <a
                  key={commit.sha}
                  href={commit.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-zinc-800/50 transition-colors group"
                >
                  <span className="shrink-0 text-[10px] font-mono text-emerald-400/70 pt-0.5">{commit.sha.slice(0, 7)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-zinc-300 truncate group-hover:text-zinc-100">{commit.message.split('\n')[0]}</p>
                    <p className="text-[10px] text-zinc-600">
                      {commit.author_name} · {formatRelativeTime(commit.date)}
                    </p>
                  </div>
                  <ExternalLink className="w-3 h-3 text-zinc-700 group-hover:text-zinc-500 shrink-0 mt-0.5" />
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Last commit footer */}
      {lastCommitSha && (
        <div className="px-3 py-1.5 border-t border-zinc-800 shrink-0">
          <span className="text-[10px] text-zinc-600">Last push: </span>
          <span className="text-[10px] text-zinc-500 font-mono">{lastCommitSha.slice(0, 7)}</span>
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

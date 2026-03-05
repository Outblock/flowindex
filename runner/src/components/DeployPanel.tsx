import { useState } from 'react';
import { CheckCircle2, XCircle, Loader2, Clock, Rocket, Settings, GitBranch, ExternalLink, RefreshCw, ChevronDown, ArrowUpRight, Play, RotateCcw } from 'lucide-react';
import type { GitHubConnection } from '../github/useGitHub';
import type { DeployEnvironment, Deployment } from '../github/api';

interface DeployPanelProps {
  connection: GitHubConnection;
  environments: DeployEnvironment[];
  deployments: Deployment[];
  onPromote: (fromBranch: string, toBranch: string) => Promise<{ pr_url: string }>;
  onDispatch: (action: 'deploy' | 'dry-run' | 'rollback', commitSha?: string) => Promise<unknown>;
  onRefresh: () => void;
  onOpenSettings: () => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function DeployStatusIcon({ status }: { status: Deployment['status'] }) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />;
    case 'failed':
      return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    case 'running':
      return <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />;
    case 'pending':
      return <Clock className="w-3.5 h-3.5 text-zinc-400" />;
    case 'cancelled':
      return <XCircle className="w-3.5 h-3.5 text-zinc-500" />;
  }
}

function statusColor(status: Deployment['status']): string {
  switch (status) {
    case 'success': return 'text-green-400';
    case 'failed': return 'text-red-400';
    case 'running': return 'text-amber-400';
    case 'pending': return 'text-zinc-400';
    case 'cancelled': return 'text-zinc-500';
  }
}

export default function DeployPanel({
  connection,
  environments,
  deployments,
  onPromote,
  onDispatch,
  onRefresh,
  onOpenSettings,
}: DeployPanelProps) {
  const [showActions, setShowActions] = useState(false);
  const [showRollback, setShowRollback] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const successfulDeploys = deployments.filter(d => d.status === 'success');
  const canPromote = environments.length > 1;

  async function handlePromote() {
    if (environments.length < 2) return;
    setPromoting(true);
    setActionError(null);
    try {
      // Promote from first env to second env (typically staging -> production)
      const sorted = [...environments].sort((a, b) => {
        if (a.is_default && !b.is_default) return -1;
        if (!a.is_default && b.is_default) return 1;
        return 0;
      });
      const result = await onPromote(sorted[0].branch, sorted[1].branch);
      window.open(result.pr_url, '_blank');
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Promote failed');
    } finally {
      setPromoting(false);
    }
  }

  async function handleDispatch(action: 'deploy' | 'dry-run' | 'rollback', sha?: string) {
    setDispatching(true);
    setActionError(null);
    try {
      await onDispatch(action, sha);
      setShowRollback(false);
      setShowActions(false);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setDispatching(false);
    }
  }

  return (
    <div className="space-y-1">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <Rocket className="w-3 h-3 text-zinc-500 shrink-0" />
          <span className="text-[10px] text-zinc-400 truncate">
            {connection.repo_owner}/{connection.repo_name}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onRefresh}
            className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
          <button
            onClick={onOpenSettings}
            className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors"
            title="Deploy settings"
          >
            <Settings className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Environment cards */}
      {environments.length > 0 && (
        <div className="px-3 space-y-1">
          {environments.map((env) => {
            const latest = deployments.find(d => d.environment_id === env.id || (d.branch === env.branch && d.network === env.network));
            return (
              <div key={env.id} className="flex items-center gap-2 px-2 py-1.5 bg-zinc-800/50 rounded">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-zinc-300 font-medium">{env.name}</span>
                    <span className={`text-[9px] ${env.network === 'mainnet' ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {env.network}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <GitBranch className="w-2.5 h-2.5 text-zinc-600" />
                    <span className="text-[9px] text-zinc-500">{env.branch}</span>
                  </div>
                </div>
                {latest ? (
                  <DeployStatusIcon status={latest.status} />
                ) : (
                  <span className="text-[9px] text-zinc-600">--</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Actions */}
      <div className="px-3">
        <button
          onClick={() => setShowActions(!showActions)}
          className="flex items-center gap-1 w-full px-2 py-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <ChevronDown className={`w-3 h-3 transition-transform ${showActions ? 'rotate-180' : ''}`} />
          Actions
        </button>

        {showActions && (
          <div className="space-y-1 pb-1">
            {actionError && (
              <div className="px-2 py-1 bg-red-900/30 border border-red-800 rounded text-[10px] text-red-400">
                {actionError}
              </div>
            )}
            <div className="flex flex-wrap gap-1">
              {canPromote && (
                <button
                  onClick={handlePromote}
                  disabled={promoting || dispatching}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] text-zinc-400 border border-zinc-700 rounded hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-50 transition-colors"
                >
                  {promoting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowUpRight className="w-3 h-3" />}
                  Promote
                </button>
              )}
              <button
                onClick={() => handleDispatch('dry-run')}
                disabled={dispatching}
                className="flex items-center gap-1 px-2 py-1 text-[10px] text-zinc-400 border border-zinc-700 rounded hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-50 transition-colors"
              >
                {dispatching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                Dry Run
              </button>
              <button
                onClick={() => setShowRollback(!showRollback)}
                disabled={dispatching || successfulDeploys.length === 0}
                className="flex items-center gap-1 px-2 py-1 text-[10px] text-zinc-400 border border-zinc-700 rounded hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-50 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Rollback
              </button>
            </div>

            {/* Rollback picker */}
            {showRollback && successfulDeploys.length > 0 && (
              <div className="border border-zinc-800 rounded mt-1">
                <div className="px-2 py-1 text-[9px] text-zinc-500 border-b border-zinc-800">
                  Select deployment to roll back to:
                </div>
                {successfulDeploys.slice(0, 5).map((d) => (
                  <button
                    key={d.id}
                    onClick={() => handleDispatch('rollback', d.commit_sha)}
                    disabled={dispatching}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-zinc-800 transition-colors disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />
                    <span className="text-[10px] text-zinc-300 font-mono">{d.commit_sha.slice(0, 7)}</span>
                    <span className="text-[10px] text-zinc-500 truncate flex-1">
                      {d.commit_message?.slice(0, 30) || 'No message'}
                    </span>
                    <span className="text-[9px] text-zinc-600 shrink-0">{timeAgo(d.created_at)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Deployment history */}
      {deployments.length > 0 && (
        <div className="border-t border-zinc-800">
          <div className="px-3 py-1 text-[9px] text-zinc-600 uppercase tracking-wider">Recent Deployments</div>
          {deployments.slice(0, 5).map((d) => (
            <div key={d.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800/50 transition-colors">
              <DeployStatusIcon status={d.status} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-zinc-300 font-mono">{d.commit_sha.slice(0, 7)}</span>
                  <span className={`text-[9px] ${statusColor(d.status)}`}>{d.status}</span>
                </div>
                <div className="text-[10px] text-zinc-500 truncate">
                  {d.commit_message || d.branch}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[9px] text-zinc-600">{timeAgo(d.created_at)}</span>
                {d.logs_url && (
                  <a
                    href={d.logs_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-600 hover:text-zinc-300 transition-colors"
                    title="View logs"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {deployments.length === 0 && environments.length === 0 && (
        <div className="px-3 py-2">
          <button
            onClick={onOpenSettings}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-zinc-500 border border-dashed border-zinc-700 rounded hover:border-zinc-600 hover:text-zinc-300 transition-colors"
          >
            <Settings className="w-3.5 h-3.5" />
            Configure deploy environments
          </button>
        </div>
      )}
    </div>
  );
}

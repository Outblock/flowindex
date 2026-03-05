import { useState } from 'react';
import { CheckCircle2, XCircle, Loader2, Rocket, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import type { WorkflowRun } from '../github/api';

interface DeployStatusProps {
  runs: WorkflowRun[];
  repoOwner: string;
  repoName: string;
  workflowConfigured: boolean;
  onSetupWorkflow: () => void;
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

function runStatus(run: WorkflowRun): 'success' | 'failure' | 'pending' {
  if (run.status === 'completed') {
    return run.conclusion === 'success' ? 'success' : 'failure';
  }
  return 'pending';
}

function StatusIcon({ status }: { status: 'success' | 'failure' | 'pending' }) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />;
    case 'failure':
      return <XCircle className="w-3.5 h-3.5 text-red-400" />;
    case 'pending':
      return <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />;
  }
}

function RunItem({ run, compact }: { run: WorkflowRun; compact?: boolean }) {
  const status = runStatus(run);
  const commitMsg = run.head_commit?.message || '';
  const truncated = commitMsg.length > 50 ? commitMsg.slice(0, 50) + '...' : commitMsg;

  return (
    <a
      href={run.html_url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center gap-2 hover:bg-zinc-800 transition-colors rounded ${
        compact ? 'px-2 py-1' : 'px-3 py-2'
      }`}
    >
      <StatusIcon status={status} />
      <span className="text-xs text-zinc-300 truncate flex-1">{truncated}</span>
      <span className="text-[10px] text-zinc-500 shrink-0">{timeAgo(run.updated_at)}</span>
      <ExternalLink className="w-3 h-3 text-zinc-600 shrink-0" />
    </a>
  );
}

export default function DeployStatus({ runs, workflowConfigured, onSetupWorkflow }: DeployStatusProps) {
  const [expanded, setExpanded] = useState(false);

  if (!workflowConfigured) {
    return (
      <button
        onClick={onSetupWorkflow}
        className="flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-400 border border-zinc-700 rounded hover:border-zinc-600 hover:text-zinc-300 transition-colors"
      >
        <Rocket className="w-3.5 h-3.5" />
        Setup Deploy
      </button>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-500">
        <Rocket className="w-3.5 h-3.5" />
        No deployments yet
      </div>
    );
  }

  const latest = runs[0];
  const rest = runs.slice(1, 5);

  return (
    <div className="border border-zinc-800 rounded">
      <RunItem run={latest} />
      {rest.length > 0 && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center gap-1 px-3 py-1 text-[10px] text-zinc-500 hover:text-zinc-400 transition-colors border-t border-zinc-800"
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            {expanded ? 'Hide' : `${rest.length} more`}
          </button>
          {expanded && rest.map((run) => (
            <RunItem key={run.id} run={run} compact />
          ))}
        </>
      )}
    </div>
  );
}

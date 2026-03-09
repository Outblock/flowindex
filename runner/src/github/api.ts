const API_BASE = import.meta.env.VITE_RUNNER_API_URL || '';

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface GitHubRepo {
  id: number;
  full_name: string;
  owner: string;
  name: string;
  default_branch: string;
  private: boolean;
}

export interface GitHubFile {
  name: string;
  path: string;
  type: 'file' | 'dir';
  sha: string;
  size: number;
}

export interface CommitResult {
  sha: string;
  message: string;
  url: string;
}

export interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  head_sha: string;
  html_url: string;
  head_commit: { message: string };
}

export interface DeployEnvironment {
  id: string;
  connection_id: string;
  name: string;
  branch: string;
  network: string;
  flow_address: string | null;
  secrets_configured: boolean;
  is_default: boolean;
  created_at: string;
}

export interface Deployment {
  id: string;
  connection_id: string;
  environment_id: string | null;
  commit_sha: string;
  commit_message: string | null;
  commit_author: string | null;
  branch: string;
  network: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  workflow_run_id: number | null;
  logs_url: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  trigger_type: string;
  created_at: string;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  author_name: string;
  author_avatar: string | null;
  date: string;
  url: string;
}

export const githubApi = {
  listRepos: (installationId: number) =>
    fetchApi<{ repos: GitHubRepo[] }>(
      `/github/repos?installation_id=${installationId}`,
    ),

  getTree: (
    installationId: number,
    owner: string,
    repo: string,
    path = '',
    ref = 'main',
  ) =>
    fetchApi<{ files: GitHubFile[] }>(
      `/github/tree/${owner}/${repo}?installation_id=${installationId}&path=${encodeURIComponent(path)}&ref=${ref}`,
    ),

  getFile: (
    installationId: number,
    owner: string,
    repo: string,
    filePath: string,
    ref = 'main',
  ) =>
    fetchApi<{ path: string; content: string; sha: string }>(
      `/github/file/${owner}/${repo}/${filePath}?installation_id=${installationId}&ref=${ref}`,
    ),

  commit: (body: {
    installation_id: number;
    owner: string;
    repo: string;
    branch: string;
    message: string;
    files: {
      path: string;
      content: string;
      action: 'create' | 'update' | 'delete';
    }[];
  }) =>
    fetchApi<CommitResult>('/github/commit', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  pushWorkflow: (body: {
    installation_id: number;
    owner: string;
    repo: string;
    branch: string;
    path: string;
    network: string;
  }) =>
    fetchApi<{
      sha: string;
      workflow_path: string;
      secrets_needed: string[];
    }>('/github/workflow', { method: 'POST', body: JSON.stringify(body) }),

  listRuns: (installationId: number, owner: string, repo: string) =>
    fetchApi<{ runs: WorkflowRun[] }>(
      `/github/runs/${owner}/${repo}?installation_id=${installationId}`,
    ),

  setSecrets: (body: {
    installation_id: number;
    owner: string;
    repo: string;
    environment_name: string;
    flow_address: string;
    flow_private_key: string;
    flow_key_index: string;
  }) =>
    fetchApi<{ success: boolean; secrets: string[] }>('/github/secrets', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  promote: (body: {
    installation_id: number;
    owner: string;
    repo: string;
    from_branch: string;
    to_branch: string;
    title?: string;
    environments?: { from: { name: string; network: string }; to: { name: string; network: string } };
  }) =>
    fetchApi<{ pr_number: number; pr_url: string }>('/github/promote', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  dispatch: (body: {
    installation_id: number;
    owner: string;
    repo: string;
    action: 'deploy' | 'dry-run' | 'rollback';
    commit_sha?: string;
  }) =>
    fetchApi<{ dispatched: boolean }>('/github/dispatch', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listCommits: (
    installationId: number,
    owner: string,
    repo: string,
    branch?: string,
    path?: string,
  ) =>
    fetchApi<{ commits: GitHubCommit[] }>(
      `/github/commits/${owner}/${repo}?installation_id=${installationId}${branch ? `&branch=${branch}` : ''}${path ? `&path=${encodeURIComponent(path)}` : ''}`,
    ),
};

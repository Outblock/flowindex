import { useState, useEffect, useCallback } from 'react';
import { Github, Folder, FolderOpen, ArrowLeft, X, Loader2, Search, GitBranch, Plus, RefreshCw } from 'lucide-react';
import { githubApi, type GitHubRepo, type GitHubFile } from '../github/api';

const API_BASE = import.meta.env.VITE_RUNNER_API_URL || '';

interface GitHubConnectProps {
  onConnect: (installationId: number, owner: string, repo: string, path: string, branch: string) => Promise<void>;
  onClose: () => void;
  installationId?: number;
}

type Step = 'install' | 'repo' | 'directory' | 'confirm';

export default function GitHubConnect({ onConnect, onClose, installationId }: GitHubConnectProps) {
  const [step, setStep] = useState<Step>(installationId ? 'repo' : 'install');
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [search, setSearch] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [files, setFiles] = useState<GitHubFile[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [selectedPath, setSelectedPath] = useState('/');
  const [branch, setBranch] = useState('');
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNewRepo, setShowNewRepo] = useState(false);
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoPrivate, setNewRepoPrivate] = useState(false);
  const [creating, setCreating] = useState(false);

  const refreshRepos = useCallback(() => {
    if (!installationId) return;
    setLoading(true);
    setError(null);
    githubApi.listRepos(installationId)
      .then(({ repos }) => { setRepos(repos); setStep('repo'); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [installationId]);

  // Fetch repos when we have an installation ID
  useEffect(() => { refreshRepos(); }, [refreshRepos]);

  const filteredRepos = repos.filter((r) =>
    r.full_name.toLowerCase().includes(search.toLowerCase()),
  );

  async function handleSelectRepo(repo: GitHubRepo) {
    setSelectedRepo(repo);
    setBranch(repo.default_branch);
    setCurrentPath('');
    setSelectedPath('/');
    setStep('directory');
    await fetchTree(repo, '');
  }

  async function fetchTree(repo: GitHubRepo, path: string) {
    if (!installationId) return;
    setLoading(true);
    setError(null);
    try {
      const { files } = await githubApi.getTree(installationId, repo.owner, repo.name, path, repo.default_branch);
      setFiles(files);
      setCurrentPath(path);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load directory');
    } finally {
      setLoading(false);
    }
  }

  async function handleNavigate(dir: GitHubFile) {
    if (!selectedRepo) return;
    setSelectedPath(dir.path);
    await fetchTree(selectedRepo, dir.path);
  }

  function handleGoBack() {
    if (!selectedRepo) return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const parentPath = parts.join('/');
    setSelectedPath(parentPath || '/');
    fetchTree(selectedRepo, parentPath);
  }

  async function handleConnect() {
    if (!installationId || !selectedRepo) return;
    setConnecting(true);
    setError(null);
    try {
      await onConnect(installationId, selectedRepo.owner, selectedRepo.name, selectedPath, branch);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setConnecting(false);
    }
  }

  async function handleCreateRepo() {
    if (!installationId || !newRepoName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const repo = await githubApi.createRepo({
        installation_id: installationId,
        name: newRepoName.trim(),
        is_private: newRepoPrivate,
      });
      setShowNewRepo(false);
      setNewRepoName('');
      // Auto-select the newly created repo
      handleSelectRepo(repo);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create repo');
    } finally {
      setCreating(false);
    }
  }

  const steps: { key: Step; label: string }[] = [
    { key: 'install', label: 'Install' },
    { key: 'repo', label: 'Repository' },
    { key: 'directory', label: 'Directory' },
    { key: 'confirm', label: 'Connect' },
  ];

  const currentStepIndex = steps.findIndex((s) => s.key === step);

  const dirs = files.filter((f) => f.type === 'dir');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl w-full max-w-lg mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
          <div className="flex items-center gap-2 text-zinc-200 text-sm font-medium">
            <Github className="w-4 h-4" />
            Connect GitHub Repository
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-zinc-800">
          {steps.map((s, i) => (
            <div key={s.key} className="flex items-center gap-1">
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded ${
                  i <= currentStepIndex
                    ? 'bg-emerald-600/20 text-emerald-400'
                    : 'bg-zinc-800 text-zinc-600'
                }`}
              >
                {s.label}
              </span>
              {i < steps.length - 1 && <span className="text-zinc-700 text-[10px]">›</span>}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="p-4 min-h-[300px] max-h-[400px] flex flex-col">
          {error && (
            <div className="mb-3 px-3 py-2 bg-red-900/30 border border-red-800 rounded text-xs text-red-400">
              {error}
            </div>
          )}

          {/* Step: Install */}
          {step === 'install' && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4">
              <Github className="w-10 h-10 text-zinc-500" />
              <p className="text-sm text-zinc-400 text-center">
                Install the GitHub App to connect your repositories.
              </p>
              <a
                href={`${API_BASE}/github/install`}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded transition-colors"
              >
                <Github className="w-4 h-4" />
                Install GitHub App
              </a>
            </div>
          )}

          {/* Step: Repo selection */}
          {step === 'repo' && (
            <div className="flex-1 flex flex-col gap-2 overflow-hidden">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search repositories..."
                    className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded pl-8 pr-3 py-2 focus:outline-none focus:border-zinc-600 placeholder-zinc-500"
                    autoFocus
                  />
                </div>
                <button
                  onClick={refreshRepos}
                  disabled={loading}
                  className="p-2 bg-zinc-800 border border-zinc-700 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors disabled:opacity-50"
                  title="Refresh repo list"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={() => setShowNewRepo((v) => !v)}
                  className="flex items-center gap-1 px-2 py-2 bg-zinc-800 border border-zinc-700 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors text-xs whitespace-nowrap"
                  title="Create a new repository"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New
                </button>
              </div>
              {showNewRepo && (
                <div className="flex items-center gap-2 p-2 bg-zinc-800/50 border border-zinc-700 rounded">
                  <input
                    value={newRepoName}
                    onChange={(e) => setNewRepoName(e.target.value)}
                    placeholder="repo-name"
                    className="flex-1 bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-zinc-600 placeholder-zinc-500"
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateRepo()}
                    autoFocus
                  />
                  <label className="flex items-center gap-1 text-[10px] text-zinc-500 cursor-pointer select-none">
                    <input type="checkbox" checked={newRepoPrivate} onChange={(e) => setNewRepoPrivate(e.target.checked)} className="rounded" />
                    Private
                  </label>
                  <button
                    onClick={handleCreateRepo}
                    disabled={creating || !newRepoName.trim()}
                    className="px-2 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs rounded transition-colors"
                  >
                    {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Create'}
                  </button>
                </div>
              )}
              <div className="flex-1 overflow-y-auto">
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
                  </div>
                ) : filteredRepos.length === 0 ? (
                  <p className="text-xs text-zinc-500 text-center py-8">No repositories found</p>
                ) : (
                  filteredRepos.map((repo) => (
                    <button
                      key={repo.id}
                      onClick={() => handleSelectRepo(repo)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left rounded hover:bg-zinc-800 transition-colors text-zinc-300"
                    >
                      <Github className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                      <span className="truncate">{repo.full_name}</span>
                      {repo.private && (
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 bg-zinc-800 text-zinc-500 rounded">private</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Step: Directory browser */}
          {step === 'directory' && selectedRepo && (
            <div className="flex-1 flex flex-col gap-2 overflow-hidden">
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <button
                  onClick={() => { setStep('repo'); setSelectedRepo(null); }}
                  className="hover:text-zinc-200 transition-colors"
                >
                  {selectedRepo.full_name}
                </button>
                <span className="text-zinc-600">/</span>
                <span className="text-zinc-300">{currentPath || '(root)'}</span>
              </div>

              <div className="flex-1 overflow-y-auto border border-zinc-800 rounded">
                {currentPath && (
                  <button
                    onClick={handleGoBack}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors border-b border-zinc-800"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    ..
                  </button>
                )}
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
                  </div>
                ) : dirs.length === 0 ? (
                  <p className="text-xs text-zinc-500 text-center py-4">No subdirectories</p>
                ) : (
                  dirs.map((dir) => (
                    <button
                      key={dir.path}
                      onClick={() => handleNavigate(dir)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-zinc-800 transition-colors ${
                        selectedPath === dir.path ? 'bg-zinc-700 text-emerald-400' : 'text-zinc-300'
                      }`}
                    >
                      {selectedPath === dir.path ? (
                        <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <Folder className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                      )}
                      <span className="truncate">{dir.name}</span>
                    </button>
                  ))
                )}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => { setSelectedPath(currentPath || '/'); setStep('confirm'); }}
                  className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  Use current directory: <span className="font-mono">{currentPath || '/'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Step: Confirm */}
          {step === 'confirm' && selectedRepo && (
            <div className="flex-1 flex flex-col gap-4">
              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Repository</label>
                  <div className="text-xs text-zinc-200 flex items-center gap-2">
                    <Github className="w-3.5 h-3.5 text-zinc-500" />
                    {selectedRepo.full_name}
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Path</label>
                  <div className="text-xs text-zinc-200 font-mono">
                    {selectedPath || '/'}
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Branch</label>
                  <div className="flex items-center gap-2">
                    <GitBranch className="w-3.5 h-3.5 text-zinc-500" />
                    <input
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-zinc-600 w-48"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-auto flex items-center gap-2">
                <button
                  onClick={() => setStep('directory')}
                  className="px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleConnect}
                  disabled={connecting || !branch}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs rounded transition-colors ml-auto"
                >
                  {connecting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Connect
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

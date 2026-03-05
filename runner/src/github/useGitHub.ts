import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../auth/supabaseClient';
import {
  githubApi,
  type CommitResult,
  type WorkflowRun,
} from './api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubConnection {
  id: string;
  installation_id: number;
  repo_owner: string;
  repo_name: string;
  repo_path: string;
  branch: string;
  network: string;
  workflow_configured: boolean;
  last_commit_sha: string | null;
}

// ---------------------------------------------------------------------------
// Edge-function helper (mirrors useProjects pattern)
// ---------------------------------------------------------------------------

async function callEdge<T = unknown>(
  endpoint: string,
  data: Record<string, unknown>,
  accessToken: string | null,
): Promise<T> {
  if (!supabase) throw new Error('Supabase not configured');
  if (!accessToken) throw new Error('Not authenticated');

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };
  const { data: result, error } = await supabase.functions.invoke(
    'runner-projects',
    { body: { endpoint, data }, headers },
  );
  if (error) throw new Error(error.message || 'Edge function error');
  if (!result.success)
    throw new Error(result.error?.message || 'Unknown error');
  return result.data as T;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useGitHub(projectId: string | undefined) {
  const { accessToken } = useAuth();

  const [connection, setConnection] = useState<GitHubConnection | null>(null);
  const [loading, setLoading] = useState(false);
  const [latestRuns, setLatestRuns] = useState<WorkflowRun[]>([]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- fetch connection ----------------------------------------------------

  const fetchConnection = useCallback(async () => {
    if (!projectId || !accessToken) return;
    setLoading(true);
    try {
      const result = await callEdge<{ connection: GitHubConnection | null }>(
        '/github/connection',
        { project_id: projectId },
        accessToken,
      );
      setConnection(result.connection);
    } catch {
      setConnection(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, accessToken]);

  // ---- connect / disconnect ------------------------------------------------

  const connect = useCallback(
    async (
      installationId: number,
      repoOwner: string,
      repoName: string,
      repoPath: string,
      branch: string,
    ): Promise<GitHubConnection> => {
      if (!projectId) throw new Error('No project selected');
      await callEdge(
        '/github/connect',
        {
          project_id: projectId,
          installation_id: installationId,
          repo_owner: repoOwner,
          repo_name: repoName,
          repo_path: repoPath,
          branch,
        },
        accessToken,
      );
      // Fetch and return the new connection (state update is async,
      // so callers that need the connection immediately should use the return value)
      const result = await callEdge<{ connection: GitHubConnection | null }>(
        '/github/connection',
        { project_id: projectId },
        accessToken,
      );
      const conn = result.connection;
      setConnection(conn);
      if (!conn) throw new Error('Connection not found after save');
      return conn;
    },
    [projectId, accessToken],
  );

  const disconnect = useCallback(async () => {
    if (!projectId || !connection) return;
    await callEdge(
      '/github/disconnect',
      { project_id: projectId },
      accessToken,
    );
    setConnection(null);
    setLatestRuns([]);
  }, [projectId, connection, accessToken]);

  // ---- pull files ----------------------------------------------------------

  const pullFiles = useCallback(async (
    connOverride?: GitHubConnection,
  ): Promise<
    { path: string; content: string }[]
  > => {
    const conn = connOverride ?? connection;
    if (!conn) throw new Error('No GitHub connection');

    const { installation_id, repo_owner, repo_name, repo_path, branch } =
      conn;

    const files: { path: string; content: string }[] = [];

    // Recursive directory walker
    async function walk(dirPath: string) {
      const { files: entries } = await githubApi.getTree(
        installation_id,
        repo_owner,
        repo_name,
        dirPath,
        branch,
      );

      for (const entry of entries) {
        if (entry.type === 'dir') {
          await walk(entry.path);
        } else if (
          entry.name.endsWith('.cdc') ||
          entry.name === 'flow.json'
        ) {
          const { content } = await githubApi.getFile(
            installation_id,
            repo_owner,
            repo_name,
            entry.path,
            branch,
          );
          // Strip repo_path prefix so paths are relative to project root
          let relativePath = entry.path;
          if (repo_path && relativePath.startsWith(repo_path)) {
            relativePath = relativePath.slice(repo_path.length);
            if (relativePath.startsWith('/')) {
              relativePath = relativePath.slice(1);
            }
          }
          files.push({ path: relativePath, content });
        }
      }
    }

    // Normalize: "/" means root, same as ""
    const startPath = (!repo_path || repo_path === '/') ? '' : repo_path;
    await walk(startPath);
    return files;
  }, [connection]);

  // ---- commit & push -------------------------------------------------------

  const commitAndPush = useCallback(
    async (
      message: string,
      filesToCommit: { path: string; content: string }[],
    ): Promise<CommitResult> => {
      if (!connection) throw new Error('No GitHub connection');

      const { installation_id, repo_owner, repo_name, repo_path, branch } =
        connection;

      // Normalize: "/" means root (same as no prefix)
      const prefix = (!repo_path || repo_path === '/') ? '' : repo_path;
      const prefixedFiles = filesToCommit.map((f) => ({
        path: prefix ? `${prefix}/${f.path}` : f.path,
        content: f.content,
        action: 'create' as const,
      }));

      const result = await githubApi.commit({
        installation_id,
        owner: repo_owner,
        repo: repo_name,
        branch,
        message,
        files: prefixedFiles,
      });

      // Update last commit sha via edge function
      await callEdge(
        '/github/update-commit',
        { project_id: connection.id, last_commit_sha: result.sha },
        accessToken,
      ).catch(() => {
        // Non-critical — ignore
      });

      return result;
    },
    [connection, accessToken],
  );

  // ---- setup workflow ------------------------------------------------------

  const setupWorkflow = useCallback(
    async (network: string) => {
      if (!connection) throw new Error('No GitHub connection');

      const { installation_id, repo_owner, repo_name, repo_path, branch } =
        connection;

      const result = await githubApi.pushWorkflow({
        installation_id,
        owner: repo_owner,
        repo: repo_name,
        branch,
        path: repo_path || '.',
        network,
      });

      // Mark workflow as configured
      await callEdge(
        '/github/update-workflow',
        { project_id: connection.id, workflow_configured: true },
        accessToken,
      ).catch(() => {
        // Non-critical — ignore
      });

      await fetchConnection();
      return result;
    },
    [connection, accessToken, fetchConnection],
  );

  // ---- fetch runs ----------------------------------------------------------

  const fetchRuns = useCallback(async () => {
    if (!connection) return;
    try {
      const { runs } = await githubApi.listRuns(
        connection.installation_id,
        connection.repo_owner,
        connection.repo_name,
      );
      setLatestRuns(runs);
    } catch {
      // Silently fail
    }
  }, [connection]);

  // ---- auto-load connection on mount ---------------------------------------

  useEffect(() => {
    fetchConnection();
  }, [fetchConnection]);

  // ---- poll runs every 30s when workflow is configured ----------------------

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    if (connection?.workflow_configured) {
      // Fetch immediately, then poll
      fetchRuns();
      pollRef.current = setInterval(fetchRuns, 30_000);
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [connection?.workflow_configured, fetchRuns]);

  return {
    connection,
    loading,
    connect,
    disconnect,
    pullFiles,
    commitAndPush,
    setupWorkflow,
    latestRuns,
    fetchRuns,
    fetchConnection,
  };
}

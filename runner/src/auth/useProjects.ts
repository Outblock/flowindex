import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from './supabaseClient';

export interface CloudProject {
  id: string;
  name: string;
  slug: string;
  network: string;
  is_public: boolean;
  active_file: string;
  open_files: string[];
  folders: string[];
  updated_at: string;
}

export interface CloudProjectFull extends CloudProject {
  user_id: string;
  files: { path: string; content: string }[];
}

export function useProjects() {
  const { accessToken, user } = useAuth();
  const [projects, setProjects] = useState<CloudProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const callEdgeFunction = useCallback(
    async <T = unknown>(
      endpoint: string,
      data: Record<string, unknown> = {},
      requireAuth = true,
    ): Promise<T> => {
      if (!supabase) throw new Error('Supabase not configured');
      if (requireAuth && !accessToken) throw new Error('Not authenticated');
      const headers: Record<string, string> = {};
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      const { data: result, error } = await supabase.functions.invoke(
        'runner-projects',
        { body: { endpoint, data }, headers },
      );
      if (error) throw new Error(error.message || 'Edge function error');
      if (!result.success)
        throw new Error(result.error?.message || 'Unknown error');
      return result.data as T;
    },
    [accessToken],
  );

  const fetchProjects = useCallback(async () => {
    if (!user || !accessToken) return;
    setLoading(true);
    try {
      const result =
        await callEdgeFunction<{ projects: CloudProject[] }>('/projects/list');
      setProjects(result.projects);
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [user, accessToken, callEdgeFunction]);

  const getProject = useCallback(
    async (slug: string): Promise<CloudProjectFull | null> => {
      try {
        const result = await callEdgeFunction<{
          project: CloudProject;
          files: { path: string; content: string }[];
        }>(
          '/projects/get',
          { slug },
          false, // auth optional
        );
        return { ...result.project, files: result.files };
      } catch {
        return null;
      }
    },
    [callEdgeFunction],
  );

  const saveProject = useCallback(
    async (
      projectState: {
        files: { path: string; content: string; readOnly?: boolean }[];
        activeFile: string;
        openFiles: string[];
        folders: string[];
      },
      meta: {
        id?: string;
        name?: string;
        slug?: string;
        network?: string;
        is_public?: boolean;
      },
    ): Promise<{ id: string; slug: string }> => {
      setSaving(true);
      try {
        const userFiles = projectState.files.filter(
          (f) => !f.readOnly && !f.path.startsWith('deps/'),
        );
        const result = await callEdgeFunction<{ id: string; slug: string }>(
          '/projects/save',
          {
            id: meta.id,
            name: meta.name || 'Untitled',
            slug: meta.slug,
            network: meta.network || 'mainnet',
            is_public: meta.is_public || false,
            active_file: projectState.activeFile,
            open_files: projectState.openFiles,
            folders: projectState.folders,
            files: userFiles.map((f) => ({ path: f.path, content: f.content })),
          },
        );
        setLastSaved(new Date());
        return result;
      } finally {
        setSaving(false);
      }
    },
    [callEdgeFunction],
  );

  const deleteProject = useCallback(
    async (id: string) => {
      await callEdgeFunction('/projects/delete', { id });
      await fetchProjects();
    },
    [callEdgeFunction, fetchProjects],
  );

  const forkProject = useCallback(
    async (slug: string): Promise<{ id: string; slug: string }> => {
      const result = await callEdgeFunction<{ id: string; slug: string }>(
        '/projects/fork',
        { slug },
      );
      await fetchProjects();
      return result;
    },
    [callEdgeFunction, fetchProjects],
  );

  // Auto-fetch projects when user is authenticated
  useEffect(() => {
    if (user) fetchProjects();
  }, [user, fetchProjects]);

  return {
    projects,
    loading,
    saving,
    lastSaved,
    fetchProjects,
    getProject,
    saveProject,
    deleteProject,
    forkProject,
  };
}

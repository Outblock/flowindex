-- GitHub App installation connections for Runner projects
CREATE TABLE IF NOT EXISTS public.runner_github_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.user_projects(id) ON DELETE SET NULL,
  installation_id BIGINT NOT NULL,
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  repo_path TEXT NOT NULL DEFAULT '/',
  branch TEXT NOT NULL DEFAULT 'main',
  network TEXT NOT NULL DEFAULT 'testnet',
  workflow_configured BOOLEAN DEFAULT FALSE,
  last_synced_at TIMESTAMPTZ,
  last_commit_sha TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_runner_github_connections_user
  ON public.runner_github_connections(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_runner_github_connections_project
  ON public.runner_github_connections(project_id) WHERE project_id IS NOT NULL;

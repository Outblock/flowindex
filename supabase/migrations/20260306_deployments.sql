-- Deployment history — records every deploy/rollback/dry-run
CREATE TABLE IF NOT EXISTS public.runner_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.runner_github_connections(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES public.runner_deploy_environments(id) ON DELETE SET NULL,
  commit_sha TEXT NOT NULL,
  commit_message TEXT,
  commit_author TEXT,
  branch TEXT NOT NULL,
  network TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  workflow_run_id BIGINT,
  logs_url TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  trigger_type TEXT NOT NULL DEFAULT 'push',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deployments_connection
  ON public.runner_deployments(connection_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_deployments_workflow_run
  ON public.runner_deployments(workflow_run_id);

GRANT ALL ON public.runner_deployments TO service_role;

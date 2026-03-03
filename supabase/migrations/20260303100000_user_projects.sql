-- Cloud-saved Runner projects
CREATE TABLE IF NOT EXISTS public.user_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled',
  slug TEXT NOT NULL UNIQUE,
  network TEXT NOT NULL DEFAULT 'mainnet' CHECK (network IN ('mainnet', 'testnet')),
  is_public BOOLEAN NOT NULL DEFAULT false,
  active_file TEXT NOT NULL DEFAULT 'main.cdc',
  open_files TEXT[] NOT NULL DEFAULT ARRAY['main.cdc'],
  folders TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own projects"
  ON public.user_projects FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Public projects are readable"
  ON public.user_projects FOR SELECT
  USING (is_public = true);

CREATE INDEX idx_user_projects_user_id ON public.user_projects(user_id);
CREATE INDEX idx_user_projects_slug ON public.user_projects(slug);

CREATE TABLE IF NOT EXISTS public.project_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.user_projects(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  UNIQUE (project_id, path)
);

ALTER TABLE public.project_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own project files"
  ON public.project_files FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_projects p
      WHERE p.id = project_files.project_id AND p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_projects p
      WHERE p.id = project_files.project_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "Public project files are readable"
  ON public.project_files FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_projects p
      WHERE p.id = project_files.project_id AND p.is_public = true
    )
  );

CREATE INDEX idx_project_files_project_id ON public.project_files(project_id);

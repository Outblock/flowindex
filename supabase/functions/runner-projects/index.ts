import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RequestBody {
  endpoint: string;
  data: Record<string, unknown>;
}

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

// ---------------------------------------------------------------------------
// Response helpers (same pattern as flow-keys)
// ---------------------------------------------------------------------------

function success<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

function error(code: string, message: string): ApiResponse {
  return { success: false, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Auth helper — extracts authenticated user from JWT
// ---------------------------------------------------------------------------

async function getAuthUser(
  req: Request,
  supabaseUrl: string,
): Promise<{ id: string } | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;

  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await userClient.auth.getUser();
  return user;
}

// ---------------------------------------------------------------------------
// Slug generation helper
// ---------------------------------------------------------------------------

function generateSlug(name: string): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'project';
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers':
          'Content-Type, Authorization, apikey, x-client-info',
      },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { endpoint, data }: RequestBody = await req.json();

    let result: ApiResponse;

    switch (endpoint) {
      // -------------------------------------------------------------------
      // /projects/list — Return user's projects (metadata only)
      // -------------------------------------------------------------------
      case '/projects/list': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            {
              status: 401,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            },
          );
        }

        const { data: projects, error: listError } = await supabaseAdmin
          .from('user_projects')
          .select(
            'id, name, slug, network, is_public, active_file, updated_at',
          )
          .eq('user_id', user.id)
          .order('updated_at', { ascending: false });

        if (listError) {
          result = error('DB_ERROR', listError.message);
          break;
        }

        result = success({ projects: projects || [] });
        break;
      }

      // -------------------------------------------------------------------
      // /projects/get — Fetch project + files (public readable by anyone)
      // -------------------------------------------------------------------
      case '/projects/get': {
        const { slug } = data as { slug: string };

        if (!slug) {
          result = error('MISSING_PARAMS', 'slug is required');
          break;
        }

        // Fetch project by slug
        const { data: project, error: fetchError } = await supabaseAdmin
          .from('user_projects')
          .select('*')
          .eq('slug', slug)
          .single();

        if (fetchError || !project) {
          result = error('NOT_FOUND', 'Project not found');
          break;
        }

        // Auth check — only needed for private projects
        if (!project.is_public) {
          const user = await getAuthUser(req, supabaseUrl);
          if (!user || user.id !== project.user_id) {
            result = error('FORBIDDEN', 'Access denied');
            break;
          }
        }

        // Fetch project files
        const { data: files, error: filesError } = await supabaseAdmin
          .from('project_files')
          .select('id, path, content')
          .eq('project_id', project.id)
          .order('path', { ascending: true });

        if (filesError) {
          result = error('DB_ERROR', filesError.message);
          break;
        }

        result = success({ project, files: files || [] });
        break;
      }

      // -------------------------------------------------------------------
      // /projects/save — Create or update a project
      // -------------------------------------------------------------------
      case '/projects/save': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            {
              status: 401,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            },
          );
        }

        const {
          id,
          name,
          slug,
          network,
          is_public,
          active_file,
          open_files,
          folders,
          files,
        } = data as {
          id?: string;
          name: string;
          slug?: string;
          network: string;
          is_public: boolean;
          active_file: string;
          open_files: string[];
          folders: string[];
          files: { path: string; content: string }[];
        };

        if (!name) {
          result = error('MISSING_PARAMS', 'name is required');
          break;
        }

        if (id) {
          // ---- UPDATE existing project ----

          // Verify ownership
          const { data: existing, error: fetchError } = await supabaseAdmin
            .from('user_projects')
            .select('id, slug')
            .eq('id', id)
            .eq('user_id', user.id)
            .single();

          if (fetchError || !existing) {
            result = error('NOT_FOUND', 'Project not found or access denied');
            break;
          }

          // Update project metadata (only set fields that are provided)
          const updateFields: Record<string, unknown> = {
            updated_at: new Date().toISOString(),
          };
          if (name !== undefined) updateFields.name = name;
          if (network !== undefined) updateFields.network = network;
          if (is_public !== undefined) updateFields.is_public = is_public;
          if (active_file !== undefined) updateFields.active_file = active_file;
          if (open_files !== undefined) updateFields.open_files = open_files;
          if (folders !== undefined) updateFields.folders = folders;

          const { error: updateError } = await supabaseAdmin
            .from('user_projects')
            .update(updateFields)
            .eq('id', id);

          if (updateError) {
            result = error('DB_ERROR', updateError.message);
            break;
          }

          // Sync files: get current paths, delete removed, upsert remaining
          const { data: currentFiles } = await supabaseAdmin
            .from('project_files')
            .select('id, path')
            .eq('project_id', id);

          const newPaths = new Set((files || []).map((f) => f.path));
          const toDelete = (currentFiles || []).filter(
            (f) => !newPaths.has(f.path),
          );

          if (toDelete.length > 0) {
            await supabaseAdmin
              .from('project_files')
              .delete()
              .in(
                'id',
                toDelete.map((f) => f.id),
              );
          }

          // Upsert files
          if (files && files.length > 0) {
            const fileRows = files.map((f) => ({
              project_id: id,
              path: f.path,
              content: f.content,
            }));

            const { error: upsertError } = await supabaseAdmin
              .from('project_files')
              .upsert(fileRows, {
                onConflict: 'project_id,path',
              });

            if (upsertError) {
              result = error('DB_ERROR', upsertError.message);
              break;
            }
          }

          result = success({ id, slug: existing.slug });
        } else {
          // ---- CREATE new project ----

          const projectSlug = slug || generateSlug(name);

          const { data: inserted, error: insertError } = await supabaseAdmin
            .from('user_projects')
            .insert({
              user_id: user.id,
              name,
              slug: projectSlug,
              network,
              is_public: is_public ?? false,
              active_file: active_file || 'main.cdc',
              open_files: open_files || ['main.cdc'],
              folders: folders || [],
            })
            .select('id, slug')
            .single();

          if (insertError) {
            result = error('DB_ERROR', insertError.message);
            break;
          }

          // Insert files
          if (files && files.length > 0) {
            const fileRows = files.map((f) => ({
              project_id: inserted.id,
              path: f.path,
              content: f.content,
            }));

            const { error: filesInsertError } = await supabaseAdmin
              .from('project_files')
              .insert(fileRows);

            if (filesInsertError) {
              result = error('DB_ERROR', filesInsertError.message);
              break;
            }
          }

          result = success({ id: inserted.id, slug: inserted.slug });
        }

        break;
      }

      // -------------------------------------------------------------------
      // /projects/delete — Delete a project (CASCADE deletes files)
      // -------------------------------------------------------------------
      case '/projects/delete': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            {
              status: 401,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            },
          );
        }

        const { id: deleteId } = data as { id: string };

        if (!deleteId) {
          result = error('MISSING_PARAMS', 'id is required');
          break;
        }

        const { data: deleted, error: deleteError } = await supabaseAdmin
          .from('user_projects')
          .delete()
          .eq('id', deleteId)
          .eq('user_id', user.id)
          .select('id')
          .single();

        if (deleteError || !deleted) {
          result = error('NOT_FOUND', 'Project not found or access denied');
          break;
        }

        result = success({ deleted: true });
        break;
      }

      // -------------------------------------------------------------------
      // /projects/fork — Fork a public (or owned) project
      // -------------------------------------------------------------------
      case '/projects/fork': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            {
              status: 401,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            },
          );
        }

        const { slug: forkSlug } = data as { slug: string };

        if (!forkSlug) {
          result = error('MISSING_PARAMS', 'slug is required');
          break;
        }

        // Fetch original project
        const { data: original, error: origError } = await supabaseAdmin
          .from('user_projects')
          .select('*')
          .eq('slug', forkSlug)
          .single();

        if (origError || !original) {
          result = error('NOT_FOUND', 'Project not found');
          break;
        }

        // Verify access: must be public or owned by user
        if (!original.is_public && original.user_id !== user.id) {
          result = error('FORBIDDEN', 'Cannot fork a private project');
          break;
        }

        // Fetch original files
        const { data: origFiles, error: origFilesError } = await supabaseAdmin
          .from('project_files')
          .select('path, content')
          .eq('project_id', original.id);

        if (origFilesError) {
          result = error('DB_ERROR', origFilesError.message);
          break;
        }

        // Create forked project
        const forkedName = `Fork of ${original.name}`;
        const forkedSlug = generateSlug(forkedName);

        const { data: forked, error: forkError } = await supabaseAdmin
          .from('user_projects')
          .insert({
            user_id: user.id,
            name: forkedName,
            slug: forkedSlug,
            network: original.network,
            is_public: false,
            active_file: original.active_file,
            open_files: original.open_files || [],
            folders: original.folders || {},
          })
          .select('id, slug')
          .single();

        if (forkError) {
          result = error('DB_ERROR', forkError.message);
          break;
        }

        // Copy files
        if (origFiles && origFiles.length > 0) {
          const fileRows = origFiles.map((f) => ({
            project_id: forked.id,
            path: f.path,
            content: f.content,
          }));

          const { error: copyError } = await supabaseAdmin
            .from('project_files')
            .insert(fileRows);

          if (copyError) {
            result = error('DB_ERROR', copyError.message);
            break;
          }
        }

        result = success({ id: forked.id, slug: forked.slug });
        break;
      }

      // -------------------------------------------------------------------
      // /github/connect — Upsert a GitHub connection for a project
      // -------------------------------------------------------------------
      case '/github/connect': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            {
              status: 401,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            },
          );
        }
        const {
          project_id,
          installation_id,
          repo_owner,
          repo_name,
          repo_path,
          branch,
          network,
        } = data as {
          project_id: string;
          installation_id: number;
          repo_owner: string;
          repo_name: string;
          repo_path?: string;
          branch?: string;
          network?: string;
        };
        const { data: conn, error: connError } = await supabaseAdmin
          .from('runner_github_connections')
          .upsert(
            {
              user_id: user.id,
              project_id,
              installation_id,
              repo_owner,
              repo_name,
              repo_path: repo_path || '/',
              branch: branch || 'main',
              network: network || 'testnet',
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'project_id' },
          )
          .select('*')
          .single();
        if (connError) {
          result = error('DB_ERROR', connError.message);
          break;
        }
        result = success({ connection: conn });
        break;
      }

      // -------------------------------------------------------------------
      // /github/disconnect — Remove a GitHub connection
      // -------------------------------------------------------------------
      case '/github/disconnect': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            {
              status: 401,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            },
          );
        }
        const { project_id } = data as { project_id: string };
        await supabaseAdmin
          .from('runner_github_connections')
          .delete()
          .eq('project_id', project_id)
          .eq('user_id', user.id);
        result = success({ disconnected: true });
        break;
      }

      // -------------------------------------------------------------------
      // /github/connection — Get connection for a specific project
      // -------------------------------------------------------------------
      case '/github/connection': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            {
              status: 401,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            },
          );
        }
        const { project_id: connProjectId } = data as { project_id: string };
        const { data: connData } = await supabaseAdmin
          .from('runner_github_connections')
          .select('*')
          .eq('project_id', connProjectId)
          .eq('user_id', user.id)
          .single();
        result = success({ connection: connData || null });
        break;
      }

      // -------------------------------------------------------------------
      // /github/connections — List all user's GitHub connections
      // -------------------------------------------------------------------
      case '/github/connections': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            {
              status: 401,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
            },
          );
        }
        const { data: conns } = await supabaseAdmin
          .from('runner_github_connections')
          .select('*')
          .eq('user_id', user.id)
          .order('updated_at', { ascending: false });
        result = success({ connections: conns || [] });
        break;
      }

      default:
        result = error('NOT_FOUND', `Unknown endpoint: ${endpoint}`);
    }

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify(
        error(
          'UNKNOWN_ERROR',
          e instanceof Error ? e.message : 'Internal server error',
        ),
      ),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  }
}, { port: Number(Deno.env.get('PORT')) || 8000 });

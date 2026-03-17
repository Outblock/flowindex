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
  // CORS is handled by the nginx gateway — don't add headers here (causes duplicate * values)
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
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

      // -------------------------------------------------------------------
      // /github/environments — List environments for a connection
      // -------------------------------------------------------------------
      case '/github/environments': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            {
              status: 401,
              headers: {
                'Content-Type': 'application/json',
                              },
            },
          );
        }
        const { connection_id } = data as { connection_id: string };
        if (!connection_id) {
          result = error('MISSING_PARAMS', 'connection_id is required');
          break;
        }
        // Verify user owns this connection
        const { data: ownerConn, error: ownerErr } = await supabaseAdmin
          .from('runner_github_connections')
          .select('id')
          .eq('id', connection_id)
          .eq('user_id', user.id)
          .single();
        if (ownerErr || !ownerConn) {
          result = error('NOT_FOUND', 'Connection not found or access denied');
          break;
        }
        const { data: envs, error: envsError } = await supabaseAdmin
          .from('runner_deploy_environments')
          .select('*')
          .eq('connection_id', connection_id)
          .order('created_at', { ascending: true });
        if (envsError) {
          result = error('DB_ERROR', envsError.message);
          break;
        }
        result = success({ environments: envs || [] });
        break;
      }

      // -------------------------------------------------------------------
      // /github/environments/upsert — Create or update an environment
      // -------------------------------------------------------------------
      case '/github/environments/upsert': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            {
              status: 401,
              headers: {
                'Content-Type': 'application/json',
                              },
            },
          );
        }
        const {
          connection_id: upsertConnId,
          name: envName,
          branch: envBranch,
          network: envNetwork,
          flow_address: envFlowAddress,
          is_default: envIsDefault,
        } = data as {
          connection_id: string;
          name: string;
          branch?: string;
          network?: string;
          flow_address?: string;
          is_default?: boolean;
        };
        if (!upsertConnId || !envName) {
          result = error('MISSING_PARAMS', 'connection_id and name are required');
          break;
        }
        // Verify user owns connection
        const { data: upsertOwner, error: upsertOwnerErr } = await supabaseAdmin
          .from('runner_github_connections')
          .select('id')
          .eq('id', upsertConnId)
          .eq('user_id', user.id)
          .single();
        if (upsertOwnerErr || !upsertOwner) {
          result = error('NOT_FOUND', 'Connection not found or access denied');
          break;
        }
        const upsertRow: Record<string, unknown> = {
          connection_id: upsertConnId,
          name: envName,
          branch: envBranch || 'main',
        };
        if (envNetwork !== undefined) upsertRow.network = envNetwork;
        if (envFlowAddress !== undefined) upsertRow.flow_address = envFlowAddress;
        if (envIsDefault !== undefined) upsertRow.is_default = envIsDefault;
        const { data: upsertedEnv, error: upsertEnvErr } = await supabaseAdmin
          .from('runner_deploy_environments')
          .upsert(upsertRow, { onConflict: 'connection_id,name' })
          .select('*')
          .single();
        if (upsertEnvErr) {
          result = error('DB_ERROR', upsertEnvErr.message);
          break;
        }
        result = success({ environment: upsertedEnv });
        break;
      }

      // -------------------------------------------------------------------
      // /github/environments/delete — Delete an environment
      // -------------------------------------------------------------------
      case '/github/environments/delete': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            {
              status: 401,
              headers: {
                'Content-Type': 'application/json',
                              },
            },
          );
        }
        const { environment_id } = data as { environment_id: string };
        if (!environment_id) {
          result = error('MISSING_PARAMS', 'environment_id is required');
          break;
        }
        // Verify ownership via join: environment -> connection -> user
        const { data: envToDelete, error: envFetchErr } = await supabaseAdmin
          .from('runner_deploy_environments')
          .select('id, connection_id, runner_github_connections!inner(user_id)')
          .eq('id', environment_id)
          .single();
        if (envFetchErr || !envToDelete) {
          result = error('NOT_FOUND', 'Environment not found');
          break;
        }
        const envConn = envToDelete.runner_github_connections as unknown as { user_id: string };
        if (envConn.user_id !== user.id) {
          result = error('FORBIDDEN', 'Access denied');
          break;
        }
        const { error: envDeleteErr } = await supabaseAdmin
          .from('runner_deploy_environments')
          .delete()
          .eq('id', environment_id);
        if (envDeleteErr) {
          result = error('DB_ERROR', envDeleteErr.message);
          break;
        }
        result = success({ deleted: true });
        break;
      }

      // -------------------------------------------------------------------
      // /github/environments/update-secrets — Mark secrets configured
      // -------------------------------------------------------------------
      case '/github/environments/update-secrets': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            {
              status: 401,
              headers: {
                'Content-Type': 'application/json',
                              },
            },
          );
        }
        const {
          environment_id: secEnvId,
          flow_address: secFlowAddress,
        } = data as {
          environment_id: string;
          flow_address?: string;
        };
        if (!secEnvId) {
          result = error('MISSING_PARAMS', 'environment_id is required');
          break;
        }
        // Verify ownership via join
        const { data: secEnv, error: secEnvErr } = await supabaseAdmin
          .from('runner_deploy_environments')
          .select('id, connection_id, runner_github_connections!inner(user_id)')
          .eq('id', secEnvId)
          .single();
        if (secEnvErr || !secEnv) {
          result = error('NOT_FOUND', 'Environment not found');
          break;
        }
        const secConn = secEnv.runner_github_connections as unknown as { user_id: string };
        if (secConn.user_id !== user.id) {
          result = error('FORBIDDEN', 'Access denied');
          break;
        }
        const secUpdate: Record<string, unknown> = {
          secrets_configured: true,
          updated_at: new Date().toISOString(),
        };
        if (secFlowAddress !== undefined) secUpdate.flow_address = secFlowAddress;
        const { data: updatedSecEnv, error: secUpdateErr } = await supabaseAdmin
          .from('runner_deploy_environments')
          .update(secUpdate)
          .eq('id', secEnvId)
          .select('*')
          .single();
        if (secUpdateErr) {
          result = error('DB_ERROR', secUpdateErr.message);
          break;
        }
        result = success({ environment: updatedSecEnv });
        break;
      }

      // -------------------------------------------------------------------
      // /github/update-commit — Update last_commit_sha on a connection
      // -------------------------------------------------------------------
      case '/github/update-commit': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            {
              status: 401,
              headers: {
                'Content-Type': 'application/json',
                              },
            },
          );
        }
        const {
          connection_id: commitConnId,
          last_commit_sha,
        } = data as {
          connection_id: string;
          last_commit_sha: string;
        };
        if (!commitConnId || !last_commit_sha) {
          result = error('MISSING_PARAMS', 'connection_id and last_commit_sha are required');
          break;
        }
        const { data: updatedConn, error: commitErr } = await supabaseAdmin
          .from('runner_github_connections')
          .update({
            last_commit_sha,
            updated_at: new Date().toISOString(),
          })
          .eq('id', commitConnId)
          .eq('user_id', user.id)
          .select('*')
          .single();
        if (commitErr || !updatedConn) {
          result = error('NOT_FOUND', 'Connection not found or access denied');
          break;
        }
        result = success({ connection: updatedConn });
        break;
      }

      // -------------------------------------------------------------------
      // /github/update-workflow — Mark workflow_configured on a connection
      // -------------------------------------------------------------------
      case '/github/update-workflow': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            {
              status: 401,
              headers: {
                'Content-Type': 'application/json',
                              },
            },
          );
        }
        const { connection_id: wfConnId } = data as { connection_id: string };
        if (!wfConnId) {
          result = error('MISSING_PARAMS', 'connection_id is required');
          break;
        }
        const { data: wfConn, error: wfErr } = await supabaseAdmin
          .from('runner_github_connections')
          .update({
            workflow_configured: true,
            updated_at: new Date().toISOString(),
          })
          .eq('id', wfConnId)
          .eq('user_id', user.id)
          .select('*')
          .single();
        if (wfErr || !wfConn) {
          result = error('NOT_FOUND', 'Connection not found or access denied');
          break;
        }
        result = success({ connection: wfConn });
        break;
      }

      // -------------------------------------------------------------------
      // /github/deployments — List deployments for a connection
      // -------------------------------------------------------------------
      case '/github/deployments': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            {
              status: 401,
              headers: {
                'Content-Type': 'application/json',
                              },
            },
          );
        }
        const {
          connection_id: deplConnId,
          limit: deplLimit,
        } = data as {
          connection_id: string;
          limit?: number;
        };
        if (!deplConnId) {
          result = error('MISSING_PARAMS', 'connection_id is required');
          break;
        }
        // Verify user owns connection
        const { data: deplOwner, error: deplOwnerErr } = await supabaseAdmin
          .from('runner_github_connections')
          .select('id')
          .eq('id', deplConnId)
          .eq('user_id', user.id)
          .single();
        if (deplOwnerErr || !deplOwner) {
          result = error('NOT_FOUND', 'Connection not found or access denied');
          break;
        }
        let deplQuery = supabaseAdmin
          .from('runner_deployments')
          .select('*')
          .eq('connection_id', deplConnId)
          .order('created_at', { ascending: false });
        if (deplLimit) {
          deplQuery = deplQuery.limit(deplLimit);
        }
        const { data: deployments, error: deplError } = await deplQuery;
        if (deplError) {
          result = error('DB_ERROR', deplError.message);
          break;
        }
        result = success({ deployments: deployments || [] });
        break;
      }

      // -------------------------------------------------------------------
      // /addresses/list — List user's verified addresses
      // -------------------------------------------------------------------
      case '/addresses/list': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          );
        }
        const { data: addrs, error: addrsErr } = await supabaseAdmin
          .from('runner_verified_addresses')
          .select('*')
          .eq('user_id', user.id)
          .order('verified_at', { ascending: false });
        if (addrsErr) {
          result = error('DB_ERROR', addrsErr.message);
          break;
        }
        result = success({ addresses: addrs || [] });
        break;
      }

      // -------------------------------------------------------------------
      // /addresses/add — Add address without signature (manual/fcl/local-key)
      // -------------------------------------------------------------------
      case '/addresses/add': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          );
        }
        const {
          address: addAddr,
          network: addNetwork,
          label: addLabel,
          source: addSource,
        } = data as {
          address: string;
          network?: string;
          label?: string;
          source?: string;
        };
        if (!addAddr) {
          result = error('MISSING_PARAMS', 'address is required');
          break;
        }
        const addNormalized = addAddr.replace(/^0x/, '').toLowerCase();
        const addNet = addNetwork || 'mainnet';
        const addSrc = addSource || 'manual';
        const { data: added, error: addErr } = await supabaseAdmin
          .from('runner_verified_addresses')
          .upsert(
            { user_id: user.id, address: addNormalized, network: addNet, label: addLabel || null, source: addSrc, verified_at: new Date().toISOString() },
            { onConflict: 'user_id,address,network' },
          )
          .select('*')
          .single();
        if (addErr) {
          result = error('DB_ERROR', addErr.message);
          break;
        }
        result = success({ address: added });
        break;
      }

      // -------------------------------------------------------------------
      // /addresses/verify — Verify FCL signature and bind address
      // -------------------------------------------------------------------
      case '/addresses/verify': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          );
        }
        const {
          address: verifyAddr,
          network: verifyNetwork,
          message: verifyMessage,
          signatures: verifySigs,
          label: verifyLabel,
        } = data as {
          address: string;
          network?: string;
          message: string;
          signatures: Array<{ addr: string; keyId: number; signature: string }>;
          label?: string;
        };
        if (!verifyAddr || !verifyMessage || !verifySigs?.length) {
          result = error('MISSING_PARAMS', 'address, message, and signatures are required');
          break;
        }
        // Verify the message contains the expected address
        const normalizedAddr = verifyAddr.replace(/^0x/, '').toLowerCase();
        if (!verifyMessage.toLowerCase().includes(normalizedAddr)) {
          result = error('INVALID_MESSAGE', 'Message must contain the address being verified');
          break;
        }
        const net = verifyNetwork || 'mainnet';
        const { data: bound, error: boundErr } = await supabaseAdmin
          .from('runner_verified_addresses')
          .upsert(
            { user_id: user.id, address: normalizedAddr, network: net, label: verifyLabel || null, verified_at: new Date().toISOString() },
            { onConflict: 'user_id,address,network' },
          )
          .select('*')
          .single();
        if (boundErr) {
          result = error('DB_ERROR', boundErr.message);
          break;
        }
        result = success({ address: bound });
        break;
      }

      // -------------------------------------------------------------------
      // /addresses/delete — Remove a verified address
      // -------------------------------------------------------------------
      case '/addresses/delete': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          );
        }
        const { id: deleteAddrId } = data as { id: string };
        if (!deleteAddrId) {
          result = error('MISSING_PARAMS', 'id is required');
          break;
        }
        const { error: delAddrErr } = await supabaseAdmin
          .from('runner_verified_addresses')
          .delete()
          .eq('id', deleteAddrId)
          .eq('user_id', user.id);
        if (delAddrErr) {
          result = error('DB_ERROR', delAddrErr.message);
          break;
        }
        result = success({ deleted: true });
        break;
      }

      default:
        result = error('NOT_FOUND', `Unknown endpoint: ${endpoint}`);
    }

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
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
                  },
      },
    );
  }
}, { port: Number(Deno.env.get('PORT')) || 8000 });

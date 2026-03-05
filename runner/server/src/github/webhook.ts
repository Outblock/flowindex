import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';

const webhookRouter = Router();
const WEBHOOK_SECRET = process.env.GITHUB_APP_WEBHOOK_SECRET || '';

// Broadcast function — injected from index.ts
let broadcastFn: ((projectId: string, event: unknown) => void) | null = null;
export function setBroadcast(fn: (projectId: string, event: unknown) => void) {
  broadcastFn = fn;
}

// Supabase REST API calls for recording deployments
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Helper: record deployment to runner_deployments table via PostgREST
async function recordDeployment(deployData: Record<string, unknown>) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/runner_deployments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(deployData),
    });
  } catch (err) {
    console.error('[webhook] Failed to record deployment:', err);
  }
}

// Helper: find connection by repo
async function findConnectionByRepo(owner: string, repo: string): Promise<any | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/runner_github_connections?repo_owner=eq.${owner}&repo_name=eq.${repo}&select=*`,
      { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } },
    );
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch { return null; }
}

// Helper: find environment by branch
async function findEnvironmentByBranch(connectionId: string, branch: string): Promise<any | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/runner_deploy_environments?connection_id=eq.${connectionId}&branch=eq.${branch}&select=*`,
      { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } },
    );
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch { return null; }
}

// Verify webhook signature
function verifySignature(payload: string, signature: string): boolean {
  if (!WEBHOOK_SECRET) return true;
  const expected = `sha256=${crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch { return false; }
}

// Main webhook handler
webhookRouter.post('/', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-hub-signature-256'] as string;
    const event = req.headers['x-github-event'] as string;

    if (WEBHOOK_SECRET && signature) {
      const payload = JSON.stringify(req.body);
      if (!verifySignature(payload, signature)) {
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }
    }

    const body = req.body;

    if (event === 'workflow_run') {
      const { action, workflow_run: run } = body;
      const owner = run?.repository?.owner?.login || body.repository?.owner?.login;
      const repo = run?.repository?.name || body.repository?.name;
      const branch = run?.head_branch;
      const sha = run?.head_sha;

      const conn = await findConnectionByRepo(owner, repo);
      if (!conn) { res.json({ ok: true, skipped: true }); return; }

      const env = await findEnvironmentByBranch(conn.id, branch);

      const deployData: Record<string, unknown> = {
        connection_id: conn.id,
        environment_id: env?.id || null,
        commit_sha: sha,
        commit_message: run.head_commit?.message || null,
        commit_author: run.head_commit?.author?.name || null,
        branch,
        network: env?.network || 'unknown',
        workflow_run_id: run.id,
        logs_url: run.html_url,
        trigger_type: run.event === 'workflow_dispatch' ? 'manual' : 'push',
      };

      if (action === 'requested' || action === 'in_progress') {
        deployData.status = 'running';
        deployData.started_at = run.run_started_at || run.created_at;
      } else if (action === 'completed') {
        deployData.status = run.conclusion === 'success' ? 'success' : 'failed';
        deployData.completed_at = run.updated_at;
        if (run.run_started_at && run.updated_at) {
          deployData.duration_ms = new Date(run.updated_at).getTime() - new Date(run.run_started_at).getTime();
        }
      }

      await recordDeployment(deployData);

      if (broadcastFn) {
        broadcastFn(conn.project_id, {
          type: action === 'completed'
            ? (run.conclusion === 'success' ? 'deploy:completed' : 'deploy:failed')
            : 'deploy:started',
          data: { sha, branch, network: env?.network, environment: env?.name, status: deployData.status, logs_url: run.html_url, duration_ms: deployData.duration_ms },
        });
      }
    }

    if (event === 'push') {
      const owner = body.repository?.owner?.login || body.repository?.owner?.name;
      const repo = body.repository?.name;
      const branch = body.ref?.replace('refs/heads/', '');
      const sha = body.after;
      const message = body.head_commit?.message;
      const author = body.head_commit?.author?.name;

      const conn = await findConnectionByRepo(owner, repo);
      if (conn && broadcastFn) {
        broadcastFn(conn.project_id, {
          type: 'deploy:push',
          data: { sha, branch, message, author },
        });
      }
    }

    res.json({ ok: true });
  } catch (err: unknown) {
    console.error('[webhook] Error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Simplified callback from workflow notify step
webhookRouter.post('/deploy', async (req: Request, res: Response) => {
  try {
    const { status, sha, branch, network, run_id, action } = req.body;
    console.log(`[webhook/deploy] status=${status} sha=${sha} branch=${branch} network=${network} run_id=${run_id} action=${action}`);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Internal error' });
  }
});

export { webhookRouter };

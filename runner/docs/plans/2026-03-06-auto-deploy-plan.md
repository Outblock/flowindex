# Runner Auto-Deploy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the Runner's GitHub integration into a Vercel-like deployment platform for Cadence smart contracts, with multi-environment support, secrets management, webhook-driven real-time status, and rollback capabilities.

**Architecture:** GitHub Actions handles all deployments (secrets never leave GitHub). Runner server receives webhooks for real-time status via WebSocket. Multi-environment support maps branches to networks (e.g., `main → mainnet`, `dev → testnet`). Promote flow creates PRs with GitHub App comments.

**Tech Stack:** Express (runner server), @octokit/app, libsodium-wrappers (secrets encryption), WebSocket (ws), Supabase edge functions (Deno), React hooks + Shadcn UI (frontend).

**Design Doc:** `runner/docs/plans/2026-03-06-auto-deploy-design.md`

---

## Task 1: Database — Deploy Environments Table

**Files:**
- Create: `supabase/migrations/20260306_deploy_environments.sql`

**Step 1: Write migration**

```sql
-- Deploy environments — maps branch → network per project
CREATE TABLE IF NOT EXISTS public.runner_deploy_environments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID NOT NULL REFERENCES public.runner_github_connections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  branch TEXT NOT NULL,
  network TEXT NOT NULL DEFAULT 'mainnet',
  flow_address TEXT,
  secrets_configured BOOLEAN DEFAULT FALSE,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(connection_id, name),
  UNIQUE(connection_id, branch)
);

CREATE INDEX IF NOT EXISTS idx_deploy_environments_connection
  ON public.runner_deploy_environments(connection_id);

GRANT ALL ON public.runner_deploy_environments TO service_role;
```

**Step 2: Commit**

```bash
git add supabase/migrations/20260306_deploy_environments.sql
git commit -m "feat: add runner_deploy_environments table"
```

---

## Task 2: Database — Deployments History Table

**Files:**
- Create: `supabase/migrations/20260306_deployments.sql`

**Step 1: Write migration**

```sql
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
```

**Step 2: Commit**

```bash
git add supabase/migrations/20260306_deployments.sql
git commit -m "feat: add runner_deployments table"
```

---

## Task 3: Edge Function — Environment CRUD Endpoints

**Files:**
- Modify: `supabase/functions/runner-projects/index.ts` (add before `default:` case at ~line 633)

**Step 1: Add environment endpoints**

Add these cases to the switch statement, before the `default:` case:

```typescript
      // -------------------------------------------------------------------
      // /github/environments — List environments for a connection
      // -------------------------------------------------------------------
      case '/github/environments': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            { status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
          );
        }
        const { connection_id } = data as { connection_id: string };
        // Verify user owns this connection
        const { data: conn } = await supabaseAdmin
          .from('runner_github_connections')
          .select('id')
          .eq('id', connection_id)
          .eq('user_id', user.id)
          .single();
        if (!conn) {
          result = error('NOT_FOUND', 'Connection not found');
          break;
        }
        const { data: envs } = await supabaseAdmin
          .from('runner_deploy_environments')
          .select('*')
          .eq('connection_id', connection_id)
          .order('is_default', { ascending: false });
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
            { status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
          );
        }
        const { connection_id, name, branch, network, flow_address, is_default } = data as {
          connection_id: string;
          name: string;
          branch: string;
          network: string;
          flow_address?: string;
          is_default?: boolean;
        };
        // Verify ownership
        const { data: connCheck } = await supabaseAdmin
          .from('runner_github_connections')
          .select('id')
          .eq('id', connection_id)
          .eq('user_id', user.id)
          .single();
        if (!connCheck) {
          result = error('NOT_FOUND', 'Connection not found');
          break;
        }
        const { data: env, error: envError } = await supabaseAdmin
          .from('runner_deploy_environments')
          .upsert(
            { connection_id, name, branch, network, flow_address: flow_address || null, is_default: is_default || false },
            { onConflict: 'connection_id,name' },
          )
          .select('*')
          .single();
        if (envError) {
          result = error('DB_ERROR', envError.message);
          break;
        }
        result = success({ environment: env });
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
            { status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
          );
        }
        const { environment_id } = data as { environment_id: string };
        // Join to verify ownership
        const { data: envToDelete } = await supabaseAdmin
          .from('runner_deploy_environments')
          .select('id, connection_id, runner_github_connections!inner(user_id)')
          .eq('id', environment_id)
          .single();
        if (!envToDelete || (envToDelete as any).runner_github_connections?.user_id !== user.id) {
          result = error('NOT_FOUND', 'Environment not found');
          break;
        }
        await supabaseAdmin.from('runner_deploy_environments').delete().eq('id', environment_id);
        result = success({ deleted: true });
        break;
      }

      // -------------------------------------------------------------------
      // /github/update-commit — Update last commit SHA
      // -------------------------------------------------------------------
      case '/github/update-commit': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            { status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
          );
        }
        const { project_id, last_commit_sha } = data as { project_id: string; last_commit_sha: string };
        await supabaseAdmin
          .from('runner_github_connections')
          .update({ last_commit_sha, last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('project_id', project_id)
          .eq('user_id', user.id);
        result = success({ updated: true });
        break;
      }

      // -------------------------------------------------------------------
      // /github/update-workflow — Mark workflow as configured
      // -------------------------------------------------------------------
      case '/github/update-workflow': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            { status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
          );
        }
        const { project_id, workflow_configured } = data as { project_id: string; workflow_configured: boolean };
        await supabaseAdmin
          .from('runner_github_connections')
          .update({ workflow_configured, updated_at: new Date().toISOString() })
          .eq('project_id', project_id)
          .eq('user_id', user.id);
        result = success({ updated: true });
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
            { status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
          );
        }
        const { connection_id, limit: deployLimit } = data as { connection_id: string; limit?: number };
        // Verify ownership
        const { data: connOwner } = await supabaseAdmin
          .from('runner_github_connections')
          .select('id')
          .eq('id', connection_id)
          .eq('user_id', user.id)
          .single();
        if (!connOwner) {
          result = error('NOT_FOUND', 'Connection not found');
          break;
        }
        const { data: deployments } = await supabaseAdmin
          .from('runner_deployments')
          .select('*')
          .eq('connection_id', connection_id)
          .order('created_at', { ascending: false })
          .limit(deployLimit || 20);
        result = success({ deployments: deployments || [] });
        break;
      }

      // -------------------------------------------------------------------
      // /github/environments/update-secrets — Mark secrets as configured
      // -------------------------------------------------------------------
      case '/github/environments/update-secrets': {
        const user = await getAuthUser(req, supabaseUrl);
        if (!user) {
          return new Response(
            JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
            { status: 401, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } },
          );
        }
        const { environment_id, secrets_configured, flow_address } = data as {
          environment_id: string;
          secrets_configured: boolean;
          flow_address?: string;
        };
        const updateData: Record<string, unknown> = { secrets_configured };
        if (flow_address) updateData.flow_address = flow_address;
        await supabaseAdmin
          .from('runner_deploy_environments')
          .update(updateData)
          .eq('id', environment_id);
        result = success({ updated: true });
        break;
      }
```

**Step 2: Commit**

```bash
git add supabase/functions/runner-projects/index.ts
git commit -m "feat: add environment, deployment, and update edge function endpoints"
```

---

## Task 4: Server — Secrets Management Route

**Files:**
- Modify: `runner/server/package.json` (add `libsodium-wrappers`)
- Create: `runner/server/src/github/secrets.ts`
- Modify: `runner/server/src/github/routes.ts` (add secrets route)

**Step 1: Install libsodium-wrappers**

```bash
cd runner/server && npm install libsodium-wrappers && npm install -D @types/libsodium-wrappers
```

**Step 2: Create secrets helper**

Create `runner/server/src/github/secrets.ts`:

```typescript
import sodium from 'libsodium-wrappers';
import { getInstallationOctokit } from './auth.js';

/**
 * Encrypt a secret value with the repository's public key (libsodium sealed box).
 * GitHub requires this format for creating/updating repository secrets.
 */
async function encryptSecret(publicKey: string, secretValue: string): Promise<string> {
  await sodium.ready;
  const binKey = sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL);
  const binSec = sodium.from_string(secretValue);
  const encBytes = sodium.crypto_box_seal(binSec, binKey);
  return sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL);
}

/**
 * Write a secret to a GitHub repository via the installation token.
 */
export async function setRepoSecret(
  installationId: number,
  owner: string,
  repo: string,
  secretName: string,
  secretValue: string,
): Promise<void> {
  const octokit = await getInstallationOctokit(installationId);

  // Get the repo's public key for encrypting secrets
  const { data: keyData } = await octokit.request(
    'GET /repos/{owner}/{repo}/actions/secrets/public-key',
    { owner, repo },
  );

  const encryptedValue = await encryptSecret(keyData.key, secretValue);

  await octokit.request(
    'PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}',
    {
      owner,
      repo,
      secret_name: secretName,
      encrypted_value: encryptedValue,
      key_id: keyData.key_id,
    },
  );
}
```

**Step 3: Add secrets route to routes.ts**

Add after the existing `/runs` route (before `export`):

```typescript
import { setRepoSecret } from './secrets.js';

// POST /secrets — Write Flow deploy secrets to GitHub repo
router.post('/secrets', async (req: Request, res: Response) => {
  try {
    const {
      installation_id,
      owner,
      repo,
      environment_name,
      flow_address,
      flow_private_key,
      flow_key_index,
    } = req.body as {
      installation_id: number;
      owner: string;
      repo: string;
      environment_name: string;
      flow_address: string;
      flow_private_key: string;
      flow_key_index: string;
    };

    if (!installation_id || !owner || !repo || !environment_name || !flow_address || !flow_private_key) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const suffix = environment_name.toUpperCase().replace(/[^A-Z0-9_]/g, '_');

    await Promise.all([
      setRepoSecret(installation_id, owner, repo, `FLOW_PRIVATE_KEY_${suffix}`, flow_private_key),
      setRepoSecret(installation_id, owner, repo, `FLOW_ADDRESS_${suffix}`, flow_address),
      setRepoSecret(installation_id, owner, repo, `FLOW_KEY_INDEX_${suffix}`, flow_key_index || '0'),
    ]);

    // Also set RUNNER_WEBHOOK_URL for post-deploy notifications
    const webhookUrl = process.env.RUNNER_WEBHOOK_URL || `${process.env.PUBLIC_URL || 'https://run.flowindex.io'}/github/webhook/deploy`;
    await setRepoSecret(installation_id, owner, repo, 'RUNNER_WEBHOOK_URL', webhookUrl);

    res.json({
      success: true,
      secrets: [`FLOW_PRIVATE_KEY_${suffix}`, `FLOW_ADDRESS_${suffix}`, `FLOW_KEY_INDEX_${suffix}`, 'RUNNER_WEBHOOK_URL'],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});
```

**Step 4: Commit**

```bash
git add runner/server/package.json runner/server/src/github/secrets.ts runner/server/src/github/routes.ts
git commit -m "feat: add GitHub Secrets write API for deploy credentials"
```

---

## Task 5: Server — Enhanced Workflow Template

**Files:**
- Modify: `runner/server/src/github/routes.ts` (replace `generateWorkflowYaml` function)

**Step 1: Replace workflow generator**

Replace the existing `generateWorkflowYaml` function (lines 230-266) with the multi-environment version:

```typescript
interface WorkflowEnvironment {
  name: string;
  branch: string;
  network: string;
}

function generateWorkflowYaml(deployPath: string, environments: WorkflowEnvironment[]): string {
  const branches = environments.map(e => e.branch);
  const branchList = branches.map(b => `'${b}'`).join(', ');

  // Generate branch → env mapping
  const cases = environments.map(e => {
    const suffix = e.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    return `            ${e.branch}) echo "env=${suffix}" >> $GITHUB_OUTPUT; echo "network=${e.network}" >> $GITHUB_OUTPUT ;;`;
  }).join('\n');

  return `name: Deploy Cadence Contracts
on:
  push:
    branches: [${branchList}]
    paths:
      - '${deployPath}/**/*.cdc'
      - 'flow.json'
  workflow_dispatch:
    inputs:
      action:
        description: 'Deploy action'
        type: choice
        options:
          - deploy
          - dry-run
          - rollback
        default: deploy
      commit_sha:
        description: 'Commit SHA (for rollback)'
        required: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.inputs.commit_sha || github.sha }}

      - name: Install Flow CLI
        run: sh -ci "$(curl -fsSL https://raw.githubusercontent.com/onflow/flow-cli/master/install.sh)"

      - name: Determine environment
        id: env
        run: |
          BRANCH="\${{ github.ref_name }}"
          case "$BRANCH" in
${cases}
            *) echo "No environment configured for branch $BRANCH"; exit 0 ;;
          esac

      - name: Deploy contracts
        if: steps.env.outputs.env
        env:
          FLOW_PRIVATE_KEY: \${{ secrets[format('FLOW_PRIVATE_KEY_{0}', steps.env.outputs.env)] }}
          FLOW_ADDRESS: \${{ secrets[format('FLOW_ADDRESS_{0}', steps.env.outputs.env)] }}
          FLOW_KEY_INDEX: \${{ secrets[format('FLOW_KEY_INDEX_{0}', steps.env.outputs.env)] }}
        run: |
          ACTION="\${{ github.event.inputs.action || 'deploy' }}"
          NETWORK="\${{ steps.env.outputs.network }}"
          echo "Action: $ACTION | Network: $NETWORK"
          if [ "$ACTION" = "dry-run" ]; then
            flow project deploy --network=$NETWORK --update=false 2>&1 || true
          else
            flow project deploy --network=$NETWORK --update
          fi

      - name: Notify Runner
        if: always() && steps.env.outputs.env
        continue-on-error: true
        run: |
          curl -sS -X POST "\${{ secrets.RUNNER_WEBHOOK_URL }}" \\
            -H "Content-Type: application/json" \\
            -d '{
              "type": "workflow_complete",
              "status": "'\${{ job.status }}'",
              "sha": "'\${{ github.sha }}'",
              "branch": "'\${{ github.ref_name }}'",
              "network": "'\${{ steps.env.outputs.network }}'",
              "run_id": '\${{ github.run_id }}',
              "action": "'\${{ github.event.inputs.action || '\\''deploy'\\'' }}'"
            }'
`;
}
```

**Step 2: Update `/workflow` route to accept environments array**

Replace the `/workflow` route body parsing and call:

```typescript
router.post('/workflow', async (req: Request, res: Response) => {
  try {
    const { installation_id, owner, repo, branch, path, network, environments } = req.body as {
      installation_id: number;
      owner: string;
      repo: string;
      branch: string;  // kept for backward compat
      path: string;
      network: string; // kept for backward compat
      environments?: WorkflowEnvironment[];
    };

    if (!installation_id || !owner || !repo || !path) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const envs = environments && environments.length > 0
      ? environments
      : [{ name: 'production', branch: branch || 'main', network: network || 'mainnet' }];

    const octokit = await getInstallationOctokit(installation_id);
    const workflowPath = '.github/workflows/cadence-deploy.yml';
    const workflowContent = generateWorkflowYaml(path || '.', envs);

    // ... rest of commit logic stays the same (lines 289-319)
```

**Step 3: Commit**

```bash
git add runner/server/src/github/routes.ts
git commit -m "feat: multi-environment workflow template with dry-run and rollback"
```

---

## Task 6: Server — Webhook Receiver

**Files:**
- Create: `runner/server/src/github/webhook.ts`
- Modify: `runner/server/src/http.ts` (mount webhook route)
- Modify: `runner/server/src/index.ts` (export WS broadcast function)

**Step 1: Create webhook handler**

Create `runner/server/src/github/webhook.ts`:

```typescript
import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';

const webhookRouter = Router();

const WEBHOOK_SECRET = process.env.GITHUB_APP_WEBHOOK_SECRET || '';

// In-memory broadcast function — set by index.ts when WS server starts
let broadcastFn: ((projectId: string, event: unknown) => void) | null = null;
export function setBroadcast(fn: (projectId: string, event: unknown) => void) {
  broadcastFn = fn;
}

// Supabase client for recording deployments
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

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

async function findConnectionByRepo(owner: string, repo: string): Promise<any | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/runner_github_connections?repo_owner=eq.${owner}&repo_name=eq.${repo}&select=*`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      },
    );
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch {
    return null;
  }
}

async function findEnvironmentByBranch(connectionId: string, branch: string): Promise<any | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/runner_deploy_environments?connection_id=eq.${connectionId}&branch=eq.${branch}&select=*`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        },
      },
    );
    const data = await res.json();
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch {
    return null;
  }
}

function verifySignature(payload: string, signature: string): boolean {
  if (!WEBHOOK_SECRET) return true; // Skip verification if no secret configured
  const expected = `sha256=${crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex')}`;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// POST /webhook — Receive GitHub App webhooks
webhookRouter.post('/', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-hub-signature-256'] as string;
    const event = req.headers['x-github-event'] as string;

    // Verify signature
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
      const owner = run.repository?.owner?.login || body.repository?.owner?.login;
      const repo = run.repository?.name || body.repository?.name;
      const branch = run.head_branch;
      const sha = run.head_sha;

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

      // Broadcast to connected clients
      if (broadcastFn) {
        broadcastFn(conn.project_id, {
          type: action === 'completed'
            ? (run.conclusion === 'success' ? 'deploy:completed' : 'deploy:failed')
            : 'deploy:started',
          data: {
            sha, branch,
            network: env?.network,
            environment: env?.name,
            status: deployData.status,
            logs_url: run.html_url,
            duration_ms: deployData.duration_ms,
          },
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

// POST /webhook/deploy — Simplified callback from workflow (no signature verification)
webhookRouter.post('/deploy', async (req: Request, res: Response) => {
  try {
    const { status, sha, branch, network, run_id, action } = req.body as {
      status: string;
      sha: string;
      branch: string;
      network: string;
      run_id: number;
      action: string;
    };

    // Find connection by looking up the deployment with this run_id, or by iterating
    // For now just log — the main webhook handler above handles the full flow
    console.log(`[webhook/deploy] status=${status} sha=${sha} branch=${branch} network=${network} run_id=${run_id} action=${action}`);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal error' });
  }
});

export { webhookRouter };
```

**Step 2: Mount webhook in http.ts**

Modify `runner/server/src/http.ts`:

```typescript
import express from 'express';
import { githubRouter } from './github/routes.js';
import { webhookRouter } from './github/webhook.js';

const app = express();

// JSON body parsing
app.use(express.json());

// CORS middleware
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (_req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// GitHub integration routes
app.use('/github', githubRouter);

// GitHub webhook routes (separate path for Caddy routing)
app.use('/github/webhook', webhookRouter);

export { app };
```

**Step 3: Commit**

```bash
git add runner/server/src/github/webhook.ts runner/server/src/http.ts
git commit -m "feat: add GitHub webhook receiver for deploy status tracking"
```

---

## Task 7: Server — WebSocket Deploy Events

**Files:**
- Modify: `runner/server/src/index.ts` (add deploy subscription channel to WS server)

**Step 1: Add deploy broadcast to WS server**

At the top of `index.ts`, after the existing imports, add:

```typescript
import { setBroadcast } from './github/webhook.js';
```

Then after the HTTP server starts (after `httpApp.listen(HTTP_PORT, ...)`), add:

```typescript
// Deploy event subscriptions: projectId -> Set<WebSocket>
const deploySubscriptions = new Map<string, Set<WebSocket>>();

setBroadcast((projectId: string, event: unknown) => {
  const subs = deploySubscriptions.get(projectId);
  if (!subs) return;
  const msg = JSON.stringify(event);
  for (const ws of subs) {
    if (ws.readyState === ws.OPEN) {
      ws.send(msg);
    }
  }
});
```

In the existing WS connection handler, add handling for deploy subscriptions. After the existing message parsing logic, add a check:

```typescript
// Inside the ws.on('message') handler, add:
if (parsed.type === 'subscribe:deploy' && parsed.project_id) {
  const pid = parsed.project_id as string;
  if (!deploySubscriptions.has(pid)) {
    deploySubscriptions.set(pid, new Set());
  }
  deploySubscriptions.get(pid)!.add(ws);
}
```

And in the ws `close` handler, clean up:

```typescript
// Inside ws.on('close'), add:
for (const [pid, subs] of deploySubscriptions) {
  subs.delete(ws);
  if (subs.size === 0) deploySubscriptions.delete(pid);
}
```

**Step 2: Commit**

```bash
git add runner/server/src/index.ts
git commit -m "feat: add WebSocket deploy event broadcast channel"
```

---

## Task 8: Server — Promote (Create PR) + Workflow Dispatch Routes

**Files:**
- Modify: `runner/server/src/github/routes.ts`

**Step 1: Add promote route**

```typescript
// POST /promote — Create a PR from staging to production branch
router.post('/promote', async (req: Request, res: Response) => {
  try {
    const { installation_id, owner, repo, from_branch, to_branch, title, environments } = req.body as {
      installation_id: number;
      owner: string;
      repo: string;
      from_branch: string;
      to_branch: string;
      title?: string;
      environments?: { from: { name: string; network: string }; to: { name: string; network: string } };
    };

    if (!installation_id || !owner || !repo || !from_branch || !to_branch) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const octokit = await getInstallationOctokit(installation_id);

    const prTitle = title || `Deploy: ${from_branch} → ${to_branch}`;
    const fromNet = environments?.from?.network || 'testnet';
    const toNet = environments?.to?.network || 'mainnet';

    const { data: pr } = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
      owner, repo,
      title: prTitle,
      head: from_branch,
      base: to_branch,
      body: `## Cadence Deploy Preview\n\n**From:** ${from_branch} (${fromNet})\n**To:** ${to_branch} (${toNet})\n\nMerge this PR to deploy contracts to **${toNet}**.`,
    });

    // Post comment from the App
    await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
      owner, repo,
      issue_number: pr.number,
      body: `## 🚀 Cadence Deploy Preview\n\n**Target network:** ${toNet}\n**Source branch:** ${from_branch} (${fromNet})\n\nMerging this PR will trigger automatic contract deployment to **${toNet}**.\n\n---\n*Managed by Cadence Runner*`,
    });

    res.json({ pr_number: pr.number, pr_url: pr.html_url });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /dispatch — Trigger workflow_dispatch (for rollback, dry-run, redeploy)
router.post('/dispatch', async (req: Request, res: Response) => {
  try {
    const { installation_id, owner, repo, action, commit_sha } = req.body as {
      installation_id: number;
      owner: string;
      repo: string;
      action: 'deploy' | 'dry-run' | 'rollback';
      commit_sha?: string;
    };

    if (!installation_id || !owner || !repo || !action) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const octokit = await getInstallationOctokit(installation_id);

    // Get default branch to dispatch on
    const { data: repoData } = await octokit.request('GET /repos/{owner}/{repo}', { owner, repo });
    const ref = repoData.default_branch;

    await octokit.request('POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches', {
      owner, repo,
      workflow_id: 'cadence-deploy.yml',
      ref,
      inputs: {
        action,
        commit_sha: commit_sha || '',
      },
    });

    res.json({ dispatched: true, action, commit_sha: commit_sha || 'latest' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});
```

**Step 2: Commit**

```bash
git add runner/server/src/github/routes.ts
git commit -m "feat: add promote (PR creation) and workflow dispatch routes"
```

---

## Task 9: Frontend — API Client Updates

**Files:**
- Modify: `runner/src/github/api.ts`

**Step 1: Add new API methods**

Add to the `githubApi` object and add new types:

```typescript
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

// Add to githubApi:
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
```

**Step 2: Commit**

```bash
git add runner/src/github/api.ts
git commit -m "feat: add secrets, promote, dispatch API client methods"
```

---

## Task 10: Frontend — useGitHub Hook — Environment & Deploy Support

**Files:**
- Modify: `runner/src/github/useGitHub.ts`

**Step 1: Add environment and deployment state + methods**

Add to imports:

```typescript
import { type DeployEnvironment, type Deployment } from './api';
```

Add state inside useGitHub hook:

```typescript
const [environments, setEnvironments] = useState<DeployEnvironment[]>([]);
const [deployments, setDeployments] = useState<Deployment[]>([]);
```

Add methods:

```typescript
  // ---- environments -------------------------------------------------------

  const fetchEnvironments = useCallback(async () => {
    if (!connection?.id || !accessToken) return;
    try {
      const result = await callEdge<{ environments: DeployEnvironment[] }>(
        '/github/environments',
        { connection_id: connection.id },
        accessToken,
      );
      setEnvironments(result.environments);
    } catch {
      setEnvironments([]);
    }
  }, [connection?.id, accessToken]);

  const upsertEnvironment = useCallback(
    async (env: { name: string; branch: string; network: string; flow_address?: string; is_default?: boolean }) => {
      if (!connection?.id || !accessToken) throw new Error('Not connected');
      await callEdge(
        '/github/environments/upsert',
        { connection_id: connection.id, ...env },
        accessToken,
      );
      await fetchEnvironments();
    },
    [connection?.id, accessToken, fetchEnvironments],
  );

  const deleteEnvironment = useCallback(
    async (environmentId: string) => {
      if (!accessToken) throw new Error('Not authenticated');
      await callEdge('/github/environments/delete', { environment_id: environmentId }, accessToken);
      await fetchEnvironments();
    },
    [accessToken, fetchEnvironments],
  );

  // ---- secrets ------------------------------------------------------------

  const configureSecrets = useCallback(
    async (environmentName: string, flowAddress: string, flowPrivateKey: string, flowKeyIndex: string) => {
      if (!connection) throw new Error('Not connected');
      await githubApi.setSecrets({
        installation_id: connection.installation_id,
        owner: connection.repo_owner,
        repo: connection.repo_name,
        environment_name: environmentName,
        flow_address: flowAddress,
        flow_private_key: flowPrivateKey,
        flow_key_index: flowKeyIndex,
      });
      // Find the environment and mark secrets_configured
      const env = environments.find(e => e.name === environmentName);
      if (env) {
        await callEdge(
          '/github/environments/update-secrets',
          { environment_id: env.id, secrets_configured: true, flow_address: flowAddress },
          accessToken,
        );
      }
      await fetchEnvironments();
    },
    [connection, environments, accessToken, fetchEnvironments],
  );

  // ---- deployments --------------------------------------------------------

  const fetchDeployments = useCallback(async () => {
    if (!connection?.id || !accessToken) return;
    try {
      const result = await callEdge<{ deployments: Deployment[] }>(
        '/github/deployments',
        { connection_id: connection.id, limit: 20 },
        accessToken,
      );
      setDeployments(result.deployments);
    } catch {
      setDeployments([]);
    }
  }, [connection?.id, accessToken]);

  // ---- promote / rollback / dry-run ----------------------------------------

  const promote = useCallback(
    async (fromBranch: string, toBranch: string) => {
      if (!connection) throw new Error('Not connected');
      const fromEnv = environments.find(e => e.branch === fromBranch);
      const toEnv = environments.find(e => e.branch === toBranch);
      return githubApi.promote({
        installation_id: connection.installation_id,
        owner: connection.repo_owner,
        repo: connection.repo_name,
        from_branch: fromBranch,
        to_branch: toBranch,
        environments: fromEnv && toEnv ? {
          from: { name: fromEnv.name, network: fromEnv.network },
          to: { name: toEnv.name, network: toEnv.network },
        } : undefined,
      });
    },
    [connection, environments],
  );

  const dispatch = useCallback(
    async (action: 'deploy' | 'dry-run' | 'rollback', commitSha?: string) => {
      if (!connection) throw new Error('Not connected');
      return githubApi.dispatch({
        installation_id: connection.installation_id,
        owner: connection.repo_owner,
        repo: connection.repo_name,
        action,
        commit_sha: commitSha,
      });
    },
    [connection],
  );
```

Add auto-fetch for environments when connection loads:

```typescript
  useEffect(() => {
    if (connection) {
      fetchEnvironments();
      fetchDeployments();
    }
  }, [connection?.id]);  // eslint-disable-line react-hooks/exhaustive-deps
```

Update the return:

```typescript
  return {
    connection, loading,
    connect, disconnect,
    pullFiles, commitAndPush,
    setupWorkflow,
    latestRuns, fetchRuns, fetchConnection,
    // New
    environments, fetchEnvironments, upsertEnvironment, deleteEnvironment,
    deployments, fetchDeployments,
    configureSecrets,
    promote, dispatch,
  };
```

**Step 2: Commit**

```bash
git add runner/src/github/useGitHub.ts
git commit -m "feat: add environment, secrets, deploy, promote methods to useGitHub hook"
```

---

## Task 11: Frontend — WebSocket Deploy Subscription Hook

**Files:**
- Create: `runner/src/github/useDeployEvents.ts`

**Step 1: Create hook**

```typescript
import { useEffect, useRef, useCallback } from 'react';

export interface DeployEvent {
  type: 'deploy:started' | 'deploy:completed' | 'deploy:failed' | 'deploy:push';
  data: {
    sha: string;
    branch: string;
    network?: string;
    environment?: string;
    status?: string;
    logs_url?: string;
    duration_ms?: number;
    message?: string;
    author?: string;
  };
}

export function useDeployEvents(
  projectId: string | undefined,
  onEvent: (event: DeployEvent) => void,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!projectId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/deploy-ws`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe:deploy', project_id: projectId }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as DeployEvent;
        onEventRef.current(data);
      } catch {
        // ignore non-JSON messages
      }
    };

    ws.onclose = () => {
      // Auto-reconnect after 5s
      setTimeout(() => {
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
      }, 5000);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [projectId]);
}
```

**Step 2: Commit**

```bash
git add runner/src/github/useDeployEvents.ts
git commit -m "feat: add useDeployEvents WebSocket hook for real-time deploy status"
```

---

## Task 12: Frontend — Deploy Settings Panel Component

**Files:**
- Create: `runner/src/components/DeploySettings.tsx`

**Step 1: Create component**

This component handles:
- Environment CRUD (add/edit/delete)
- Secrets configuration per environment
- Workflow setup trigger

The component should use Shadcn UI components (Dialog, Button, Input, Select, Badge) already available in the project. It receives `useGitHub` hook methods as props.

Key sections:
1. Environment list with branch/network/secrets status
2. "Add Environment" button → form with name, branch, network fields
3. Per-environment "Configure Secrets" dialog → FLOW_ADDRESS, FLOW_PRIVATE_KEY, FLOW_KEY_INDEX fields
4. "Setup Workflow" button (regenerates workflow with all environments)
5. "Disconnect GitHub" button

(Full component code is ~300 lines of React with Shadcn UI. Implementation should follow existing patterns in `GitHubConnect.tsx`.)

**Step 2: Commit**

```bash
git add runner/src/components/DeploySettings.tsx
git commit -m "feat: add DeploySettings component for environment and secrets management"
```

---

## Task 13: Frontend — Deployments Panel Component

**Files:**
- Create: `runner/src/components/DeployPanel.tsx`

**Step 1: Create component**

This component shows:
1. Current environment status cards (per-env latest deploy status)
2. Deployment history list with status badges
3. Action buttons: Promote, Rollback, Dry Run, Redeploy
4. Real-time updates via useDeployEvents

Key interactions:
- "Promote" → calls `promote()`, opens the PR URL
- "Rollback" → opens deployment picker dialog, calls `dispatch('rollback', sha)`
- "Dry Run" → calls `dispatch('dry-run')`
- "View Logs" → opens GitHub Actions URL in new tab
- Status badges: pending (gray), running (yellow pulse), success (green), failed (red)

(Full component code is ~400 lines. Follow existing Shadcn patterns.)

**Step 2: Commit**

```bash
git add runner/src/components/DeployPanel.tsx
git commit -m "feat: add DeployPanel component with history, promote, rollback UI"
```

---

## Task 14: Frontend — Integrate Deploy UI into App.tsx

**Files:**
- Modify: `runner/src/App.tsx`

**Step 1: Add deploy panel to sidebar/main area**

- Import DeployPanel, DeploySettings, useDeployEvents
- Add a "Deployments" tab in the sidebar (alongside existing GitHub button)
- When "Deployments" is active, show DeployPanel in the right panel area
- Add settings gear icon that opens DeploySettings dialog
- Wire useDeployEvents to refresh deployments on events

**Step 2: Commit**

```bash
git add runner/src/App.tsx
git commit -m "feat: integrate deploy panel and settings into runner App"
```

---

## Task 15: Infrastructure — Caddy + Nginx Webhook Routing

**Files:**
- Modify: `runner/nginx.conf` (add webhook route to upstream)

**Step 1: Verify nginx already proxies /github/* to port 3003**

The runner's nginx.conf should already proxy `/github/*` requests to the Node.js server on port 3003. If not, add:

```nginx
location /github/ {
    proxy_pass http://127.0.0.1:3003;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

**Step 2: Configure GitHub App webhook URL**

In the GitHub App settings (github.com), set the webhook URL to:
`https://run.flowindex.io/github/webhook`

**Step 3: Add `GITHUB_APP_WEBHOOK_SECRET` to the runner server environment**

On the GCP VM, update the runner container's environment to include `GITHUB_APP_WEBHOOK_SECRET`.

**Step 4: Commit any nginx changes**

```bash
git add runner/nginx.conf
git commit -m "chore: ensure webhook routing through nginx"
```

---

## Task 16: GitHub App — Update Permissions

**Manual step** (not code):

Go to the GitHub App settings and add these permissions:
- `actions: write` — trigger workflow_dispatch, cancel runs
- `secrets: write` — write repository secrets via API
- `pull_requests: write` — create PRs, post comments
- (existing) `contents: write` — commit files

After updating, existing installations will need to accept the new permissions.

---

## Task 17: Final Integration Test

**Step 1: Build and verify**

```bash
cd runner/server && npm run build
cd ../.. && cd runner && bun run build
```

**Step 2: Test flow**

1. Connect a test repo via GitHub App
2. Add an environment (main → mainnet)
3. Configure secrets
4. Setup workflow (verify it generates multi-env workflow)
5. Push a `.cdc` file to trigger deploy
6. Verify webhook receives workflow_run event
7. Verify WebSocket pushes deploy status to UI
8. Test promote (create PR from dev → main)
9. Test rollback via workflow_dispatch
10. Test dry-run

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete Vercel-like auto-deploy for Cadence contracts"
```

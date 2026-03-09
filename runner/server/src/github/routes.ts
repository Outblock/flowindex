import { Router, type Request, type Response } from 'express';
import { getInstallationOctokit } from './auth.js';
import { setRepoSecret } from './secrets.js';

const router = Router();

// GET /install — Redirect user to GitHub App installation page
router.get('/install', (req: Request, res: Response) => {
  const slug = process.env.GITHUB_APP_SLUG || 'cadence-runner';
  const projectId = req.query.project_id as string | undefined;
  const state = projectId ? `?state=${encodeURIComponent(projectId)}` : '';
  res.redirect(`https://github.com/apps/${slug}/installations/new${state}`);
});

// GET /callback — GitHub redirects here after App installation
router.get('/callback', (req: Request, res: Response) => {
  const installationId = req.query.installation_id as string;
  const setupAction = req.query.setup_action as string;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const params = new URLSearchParams();
  if (installationId) params.set('github_installation_id', installationId);
  if (setupAction) params.set('setup_action', setupAction);
  res.redirect(`${frontendUrl}?${params.toString()}`);
});

// GET /repos — List repos accessible to a given installation
router.get('/repos', async (req: Request, res: Response) => {
  try {
    const installationId = Number(req.query.installation_id);
    if (!installationId) {
      res.status(400).json({ error: 'installation_id is required' });
      return;
    }
    const octokit = await getInstallationOctokit(installationId);
    const { data } = await octokit.request('GET /installation/repositories', { per_page: 100 });
    const repos = data.repositories.map((r: any) => ({
      id: r.id,
      full_name: r.full_name,
      owner: r.owner?.login ?? '',
      name: r.name,
      default_branch: r.default_branch,
      private: r.private,
    }));
    res.json({ repos });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /tree/:owner/:repo — Read file tree of a repo directory
router.get('/tree/:owner/:repo', async (req: Request, res: Response) => {
  try {
    const installationId = Number(req.query.installation_id);
    if (!installationId) {
      res.status(400).json({ error: 'installation_id is required' });
      return;
    }
    const owner = req.params.owner as string;
    const repo = req.params.repo as string;
    // Strip leading slash — GitHub API treats "/" differently from "" (empty)
    const rawPath = (req.query.path as string) || '';
    const path = rawPath.replace(/^\/+/, '');
    const ref = (req.query.ref as string) || undefined;

    const octokit = await getInstallationOctokit(installationId);
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner,
      repo,
      path,
      ref,
    });

    if (!Array.isArray(data)) {
      res.status(400).json({ error: 'Path is not a directory' });
      return;
    }

    const files = data.map((f: any) => ({
      name: f.name,
      path: f.path,
      type: f.type,
      sha: f.sha,
      size: f.size,
    }));
    res.json({ files });
  } catch (err: unknown) {
    // Empty repos return 404 from GitHub — return empty array instead of error
    const status = err instanceof Error && 'status' in err ? (err as Record<string, unknown>).status : undefined;
    if (status === 404 || status === 409) {
      res.json({ files: [] });
      return;
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    // Don't pass through giant GitHub HTML error pages
    const safeMessage = message.length > 500 ? 'GitHub API error' : message;
    res.status(500).json({ error: safeMessage });
  }
});

// GET /file/:owner/:repo/*path — Read a single file's content
router.get('/file/:owner/:repo/*path', async (req: Request, res: Response) => {
  try {
    const installationId = Number(req.query.installation_id);
    if (!installationId) {
      res.status(400).json({ error: 'installation_id is required' });
      return;
    }
    const owner = req.params.owner as string;
    const repo = req.params.repo as string;
    const filePath = req.params.path as string;
    const ref = (req.query.ref as string) || undefined;

    const octokit = await getInstallationOctokit(installationId);
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner,
      repo,
      path: filePath,
      ref,
    });

    if (Array.isArray(data) || data.type !== 'file') {
      res.status(400).json({ error: 'Path is not a file' });
      return;
    }

    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    res.json({ path: data.path, content, sha: data.sha });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /commit — Batch commit + push using Git Trees API
router.post('/commit', async (req: Request, res: Response) => {
  try {
    const { installation_id, owner, repo, branch, message, files } = req.body as {
      installation_id: number;
      owner: string;
      repo: string;
      branch: string;
      message: string;
      files: Array<{ path: string; content?: string; action: string }>;
    };

    if (!installation_id || !owner || !repo || !branch || !message || !files) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Sanitize file paths — strip leading slashes
    for (const file of files) {
      file.path = file.path.replace(/^\/+/, '');
    }

    const octokit = await getInstallationOctokit(installation_id);

    // Try to get the current branch ref — may not exist for empty repos
    let parentSha: string | null = null;
    let baseTreeSha: string | null = null;
    try {
      const { data: refData } = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
        owner, repo, ref: `heads/${branch}`,
      });
      parentSha = refData.object.sha;
      const { data: commitData } = await octokit.request('GET /repos/{owner}/{repo}/git/commits/{commit_sha}', {
        owner, repo, commit_sha: parentSha,
      });
      baseTreeSha = commitData.tree.sha;
    } catch {
      // Empty repo — no branch exists yet, will create initial commit
    }

    // Empty repos: Git Database APIs (blobs, trees, commits) don't work.
    // Use the Contents API which handles initial commits automatically.
    if (!parentSha) {
      let lastSha = '';
      const createFiles = files.filter(f => f.action !== 'delete');
      for (const file of createFiles) {
        const { data } = await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
          owner, repo,
          path: file.path,
          message: createFiles.length === 1 ? message : `${message} (${file.path})`,
          content: Buffer.from(file.content ?? '').toString('base64'),
          branch,
        });
        lastSha = (data as any).commit.sha;
      }
      res.json({ sha: lastSha, message, url: `https://github.com/${owner}/${repo}/commit/${lastSha}` });
      return;
    }

    // Non-empty repos: use Git Trees API for atomic batch commit
    const tree: Array<{ path: string; mode: '100644'; type: 'blob'; sha: string | null }> = [];

    for (const file of files) {
      if (file.action === 'delete') {
        tree.push({ path: file.path, mode: '100644', type: 'blob', sha: null });
      } else {
        const { data: blobData } = await octokit.request('POST /repos/{owner}/{repo}/git/blobs', {
          owner, repo, content: file.content ?? '', encoding: 'utf-8',
        });
        tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blobData.sha });
      }
    }

    const { data: newTree } = await octokit.request('POST /repos/{owner}/{repo}/git/trees', {
      owner, repo, base_tree: baseTreeSha!, tree,
    } as any);

    const { data: newCommit } = await octokit.request('POST /repos/{owner}/{repo}/git/commits', {
      owner, repo, message, tree: newTree.sha, parents: [parentSha],
    } as any);

    await octokit.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
      owner, repo, ref: `heads/${branch}`, sha: newCommit.sha,
    });

    res.json({
      sha: newCommit.sha,
      message: newCommit.message,
      url: newCommit.html_url,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

interface WorkflowEnvironment {
  name: string;
  branch: string;
  network: string;
}

function generateWorkflowYaml(deployPath: string, environments: WorkflowEnvironment[]): string {
  const branches = environments.map(e => e.branch);
  const branchList = branches.map(b => `'${b}'`).join(', ');

  // Build case statement to determine environment from branch
  const caseEntries = environments.map(e => {
    const suffix = e.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    return `            ${e.branch})
              ENV_NAME="${e.name}"
              NETWORK="${e.network}"
              FLOW_PRIVATE_KEY="\$FLOW_PRIVATE_KEY_${suffix}"
              FLOW_ADDRESS="\$FLOW_ADDRESS_${suffix}"
              FLOW_KEY_INDEX="\$FLOW_KEY_INDEX_${suffix}"
              ;;`;
  }).join('\n');

  // Build secrets env block — one set per environment
  const secretsEnv = environments.map(e => {
    const suffix = e.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    return `          FLOW_PRIVATE_KEY_${suffix}: \${{ secrets.FLOW_PRIVATE_KEY_${suffix} }}
          FLOW_ADDRESS_${suffix}: \${{ secrets.FLOW_ADDRESS_${suffix} }}
          FLOW_KEY_INDEX_${suffix}: \${{ secrets.FLOW_KEY_INDEX_${suffix} }}`;
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
        description: 'Deployment action'
        required: true
        type: choice
        options:
          - deploy
          - dry-run
          - rollback
        default: deploy
      commit_sha:
        description: 'Commit SHA (for rollback)'
        required: false
        type: string

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
        env:
${secretsEnv}
        run: |
          BRANCH="\${{ github.ref_name }}"
          ACTION="\${{ github.event.inputs.action || 'deploy' }}"
          case "$BRANCH" in
${caseEntries}
            *)
              echo "Unknown branch: $BRANCH"
              exit 1
              ;;
          esac
          echo "env_name=$ENV_NAME" >> $GITHUB_OUTPUT
          echo "network=$NETWORK" >> $GITHUB_OUTPUT
          echo "action=$ACTION" >> $GITHUB_OUTPUT
          echo "flow_private_key=$FLOW_PRIVATE_KEY" >> $GITHUB_OUTPUT
          echo "flow_address=$FLOW_ADDRESS" >> $GITHUB_OUTPUT
          echo "flow_key_index=$FLOW_KEY_INDEX" >> $GITHUB_OUTPUT
      - name: Deploy contracts
        run: |
          ACTION="\${{ steps.env.outputs.action }}"
          NETWORK="\${{ steps.env.outputs.network }}"
          if [ "$ACTION" = "dry-run" ]; then
            echo "Dry-run deploy to $NETWORK..."
            flow project deploy --network="$NETWORK" --update=false
          else
            echo "Deploying to $NETWORK..."
            flow project deploy --network="$NETWORK" --update
          fi
        env:
          FLOW_PRIVATE_KEY: \${{ steps.env.outputs.flow_private_key }}
          FLOW_ADDRESS: \${{ steps.env.outputs.flow_address }}
          FLOW_KEY_INDEX: \${{ steps.env.outputs.flow_key_index }}
      - name: Notify Runner
        if: always()
        run: |
          curl -s -X POST "\${{ secrets.RUNNER_WEBHOOK_URL }}" \\
            -H "Content-Type: application/json" \\
            -d '{
              "status": "'\${{ job.status }}'",
              "sha": "'\${{ github.sha }}'",
              "branch": "'\${{ github.ref_name }}'",
              "network": "'\${{ steps.env.outputs.network }}'",
              "run_id": "'\${{ github.run_id }}'",
              "action": "'\${{ steps.env.outputs.action }}'"
            }' || true
`;
}

// POST /workflow — Generate and push a Cadence deploy workflow
router.post('/workflow', async (req: Request, res: Response) => {
  try {
    const { installation_id, owner, repo, branch, path, network, environments } = req.body as {
      installation_id: number;
      owner: string;
      repo: string;
      branch?: string;
      path: string;
      network?: string;
      environments?: WorkflowEnvironment[];
    };

    if (!installation_id || !owner || !repo || !path) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Build environments list — use provided array or fall back to single branch/network
    const envs: WorkflowEnvironment[] = environments && environments.length > 0
      ? environments
      : (branch && network)
        ? [{ name: network, branch, network }]
        : [];

    if (envs.length === 0) {
      res.status(400).json({ error: 'Either environments array or branch+network params required' });
      return;
    }

    // Commit to the first environment's branch (or default branch)
    const targetBranch = envs[0].branch;

    const octokit = await getInstallationOctokit(installation_id);
    const workflowPath = '.github/workflows/cadence-deploy.yml';
    const workflowContent = generateWorkflowYaml(path, envs);

    const { data: refData } = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
      owner, repo, ref: `heads/${targetBranch}`,
    });
    const parentSha = refData.object.sha;

    const { data: commitData } = await octokit.request('GET /repos/{owner}/{repo}/git/commits/{commit_sha}', {
      owner, repo, commit_sha: parentSha,
    });

    const { data: blobData } = await octokit.request('POST /repos/{owner}/{repo}/git/blobs', {
      owner, repo, content: workflowContent, encoding: 'utf-8',
    });

    const { data: newTree } = await octokit.request('POST /repos/{owner}/{repo}/git/trees', {
      owner, repo, base_tree: commitData.tree.sha,
      tree: [{ path: workflowPath, mode: '100644', type: 'blob', sha: blobData.sha }],
    });

    const networkNames = envs.map(e => e.network).join(', ');
    const { data: newCommit } = await octokit.request('POST /repos/{owner}/{repo}/git/commits', {
      owner, repo, message: `Add Cadence deploy workflow for ${networkNames}`,
      tree: newTree.sha, parents: [parentSha],
    });

    await octokit.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
      owner, repo, ref: `heads/${targetBranch}`, sha: newCommit.sha,
    });

    // Build secrets list from all environments
    const secretsNeeded = envs.flatMap(e => {
      const suffix = e.name.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      return [`FLOW_PRIVATE_KEY_${suffix}`, `FLOW_ADDRESS_${suffix}`, `FLOW_KEY_INDEX_${suffix}`];
    });
    secretsNeeded.push('RUNNER_WEBHOOK_URL');

    res.json({
      sha: newCommit.sha,
      workflow_path: workflowPath,
      secrets_needed: secretsNeeded,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg });
  }
});

// GET /runs/:owner/:repo — Get recent GitHub Actions workflow runs
router.get('/runs/:owner/:repo', async (req: Request, res: Response) => {
  try {
    const installationId = Number(req.query.installation_id);
    if (!installationId) {
      res.status(400).json({ error: 'installation_id is required' });
      return;
    }
    const owner = req.params.owner as string;
    const repo = req.params.repo as string;
    const workflow = req.query.workflow as string | undefined;

    const octokit = await getInstallationOctokit(installationId);

    let runs: Array<{
      id: number;
      status: string | null;
      conclusion: string | null;
      created_at: string;
      updated_at: string;
      head_sha: string;
      html_url: string;
      head_commit: { message: string } | null;
    }> = [];

    try {
      const { data } = workflow
        ? await octokit.request('GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs', {
            owner, repo, workflow_id: workflow, per_page: 20,
          })
        : await octokit.request('GET /repos/{owner}/{repo}/actions/runs', {
            owner, repo, per_page: 20,
          });

      runs = data.workflow_runs.map((r: any) => ({
        id: r.id,
        status: r.status,
        conclusion: r.conclusion,
        created_at: r.created_at,
        updated_at: r.updated_at,
        head_sha: r.head_sha,
        html_url: r.html_url,
        head_commit: r.head_commit ? { message: r.head_commit.message } : null,
      }));
    } catch (e: unknown) {
      // If workflow doesn't exist (404), return empty runs
      if (e instanceof Error && 'status' in e && (e as Record<string, unknown>).status === 404) {
        runs = [];
      } else {
        throw e;
      }
    }

    res.json({ runs });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// POST /secrets — Write Flow deploy secrets to GitHub repo
router.post('/secrets', async (req: Request, res: Response) => {
  try {
    const {
      installation_id, owner, repo, environment_name,
      flow_address, flow_private_key, flow_key_index,
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

// POST /promote — Create a PR from one branch to another (e.g., dev → main)
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

// POST /dispatch — Trigger a workflow_dispatch event (deploy, dry-run, rollback)
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
    const { data: repoData } = await octokit.request('GET /repos/{owner}/{repo}', { owner, repo });
    const ref = repoData.default_branch;

    await octokit.request('POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches', {
      owner, repo,
      workflow_id: 'cadence-deploy.yml',
      ref,
      inputs: { action, commit_sha: commit_sha || '' },
    });

    res.json({ dispatched: true, action, commit_sha: commit_sha || 'latest' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// GET /commits/:owner/:repo — Get recent commits
router.get('/commits/:owner/:repo', async (req: Request, res: Response) => {
  try {
    const installationId = Number(req.query.installation_id);
    if (!installationId) {
      res.status(400).json({ error: 'installation_id is required' });
      return;
    }
    const owner = req.params.owner as string;
    const repo = req.params.repo as string;
    const branch = (req.query.branch as string) || undefined;
    const path = (req.query.path as string) || undefined;
    const perPage = Math.min(Number(req.query.per_page) || 30, 100);

    const octokit = await getInstallationOctokit(installationId);
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/commits', {
      owner, repo, sha: branch, path, per_page: perPage,
    });

    const commits = data.map((c: any) => ({
      sha: c.sha,
      message: c.commit.message,
      author_name: c.commit.author?.name || c.author?.login || 'Unknown',
      author_avatar: c.author?.avatar_url || null,
      date: c.commit.author?.date || c.commit.committer?.date || '',
      url: c.html_url,
    }));
    res.json({ commits });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export { router as githubRouter };

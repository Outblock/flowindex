import { Router, type Request, type Response } from 'express';
import { getInstallationOctokit } from './auth.js';

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
    const repos = data.repositories.map((r) => ({
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
    const path = (req.query.path as string) || '';
    const ref = (req.query.ref as string) || undefined;

    const octokit = await getInstallationOctokit(installationId);
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref,
    });

    if (!Array.isArray(data)) {
      res.status(400).json({ error: 'Path is not a directory' });
      return;
    }

    const files = data.map((f) => ({
      name: f.name,
      path: f.path,
      type: f.type,
      sha: f.sha,
      size: f.size,
    }));
    res.json({ files });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
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
    const { data } = await octokit.repos.getContent({
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

    const octokit = await getInstallationOctokit(installation_id);

    // 1. Get current branch ref SHA
    const { data: refData } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    const parentSha = refData.object.sha;

    // 2. Get base tree SHA from that commit
    const { data: commitData } = await octokit.git.getCommit({
      owner,
      repo,
      commit_sha: parentSha,
    });
    const baseTreeSha = commitData.tree.sha;

    // 3. For each file: create blob (or set sha=null for deletes)
    const tree: Array<{
      path: string;
      mode: '100644';
      type: 'blob';
      sha: string | null;
    }> = [];

    for (const file of files) {
      if (file.action === 'delete') {
        tree.push({
          path: file.path,
          mode: '100644',
          type: 'blob',
          sha: null,
        });
      } else {
        const { data: blobData } = await octokit.git.createBlob({
          owner,
          repo,
          content: file.content ?? '',
          encoding: 'utf-8',
        });
        tree.push({
          path: file.path,
          mode: '100644',
          type: 'blob',
          sha: blobData.sha,
        });
      }
    }

    // 4. Create new tree with base_tree
    const { data: newTree } = await octokit.git.createTree({
      owner,
      repo,
      base_tree: baseTreeSha,
      tree,
    });

    // 5. Create commit with new tree + parent
    const { data: newCommit } = await octokit.git.createCommit({
      owner,
      repo,
      message,
      tree: newTree.sha,
      parents: [parentSha],
    });

    // 6. Update branch ref
    await octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: newCommit.sha,
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

function generateWorkflowYaml(branch: string, path: string, network: string): string {
  return `name: Deploy Cadence Contracts
on:
  push:
    branches: [${branch}]
    paths:
      - '${path}/**/*.cdc'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install Flow CLI
        run: sh -ci "$(curl -fsSL https://raw.githubusercontent.com/onflow/flow-cli/master/install.sh)"
      - name: Deploy contracts
        env:
          FLOW_PRIVATE_KEY: \${{ secrets.FLOW_PRIVATE_KEY }}
          FLOW_ADDRESS: \${{ secrets.FLOW_ADDRESS }}
          FLOW_KEY_INDEX: \${{ secrets.FLOW_KEY_INDEX }}
        run: |
          for file in ${path}/**/*.cdc; do
            if head -5 "$file" | grep -q "contract"; then
              CONTRACT_NAME=$(grep -oP '(?:access\\(all\\)|pub)\\s+contract\\s+\\K\\w+' "$file" | head -1)
              if [ -n "$CONTRACT_NAME" ]; then
                echo "Deploying $CONTRACT_NAME from $file..."
                flow accounts update-contract "$CONTRACT_NAME" "$file" \\
                  --signer deployer \\
                  --network ${network} \\
                  --key "$FLOW_PRIVATE_KEY" \\
                  --address "$FLOW_ADDRESS" \\
                  --key-index "$FLOW_KEY_INDEX" || true
              fi
            fi
          done
`;
}

// POST /workflow — Generate and push a Cadence deploy workflow
router.post('/workflow', async (req: Request, res: Response) => {
  try {
    const { installation_id, owner, repo, branch, path, network } = req.body as {
      installation_id: number;
      owner: string;
      repo: string;
      branch: string;
      path: string;
      network: string;
    };

    if (!installation_id || !owner || !repo || !branch || !path || !network) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const octokit = await getInstallationOctokit(installation_id);
    const workflowPath = '.github/workflows/cadence-deploy.yml';
    const workflowContent = generateWorkflowYaml(branch, path, network);

    // Use Git Trees API to commit the workflow file
    const { data: refData } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    const parentSha = refData.object.sha;

    const { data: commitData } = await octokit.git.getCommit({
      owner,
      repo,
      commit_sha: parentSha,
    });

    const { data: blobData } = await octokit.git.createBlob({
      owner,
      repo,
      content: workflowContent,
      encoding: 'utf-8',
    });

    const { data: newTree } = await octokit.git.createTree({
      owner,
      repo,
      base_tree: commitData.tree.sha,
      tree: [
        {
          path: workflowPath,
          mode: '100644',
          type: 'blob',
          sha: blobData.sha,
        },
      ],
    });

    const { data: newCommit } = await octokit.git.createCommit({
      owner,
      repo,
      message: `Add Cadence deploy workflow for ${network}`,
      tree: newTree.sha,
      parents: [parentSha],
    });

    await octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: newCommit.sha,
    });

    res.json({
      sha: newCommit.sha,
      workflow_path: workflowPath,
      secrets_needed: ['FLOW_PRIVATE_KEY', 'FLOW_ADDRESS', 'FLOW_KEY_INDEX'],
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
      const params: {
        owner: string;
        repo: string;
        per_page: number;
        workflow_id?: string;
      } = { owner, repo, per_page: 20 };

      if (workflow) {
        params.workflow_id = workflow;
      }

      const { data } = workflow
        ? await octokit.actions.listWorkflowRuns({
            owner,
            repo,
            workflow_id: workflow,
            per_page: 20,
          })
        : await octokit.actions.listWorkflowRunsForRepo({
            owner,
            repo,
            per_page: 20,
          });

      runs = data.workflow_runs.map((r) => ({
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

export { router as githubRouter };

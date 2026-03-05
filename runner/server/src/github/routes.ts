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

    // Build tree entries for each file
    const tree: Array<Record<string, unknown>> = [];

    for (const file of files) {
      if (file.action === 'delete') {
        tree.push({ path: file.path, mode: '100644', type: 'blob', sha: null });
      } else if (!parentSha) {
        // Empty repo: Blob API doesn't work — use inline content in tree
        tree.push({ path: file.path, mode: '100644', type: 'blob', content: file.content ?? '' });
      } else {
        const { data: blobData } = await octokit.request('POST /repos/{owner}/{repo}/git/blobs', {
          owner, repo, content: file.content ?? '', encoding: 'utf-8',
        });
        tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blobData.sha });
      }
    }

    // Create tree (with base_tree if repo has history, without for initial commit)
    const treeParams: Record<string, unknown> = { owner, repo, tree };
    if (baseTreeSha) treeParams.base_tree = baseTreeSha;
    const { data: newTree } = await octokit.request('POST /repos/{owner}/{repo}/git/trees', treeParams as any);

    // Create commit (with parent if repo has history)
    const commitParams: Record<string, unknown> = { owner, repo, message, tree: newTree.sha };
    if (parentSha) commitParams.parents = [parentSha];
    else commitParams.parents = [];
    const { data: newCommit } = await octokit.request('POST /repos/{owner}/{repo}/git/commits', commitParams as any);

    // Create or update branch ref
    if (parentSha) {
      await octokit.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
        owner, repo, ref: `heads/${branch}`, sha: newCommit.sha,
      });
    } else {
      await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
        owner, repo, ref: `refs/heads/${branch}`, sha: newCommit.sha,
      });
    }

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

    const { data: refData } = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
      owner, repo, ref: `heads/${branch}`,
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

    const { data: newCommit } = await octokit.request('POST /repos/{owner}/{repo}/git/commits', {
      owner, repo, message: `Add Cadence deploy workflow for ${network}`,
      tree: newTree.sha, parents: [parentSha],
    });

    await octokit.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
      owner, repo, ref: `heads/${branch}`, sha: newCommit.sha,
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

export { router as githubRouter };

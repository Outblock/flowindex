# Runner Auto-Deploy: Vercel-like Contract Deployment

**Date**: 2026-03-06
**Status**: Approved
**Approach**: GitHub-Native (Method A)

## Overview

Enhance the Runner's existing GitHub App integration into a full Vercel-like deployment platform for Cadence smart contracts. Deployments execute via GitHub Actions; Runner serves as the management dashboard with real-time status via webhooks and WebSocket.

## Architecture

```
User pushes code → GitHub webhook → Runner server → WebSocket → Frontend (real-time)
                        ↓                    ↓
                  GitHub Actions         runner_deployments table
                  (flow deploy)
```

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Deployment engine | GitHub Actions | Secrets stay on GitHub, no private keys on our servers |
| Secrets storage | GitHub Secrets API | Write via GitHub App installation token, never persisted on Runner |
| Import handling | flow.json aliases | Flow CLI handles network-specific address substitution |
| Realtime | WebSocket (existing) | Runner server already has WS; add deploy event channel |
| Webhook receiver | Runner Node.js server | Add `/github/webhook` route to existing Express app |
| Promote to mainnet | Create PR + App comment | Review gate for irreversible mainnet deployments |
| Default environment | main → mainnet | Users can add staging/dev environments in advanced settings |

## Feature 1: Multi-Environment Deployment

### Concept

Each project can have multiple **environments**, each mapping a branch to a network + Flow account:

| Environment | Branch | Network | Account |
|-------------|--------|---------|---------|
| Production  | main   | mainnet | 0xabc... |
| Staging     | dev    | testnet | 0xdef... |

### Default Setup

First-time setup creates one environment: `main → mainnet`.
Users can add more environments (e.g., `dev → testnet`) in advanced settings.

### Database: `runner_deploy_environments`

```sql
CREATE TABLE IF NOT EXISTS public.runner_deploy_environments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID REFERENCES public.runner_github_connections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,               -- "production", "staging", custom
  branch TEXT NOT NULL,
  network TEXT NOT NULL,            -- "mainnet", "testnet"
  flow_address TEXT,                -- display only; actual key in GitHub Secrets
  secrets_configured BOOLEAN DEFAULT FALSE,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(connection_id, name),
  UNIQUE(connection_id, branch)
);
```

### Secrets Naming Convention

Per-environment GitHub Secrets with suffix:
- `FLOW_PRIVATE_KEY_PRODUCTION`, `FLOW_ADDRESS_PRODUCTION`, `FLOW_KEY_INDEX_PRODUCTION`
- `FLOW_PRIVATE_KEY_STAGING`, `FLOW_ADDRESS_STAGING`, `FLOW_KEY_INDEX_STAGING`

## Feature 2: Secrets Management

### Flow

```
Runner UI "Deploy Settings"
  → User enters FLOW_ADDRESS, FLOW_PRIVATE_KEY, FLOW_KEY_INDEX per environment
  → Runner server encrypts with repo's public key (libsodium)
  → PUT /repos/{owner}/{repo}/actions/secrets/{name} via installation token
  → Updates environment.secrets_configured = true
```

### Requirements

- GitHub App must have `secrets: write` permission
- Runner server uses `tweetsodium` / `libsodium-wrappers` for encryption
- Private keys are never stored on Runner server or database
- Password fields in UI, values not retrievable after save

### API Route

```
POST /github/secrets
Body: { installation_id, owner, repo, environment_name, flow_address, flow_private_key, flow_key_index }
```

## Feature 3: Enhanced Workflow Template

### Improvements over current template

- Uses `flow deploy` instead of manual grep + `flow accounts update-contract`
- Multi-contract dependency ordering handled by flow.json
- `workflow_dispatch` supports dry-run and rollback
- Multi-environment via branch detection
- Post-deploy webhook notification to Runner

### Generated flow.json

Runner auto-generates/updates `flow.json` with:
- Contract paths from project files
- Deployment mappings per environment
- Standard contract aliases (FungibleToken, NonFungibleToken, etc.) per network

### Workflow Template

```yaml
name: Deploy Cadence Contracts
on:
  push:
    paths: ['{deploy_path}/**/*.cdc', 'flow.json']
  workflow_dispatch:
    inputs:
      action:
        type: choice
        options: [deploy, dry-run, rollback]
        default: deploy
      commit_sha:
        description: 'Commit SHA for rollback'
        required: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.inputs.commit_sha || github.sha }}

      - name: Install Flow CLI
        run: sh -ci "$(curl -fsSL https://raw.githubusercontent.com/onflow/flow-cli/master/install.sh)"

      - name: Determine environment
        id: env
        run: |
          BRANCH="${{ github.ref_name }}"
          # Dynamic branch→environment mapping (generated by Runner)
          case "$BRANCH" in
            main) echo "env=PRODUCTION" >> $GITHUB_OUTPUT; echo "network=mainnet" >> $GITHUB_OUTPUT ;;
            dev)  echo "env=STAGING" >> $GITHUB_OUTPUT; echo "network=testnet" >> $GITHUB_OUTPUT ;;
          esac

      - name: Deploy
        if: steps.env.outputs.env
        env:
          FLOW_PRIVATE_KEY: ${{ secrets[format('FLOW_PRIVATE_KEY_{0}', steps.env.outputs.env)] }}
          FLOW_ADDRESS: ${{ secrets[format('FLOW_ADDRESS_{0}', steps.env.outputs.env)] }}
          FLOW_KEY_INDEX: ${{ secrets[format('FLOW_KEY_INDEX_{0}', steps.env.outputs.env)] }}
        run: |
          ACTION="${{ github.event.inputs.action || 'deploy' }}"
          NETWORK="${{ steps.env.outputs.network }}"
          if [ "$ACTION" = "dry-run" ]; then
            flow deploy --network=$NETWORK --update=false 2>&1
          else
            flow deploy --network=$NETWORK --update
          fi

      - name: Notify Runner
        if: always()
        run: |
          curl -sS -X POST "${{ secrets.RUNNER_WEBHOOK_URL }}" \
            -H "Content-Type: application/json" \
            -d '{
              "status": "${{ job.status }}",
              "sha": "${{ github.sha }}",
              "branch": "${{ github.ref_name }}",
              "network": "${{ steps.env.outputs.network }}",
              "run_id": "${{ github.run_id }}",
              "action": "${{ github.event.inputs.action || '\''deploy'\'' }}"
            }'
```

## Feature 4: Webhook + Real-time Notifications

### Webhook Endpoint

New route on Runner server: `POST /github/webhook`

**Events to handle:**
- `push` — Record new commit, show "deploying..." status
- `workflow_run` — Track workflow start/complete/fail
- `pull_request` — Track promote PRs
- `installation` — Handle app install/uninstall

**Security:** Validate webhook signature using `GITHUB_APP_WEBHOOK_SECRET` + HMAC-SHA256.

**Processing:**
1. Parse event type from `X-GitHub-Event` header
2. Look up `runner_github_connections` by repo owner+name
3. Upsert `runner_deployments` record
4. Push WebSocket event to connected clients for that project

### WebSocket Events

New message types on existing WS connection:

```typescript
{ type: "deploy:started", data: { sha, branch, network, environment } }
{ type: "deploy:completed", data: { sha, status, logs_url, duration } }
{ type: "deploy:failed", data: { sha, error, logs_url } }
{ type: "deploy:cancelled", data: { sha } }
```

Client subscribes by sending `{ type: "subscribe:deploy", project_id }` on connect.

### Database: `runner_deployments`

```sql
CREATE TABLE IF NOT EXISTS public.runner_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id UUID REFERENCES public.runner_github_connections(id) ON DELETE CASCADE,
  environment_id UUID REFERENCES public.runner_deploy_environments(id) ON DELETE SET NULL,
  commit_sha TEXT NOT NULL,
  commit_message TEXT,
  commit_author TEXT,
  branch TEXT NOT NULL,
  network TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, running, success, failed, cancelled
  workflow_run_id BIGINT,
  logs_url TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  trigger_type TEXT DEFAULT 'push',  -- push, manual, rollback, dry-run, promote
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_deployments_connection ON public.runner_deployments(connection_id, created_at DESC);
```

## Feature 5: Promote to Mainnet

### Flow

1. User clicks "Promote" on staging environment
2. Runner creates PR via GitHub API: `dev → main`
3. GitHub App posts comment on PR with deploy preview:
   ```
   ## Cadence Deploy Preview

   **Target**: mainnet (0xabc...)
   **Contracts**: MyContract, TokenVault
   **Last testnet deploy**: ✅ success (abc1234, 5 min ago)

   Merge this PR to deploy to mainnet.
   ```
4. User reviews and merges PR
5. Push to `main` triggers mainnet workflow
6. Runner records deployment with `trigger_type: 'promote'`

### API Routes

```
POST /github/promote
Body: { installation_id, owner, repo, from_branch, to_branch, title? }
Response: { pr_number, pr_url }
```

## Feature 6: Rollback + Dry Run

### Rollback

1. User selects a past successful deployment from history
2. Runner triggers `workflow_dispatch` with `action=rollback` and `commit_sha=<selected>`
3. GitHub Actions checks out that commit and runs `flow deploy`
4. Recorded with `trigger_type: 'rollback'`

### Dry Run

1. User clicks "Dry Run" button
2. Runner triggers `workflow_dispatch` with `action=dry-run`
3. Workflow runs `flow deploy --update=false` (validates without deploying)
4. Result shown in deployment history with `trigger_type: 'dry-run'`

### API Routes

```
POST /github/rollback
Body: { installation_id, owner, repo, commit_sha, environment_name }

POST /github/dry-run
Body: { installation_id, owner, repo, environment_name }
```

## Feature 7: Deploy Panel UI

### Deployments Tab

```
┌─────────────────────────────────────────┐
│ Deployments                    [Settings]│
├─────────────────────────────────────────┤
│ Production (main → mainnet)              │
│   Last: abc1234 "Add NFT minting" 2m ago│
│   ✅ Deployed by @hao                    │
│                          [Promote]       │
├─────────────────────────────────────────┤
│ Staging (dev → testnet)                  │
│   Deploying def5678 "Fix imports"...     │
│   Running for 45s                        │
│                     [View Logs] [Cancel] │
├─────────────────────────────────────────┤
│ History                                  │
│  ✅ abc1234  main  mainnet  2m ago       │
│  ✅ def5678  dev   testnet  15m ago      │
│  ❌ ghi9012  dev   testnet  1h ago       │
│  ✅ jkl3456  dev   testnet  2h ago       │
│               [Load more...]             │
├─────────────────────────────────────────┤
│ [Rollback]  [Dry Run]  [Redeploy]        │
└─────────────────────────────────────────┘
```

### Settings Panel

```
┌─────────────────────────────────────────┐
│ Deploy Settings                          │
├─────────────────────────────────────────┤
│ Environments                             │
│  ┌─ Production ───────────────────┐     │
│  │ Branch: [main]   Network: [mainnet]│  │
│  │ Address: 0xabc...              │     │
│  │ Secrets: ✅ Configured         │     │
│  │          [Update Secrets]      │     │
│  └────────────────────────────────┘     │
│  ┌─ Staging ──────────────────────┐     │
│  │ Branch: [dev]   Network: [testnet]│  │
│  │ Address: 0xdef...              │     │
│  │ Secrets: ❌ Not configured     │     │
│  │          [Configure Secrets]   │     │
│  └────────────────────────────────┘     │
│  [+ Add Environment]                     │
├─────────────────────────────────────────┤
│ Auto-deploy: [On push]                   │
│ Deploy path: [contracts/]                │
│ [Disconnect GitHub]                      │
└─────────────────────────────────────────┘
```

## Implementation Order

1. **Database migrations** — environments table, deployments table
2. **Secrets management** — GitHub Secrets API integration + UI
3. **flow.json generation** — auto-generate from project files + environment config
4. **Enhanced workflow template** — multi-env, dry-run, rollback, webhook notify
5. **Webhook receiver** — `/github/webhook` route + signature verification
6. **WebSocket deploy events** — subscribe/publish mechanism
7. **Deploy panel UI** — deployments list, environment status, history
8. **Settings panel UI** — environment CRUD, secrets config
9. **Promote flow** — PR creation + App comment
10. **Rollback + Dry-run** — workflow_dispatch triggers

## Required GitHub App Permission Updates

- `actions: write` — trigger workflow_dispatch, cancel runs
- `secrets: write` — write repository secrets
- `pull_requests: write` — create PRs, post comments
- (existing) `contents: write` — commit files

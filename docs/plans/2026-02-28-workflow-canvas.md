# Workflow Canvas Editor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the form-based subscriptions page with a visual n8n-style workflow canvas using ReactFlow, where users build event-driven notification pipelines by dragging, connecting, and configuring trigger/condition/destination nodes.

**Architecture:** Visual-only approach — the canvas compiles DAGs down to the existing subscription/endpoint API. A new `workflows` table stores canvas JSON for persistence. ReactFlow `^11.11.4` (already installed) powers the canvas. Backend adds 5 CRUD endpoints + 1 deploy endpoint following existing handler/store patterns.

**Tech Stack:** ReactFlow 11, React 19, TanStack Router, TailwindCSS, Framer Motion, Lucide icons, existing webhookApi.ts client

---

## Task 1: Backend — Workflow Model & Store Methods

**Files:**
- Modify: `backend/internal/webhooks/store.go`

**Step 1: Add the Workflow struct** (after existing model structs, ~line 74)

```go
type Workflow struct {
	ID         string          `json:"id"`
	UserID     string          `json:"user_id,omitempty"`
	Name       string          `json:"name"`
	CanvasJSON json.RawMessage `json:"canvas_json"`
	IsActive   bool            `json:"is_active"`
	CreatedAt  time.Time       `json:"created_at"`
	UpdatedAt  time.Time       `json:"updated_at"`
}
```

**Step 2: Add store methods** (after existing store methods)

```go
func (s *Store) CreateWorkflow(ctx context.Context, w *Workflow) error {
	return s.pool.QueryRow(ctx,
		`INSERT INTO public.workflows (user_id, name, canvas_json, is_active)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, created_at, updated_at`,
		w.UserID, w.Name, w.CanvasJSON, w.IsActive,
	).Scan(&w.ID, &w.CreatedAt, &w.UpdatedAt)
}

func (s *Store) ListWorkflows(ctx context.Context, userID string, limit, offset int) ([]Workflow, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, user_id, name, canvas_json, is_active, created_at, updated_at
		 FROM public.workflows WHERE user_id = $1
		 ORDER BY updated_at DESC LIMIT $2 OFFSET $3`,
		userID, limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var items []Workflow
	for rows.Next() {
		var item Workflow
		if err := rows.Scan(&item.ID, &item.UserID, &item.Name, &item.CanvasJSON, &item.IsActive, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, nil
}

func (s *Store) GetWorkflow(ctx context.Context, id, userID string) (*Workflow, error) {
	var w Workflow
	err := s.pool.QueryRow(ctx,
		`SELECT id, user_id, name, canvas_json, is_active, created_at, updated_at
		 FROM public.workflows WHERE id = $1 AND user_id = $2`, id, userID,
	).Scan(&w.ID, &w.UserID, &w.Name, &w.CanvasJSON, &w.IsActive, &w.CreatedAt, &w.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &w, nil
}

func (s *Store) UpdateWorkflow(ctx context.Context, id, userID string, name *string, canvasJSON *json.RawMessage, isActive *bool) error {
	if name != nil {
		if _, err := s.pool.Exec(ctx,
			`UPDATE public.workflows SET name = $1, updated_at = now() WHERE id = $2 AND user_id = $3`,
			*name, id, userID); err != nil {
			return err
		}
	}
	if canvasJSON != nil {
		if _, err := s.pool.Exec(ctx,
			`UPDATE public.workflows SET canvas_json = $1, updated_at = now() WHERE id = $2 AND user_id = $3`,
			*canvasJSON, id, userID); err != nil {
			return err
		}
	}
	if isActive != nil {
		if _, err := s.pool.Exec(ctx,
			`UPDATE public.workflows SET is_active = $1, updated_at = now() WHERE id = $2 AND user_id = $3`,
			*isActive, id, userID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) DeleteWorkflow(ctx context.Context, id, userID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM public.workflows WHERE id = $1 AND user_id = $2`, id, userID)
	return err
}
```

**Step 3: Verify it compiles**

Run: `cd backend && go build ./...`
Expected: No errors

**Step 4: Commit**

```bash
git add backend/internal/webhooks/store.go
git commit -m "feat(workflows): add Workflow model and store CRUD methods"
```

---

## Task 2: Backend — Workflow HTTP Handlers & Routes

**Files:**
- Modify: `backend/internal/webhooks/handlers.go`

**Step 1: Register workflow routes** (inside `RegisterRoutes`, after existing authed routes)

```go
// Workflows
authed.HandleFunc("/workflows", h.handleCreateWorkflow).Methods("POST", "OPTIONS")
authed.HandleFunc("/workflows", h.handleListWorkflows).Methods("GET", "OPTIONS")
authed.HandleFunc("/workflows/{id}", h.handleGetWorkflow).Methods("GET", "OPTIONS")
authed.HandleFunc("/workflows/{id}", h.handleUpdateWorkflow).Methods("PATCH", "OPTIONS")
authed.HandleFunc("/workflows/{id}", h.handleDeleteWorkflow).Methods("DELETE", "OPTIONS")
authed.HandleFunc("/workflows/{id}/deploy", h.handleDeployWorkflow).Methods("POST", "OPTIONS")
```

**Step 2: Add handler methods** (after existing handler methods)

```go
func (h *Handlers) handleCreateWorkflow(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "missing user identity")
		return
	}
	var body struct {
		Name       string          `json:"name"`
		CanvasJSON json.RawMessage `json:"canvas_json"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Name == "" {
		body.Name = "Untitled Workflow"
	}
	if body.CanvasJSON == nil {
		body.CanvasJSON = json.RawMessage(`{}`)
	}
	wf := &Workflow{
		UserID:     userID,
		Name:       body.Name,
		CanvasJSON: body.CanvasJSON,
		IsActive:   false,
	}
	if err := h.store.CreateWorkflow(r.Context(), wf); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create workflow")
		return
	}
	writeJSON(w, http.StatusCreated, wf)
}

func (h *Handlers) handleListWorkflows(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "missing user identity")
		return
	}
	limit, offset := parsePagination(r)
	items, err := h.store.ListWorkflows(r.Context(), userID, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list workflows")
		return
	}
	if items == nil {
		items = []Workflow{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"items": items,
		"count": len(items),
	})
}

func (h *Handlers) handleGetWorkflow(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "missing user identity")
		return
	}
	id := mux.Vars(r)["id"]
	wf, err := h.store.GetWorkflow(r.Context(), id, userID)
	if err != nil {
		writeError(w, http.StatusNotFound, "workflow not found")
		return
	}
	writeJSON(w, http.StatusOK, wf)
}

func (h *Handlers) handleUpdateWorkflow(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "missing user identity")
		return
	}
	id := mux.Vars(r)["id"]
	var body struct {
		Name       *string          `json:"name,omitempty"`
		CanvasJSON *json.RawMessage `json:"canvas_json,omitempty"`
		IsActive   *bool            `json:"is_active,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := h.store.UpdateWorkflow(r.Context(), id, userID, body.Name, body.CanvasJSON, body.IsActive); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update workflow")
		return
	}
	wf, err := h.store.GetWorkflow(r.Context(), id, userID)
	if err != nil {
		writeError(w, http.StatusNotFound, "workflow not found")
		return
	}
	writeJSON(w, http.StatusOK, wf)
}

func (h *Handlers) handleDeleteWorkflow(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "missing user identity")
		return
	}
	id := mux.Vars(r)["id"]
	if err := h.store.DeleteWorkflow(r.Context(), id, userID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to delete workflow")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleDeployWorkflow is a stub — deploy logic lives in the frontend compiler
// for the visual-only V1. This endpoint marks the workflow as active.
func (h *Handlers) handleDeployWorkflow(w http.ResponseWriter, r *http.Request) {
	userID := UserIDFromContext(r.Context())
	if userID == "" {
		writeError(w, http.StatusUnauthorized, "missing user identity")
		return
	}
	id := mux.Vars(r)["id"]
	active := true
	if err := h.store.UpdateWorkflow(r.Context(), id, userID, nil, nil, &active); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to deploy workflow")
		return
	}
	wf, err := h.store.GetWorkflow(r.Context(), id, userID)
	if err != nil {
		writeError(w, http.StatusNotFound, "workflow not found")
		return
	}
	writeJSON(w, http.StatusOK, wf)
}
```

**Step 3: Verify it compiles**

Run: `cd backend && go build ./...`
Expected: No errors

**Step 4: Commit**

```bash
git add backend/internal/webhooks/handlers.go
git commit -m "feat(workflows): add workflow HTTP handlers and routes"
```

---

## Task 3: Backend — Database Migration

**Files:**
- No file — run SQL migration on production database

**Step 1: Run SQL migration**

```sql
CREATE TABLE IF NOT EXISTS public.workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL DEFAULT 'Untitled Workflow',
  canvas_json JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflows_user_id ON public.workflows(user_id);
```

Run on production supabase via:
```bash
docker exec -e PGPASSWORD=supabase-secret-prod-2026 supabase-postgres \
  psql -U supabase_admin -d supabase -c "CREATE TABLE IF NOT EXISTS public.workflows ..."
```

**Step 2: Verify table exists**

```bash
docker exec -e PGPASSWORD=supabase-secret-prod-2026 supabase-postgres \
  psql -U supabase_admin -d supabase -c "\dt public.workflows"
```

**Step 3: Commit** (no file changes, skip)

---

## Task 4: Frontend — API Client for Workflows

**Files:**
- Modify: `frontend/app/lib/webhookApi.ts`

**Step 1: Add Workflow type** (after existing types, ~line 46)

```typescript
export interface Workflow {
  id: string;
  name: string;
  canvas_json: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
```

**Step 2: Add workflow CRUD functions** (after existing functions, at end of file)

```typescript
// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

export async function listWorkflows(): Promise<Workflow[]> {
  const data = await request<{ items: Workflow[]; count: number }>('/workflows');
  return data.items ?? [];
}

export async function createWorkflow(name?: string, canvasJSON?: Record<string, unknown>): Promise<Workflow> {
  return request<Workflow>('/workflows', {
    method: 'POST',
    body: JSON.stringify({ name: name ?? 'Untitled Workflow', canvas_json: canvasJSON ?? {} }),
  });
}

export async function getWorkflow(id: string): Promise<Workflow> {
  return request<Workflow>(`/workflows/${encodeURIComponent(id)}`);
}

export async function updateWorkflow(
  id: string,
  data: { name?: string; canvas_json?: Record<string, unknown>; is_active?: boolean },
): Promise<Workflow> {
  return request<Workflow>(`/workflows/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deleteWorkflow(id: string): Promise<void> {
  return request<void>(`/workflows/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function deployWorkflow(id: string): Promise<Workflow> {
  return request<Workflow>(`/workflows/${encodeURIComponent(id)}/deploy`, { method: 'POST' });
}
```

**Step 3: Verify types**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors related to webhookApi.ts

**Step 4: Commit**

```bash
git add frontend/app/lib/webhookApi.ts
git commit -m "feat(workflows): add workflow API client functions"
```

---

## Task 5: Frontend — Node Type Registry & Constants

**Files:**
- Create: `frontend/app/components/developer/workflow/nodeTypes.ts`
- Create: `frontend/app/components/developer/workflow/constants.ts`

**Step 1: Create constants.ts**

```typescript
// Category colors
export const COLORS = {
  trigger: '#00ef8b',    // green
  condition: '#f59e0b',  // amber
  destination: '#3b82f6', // blue
} as const

// Preset tokens (reused from subscriptions)
export const FT_TOKENS = [
  { value: '', label: 'Any Token' },
  { value: 'A.1654653399040a61.FlowToken', label: 'FLOW' },
  { value: 'A.b19436aae4d94622.FiatToken', label: 'USDC' },
  { value: 'A.cfdd90d4a00f7b5b.TeleportedTetherToken', label: 'USDT' },
  { value: 'A.d6f80565193ad727.stFlowToken', label: 'stFLOW' },
  { value: 'A.231cc0dbbcffc4b7.ceWBTC', label: 'BTC (Celer)' },
  { value: 'A.231cc0dbbcffc4b7.ceWETH', label: 'ETH (Celer)' },
  { value: 'A.3c1c4b041ad18279.PYUSD', label: 'PYUSD' },
]

export const NFT_COLLECTIONS = [
  { value: '', label: 'Any Collection' },
  { value: 'A.0b2a3299cc857e29.TopShot', label: 'NBA Top Shot' },
  { value: 'A.e4cf4bdc1751c65d.AllDay', label: 'NFL All Day' },
  { value: 'A.329feb3ab062d289.UFC_NFT', label: 'UFC Strike' },
  { value: 'A.87ca73a41bb50ad5.Golazos', label: 'LaLiga Golazos' },
  { value: 'A.2d4c3caffbeab845.FLOAT', label: 'FLOAT' },
]
```

**Step 2: Create nodeTypes.ts**

```typescript
import type { ComponentType } from 'react'
import {
  Zap, Image, User, FileCheck, Box, Monitor, ScrollText, Wallet, Clock,
  GitBranch, Filter,
  Globe, MessageSquare, Hash, Send, Mail,
} from 'lucide-react'
import { COLORS } from './constants'

export type NodeCategory = 'trigger' | 'condition' | 'destination'

export interface NodeTypeMeta {
  type: string           // ReactFlow node type id, e.g. 'trigger_ft_transfer'
  label: string          // Human label, e.g. 'FT Transfer'
  category: NodeCategory
  icon: ComponentType<{ className?: string }>
  color: string
  eventType?: string     // maps to subscription event_type (triggers only)
  /** Config field definitions for the right panel form */
  configFields: ConfigFieldDef[]
  /** Number of output handles (default 1). IF node has 2. */
  outputs?: number
}

export interface ConfigFieldDef {
  key: string
  label: string
  type: 'text' | 'number' | 'select'
  placeholder?: string
  options?: { value: string; label: string }[] | string[]
  isArray?: boolean
}

// ---------------------------------------------------------------------------
// FT_TOKENS and NFT_COLLECTIONS imported from constants.ts
// ---------------------------------------------------------------------------
import { FT_TOKENS, NFT_COLLECTIONS } from './constants'

// ---------------------------------------------------------------------------
// Trigger nodes
// ---------------------------------------------------------------------------

const TRIGGER_NODES: NodeTypeMeta[] = [
  {
    type: 'trigger_ft_transfer', label: 'FT Transfer', category: 'trigger',
    icon: Zap, color: COLORS.trigger, eventType: 'ft.transfer',
    configFields: [
      { key: 'addresses', label: 'Addresses', type: 'text', placeholder: '0x1,0x2', isArray: true },
      { key: 'direction', label: 'Direction', type: 'select', options: ['in', 'out', 'both'] },
      { key: 'token_contract', label: 'Token', type: 'select', options: FT_TOKENS },
      { key: 'min_amount', label: 'Min Amount', type: 'number', placeholder: '0' },
    ],
  },
  {
    type: 'trigger_nft_transfer', label: 'NFT Transfer', category: 'trigger',
    icon: Image, color: COLORS.trigger, eventType: 'nft.transfer',
    configFields: [
      { key: 'addresses', label: 'Addresses', type: 'text', placeholder: '0x1,0x2', isArray: true },
      { key: 'collection', label: 'Collection', type: 'select', options: NFT_COLLECTIONS },
      { key: 'direction', label: 'Direction', type: 'select', options: ['in', 'out', 'both'] },
    ],
  },
  {
    type: 'trigger_account_event', label: 'Account Event', category: 'trigger',
    icon: User, color: COLORS.trigger, eventType: 'account.created',
    configFields: [
      { key: 'addresses', label: 'Addresses', type: 'text', placeholder: '0x1,0x2', isArray: true },
      { key: 'subtypes', label: 'Subtypes', type: 'text', placeholder: 'created,key.added', isArray: true },
    ],
  },
  {
    type: 'trigger_tx_sealed', label: 'TX Sealed', category: 'trigger',
    icon: FileCheck, color: COLORS.trigger, eventType: 'transaction.sealed',
    configFields: [
      { key: 'addresses', label: 'Addresses', type: 'text', placeholder: '0x1,0x2', isArray: true },
      { key: 'roles', label: 'Roles', type: 'text', placeholder: 'PROPOSER,PAYER', isArray: true },
    ],
  },
  {
    type: 'trigger_block_sealed', label: 'Block Sealed', category: 'trigger',
    icon: Box, color: COLORS.trigger, eventType: 'block.sealed',
    configFields: [],
  },
  {
    type: 'trigger_evm_tx', label: 'EVM Transaction', category: 'trigger',
    icon: Monitor, color: COLORS.trigger, eventType: 'evm.transaction',
    configFields: [
      { key: 'from', label: 'From', type: 'text', placeholder: '0x...' },
      { key: 'to', label: 'To', type: 'text', placeholder: '0x...' },
      { key: 'min_value', label: 'Min Value (wei)', type: 'number', placeholder: '0' },
    ],
  },
  {
    type: 'trigger_contract_event', label: 'Contract Event', category: 'trigger',
    icon: ScrollText, color: COLORS.trigger, eventType: 'contract.event',
    configFields: [
      { key: 'contract_address', label: 'Contract', type: 'text', placeholder: '0x...' },
      { key: 'event_names', label: 'Events', type: 'text', placeholder: 'Deposit,Withdraw', isArray: true },
    ],
  },
  {
    type: 'trigger_balance_change', label: 'Balance Change', category: 'trigger',
    icon: Wallet, color: COLORS.trigger, eventType: 'ft.large_transfer',
    configFields: [
      { key: 'addresses', label: 'Addresses', type: 'text', placeholder: '0x1', isArray: true },
      { key: 'token_contract', label: 'Token', type: 'select', options: FT_TOKENS },
      { key: 'min_amount', label: 'Threshold', type: 'number', placeholder: '1000' },
    ],
  },
  {
    type: 'trigger_schedule', label: 'Schedule', category: 'trigger',
    icon: Clock, color: COLORS.trigger, eventType: 'schedule',
    configFields: [
      { key: 'cron', label: 'Cron Expression', type: 'text', placeholder: '0 * * * *' },
      { key: 'timezone', label: 'Timezone', type: 'text', placeholder: 'UTC' },
    ],
  },
]

// ---------------------------------------------------------------------------
// Condition nodes
// ---------------------------------------------------------------------------

const CONDITION_NODES: NodeTypeMeta[] = [
  {
    type: 'condition_if', label: 'IF', category: 'condition',
    icon: GitBranch, color: COLORS.condition, outputs: 2,
    configFields: [
      { key: 'field', label: 'Field', type: 'text', placeholder: 'amount' },
      { key: 'operator', label: 'Operator', type: 'select', options: ['==', '!=', '>', '<', '>=', '<=', 'contains', 'starts_with'] },
      { key: 'value', label: 'Value', type: 'text', placeholder: '' },
    ],
  },
  {
    type: 'condition_filter', label: 'Filter', category: 'condition',
    icon: Filter, color: COLORS.condition,
    configFields: [
      { key: 'field', label: 'Field', type: 'text', placeholder: 'token' },
      { key: 'operator', label: 'Operator', type: 'select', options: ['==', '!=', '>', '<', 'contains'] },
      { key: 'value', label: 'Value', type: 'text', placeholder: '' },
    ],
  },
]

// ---------------------------------------------------------------------------
// Destination nodes
// ---------------------------------------------------------------------------

const DESTINATION_NODES: NodeTypeMeta[] = [
  {
    type: 'dest_webhook', label: 'Webhook', category: 'destination',
    icon: Globe, color: COLORS.destination,
    configFields: [
      { key: 'url', label: 'URL', type: 'text', placeholder: 'https://...' },
      { key: 'method', label: 'Method', type: 'select', options: ['POST', 'PUT', 'PATCH'] },
    ],
  },
  {
    type: 'dest_slack', label: 'Slack', category: 'destination',
    icon: MessageSquare, color: COLORS.destination,
    configFields: [
      { key: 'webhook_url', label: 'Webhook URL', type: 'text', placeholder: 'https://hooks.slack.com/...' },
    ],
  },
  {
    type: 'dest_discord', label: 'Discord', category: 'destination',
    icon: Hash, color: COLORS.destination,
    configFields: [
      { key: 'webhook_url', label: 'Webhook URL', type: 'text', placeholder: 'https://discord.com/api/webhooks/...' },
    ],
  },
  {
    type: 'dest_telegram', label: 'Telegram', category: 'destination',
    icon: Send, color: COLORS.destination,
    configFields: [
      { key: 'bot_token', label: 'Bot Token', type: 'text', placeholder: '123456:ABC-DEF...' },
      { key: 'chat_id', label: 'Chat ID', type: 'text', placeholder: '-100...' },
    ],
  },
  {
    type: 'dest_email', label: 'Email', category: 'destination',
    icon: Mail, color: COLORS.destination,
    configFields: [
      { key: 'to', label: 'To', type: 'text', placeholder: 'user@example.com' },
      { key: 'subject', label: 'Subject', type: 'text', placeholder: 'Alert: {{event_type}}' },
    ],
  },
]

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const ALL_NODE_TYPES: NodeTypeMeta[] = [
  ...TRIGGER_NODES,
  ...CONDITION_NODES,
  ...DESTINATION_NODES,
]

/** Lookup by ReactFlow node type string */
export const NODE_TYPE_MAP: Record<string, NodeTypeMeta> = Object.fromEntries(
  ALL_NODE_TYPES.map((n) => [n.type, n])
)

export const TRIGGER_NODE_TYPES = TRIGGER_NODES
export const CONDITION_NODE_TYPES = CONDITION_NODES
export const DESTINATION_NODE_TYPES = DESTINATION_NODES
```

**Step 3: Verify**

Run: `cd frontend && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add frontend/app/components/developer/workflow/
git commit -m "feat(workflows): add node type registry and constants"
```

---

## Task 6: Frontend — Custom ReactFlow Node Components

**Files:**
- Create: `frontend/app/components/developer/workflow/nodes/TriggerNode.tsx`
- Create: `frontend/app/components/developer/workflow/nodes/ConditionNode.tsx`
- Create: `frontend/app/components/developer/workflow/nodes/DestinationNode.tsx`

**Step 1: Create TriggerNode.tsx**

```tsx
import { memo } from 'react'
import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'
import { NODE_TYPE_MAP } from '../nodeTypes'
import { COLORS } from '../constants'

function TriggerNode({ data, selected }: NodeProps) {
  const meta = NODE_TYPE_MAP[data.nodeType]
  if (!meta) return null
  const Icon = meta.icon

  // Build a short config preview string
  const config = data.config ?? {}
  const preview = Object.entries(config)
    .filter(([, v]) => v !== '' && v !== undefined)
    .slice(0, 2)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')

  return (
    <div
      className={`bg-neutral-800 border rounded-xl px-4 py-3 min-w-[180px] max-w-[220px] transition-shadow ${
        selected ? 'shadow-lg shadow-[#00ef8b]/20 border-[#00ef8b]/50' : 'border-neutral-700'
      }`}
      style={{ borderLeftWidth: 3, borderLeftColor: COLORS.trigger }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4" style={{ color: COLORS.trigger }} />
        <span className="text-sm font-medium text-white truncate">{meta.label}</span>
      </div>
      {preview && (
        <p className="text-xs text-neutral-400 truncate">{preview}</p>
      )}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !border-2 !border-neutral-700 !bg-[#00ef8b]"
      />
    </div>
  )
}

export default memo(TriggerNode)
```

**Step 2: Create ConditionNode.tsx**

```tsx
import { memo } from 'react'
import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'
import { NODE_TYPE_MAP } from '../nodeTypes'
import { COLORS } from '../constants'

function ConditionNode({ data, selected }: NodeProps) {
  const meta = NODE_TYPE_MAP[data.nodeType]
  if (!meta) return null
  const Icon = meta.icon
  const isIF = meta.type === 'condition_if'

  const config = data.config ?? {}
  const preview = config.field
    ? `${config.field} ${config.operator ?? '=='} ${config.value ?? ''}`
    : ''

  return (
    <div
      className={`bg-neutral-800 border rounded-xl px-4 py-3 min-w-[160px] max-w-[200px] transition-shadow ${
        selected ? 'shadow-lg shadow-amber-500/20 border-amber-500/50' : 'border-neutral-700'
      }`}
      style={{ borderLeftWidth: 3, borderLeftColor: COLORS.condition }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !border-2 !border-neutral-700 !bg-amber-500"
      />
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4" style={{ color: COLORS.condition }} />
        <span className="text-sm font-medium text-white">{meta.label}</span>
      </div>
      {preview && (
        <p className="text-xs text-neutral-400 truncate">{preview}</p>
      )}
      {isIF ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="true"
            className="!w-3 !h-3 !border-2 !border-neutral-700 !bg-emerald-400"
            style={{ top: '35%' }}
          />
          <Handle
            type="source"
            position={Position.Right}
            id="false"
            className="!w-3 !h-3 !border-2 !border-neutral-700 !bg-red-400"
            style={{ top: '65%' }}
          />
          <div className="absolute -right-7 text-[10px] text-emerald-400" style={{ top: '28%' }}>T</div>
          <div className="absolute -right-7 text-[10px] text-red-400" style={{ top: '58%' }}>F</div>
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          className="!w-3 !h-3 !border-2 !border-neutral-700 !bg-amber-500"
        />
      )}
    </div>
  )
}

export default memo(ConditionNode)
```

**Step 3: Create DestinationNode.tsx**

```tsx
import { memo } from 'react'
import { Handle, Position } from 'reactflow'
import type { NodeProps } from 'reactflow'
import { NODE_TYPE_MAP } from '../nodeTypes'
import { COLORS } from '../constants'

function DestinationNode({ data, selected }: NodeProps) {
  const meta = NODE_TYPE_MAP[data.nodeType]
  if (!meta) return null
  const Icon = meta.icon

  const config = data.config ?? {}
  const preview = config.url || config.webhook_url || config.chat_id || config.to || ''

  return (
    <div
      className={`bg-neutral-800 border rounded-xl px-4 py-3 min-w-[160px] max-w-[200px] transition-shadow ${
        selected ? 'shadow-lg shadow-blue-500/20 border-blue-500/50' : 'border-neutral-700'
      }`}
      style={{ borderLeftWidth: 3, borderLeftColor: COLORS.destination }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !border-2 !border-neutral-700 !bg-blue-500"
      />
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4" style={{ color: COLORS.destination }} />
        <span className="text-sm font-medium text-white">{meta.label}</span>
      </div>
      {preview && (
        <p className="text-xs text-neutral-400 truncate">{String(preview)}</p>
      )}
    </div>
  )
}

export default memo(DestinationNode)
```

**Step 4: Verify**

Run: `cd frontend && npx tsc --noEmit`

**Step 5: Commit**

```bash
git add frontend/app/components/developer/workflow/nodes/
git commit -m "feat(workflows): add custom ReactFlow node components"
```

---

## Task 7: Frontend — Node Palette (Left Sidebar)

**Files:**
- Create: `frontend/app/components/developer/workflow/NodePalette.tsx`

**Step 1: Create NodePalette.tsx**

```tsx
import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { TRIGGER_NODE_TYPES, CONDITION_NODE_TYPES, DESTINATION_NODE_TYPES } from './nodeTypes'
import type { NodeTypeMeta } from './nodeTypes'
import { COLORS } from './constants'

interface NodePaletteProps {
  onAddNode: (nodeType: string) => void
}

interface CategoryProps {
  title: string
  color: string
  items: NodeTypeMeta[]
  onAddNode: (nodeType: string) => void
}

function Category({ title, color, items, onAddNode }: CategoryProps) {
  const [open, setOpen] = useState(true)

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs font-medium uppercase tracking-wider hover:bg-neutral-800 rounded-lg transition-colors"
        style={{ color }}
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {title}
      </button>
      {open && (
        <div className="space-y-0.5 mt-0.5">
          {items.map((node) => {
            const Icon = node.icon
            return (
              <button
                key={node.type}
                onClick={() => onAddNode(node.type)}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/reactflow-node-type', node.type)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-neutral-300 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors cursor-grab active:cursor-grabbing"
              >
                <Icon className="w-4 h-4 shrink-0" style={{ color: node.color }} />
                {node.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function NodePalette({ onAddNode }: NodePaletteProps) {
  return (
    <div className="w-52 shrink-0 border-r border-neutral-800 bg-neutral-900/80 p-2 space-y-2 overflow-y-auto">
      <p className="px-3 py-1 text-xs font-semibold text-neutral-500 uppercase tracking-wider">
        Add Nodes
      </p>
      <Category title="Triggers" color={COLORS.trigger} items={TRIGGER_NODE_TYPES} onAddNode={onAddNode} />
      <Category title="Conditions" color={COLORS.condition} items={CONDITION_NODE_TYPES} onAddNode={onAddNode} />
      <Category title="Destinations" color={COLORS.destination} items={DESTINATION_NODE_TYPES} onAddNode={onAddNode} />
    </div>
  )
}
```

**Step 2: Verify**

Run: `cd frontend && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add frontend/app/components/developer/workflow/NodePalette.tsx
git commit -m "feat(workflows): add draggable node palette sidebar"
```

---

## Task 8: Frontend — Node Config Panel (Right Sidebar)

**Files:**
- Create: `frontend/app/components/developer/workflow/NodeConfigPanel.tsx`

**Step 1: Create NodeConfigPanel.tsx**

```tsx
import { X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { NODE_TYPE_MAP } from './nodeTypes'
import type { ConfigFieldDef } from './nodeTypes'

interface NodeConfigPanelProps {
  selectedNodeId: string | null
  nodeType: string | null
  config: Record<string, string>
  onConfigChange: (key: string, value: string) => void
  onClose: () => void
  onDelete: () => void
}

export default function NodeConfigPanel({
  selectedNodeId,
  nodeType,
  config,
  onConfigChange,
  onClose,
  onDelete,
}: NodeConfigPanelProps) {
  const meta = nodeType ? NODE_TYPE_MAP[nodeType] : null

  return (
    <AnimatePresence>
      {selectedNodeId && meta && (
        <motion.div
          initial={{ x: 320, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 320, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="w-80 shrink-0 border-l border-neutral-800 bg-neutral-900/95 backdrop-blur-sm flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
            <div className="flex items-center gap-2">
              <meta.icon className="w-4 h-4" style={{ color: meta.color }} />
              <span className="text-sm font-medium text-white">{meta.label}</span>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-neutral-500 hover:text-white hover:bg-neutral-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Config fields */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {meta.configFields.length === 0 ? (
              <p className="text-sm text-neutral-500">No configuration needed for this node.</p>
            ) : (
              meta.configFields.map((field: ConfigFieldDef) => (
                <div key={field.key}>
                  <label
                    htmlFor={`cfg-${field.key}`}
                    className="block text-xs text-neutral-400 mb-1.5"
                  >
                    {field.label}
                  </label>
                  {field.type === 'select' ? (
                    <select
                      id={`cfg-${field.key}`}
                      value={config[field.key] ?? ''}
                      onChange={(e) => onConfigChange(field.key, e.target.value)}
                      className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-white focus:outline-none focus:border-[#00ef8b]/50 focus:ring-1 focus:ring-[#00ef8b]/25 transition-colors"
                    >
                      <option value="">-- Select --</option>
                      {field.options?.map((opt) =>
                        typeof opt === 'object' ? (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ) : (
                          <option key={opt} value={opt}>{opt}</option>
                        ),
                      )}
                    </select>
                  ) : (
                    <input
                      id={`cfg-${field.key}`}
                      type={field.type === 'number' ? 'number' : 'text'}
                      value={config[field.key] ?? ''}
                      onChange={(e) => onConfigChange(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-lg text-sm text-white font-mono placeholder-neutral-500 focus:outline-none focus:border-[#00ef8b]/50 focus:ring-1 focus:ring-[#00ef8b]/25 transition-colors"
                    />
                  )}
                </div>
              ))
            )}
          </div>

          {/* Delete button */}
          <div className="p-4 border-t border-neutral-800">
            <button
              onClick={onDelete}
              className="w-full py-2 text-sm font-medium text-red-400 bg-red-500/10 rounded-lg hover:bg-red-500/20 transition-colors"
            >
              Delete Node
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

**Step 2: Verify**

Run: `cd frontend && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add frontend/app/components/developer/workflow/NodeConfigPanel.tsx
git commit -m "feat(workflows): add node config panel (right sidebar)"
```

---

## Task 9: Frontend — DAG Compiler (Canvas → Subscriptions)

**Files:**
- Create: `frontend/app/components/developer/workflow/compiler.ts`

**Step 1: Create compiler.ts**

```typescript
import type { Node, Edge } from 'reactflow'
import { NODE_TYPE_MAP } from './nodeTypes'

export interface CompiledPath {
  triggerNodeId: string
  eventType: string
  conditions: Record<string, unknown>
  destinationNodeId: string
  destinationType: string
  destinationConfig: Record<string, string>
}

export interface CompileResult {
  paths: CompiledPath[]
  errors: string[]
}

/**
 * Walk the DAG from each trigger node to each reachable destination node.
 * Collect conditions from IF/Filter nodes along the way.
 * Returns a list of compiled paths ready to become subscriptions.
 */
export function compileWorkflow(nodes: Node[], edges: Edge[]): CompileResult {
  const errors: string[] = []
  const paths: CompiledPath[] = []

  // Build adjacency list
  const adj = new Map<string, { targetId: string; sourceHandle?: string | null }[]>()
  for (const edge of edges) {
    const list = adj.get(edge.source) || []
    list.push({ targetId: edge.target, sourceHandle: edge.sourceHandle })
    adj.set(edge.source, list)
  }

  // Find trigger nodes
  const triggerNodes = nodes.filter((n) => {
    const meta = NODE_TYPE_MAP[n.data?.nodeType]
    return meta?.category === 'trigger'
  })

  if (triggerNodes.length === 0) {
    errors.push('Workflow has no trigger nodes')
    return { paths, errors }
  }

  // DFS from each trigger
  for (const trigger of triggerNodes) {
    const meta = NODE_TYPE_MAP[trigger.data.nodeType]
    if (!meta?.eventType) continue

    const visited = new Set<string>()

    function dfs(nodeId: string, conditions: Record<string, unknown>) {
      if (visited.has(nodeId)) return
      visited.add(nodeId)

      const node = nodes.find((n) => n.id === nodeId)
      if (!node) return

      const nodeMeta = NODE_TYPE_MAP[node.data?.nodeType]
      if (!nodeMeta) return

      // If destination, record path
      if (nodeMeta.category === 'destination') {
        paths.push({
          triggerNodeId: trigger.id,
          eventType: meta.eventType!,
          conditions: { ...conditions, ...(trigger.data.config ?? {}) },
          destinationNodeId: node.id,
          destinationType: nodeMeta.type,
          destinationConfig: node.data.config ?? {},
        })
        return
      }

      // If condition, merge conditions
      let mergedConditions = { ...conditions }
      if (nodeMeta.category === 'condition') {
        const cfg = node.data.config ?? {}
        if (cfg.field && cfg.operator && cfg.value !== undefined) {
          mergedConditions[`${cfg.field}_${cfg.operator}`] = cfg.value
        }
      }

      // Continue DFS
      const neighbors = adj.get(nodeId) || []
      for (const neighbor of neighbors) {
        dfs(neighbor.targetId, mergedConditions)
      }

      visited.delete(nodeId) // Allow revisiting via different paths
    }

    dfs(trigger.id, {})
  }

  // Validate: check for orphan nodes (not connected)
  const connectedNodes = new Set<string>()
  for (const edge of edges) {
    connectedNodes.add(edge.source)
    connectedNodes.add(edge.target)
  }
  for (const node of nodes) {
    if (!connectedNodes.has(node.id)) {
      const nodeMeta = NODE_TYPE_MAP[node.data?.nodeType]
      errors.push(`"${nodeMeta?.label ?? node.id}" is not connected`)
    }
  }

  if (paths.length === 0 && errors.length === 0) {
    errors.push('No complete trigger → destination paths found')
  }

  return { paths, errors }
}
```

**Step 2: Verify**

Run: `cd frontend && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add frontend/app/components/developer/workflow/compiler.ts
git commit -m "feat(workflows): add DAG compiler (canvas → subscription paths)"
```

---

## Task 10: Frontend — WorkflowCanvas Main Component

**Files:**
- Create: `frontend/app/components/developer/workflow/WorkflowCanvas.tsx`

**Step 1: Create WorkflowCanvas.tsx**

This is the main component that ties together ReactFlow, NodePalette, NodeConfigPanel, and the top bar.

```tsx
import { useState, useCallback, useRef, useMemo } from 'react'
import ReactFlow, {
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
} from 'reactflow'
import type {
  Node,
  Edge,
  Connection,
  NodeChange,
  EdgeChange,
  ReactFlowInstance,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { Save, Rocket, Loader2, ArrowLeft, Pencil, Check } from 'lucide-react'
import { Link } from '@tanstack/react-router'

import TriggerNode from './nodes/TriggerNode'
import ConditionNode from './nodes/ConditionNode'
import DestinationNode from './nodes/DestinationNode'
import NodePalette from './NodePalette'
import NodeConfigPanel from './NodeConfigPanel'
import { NODE_TYPE_MAP } from './nodeTypes'
import { compileWorkflow } from './compiler'
import { updateWorkflow, deployWorkflow, listEndpoints, createEndpoint, createSubscription } from '../../../lib/webhookApi'
import type { Endpoint } from '../../../lib/webhookApi'

// Register custom node types
const nodeTypes = {
  // Triggers
  trigger_ft_transfer: TriggerNode,
  trigger_nft_transfer: TriggerNode,
  trigger_account_event: TriggerNode,
  trigger_tx_sealed: TriggerNode,
  trigger_block_sealed: TriggerNode,
  trigger_evm_tx: TriggerNode,
  trigger_contract_event: TriggerNode,
  trigger_balance_change: TriggerNode,
  trigger_schedule: TriggerNode,
  // Conditions
  condition_if: ConditionNode,
  condition_filter: ConditionNode,
  // Destinations
  dest_webhook: DestinationNode,
  dest_slack: DestinationNode,
  dest_discord: DestinationNode,
  dest_telegram: DestinationNode,
  dest_email: DestinationNode,
}

interface WorkflowCanvasProps {
  workflowId: string
  initialName: string
  initialNodes: Node[]
  initialEdges: Edge[]
}

let nodeIdCounter = 0
function nextNodeId() {
  return `node_${++nodeIdCounter}_${Date.now()}`
}

export default function WorkflowCanvas({
  workflowId,
  initialName,
  initialNodes,
  initialEdges,
}: WorkflowCanvasProps) {
  const [nodes, setNodes] = useState<Node[]>(initialNodes)
  const [edges, setEdges] = useState<Edge[]>(initialEdges)
  const [name, setName] = useState(initialName)
  const [editingName, setEditingName] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [deployResult, setDeployResult] = useState<{ ok: boolean; message: string } | null>(null)

  // Selected node for config panel
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const reactFlowRef = useRef<ReactFlowInstance | null>(null)

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId],
  )

  // --- ReactFlow callbacks ---

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds))
  }, [])

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes, eds))
  }, [])

  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) => addEdge({
      ...connection,
      animated: true,
      style: { stroke: '#525252', strokeWidth: 2 },
    }, eds))
  }, [])

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id)
  }, [])

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null)
  }, [])

  // --- Add node ---

  const addNode = useCallback((nodeType: string) => {
    const meta = NODE_TYPE_MAP[nodeType]
    if (!meta) return

    const position = reactFlowRef.current
      ? reactFlowRef.current.project({ x: 300 + Math.random() * 200, y: 150 + Math.random() * 200 })
      : { x: 300, y: 200 }

    const newNode: Node = {
      id: nextNodeId(),
      type: nodeType,
      position,
      data: { nodeType, config: {} },
    }

    setNodes((nds) => [...nds, newNode])
  }, [])

  // --- Drop handler (drag from palette) ---

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const nodeType = e.dataTransfer.getData('application/reactflow-node-type')
    if (!nodeType || !NODE_TYPE_MAP[nodeType]) return

    const position = reactFlowRef.current
      ? reactFlowRef.current.project({ x: e.clientX - 250, y: e.clientY - 50 })
      : { x: e.clientX, y: e.clientY }

    const newNode: Node = {
      id: nextNodeId(),
      type: nodeType,
      position,
      data: { nodeType, config: {} },
    }

    setNodes((nds) => [...nds, newNode])
  }, [])

  // --- Config panel handlers ---

  const handleConfigChange = useCallback((key: string, value: string) => {
    if (!selectedNodeId) return
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedNodeId
          ? { ...n, data: { ...n.data, config: { ...n.data.config, [key]: value } } }
          : n,
      ),
    )
  }, [selectedNodeId])

  const handleDeleteNode = useCallback(() => {
    if (!selectedNodeId) return
    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId))
    setEdges((eds) => eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId))
    setSelectedNodeId(null)
  }, [selectedNodeId])

  // --- Save ---

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await updateWorkflow(workflowId, {
        name,
        canvas_json: { nodes, edges },
      })
    } catch (err) {
      console.error('Save failed:', err)
    } finally {
      setSaving(false)
    }
  }, [workflowId, name, nodes, edges])

  // --- Deploy ---

  const handleDeploy = useCallback(async () => {
    setDeploying(true)
    setDeployResult(null)
    try {
      // 1. Save canvas first
      await updateWorkflow(workflowId, {
        name,
        canvas_json: { nodes, edges },
      })

      // 2. Compile DAG
      const result = compileWorkflow(nodes, edges)
      if (result.errors.length > 0) {
        setDeployResult({ ok: false, message: result.errors.join('\n') })
        return
      }

      // 3. Get existing endpoints
      const existingEndpoints = await listEndpoints()

      // 4. For each compiled path, create endpoint + subscription
      let created = 0
      for (const path of result.paths) {
        // Find or create endpoint
        const destMeta = NODE_TYPE_MAP[path.destinationType]
        const endpointType = path.destinationType.replace('dest_', '') as 'webhook' | 'discord' | 'slack' | 'telegram' | 'email'
        const url = path.destinationConfig.url || path.destinationConfig.webhook_url || `${endpointType}://${path.destinationConfig.chat_id || path.destinationConfig.to || 'default'}`

        let endpoint: Endpoint | undefined = existingEndpoints.find(
          (ep) => ep.url === url && ep.endpoint_type === endpointType
        )
        if (!endpoint) {
          endpoint = await createEndpoint(url, `${destMeta?.label ?? endpointType} (from workflow)`, endpointType, path.destinationConfig)
        }

        // Create subscription
        await createSubscription(endpoint.id, path.eventType, path.conditions)
        created++
      }

      // 5. Mark workflow as active
      await deployWorkflow(workflowId)

      setDeployResult({ ok: true, message: `Deployed ${created} subscription${created !== 1 ? 's' : ''}` })
    } catch (err) {
      setDeployResult({ ok: false, message: err instanceof Error ? err.message : 'Deploy failed' })
    } finally {
      setDeploying(false)
    }
  }, [workflowId, name, nodes, edges])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-neutral-800 bg-neutral-900/80 backdrop-blur-sm shrink-0">
        <Link
          to="/developer/subscriptions"
          className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>

        {editingName ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setEditingName(false) }}
              className="px-2 py-1 bg-neutral-800 border border-neutral-700 rounded text-sm text-white focus:outline-none focus:border-[#00ef8b]/50"
            />
            <button onClick={() => setEditingName(false)} className="p-1 text-[#00ef8b]">
              <Check className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditingName(true)}
            className="flex items-center gap-1.5 text-sm font-medium text-white hover:text-[#00ef8b] transition-colors"
          >
            {name}
            <Pencil className="w-3 h-3 text-neutral-500" />
          </button>
        )}

        <div className="flex-1" />

        {deployResult && (
          <span className={`text-xs px-2 py-1 rounded ${deployResult.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
            {deployResult.message}
          </span>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 border border-neutral-700 text-neutral-300 text-sm rounded-lg hover:bg-neutral-700 transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save
        </button>

        <button
          onClick={handleDeploy}
          disabled={deploying}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#00ef8b] text-black text-sm font-medium rounded-lg hover:bg-[#00ef8b]/90 transition-colors disabled:opacity-50"
        >
          {deploying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
          Deploy
        </button>
      </div>

      {/* Canvas area */}
      <div className="flex-1 flex min-h-0">
        <NodePalette onAddNode={addNode} />

        <div className="flex-1 min-w-0" onDragOver={onDragOver} onDrop={onDrop}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onInit={(instance) => { reactFlowRef.current = instance }}
            nodeTypes={nodeTypes}
            fitView
            snapToGrid
            snapGrid={[16, 16]}
            defaultEdgeOptions={{
              animated: true,
              style: { stroke: '#525252', strokeWidth: 2 },
            }}
            className="bg-neutral-950"
          >
            <Background variant={BackgroundVariant.Dots} color="#333" gap={16} size={1} />
            <Controls className="!bg-neutral-800 !border-neutral-700 !rounded-lg [&>button]:!bg-neutral-800 [&>button]:!border-neutral-700 [&>button]:!text-neutral-400 [&>button:hover]:!bg-neutral-700" />
            <MiniMap
              nodeColor={(n) => {
                const meta = NODE_TYPE_MAP[n.data?.nodeType]
                return meta?.color ?? '#525252'
              }}
              className="!bg-neutral-900 !border-neutral-800 !rounded-lg"
              maskColor="rgba(0,0,0,0.6)"
            />
          </ReactFlow>
        </div>

        <NodeConfigPanel
          selectedNodeId={selectedNodeId}
          nodeType={selectedNode?.data?.nodeType ?? null}
          config={selectedNode?.data?.config ?? {}}
          onConfigChange={handleConfigChange}
          onClose={() => setSelectedNodeId(null)}
          onDelete={handleDeleteNode}
        />
      </div>
    </div>
  )
}
```

**Step 2: Verify**

Run: `cd frontend && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add frontend/app/components/developer/workflow/WorkflowCanvas.tsx
git commit -m "feat(workflows): add main WorkflowCanvas component with ReactFlow"
```

---

## Task 11: Frontend — Workflow List Page (replaces subscriptions.tsx)

**Files:**
- Modify: `frontend/app/routes/developer/subscriptions.tsx` (complete rewrite)

**Step 1: Rewrite subscriptions.tsx as workflow list**

```tsx
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Plus, Trash2, Loader2, GitBranch, CheckCircle, Circle } from 'lucide-react'
import DeveloperLayout from '../../components/developer/DeveloperLayout'
import { listWorkflows, createWorkflow, deleteWorkflow } from '../../lib/webhookApi'
import type { Workflow } from '../../lib/webhookApi'

export const Route = createFileRoute('/developer/subscriptions')({
  component: WorkflowListPage,
})

function WorkflowListPage() {
  const navigate = useNavigate()
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Workflow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fetchWorkflows = useCallback(async () => {
    try {
      const data = await listWorkflows()
      setWorkflows(data)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchWorkflows() }, [fetchWorkflows])

  async function handleCreate() {
    setCreating(true)
    try {
      const wf = await createWorkflow()
      navigate({ to: '/developer/subscriptions/$id', params: { id: wf.id } })
    } catch {
      setCreating(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteWorkflow(deleteTarget.id)
      setWorkflows((prev) => prev.filter((w) => w.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch {
      // ignore
    } finally {
      setDeleting(false)
    }
  }

  return (
    <DeveloperLayout>
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-white">Workflows</h1>
            <p className="text-xs md:text-sm text-neutral-400 mt-1">
              Build event-driven notification pipelines with a visual editor
            </p>
          </div>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="flex items-center gap-2 px-4 py-2 bg-[#00ef8b] text-black font-medium text-sm rounded-lg hover:bg-[#00ef8b]/90 transition-colors disabled:opacity-50"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            New Workflow
          </button>
        </div>

        <div className="bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-neutral-500" />
            </div>
          ) : workflows.length === 0 ? (
            <div className="text-center py-16 text-neutral-500">
              <GitBranch className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No workflows yet.</p>
              <p className="text-xs text-neutral-600 mt-1">Create one to get started with visual event pipelines.</p>
            </div>
          ) : (
            <div className="divide-y divide-neutral-800">
              {workflows.map((wf, i) => {
                const nodeCount = (wf.canvas_json as { nodes?: unknown[] })?.nodes?.length ?? 0
                return (
                  <motion.div
                    key={wf.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <Link
                      to="/developer/subscriptions/$id"
                      params={{ id: wf.id }}
                      className="flex items-center gap-4 px-4 py-4 hover:bg-neutral-800/30 transition-colors group"
                    >
                      <div className="w-9 h-9 rounded-lg bg-neutral-800 flex items-center justify-center shrink-0">
                        <GitBranch className="w-4 h-4 text-[#00ef8b]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{wf.name}</p>
                        <p className="text-xs text-neutral-500 mt-0.5">
                          {nodeCount} node{nodeCount !== 1 ? 's' : ''} &middot; {new Date(wf.updated_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {wf.is_active ? (
                          <span className="flex items-center gap-1 text-xs text-emerald-400">
                            <CheckCircle className="w-3.5 h-3.5" /> Active
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-neutral-500">
                            <Circle className="w-3.5 h-3.5" /> Draft
                          </span>
                        )}
                        <button
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setDeleteTarget(wf)
                          }}
                          className="p-1.5 rounded-md text-neutral-600 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </Link>
                  </motion.div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Delete modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setDeleteTarget(null) }}
        >
          <div className="bg-neutral-900 border border-neutral-800 rounded-xl w-full max-w-sm mx-4 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white">Delete Workflow</h2>
            <p className="text-sm text-neutral-400">
              Delete &ldquo;<span className="text-white">{deleteTarget.name}</span>&rdquo;? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2 bg-neutral-800 text-neutral-300 text-sm font-medium rounded-lg hover:bg-neutral-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 py-2 bg-red-500/20 text-red-400 text-sm font-medium rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </DeveloperLayout>
  )
}
```

**Step 2: Verify**

Run: `cd frontend && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add frontend/app/routes/developer/subscriptions.tsx
git commit -m "feat(workflows): replace subscriptions list with workflow list page"
```

---

## Task 12: Frontend — Workflow Editor Route (Canvas Page)

**Files:**
- Create: `frontend/app/routes/developer/subscriptions.$id.tsx`

**Step 1: Create the editor route**

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { Node, Edge } from 'reactflow'
import DeveloperLayout from '../../components/developer/DeveloperLayout'
import WorkflowCanvas from '../../components/developer/workflow/WorkflowCanvas'
import { getWorkflow } from '../../lib/webhookApi'

export const Route = createFileRoute('/developer/subscriptions/$id')({
  component: WorkflowEditorPage,
})

function WorkflowEditorPage() {
  const { id } = Route.useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workflowName, setWorkflowName] = useState('Untitled Workflow')
  const [initialNodes, setInitialNodes] = useState<Node[]>([])
  const [initialEdges, setInitialEdges] = useState<Edge[]>([])

  useEffect(() => {
    async function load() {
      try {
        const wf = await getWorkflow(id)
        setWorkflowName(wf.name)
        const canvas = wf.canvas_json as { nodes?: Node[]; edges?: Edge[] }
        setInitialNodes(canvas?.nodes ?? [])
        setInitialEdges(canvas?.edges ?? [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load workflow')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  if (loading) {
    return (
      <DeveloperLayout>
        <div className="flex items-center justify-center flex-1 py-20">
          <Loader2 className="w-5 h-5 animate-spin text-neutral-500" />
        </div>
      </DeveloperLayout>
    )
  }

  if (error) {
    return (
      <DeveloperLayout>
        <div className="flex items-center justify-center flex-1 py-20 text-red-400 text-sm">
          {error}
        </div>
      </DeveloperLayout>
    )
  }

  return (
    <DeveloperLayout>
      <WorkflowCanvas
        workflowId={id}
        initialName={workflowName}
        initialNodes={initialNodes}
        initialEdges={initialEdges}
      />
    </DeveloperLayout>
  )
}
```

**Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit`

**Step 3: Verify dev server**

Run: `cd frontend && npm run dev` and navigate to `/developer/subscriptions`

**Step 4: Commit**

```bash
git add frontend/app/routes/developer/subscriptions.\$id.tsx
git commit -m "feat(workflows): add workflow canvas editor route"
```

---

## Task 13: Frontend — Update DeveloperLayout Nav

**Files:**
- Modify: `frontend/app/components/developer/DeveloperLayout.tsx`

**Step 1: Update the nav label from "Subscriptions" to "Workflows"**

Change the nav item at line 27:
```typescript
// Before:
{ label: 'Subscriptions', path: '/developer/subscriptions', icon: Bell },
// After:
{ label: 'Workflows', path: '/developer/subscriptions', icon: GitBranch },
```

Add `GitBranch` to the lucide-react import at top.

**Step 2: Verify build**

Run: `cd frontend && npm run build`

**Step 3: Commit**

```bash
git add frontend/app/components/developer/DeveloperLayout.tsx
git commit -m "feat(workflows): rename nav item from Subscriptions to Workflows"
```

---

## Task 14: Build, Deploy & Verify

**Step 1: Build backend**

```bash
cd backend && go build -o indexer main.go
```

**Step 2: Build frontend**

```bash
cd frontend && npm run build
```

**Step 3: Run DB migration** (on production)

```bash
docker exec -e PGPASSWORD=supabase-secret-prod-2026 supabase-postgres \
  psql -U supabase_admin -d supabase -c "
    CREATE TABLE IF NOT EXISTS public.workflows (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES auth.users(id),
      name TEXT NOT NULL DEFAULT 'Untitled Workflow',
      canvas_json JSONB NOT NULL DEFAULT '{}',
      is_active BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_workflows_user_id ON public.workflows(user_id);
  "
```

**Step 4: Deploy backend and frontend** (follow existing GCP deployment pattern)

**Step 5: Test**
1. Navigate to `/developer/subscriptions` — should show empty workflow list
2. Click "New Workflow" — should create and redirect to canvas editor
3. Drag trigger node (FT Transfer) from palette onto canvas
4. Drag destination node (Slack) onto canvas
5. Connect trigger output to destination input
6. Click trigger node — config panel slides in, enter token filter
7. Click "Save" — persists to backend
8. Click "Deploy" — compiles and creates subscription(s)
9. Navigate back to list — workflow shows as "Active"

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat(workflows): complete n8n-style workflow canvas editor"
```

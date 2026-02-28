# Workflow Canvas Editor — Design Document

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create the implementation plan.

**Goal:** Replace the form-based subscriptions page with a visual n8n-style workflow canvas using ReactFlow, where users build event-driven notification pipelines by connecting trigger, condition, and destination nodes.

**Architecture:** Visual-only approach — the canvas is a rich editor that compiles DAGs down to the existing subscription/endpoint API. A new `workflows` table stores the canvas JSON for persistence across devices. ReactFlow `^11.11.4` (already installed) powers the canvas.

**Tech Stack:** ReactFlow, React 19, TailwindCSS, Framer Motion, Lucide icons, existing webhook API

---

## 1. Node Types

### 1.1 Trigger Nodes (green accent `#00ef8b`)

Start of every workflow path. One output handle (right side).

| Node | Event Type | Config Fields |
|------|-----------|---------------|
| FT Transfer | `ft.transfer` | token (preset dropdown: FLOW, USDC, USDT, stFLOW…), addresses[], direction (in/out/both), min_amount |
| NFT Transfer | `nft.transfer` | collection (preset: NBA Top Shot, NFL All Day…), addresses[], direction |
| Account Event | `account.*` | addresses[], subtypes[] (created, key.added, key.removed, contract.added/updated/removed) |
| TX Sealed | `transaction.sealed` | addresses[], roles[] (PROPOSER, PAYER, AUTHORIZER) |
| Block Sealed | `block.sealed` | _(no config — fires every block)_ |
| EVM Transaction | `evm.transaction` | from, to, min_value |
| Contract Event | `contract.event` | contract_address, event_name |
| Balance Change | `ft.large_transfer` | addresses[], token, threshold, direction (above/below) |
| Schedule | `schedule` | cron expression, timezone |

### 1.2 Condition Nodes (amber accent `#f59e0b`)

Middle nodes with one input (left) and two outputs (right: true/false for IF, or single pass-through for Filter).

| Node | Config Fields | Outputs |
|------|---------------|---------|
| IF | field (dropdown based on parent trigger), operator (==, !=, >, <, >=, <=, contains, starts_with), value | 2: ✓ true, ✗ false |
| Filter | field, operator, value | 1: matching items only |

### 1.3 Destination Nodes (blue accent `#3b82f6`)

End of workflow path. One input handle (left side), no outputs.

| Node | Config Fields |
|------|---------------|
| Webhook | URL, HTTP method, custom headers |
| Slack | webhook URL _or_ channel name (if OAuth) |
| Discord | webhook URL |
| Telegram | bot token, chat ID |
| Email | to address, subject template |

---

## 2. Canvas UI Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ ┌─────────┐  "My Alert Pipeline" ✏️          [Save] [Deploy 🚀] │
│ │ + Add   │                                                      │
│ │         │                                                      │
│ │ TRIGGERS│  ┌──────────────┐    ┌──────────┐    ┌───────────┐  │
│ │ ⚡FT    │  │ ⚡ FT        │───▶│ IF       │──▶│ 💬 Slack  │  │
│ │ ⚡NFT   │  │ Transfer     │    │ amt>1000 │    │ #alerts   │  │
│ │ ⚡Acct  │  └──────────────┘    │          │──▶┌───────────┐  │
│ │ ...     │                      └──────────┘   │ 🔔 Discord│  │
│ │         │                                      └───────────┘  │
│ │CONDITION│                                                      │
│ │ ⚙️IF    │  ┌──────────────┐    ┌───────────┐                  │
│ │ ⚙️Filter│  │ 📅 Schedule  │───▶│ 🌐 Webhook│                  │
│ │         │  │ Every hour   │    │ POST /api │                  │
│ │DESTINATN│  └──────────────┘    └───────────┘                  │
│ │ 🌐Web   │                                                      │
│ │ 💬Slack │                                            ┌──────┐ │
│ │ 🔔Discord│                                           │minimap│ │
│ │ ✈️Tele  │                                            └──────┘ │
│ │ ✉️Email │                                                      │
│ └─────────┘                                                      │
└──────────────────────────────────────────────────────────────────┘
```

### Components

- **Left Panel** — Node palette, grouped by category. Drag or click to add to canvas.
- **Canvas** — ReactFlow with grid background, snap-to-grid, pan/zoom. Dark theme matching site.
- **Right Panel** (slide-out) — Opens on node click. Shows config form for selected node. Context-aware fields based on node type.
- **Top Bar** — Workflow name (inline editable), Save button, Deploy button.
- **Bottom-right** — ReactFlow MiniMap + zoom controls.

### Interactions

- **Add node:** Drag from palette or click (places at center)
- **Connect:** Drag from output handle to input handle
- **Configure:** Click node → right panel slides open
- **Delete:** Select node/edge → Delete key or context menu
- **Save:** Persists canvas JSON to backend (auto-save debounced + manual button)
- **Deploy:** Compiles DAG → creates/updates subscriptions+endpoints via existing API

---

## 3. Custom Node Component Design

Each node rendered as a card:

```
┌─────────────────────────────┐
│ ⚡ FT Transfer              │  ← icon + type label
│─────────────────────────────│
│ Token: FLOW                 │  ← config preview (1-2 lines)
│ Min: 1,000                  │
│─────────────────────────────│
│ ● enabled                   │  ← status dot
└──────────────●──────────────┘
               ↑ output handle
```

- Card size: ~200×100px
- Dark bg (`bg-neutral-800`) with colored left border (category color)
- Handles styled as colored dots matching category
- Selected state: ring glow in category color

---

## 4. Backend: Workflows Table

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

CREATE INDEX idx_workflows_user_id ON public.workflows(user_id);
```

`canvas_json` schema:
```json
{
  "nodes": [
    {
      "id": "node_1",
      "type": "trigger_ft_transfer",
      "position": { "x": 100, "y": 200 },
      "data": {
        "config": {
          "token_contract": "A.1654653399040a61.FlowToken",
          "min_amount": 1000,
          "addresses": ["0x1234"],
          "direction": "in"
        }
      }
    }
  ],
  "edges": [
    {
      "id": "edge_1",
      "source": "node_1",
      "sourceHandle": "output",
      "target": "node_2",
      "targetHandle": "input"
    }
  ]
}
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/workflows` | List user workflows |
| POST | `/api/v1/workflows` | Create new workflow |
| GET | `/api/v1/workflows/{id}` | Get workflow by ID |
| PATCH | `/api/v1/workflows/{id}` | Update workflow (save canvas) |
| DELETE | `/api/v1/workflows/{id}` | Delete workflow |
| POST | `/api/v1/workflows/{id}/deploy` | Compile & deploy subscriptions |

---

## 5. Compile / Deploy Logic

When user clicks **Deploy**:

1. **Validate DAG** — every path must start with a trigger and end with a destination. No orphan nodes.
2. **Walk paths** — BFS/DFS from each trigger node, collecting condition configs along each path to a destination.
3. **Merge conditions** — IF/Filter nodes along a path get merged into the subscription's `conditions` JSON.
4. **Create/update endpoints** — for each unique destination node, ensure an endpoint exists (match by type+config or create new).
5. **Create subscriptions** — for each trigger→destination path, create a subscription with the trigger's `event_type`, merged conditions, and the destination endpoint ID.
6. **Cleanup** — remove subscriptions from previous deploy of this workflow that are no longer in the DAG.
7. **Report** — show success/failure per path in a deploy summary modal.

Example compile:
```
[FT Transfer (FLOW, >1000)] → [IF amount>5000] → true → [Slack #whale-alerts]
                                                → false → [Discord #transfers]
```
Produces:
- Subscription 1: `ft.transfer`, conditions: `{token: "FLOW", min_amount: 5000}`, endpoint: slack
- Subscription 2: `ft.transfer`, conditions: `{token: "FLOW", min_amount: 1000, max_amount: 4999}`, endpoint: discord

---

## 6. Subscriptions Page Restructure

The `/developer/subscriptions` route becomes a **workflow list + editor**:

- **List view** (default): Cards showing each workflow — name, node count, active/inactive, last deployed
- **Editor view** (`/developer/subscriptions/{id}`): Full-screen ReactFlow canvas
- **Create** button → creates new workflow → opens editor
- Navigation between list ↔ editor via breadcrumbs

The old form-based subscription management is fully replaced.

---

## 7. File Structure

```
app/
  routes/developer/
    subscriptions.tsx         → workflow list page
    subscriptions.$id.tsx     → workflow canvas editor
  components/developer/workflow/
    WorkflowCanvas.tsx        → ReactFlow provider + canvas
    NodePalette.tsx           → left sidebar with draggable nodes
    NodeConfigPanel.tsx       → right slide-out config form
    WorkflowTopBar.tsx        → name, save, deploy buttons
    nodes/
      TriggerNode.tsx         → custom ReactFlow node for triggers
      ConditionNode.tsx       → custom ReactFlow node for conditions
      DestinationNode.tsx     → custom ReactFlow node for destinations
    configs/
      TriggerConfigs.tsx      → config forms for each trigger type
      ConditionConfigs.tsx    → config forms for IF/Filter
      DestinationConfigs.tsx  → config forms for each destination
    compiler.ts               → DAG → subscription/endpoint compiler
    nodeTypes.ts              → node type registry + metadata
    constants.ts              → presets, colors, handle positions
  lib/
    webhookApi.ts             → add workflow CRUD functions
```

---

## 8. Non-Goals (V1)

- No real-time preview / test execution
- No version history for workflows
- No collaborative editing
- No template marketplace
- No server-side workflow engine (conditions evaluated by compile step, not at runtime)
- Schedule trigger is UI-only placeholder (backend cron not implemented in V1)

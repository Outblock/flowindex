# Cadence Runner Design

## Overview

Add Cadence script/transaction execution capability to FlowIndex in two phases:
- **V1**: "Run Script" button in Common Scripts tab (in-place, lightweight)
- **V2**: Standalone Cadence Runner playground (separate project, iframe-embedded)

## Architecture Decision

**Frontend direct-connect via FCL** (Option A). Scripts and transactions execute via FCL directly against Flow Access Nodes. No backend proxy needed for execution. Only cadence-mcp static checking goes through backend.

## V1 — Common Scripts Run Button

### Scope
Add a "Run Script" button to the existing Common Scripts tab on the contract detail page.

### User Flow
1. User selects a script in the Common Scripts sidebar
2. Code panel shows script with **Run** button in header
3. If script has parameters → parameter input form appears below code
4. Click Run → FCL `fcl.query()` executes against Flow mainnet
5. Result displays as formatted JSON below parameters

### Parameter Parsing
Extract parameters from Cadence `fun main(...)` signature via regex:
```
fun\s+main\s*\(([^)]*)\)
```
Type mapping to input controls:
- `Address` → text input (0x prefix hint)
- `String` → text input
- `UInt64/Int/UFix64` → number input
- `Bool` → toggle switch
- Complex types → raw JSON input

### UI Layout
```
┌─────────────────────────────────┐
│ Script Name          [▶ Run]   │
├─────────────────────────────────┤
│ Cadence Code (read-only)        │
│ (SyntaxHighlighter)             │
├─────────────────────────────────┤
│ Parameters (if any):            │
│  addr: Address  [0x________]   │
│  amount: UFix64 [__________]   │
├─────────────────────────────────┤
│ Result:                         │
│  { "balance": "1234.5678" }    │
│                           [📋] │
└─────────────────────────────────┘
```

### Technical Details
- Uses existing `@onflow/fcl` (already configured in `fclConfig.ts`)
- `fcl.query({ cadence: code, args: (arg, t) => [...] })` for execution
- No new dependencies needed
- No wallet connection needed (scripts are read-only)
- No backend changes needed

### Files Modified
- `frontend/app/routes/contracts/$id.tsx` — add Run button, parameter form, result panel

## V2 — Cadence Runner (Standalone Project)

### Project Structure
- **Separate frontend project**: `runner/` directory in repo (or separate repo)
- **Deployed to**: `runner.flowindex.io`
- **Embedded in main site**: `/developer/runner` route renders iframe pointing to runner
- **Tech stack**: Vite + React + TailwindCSS + Monaco Editor + FCL

### Page Layout
```
┌──────────────────────────────────────────────────────────┐
│  [Mainnet ▾]  [Connect Wallet]     [▶ Run] [📤 Deploy]  │
├────────────────────┬─────────────────────────────────────┤
│                    │                                     │
│   AI Chat Panel    │   Monaco Editor                     │
│   (collapsible)    │   (Cadence syntax highlighting)     │
│                    │   (Real-time error markers from     │
│   "Ask AI" input   │    cadence-mcp static checking)     │
│                    │                                     │
│   AI responses     │                                     │
│   with [Insert]    │                                     │
│   buttons          │                                     │
│                    ├─────────────────────────────────────┤
│                    │   [Params] [Result] [Events] [Logs] │
│                    │   Tabbed result panel                │
│                    │                                     │
└────────────────────┴─────────────────────────────────────┘
```

### Core Features

**1. Monaco Editor + Cadence Language Support**
- Register custom Cadence language (syntax rules based on Swift/Rust patterns)
- Keywords: `access`, `fun`, `resource`, `struct`, `transaction`, `prepare`, `execute`, `import`, `from`, `let`, `var`, `if`, `else`, `while`, `for`, `in`, `return`, `self`, `create`, `destroy`, `emit`
- Real-time static checking:
  - User types → debounce 500ms → POST `/api/cadence/check` → cadence-mcp `cadence_check` → diagnostics → Monaco error markers (red squiggly lines)

**2. Execution Engine**
- **Auto-detect code type** by scanning for `transaction {` keyword:
  - Script → `fcl.query()`, no wallet needed
  - Transaction → `fcl.mutate()`, requires wallet connection
- Run button text adapts: "Run Script" vs "Send Transaction"
- Script results: JSON-formatted return value
- Transaction results: tx hash (clickable link to `/tx/{hash}`), status, events

**3. Wallet Connection**
- FCL Discovery integration (Blocto, Lilico, Flow Wallet)
- Connection state displayed in top bar
- Network switching (Mainnet/Testnet) resets FCL config
- Attempting transaction without wallet shows "Connect wallet first" prompt

**4. AI Chat Panel**
- Reuse `AIChatWidget` component in embedded/inline mode (not floating)
- Collapsed by default (AI icon toggle on left)
- AI-generated Cadence code blocks get "Insert to Editor" button
- Chat context automatically includes current editor content

**5. Parameter Panel**
- Auto-parses `fun main(...)` for scripts
- Type-aware input fields (same mapping as V1)
- Transaction `prepare(acct: &Account)` handled automatically by FCL

**6. Result Panel (3 tabs)**
- **Result**: Script return value or tx hash + status
- **Events**: Transaction events list
- **Logs**: Execution logs, error messages

### Backend Changes (Minimal)
One new endpoint:
```
POST /api/cadence/check
Body: { "code": "...", "network": "mainnet" }
Response: { "diagnostics": [{ "message": "...", "startLine": 1, ... }] }
```
Proxies to cadence-mcp `cadence_check` tool.

### Cross-Project Integration
- Common Scripts tab gets "Open in Runner" button per script
- Navigates to `runner.flowindex.io?code=<base64>&contract=A.xxx.Name`
- Runner decodes URL params and populates editor

### Dependencies (runner project)
- `@monaco-editor/react` — Monaco Editor React wrapper
- `@onflow/fcl` — Flow Client Library
- `react`, `react-dom` — UI framework
- `tailwindcss` — Styling
- `@ai-sdk/react` — AI chat integration
- `axios` — API calls to backend

## Implementation Order

1. **V1**: Common Scripts Run button (1-2 days)
2. **V2 Phase 1**: Standalone runner project scaffold + Monaco + script execution (3-4 days)
3. **V2 Phase 2**: Wallet connection + transaction execution (2-3 days)
4. **V2 Phase 3**: AI Chat panel integration (2-3 days)
5. **V2 Phase 4**: cadence-mcp static checking + iframe embed in main site (1-2 days)

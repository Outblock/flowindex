# AI Workflow Builder — Design

## Goal
Add an AI chat bar to the workflow canvas that generates nodes + edges from natural language descriptions.

## Architecture
- Text input bar below the top bar in WorkflowCanvas
- Calls existing Anthropic AI backend (`ai.flowindex.io/api/chat`) with a specialized system prompt
- System prompt instructs the AI to output structured JSON `{ nodes: [...], edges: [...] }` matching our ReactFlow schema
- Smart merge: empty canvas → fresh generation; existing nodes → append and connect

## AI System Prompt
The prompt includes:
- All 16 node types with their config fields (from nodeTypes.ts)
- The ReactFlow node/edge data structure
- Instructions to output valid JSON that can be directly parsed
- Examples of common workflows

## UI
- Input bar: text input + "Build" button, sits between top bar and canvas
- Loading state: animated shimmer while AI generates
- Error state: inline error message if generation fails
- After generation: nodes appear on canvas with auto-layout

## Data Flow
1. User types description → clicks Build
2. Frontend sends to AI backend with workflow system prompt
3. AI returns JSON with nodes array and edges array
4. Frontend parses JSON, assigns positions (auto-layout), merges with existing canvas
5. User can manually adjust, then Save/Deploy as normal

## Node Position Auto-Layout
- Triggers start at x=100
- Each subsequent layer shifts x+250
- Nodes in the same layer spread vertically by y+120
- Simple left-to-right topological layout

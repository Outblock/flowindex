BEGIN;

-- Stable IDs for seeded workspace, workflows, tools, and skills.
-- Keep these constants so deploys are idempotent.

-- Ensure deterministic seed owner exists (required by FK on permissions/workspace/mcp/workflow).
INSERT INTO public."user" (
  id, name, email, email_verified, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'FlowIndex Seed Owner',
  'simstudio-owner-00000000-0000-0000-0000-000000000000',
  true,
  now(),
  now()
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  email_verified = EXCLUDED.email_verified,
  updated_at = now();

-- Ensure owner has admin permission on seeded workspace.
DELETE FROM public.permissions
WHERE user_id = '00000000-0000-0000-0000-000000000000'
  AND entity_type = 'workspace'
  AND entity_id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

INSERT INTO public.permissions (
  id, user_id, entity_type, entity_id, permission_type, created_at, updated_at
) VALUES (
  'da4a8c5e-0dfd-41f6-8e39-0f66e5e2d602',
  '00000000-0000-0000-0000-000000000000',
  'workspace',
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  'admin',
  '2026-03-02 07:32:13.869',
  '2026-03-02 07:32:13.869'
);

DELETE FROM public.workflow_mcp_tool
WHERE workflow_id IN (
  'c8bb0215-cf73-4919-a452-e5a11728fb59',
  'e0a4f27e-45d4-4c21-b67b-0eb2e2e36f31',
  '0f8d8936-d6fc-4f4e-a255-17de26e8f53d',
  '88d2c28d-86ab-4b67-9f89-07c39fead9d6'
)
OR server_id IN ('mcp-70866f58', 'mcp-911eec0e');

DELETE FROM public.workflow_mcp_server
WHERE workspace_id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

DELETE FROM public.workflow_edges
WHERE workflow_id IN (
  'c8bb0215-cf73-4919-a452-e5a11728fb59',
  'e0a4f27e-45d4-4c21-b67b-0eb2e2e36f31',
  '0f8d8936-d6fc-4f4e-a255-17de26e8f53d',
  '88d2c28d-86ab-4b67-9f89-07c39fead9d6'
);

DELETE FROM public.workflow_blocks
WHERE workflow_id IN (
  'c8bb0215-cf73-4919-a452-e5a11728fb59',
  'e0a4f27e-45d4-4c21-b67b-0eb2e2e36f31',
  '0f8d8936-d6fc-4f4e-a255-17de26e8f53d',
  '88d2c28d-86ab-4b67-9f89-07c39fead9d6'
);

DELETE FROM public.workflow
WHERE id IN (
  'c8bb0215-cf73-4919-a452-e5a11728fb59',
  'e0a4f27e-45d4-4c21-b67b-0eb2e2e36f31',
  '0f8d8936-d6fc-4f4e-a255-17de26e8f53d',
  '88d2c28d-86ab-4b67-9f89-07c39fead9d6'
);

DELETE FROM public.mcp_servers
WHERE id IN ('mcp-70866f58', 'mcp-911eec0e');

DELETE FROM public.custom_tools
WHERE id IN (
  'ct-flow-onchain-events',
  'ct-cadence-onchain-events',
  'ct-cadence-account-events',
  'ct-cadence-events-by-block-range',
  'ct-cadence-tx-events'
);

DELETE FROM public.skill
WHERE id IN (
  'sk-cadence-mcp-operator',
  'sk-cadence-trigger-playbook',
  'sk-cadence-event-investigation'
);

DELETE FROM public.workspace_environment
WHERE workspace_id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

DELETE FROM public.workspace
WHERE id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

INSERT INTO public.workspace (
  id, name, owner_id, created_at, updated_at, billed_account_user_id, allow_personal_api_keys
) VALUES (
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  'Default Workspace',
  '00000000-0000-0000-0000-000000000000',
  '2026-03-02 07:32:13.759128',
  '2026-03-02 07:32:13.759128',
  '00000000-0000-0000-0000-000000000000',
  true
);

INSERT INTO public.mcp_servers (
  id, workspace_id, created_by, name, description, transport, url, headers, timeout, retries,
  enabled, last_connected, connection_status, last_error, tool_count, last_tools_refresh,
  total_requests, last_used, deleted_at, created_at, updated_at, status_config
) VALUES (
  'mcp-70866f58',
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  '00000000-0000-0000-0000-000000000000',
  'Flow EVM MCP',
  'Flow EVM tools for contracts, events, and transactions',
  'streamable-http',
  'https://flow-evm-mcp.up.railway.app/mcp',
  '{}',
  30000,
  3,
  true,
  '2026-03-03 00:39:20.679',
  'connected',
  NULL,
  25,
  '2026-03-03 00:39:20.679',
  0,
  NULL,
  NULL,
  '2026-03-02 08:04:55.671942',
  '2026-03-03 00:39:20.679',
  '{"consecutiveFailures": 0, "lastSuccessfulDiscovery": "2026-03-03T00:39:20.679Z"}'
), (
  'mcp-911eec0e',
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  '00000000-0000-0000-0000-000000000000',
  'Cadence MCP',
  'Cadence tools for contracts, docs, and static analysis',
  'streamable-http',
  'https://cadence-mcp.up.railway.app/mcp',
  '{}',
  30000,
  3,
  true,
  '2026-03-03 00:39:20.682',
  'connected',
  NULL,
  10,
  '2026-03-03 00:39:20.682',
  0,
  NULL,
  NULL,
  '2026-03-02 08:04:55.671942',
  '2026-03-03 00:39:20.682',
  '{"consecutiveFailures": 0, "lastSuccessfulDiscovery": "2026-03-03T00:39:20.682Z"}'
);

INSERT INTO public.workflow (
  id, user_id, name, description, last_synced, created_at, updated_at, is_deployed, deployed_at,
  color, run_count, last_run_at, variables, workspace_id, folder_id, sort_order, is_public_api
) VALUES (
  'c8bb0215-cf73-4919-a452-e5a11728fb59',
  '00000000-0000-0000-0000-000000000000',
  'sharp-vega',
  'Flow and Cadence starter workflow',
  '2026-03-02 11:36:40.231',
  '2026-03-02 11:36:29.562',
  '2026-03-02 11:36:40.231',
  false,
  NULL,
  '#2ed96a',
  0,
  NULL,
  '{}',
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  NULL,
  0,
  false
), (
  'e0a4f27e-45d4-4c21-b67b-0eb2e2e36f31',
  '00000000-0000-0000-0000-000000000000',
  'cadence-schedule-trigger',
  'Cadence event polling starter (schedule-friendly)',
  now(),
  now(),
  now(),
  false,
  NULL,
  '#2563eb',
  0,
  NULL,
  '{}',
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  NULL,
  1,
  false
), (
  '0f8d8936-d6fc-4f4e-a255-17de26e8f53d',
  '00000000-0000-0000-0000-000000000000',
  'cadence-webhook-trigger',
  'Cadence webhook ingestion starter',
  now(),
  now(),
  now(),
  false,
  NULL,
  '#0ea5e9',
  0,
  NULL,
  '{}',
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  NULL,
  2,
  false
), (
  '88d2c28d-86ab-4b67-9f89-07c39fead9d6',
  '00000000-0000-0000-0000-000000000000',
  'cadence-api-trigger',
  'Cadence API starter for contract event lookups',
  now(),
  now(),
  now(),
  false,
  NULL,
  '#7c3aed',
  0,
  NULL,
  '{}',
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  NULL,
  3,
  false
);

INSERT INTO public.workflow_blocks (
  id, workflow_id, type, name, position_x, position_y, enabled, horizontal_handles, is_wide, height,
  sub_blocks, outputs, data, created_at, updated_at, advanced_mode, trigger_mode, locked
) VALUES (
  '17c4981e-c266-4f6d-9f0b-8c03f3a35908',
  'c8bb0215-cf73-4919-a452-e5a11728fb59',
  'start_trigger',
  'Start',
  0,
  0,
  true,
  true,
  false,
  0,
  '{"inputFormat": {"id": "inputFormat", "type": "input-format", "value": [{"id": "c2236fa9-bbee-4f92-96c3-c2cc478a496d", "name": "", "type": "string", "value": "", "collapsed": false}]}}',
  '{"files": {"type": "file[]", "description": "User uploaded files"}, "input": {"type": "string", "description": "Primary user input or message"}, "conversationId": {"type": "string", "description": "Conversation thread identifier"}}',
  '{}',
  '2026-03-02 11:36:40.175438',
  '2026-03-02 11:36:40.175438',
  false,
  false,
  false
), (
  'd21d3d1f-0b3d-4bf8-87a9-1e57cccb2a7f',
  'e0a4f27e-45d4-4c21-b67b-0eb2e2e36f31',
  'start_trigger',
  'Cadence Poll Start',
  0,
  0,
  true,
  true,
  false,
  0,
  '{"inputFormat": {"id": "inputFormat", "type": "input-format", "value": [{"id": "c0a2f8d1-6d7e-4a70-aedf-5adf7c87c8c1", "name": "event_type", "type": "string", "value": "A.0ae53cb6e3f42a79.FlowToken.TokensDeposited", "collapsed": false}, {"id": "dc9e1b7b-3e53-4b79-b879-5a65abf5df13", "name": "from_block_height", "type": "number", "value": "", "collapsed": false}, {"id": "e6a8a408-7e54-41d4-a3e9-1a84b631d9d2", "name": "to_block_height", "type": "number", "value": "", "collapsed": false}, {"id": "9b0bc9be-eaa8-43c8-a18b-1a0d01d98f6c", "name": "limit", "type": "number", "value": "100", "collapsed": false}]}}',
  '{"files": {"type": "file[]", "description": "User uploaded files"}, "input": {"type": "string", "description": "Primary user input or message"}, "conversationId": {"type": "string", "description": "Conversation thread identifier"}}',
  '{}',
  now(),
  now(),
  false,
  false,
  false
), (
  '71c5f6de-f57a-489e-ab57-12df888f58be',
  '0f8d8936-d6fc-4f4e-a255-17de26e8f53d',
  'start_trigger',
  'Cadence Webhook Start',
  0,
  0,
  true,
  true,
  false,
  0,
  '{"inputFormat": {"id": "inputFormat", "type": "input-format", "value": [{"id": "2e7f5f11-e083-4fb3-b85d-5df448428ca8", "name": "event_type", "type": "string", "value": "", "collapsed": false}, {"id": "0e70e9fb-58b9-44e8-aa58-a017baf4ea62", "name": "payload", "type": "string", "value": "", "collapsed": false}, {"id": "3fc4df54-adf5-43d7-98ea-342adf95e01e", "name": "source", "type": "string", "value": "webhook", "collapsed": false}]}}',
  '{"files": {"type": "file[]", "description": "User uploaded files"}, "input": {"type": "string", "description": "Primary user input or message"}, "conversationId": {"type": "string", "description": "Conversation thread identifier"}}',
  '{}',
  now(),
  now(),
  false,
  false,
  false
), (
  '8a6b4f0f-1ad6-4e77-908a-80f7b9f8be3a',
  '88d2c28d-86ab-4b67-9f89-07c39fead9d6',
  'start_trigger',
  'Cadence API Start',
  0,
  0,
  true,
  true,
  false,
  0,
  '{"inputFormat": {"id": "inputFormat", "type": "input-format", "value": [{"id": "d8a9320e-7c8f-4f52-9f53-b8d413fc6bea", "name": "address", "type": "string", "value": "0x1", "collapsed": false}, {"id": "6ee9093d-42f4-4cc8-88d3-c6ca66f2f6b6", "name": "contract_name", "type": "string", "value": "FlowToken", "collapsed": false}, {"id": "7c83ef4a-cc34-4a16-b8df-e3122f9f8f64", "name": "event_name", "type": "string", "value": "TokensDeposited", "collapsed": false}, {"id": "eb0cf236-3b42-4036-81aa-35d9ea335111", "name": "limit", "type": "number", "value": "50", "collapsed": false}]}}',
  '{"files": {"type": "file[]", "description": "User uploaded files"}, "input": {"type": "string", "description": "Primary user input or message"}, "conversationId": {"type": "string", "description": "Conversation thread identifier"}}',
  '{}',
  now(),
  now(),
  false,
  false,
  false
);

-- Versioned custom tools that act as packaged Flow/Cadence event nodes.
INSERT INTO public.custom_tools (
  id, user_id, title, schema, code, created_at, updated_at, workspace_id
) VALUES (
  'ct-flow-onchain-events',
  '00000000-0000-0000-0000-000000000000',
  'Flow Onchain Events',
  '{"type":"object","properties":{"event_type":{"type":"string","description":"Event type to query"},"limit":{"type":"integer","minimum":1,"maximum":200,"default":25}},"required":["event_type"]}',
  $$export default async function run(input) {
  const eventType = input?.event_type;
  const limit = Number(input?.limit ?? 25);
  if (!eventType) throw new Error("event_type is required");
  const url = `https://flowindex.io/api/v1/events?type=${encodeURIComponent(eventType)}&limit=${Math.min(Math.max(limit, 1), 200)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Flow event query failed: ${res.status}`);
  return await res.json();
}$$,
  now(),
  now(),
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
), (
  'ct-cadence-onchain-events',
  '00000000-0000-0000-0000-000000000000',
  'Cadence Contract Events',
  '{"type":"object","properties":{"address":{"type":"string","description":"Contract address, e.g. 0x1"},"contract_name":{"type":"string","description":"Contract name"},"event_name":{"type":"string","description":"Event name"},"limit":{"type":"integer","minimum":1,"maximum":200,"default":25}},"required":["address","contract_name","event_name"]}',
  $$export default async function run(input) {
  const address = input?.address;
  const contractName = input?.contract_name;
  const eventName = input?.event_name;
  const limit = Number(input?.limit ?? 25);
  if (!address || !contractName || !eventName) {
    throw new Error("address, contract_name, and event_name are required");
  }
  const query = `${address}.${contractName}.${eventName}`;
  const url = `https://flowindex.io/api/v1/events?type=${encodeURIComponent(query)}&limit=${Math.min(Math.max(limit, 1), 200)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Cadence event query failed: ${res.status}`);
  return await res.json();
}$$,
  now(),
  now(),
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
), (
  'ct-cadence-account-events',
  '00000000-0000-0000-0000-000000000000',
  'Cadence Account Events',
  '{"type":"object","properties":{"account":{"type":"string","description":"Flow account address (e.g. 0x1)"},"event_type":{"type":"string","description":"Optional full event type"},"limit":{"type":"integer","minimum":1,"maximum":200,"default":50}},"required":["account"]}',
  $$export default async function run(input) {
  const account = input?.account;
  const eventType = input?.event_type;
  const limit = Number(input?.limit ?? 50);
  if (!account) throw new Error("account is required");
  const q = new URLSearchParams();
  q.set("account", account);
  q.set("limit", String(Math.min(Math.max(limit, 1), 200)));
  if (eventType) q.set("type", eventType);
  const url = `https://flowindex.io/api/v1/events?${q.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Cadence account event query failed: ${res.status}`);
  return await res.json();
}$$,
  now(),
  now(),
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
), (
  'ct-cadence-events-by-block-range',
  '00000000-0000-0000-0000-000000000000',
  'Cadence Events By Block Range',
  '{"type":"object","properties":{"event_type":{"type":"string","description":"Full event type"},"from_block_height":{"type":"integer","description":"Start block height"},"to_block_height":{"type":"integer","description":"End block height"},"limit":{"type":"integer","minimum":1,"maximum":200,"default":100}},"required":["event_type"]}',
  $$export default async function run(input) {
  const eventType = input?.event_type;
  const fromBlock = input?.from_block_height;
  const toBlock = input?.to_block_height;
  const limit = Number(input?.limit ?? 100);
  if (!eventType) throw new Error("event_type is required");
  const q = new URLSearchParams();
  q.set("type", eventType);
  q.set("limit", String(Math.min(Math.max(limit, 1), 200)));
  if (fromBlock !== undefined && fromBlock !== null && fromBlock !== "") q.set("from_block_height", String(fromBlock));
  if (toBlock !== undefined && toBlock !== null && toBlock !== "") q.set("to_block_height", String(toBlock));
  const url = `https://flowindex.io/api/v1/events?${q.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Cadence block range query failed: ${res.status}`);
  return await res.json();
}$$,
  now(),
  now(),
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
), (
  'ct-cadence-tx-events',
  '00000000-0000-0000-0000-000000000000',
  'Cadence Transaction Events',
  '{"type":"object","properties":{"tx_id":{"type":"string","description":"Flow transaction id"},"limit":{"type":"integer","minimum":1,"maximum":200,"default":50}},"required":["tx_id"]}',
  $$export default async function run(input) {
  const txId = input?.tx_id;
  const limit = Number(input?.limit ?? 50);
  if (!txId) throw new Error("tx_id is required");
  const q = new URLSearchParams();
  q.set("tx_id", txId);
  q.set("limit", String(Math.min(Math.max(limit, 1), 200)));
  const url = `https://flowindex.io/api/v1/events?${q.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Cadence tx event query failed: ${res.status}`);
  return await res.json();
}$$,
  now(),
  now(),
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
);

-- Seed Cadence-focused skills for Copilot and team onboarding.
INSERT INTO public.skill (
  id, workspace_id, user_id, name, description, content, created_at, updated_at
) VALUES (
  'sk-cadence-mcp-operator',
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  '00000000-0000-0000-0000-000000000000',
  'Cadence MCP Operator',
  'How to use Cadence MCP + Flow EVM MCP together for contract/event debugging.',
  $$# Cadence MCP Operator

Goal: Debug contracts and events with a repeatable loop.

1. Use Cadence MCP to inspect contract interface and event signatures.
2. Use Flow EVM MCP for tx and execution context.
3. Use `Cadence Contract Events` custom tool to fetch indexed events.
4. Correlate tx_id + block height + event payload.

Output checklist:
- Contract address
- Event signature
- tx_id
- block height range
- decoded payload summary
$$,
  now(),
  now()
), (
  'sk-cadence-trigger-playbook',
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  '00000000-0000-0000-0000-000000000000',
  'Cadence Trigger Playbook',
  'Trigger patterns for schedule/webhook/API based Cadence automations.',
  $$# Cadence Trigger Playbook

## Schedule trigger
- Run every N minutes.
- Use `Cadence Events By Block Range` with stored last height.
- Persist checkpoint after each successful run.

## Webhook trigger
- Accept incoming event payloads from relayers.
- Validate signature/token before processing.
- Normalize payload into standard `{event_type, tx_id, block_height, payload}` schema.

## API trigger
- Expose query workflow for ad-hoc investigations.
- Accept `address`, `contract_name`, `event_name`, `limit`.
- Return compact JSON for dashboards.
$$,
  now(),
  now()
), (
  'sk-cadence-event-investigation',
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  '00000000-0000-0000-0000-000000000000',
  'Cadence Event Investigation',
  'Incident-response workflow for missing or malformed onchain events.',
  $$# Cadence Event Investigation

When an expected event is missing:

1. Verify tx execution status and block inclusion.
2. Query by tx_id using `Cadence Transaction Events`.
3. Query by event signature + block range using `Cadence Events By Block Range`.
4. Check account-scoped events with `Cadence Account Events`.
5. Record root cause: emit failure, index lag, filter mismatch, or decode mismatch.

Template RCA fields:
- incident_id
- expected_event
- observed_event_count
- affected_range
- mitigation
$$,
  now(),
  now()
);

COMMIT;

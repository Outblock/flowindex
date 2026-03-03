BEGIN;

-- Stable IDs for seeded workspace and workflow.
-- Keep these constants so deploys are idempotent.
-- Workspace: Default Workspace
-- Workflow: sharp-vega

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
WHERE workflow_id = 'c8bb0215-cf73-4919-a452-e5a11728fb59'
   OR server_id IN ('mcp-70866f58', 'mcp-911eec0e');

DELETE FROM public.workflow_mcp_server
WHERE workspace_id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

DELETE FROM public.workflow_edges
WHERE workflow_id = 'c8bb0215-cf73-4919-a452-e5a11728fb59';

DELETE FROM public.workflow_blocks
WHERE workflow_id = 'c8bb0215-cf73-4919-a452-e5a11728fb59';

DELETE FROM public.workflow
WHERE id = 'c8bb0215-cf73-4919-a452-e5a11728fb59';

DELETE FROM public.mcp_servers
WHERE id IN ('mcp-70866f58', 'mcp-911eec0e');

DELETE FROM public.custom_tools
WHERE id IN ('ct-flow-onchain-events', 'ct-cadence-onchain-events');

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
);

COMMIT;

import type Anthropic from '@anthropic-ai/sdk'

/**
 * Workflow manipulation tools executed by the sim-workflow frontend.
 *
 * When Claude calls these, we emit `tool_call` SSE events.
 * The sim-workflow orchestrator executes them and calls our `/api/tools/mark-complete`.
 */
export const WORKFLOW_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_blocks_and_tools',
    description: 'List all available block types and integrations that can be used in workflows. Call this first to understand what building blocks are available.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_blocks_metadata',
    description: 'Get detailed metadata for specific block types, including their configuration options and sub-blocks.',
    input_schema: {
      type: 'object' as const,
      properties: {
        blockTypes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of block type IDs to get metadata for',
        },
      },
      required: ['blockTypes'],
    },
  },
  {
    name: 'get_block_options',
    description: 'Get available options for a specific block configuration field (e.g., available models for an LLM block).',
    input_schema: {
      type: 'object' as const,
      properties: {
        blockType: { type: 'string', description: 'Block type ID' },
        fieldId: { type: 'string', description: 'Field/sub-block ID to get options for' },
      },
      required: ['blockType', 'fieldId'],
    },
  },
  {
    name: 'get_trigger_blocks',
    description: 'List available trigger block types (schedule, webhook, API, etc.).',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'edit_workflow',
    description: `Modify the workflow by adding, editing, or deleting blocks on the canvas.

IMPORTANT: Add ALL blocks with their connections in a SINGLE call. Do NOT make multiple edit_workflow calls — block IDs from the workflow state are the source of truth.

Each operation has: operation_type ("add"|"edit"|"delete"), block_id (UUID), params (config object).

For "add": params MUST include "type" and "name". Use "connections" to wire blocks together.
- connections format: {"source": ["target-block-id"]} means this block's output connects TO the target block's input
- For condition blocks: {"true": ["block-if-true"], "false": ["block-if-false"]}

For "edit": params contains fields to update on an existing block.
For "delete": just block_id, no params needed.

CRITICAL: Always call get_workflow_data with data_type "state" FIRST to get existing block IDs before editing.

Example — build a 3-block workflow in ONE call:
{
  "operations": [
    {"operation_type": "add", "block_id": "aaa-111", "params": {"type": "api_call", "name": "Fetch API", "connections": {"source": ["bbb-222"]}}},
    {"operation_type": "add", "block_id": "bbb-222", "params": {"type": "condition", "name": "Check Result", "connections": {"true": ["ccc-333"]}}},
    {"operation_type": "add", "block_id": "ccc-333", "params": {"type": "llm", "name": "Process Data"}}
  ]
}`,
    input_schema: {
      type: 'object' as const,
      properties: {
        operations: {
          type: 'array',
          description: 'Array of operations to apply to the workflow',
          items: {
            type: 'object',
            properties: {
              operation_type: {
                type: 'string',
                enum: ['add', 'edit', 'delete'],
                description: 'Operation type',
              },
              block_id: {
                type: 'string',
                description: 'Block UUID. For "add", generate a new UUID. For "edit"/"delete", use existing block ID.',
              },
              params: {
                type: 'object',
                description: 'Block parameters. For "add": must include type and name. For "edit": fields to update.',
              },
            },
            required: ['operation_type', 'block_id'],
          },
        },
      },
      required: ['operations'],
    },
  },
  {
    name: 'get_workflow_data',
    description: 'Get data about the current workflow. Use data_type to specify what to retrieve: "state" for blocks/edges/config, "global_variables" for workflow variables, "deployment" for deployment status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        data_type: {
          type: 'string',
          enum: ['state', 'global_variables', 'deployment'],
          description: 'Type of data to retrieve',
        },
        workflowId: { type: 'string', description: 'Workflow ID (optional, uses current workflow if not specified)' },
      },
      required: ['data_type'],
    },
  },
  {
    name: 'get_workflow_console',
    description: 'Get execution logs from the workflow console. Use this to debug workflow runs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID (optional)' },
      },
    },
  },
  {
    name: 'get_block_outputs',
    description: 'Get the output data from a specific block after a workflow run.',
    input_schema: {
      type: 'object' as const,
      properties: {
        blockId: { type: 'string', description: 'Block ID to get outputs for' },
      },
      required: ['blockId'],
    },
  },
  {
    name: 'run_workflow',
    description: 'Execute the current workflow. Returns execution results. Requires user approval.',
    input_schema: {
      type: 'object' as const,
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID (optional)' },
      },
    },
  },
  {
    name: 'run_block',
    description: 'Execute a single block in isolation for testing.',
    input_schema: {
      type: 'object' as const,
      properties: {
        blockId: { type: 'string', description: 'Block ID to run' },
      },
      required: ['blockId'],
    },
  },
  {
    name: 'set_environment_variables',
    description: 'Set environment variables (API keys, secrets) for the workflow. Values are encrypted.',
    input_schema: {
      type: 'object' as const,
      properties: {
        variables: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Variable name' },
              value: { type: 'string', description: 'Variable value' },
            },
            required: ['key', 'value'],
          },
          description: 'Variables to set',
        },
      },
      required: ['variables'],
    },
  },
  {
    name: 'get_credentials',
    description: 'Check which OAuth accounts and API keys the user has configured.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'deploy_api',
    description: 'Deploy the workflow as an API endpoint.',
    input_schema: {
      type: 'object' as const,
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID' },
      },
    },
  },
  {
    name: 'deploy_chat',
    description: 'Deploy the workflow as a chat interface.',
    input_schema: {
      type: 'object' as const,
      properties: {
        workflowId: { type: 'string', description: 'Workflow ID' },
      },
    },
  },
]

/** Set of tool names that are handled by the sim-workflow frontend via mark-complete */
export const WORKFLOW_TOOL_NAMES = new Set(WORKFLOW_TOOLS.map(t => t.name))

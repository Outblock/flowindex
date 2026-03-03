/**
 * Pre-built Flow workflow template definitions.
 * These are inserted into the templates table as seed content
 * when a personal workspace is created.
 */

interface FlowTemplate {
  id: string
  name: string
  details: {
    tagline: string
    about: string
  }
  tags: string[]
  state: Record<string, unknown>
}

function uuid(suffix: string): string {
  return `flow-tmpl-0000-0000-0000-${suffix.padStart(12, '0')}`
}

function makeBlock(
  id: string,
  type: string,
  name: string,
  position: { x: number; y: number },
  subBlocks: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    type,
    name,
    position,
    subBlocks,
    enabled: true,
  }
}

function makeEdge(
  source: string,
  target: string,
  sourceHandle?: string,
  targetHandle?: string
): Record<string, unknown> {
  return {
    id: `${source}-${target}`,
    source,
    target,
    sourceHandle: sourceHandle || `${source}-source`,
    targetHandle: targetHandle || `${target}-target`,
  }
}

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    id: uuid('large-flow-xfer'),
    name: 'Large FLOW Transfer Alert',
    details: {
      tagline: 'Get notified when large FLOW transfers occur on-chain',
      about:
        'Monitors the Flow blockchain for fungible token transfers exceeding a configurable threshold. When a large FLOW transfer is detected, sends a notification via Slack or email with transaction details.',
    },
    tags: ['flow', 'alerts', 'monitoring', 'defi'],
    state: {
      blocks: {
        trigger: makeBlock('trigger', 'flow_trigger', 'Flow Large Transfer', { x: 100, y: 200 }, {
          selectedTriggerId: 'flow_large_transfer',
          token: 'flow',
          threshold: '10000',
        }),
        agent: makeBlock('agent', 'agent', 'Format Alert', { x: 450, y: 200 }, {
          systemPrompt:
            'Format a concise alert message for a large FLOW transfer. Include: amount, sender, receiver, and transaction ID.',
          prompt:
            'Large transfer detected: {{trigger.amount}} FLOW from {{trigger.from}} to {{trigger.to}}. TX: {{trigger.transactionId}}',
        }),
      },
      edges: [makeEdge('trigger', 'agent')],
      loops: {},
    },
  },
  {
    id: uuid('large-usdc-xfer'),
    name: 'Large USDC Transfer Alert',
    details: {
      tagline: 'Monitor large USDC movements on Flow',
      about:
        'Watches for USDC transfers above a threshold on the Flow blockchain. Useful for tracking stablecoin movements and potential market-moving transfers.',
    },
    tags: ['flow', 'alerts', 'usdc', 'stablecoin'],
    state: {
      blocks: {
        trigger: makeBlock('trigger', 'flow_trigger', 'Flow Large Transfer', { x: 100, y: 200 }, {
          selectedTriggerId: 'flow_large_transfer',
          token: 'usdc',
          threshold: '50000',
        }),
        agent: makeBlock('agent', 'agent', 'Analyze Transfer', { x: 450, y: 200 }, {
          systemPrompt:
            'Analyze a large USDC transfer on Flow. Provide context about the sender and receiver if known.',
          prompt:
            'USDC transfer: {{trigger.amount}} from {{trigger.from}} to {{trigger.to}}. Block: {{trigger.blockHeight}}',
        }),
      },
      edges: [makeEdge('trigger', 'agent')],
      loops: {},
    },
  },
  {
    id: uuid('whale-monitor'),
    name: 'Whale Activity Monitor',
    details: {
      tagline: 'Track transactions from whale addresses on Flow',
      about:
        'Monitor a list of known whale addresses for any transaction activity. Get instant alerts when whales move funds, stake tokens, or interact with DeFi protocols.',
    },
    tags: ['flow', 'whale', 'monitoring', 'analytics'],
    state: {
      blocks: {
        trigger: makeBlock('trigger', 'flow_trigger', 'Flow Whale Activity', { x: 100, y: 200 }, {
          selectedTriggerId: 'flow_whale_activity',
          addressList: '',
        }),
        lookup: makeBlock('lookup', 'flow_get_account', 'Get Whale Account', { x: 450, y: 200 }, {
          address: '{{trigger.address}}',
        }),
        agent: makeBlock('agent', 'agent', 'Analyze Activity', { x: 800, y: 200 }, {
          systemPrompt:
            'Analyze whale activity on the Flow blockchain. Provide context about what the whale did and potential market implications.',
          prompt:
            'Whale {{trigger.address}} performed a {{trigger.role}} transaction. Balance: {{lookup.balance}} FLOW. TX: {{trigger.transactionId}}',
        }),
      },
      edges: [makeEdge('trigger', 'lookup'), makeEdge('lookup', 'agent')],
      loops: {},
    },
  },
  {
    id: uuid('contract-depl'),
    name: 'New Contract Deployment Watcher',
    details: {
      tagline: 'Get notified when new smart contracts are deployed on Flow',
      about:
        'Monitors the Flow blockchain for new Cadence smart contract deployments. Useful for tracking ecosystem growth and discovering new projects early.',
    },
    tags: ['flow', 'contracts', 'monitoring', 'ecosystem'],
    state: {
      blocks: {
        trigger: makeBlock('trigger', 'flow_trigger', 'Flow Contract Deploy', { x: 100, y: 200 }, {
          selectedTriggerId: 'flow_contract_deploy',
          addressFilter: '',
        }),
        code: makeBlock('code', 'flow_get_contract_code', 'Get Contract Code', { x: 450, y: 200 }, {
          address: '{{trigger.address}}',
          contractName: '{{trigger.contractName}}',
        }),
        agent: makeBlock('agent', 'agent', 'Analyze Contract', { x: 800, y: 200 }, {
          systemPrompt:
            'Analyze a newly deployed Cadence smart contract on Flow. Summarize what it does, its key functions, and any notable patterns.',
          prompt:
            'New contract "{{trigger.contractName}}" deployed to {{trigger.address}}. Code:\n{{code.content}}',
        }),
      },
      edges: [makeEdge('trigger', 'code'), makeEdge('code', 'agent')],
      loops: {},
    },
  },
  {
    id: uuid('topshot-trade'),
    name: 'NBA Top Shot Trade Monitor',
    details: {
      tagline: 'Track NBA Top Shot NFT transfers on Flow',
      about:
        'Monitors NFT transfers for the NBA Top Shot collection on Flow. Get notified when moments are traded, gifted, or moved between accounts.',
    },
    tags: ['flow', 'nft', 'topshot', 'monitoring'],
    state: {
      blocks: {
        trigger: makeBlock('trigger', 'flow_trigger', 'Flow NFT Transfer', { x: 100, y: 200 }, {
          selectedTriggerId: 'flow_nft_transfer',
          collection: 'TopShot',
          addressFilter: '',
        }),
        agent: makeBlock('agent', 'agent', 'Report Trade', { x: 450, y: 200 }, {
          systemPrompt:
            'Report an NBA Top Shot NFT trade. Include the NFT ID, sender, receiver, and link to the transaction.',
          prompt:
            'Top Shot moment #{{trigger.nftId}} transferred from {{trigger.from}} to {{trigger.to}}. TX: {{trigger.transactionId}}',
        }),
      },
      edges: [makeEdge('trigger', 'agent')],
      loops: {},
    },
  },
  {
    id: uuid('staking-chng'),
    name: 'Staking Changes Monitor',
    details: {
      tagline: 'Monitor staking and delegation changes on Flow',
      about:
        'Tracks staking-related events on the Flow blockchain including new stakes, unstaking, and reward withdrawals. Useful for node operators and delegators.',
    },
    tags: ['flow', 'staking', 'monitoring', 'nodes'],
    state: {
      blocks: {
        trigger: makeBlock('trigger', 'flow_trigger', 'Flow Staking Event', { x: 100, y: 200 }, {
          selectedTriggerId: 'flow_staking_event',
          delegatorAddress: '',
          stakingEventType: 'any',
        }),
        info: makeBlock('info', 'flow_get_staking_info', 'Get Staking Info', { x: 450, y: 200 }, {
          address: '{{trigger.address}}',
        }),
        agent: makeBlock('agent', 'agent', 'Report Change', { x: 800, y: 200 }, {
          systemPrompt:
            'Report a staking change on the Flow blockchain. Include the type of event, address, amount, and current staking status.',
          prompt:
            'Staking event: {{trigger.eventType}} by {{trigger.address}}. Amount: {{trigger.amount}}. Node: {{trigger.nodeId}}. Current staking info: {{info.content}}',
        }),
      },
      edges: [makeEdge('trigger', 'info'), makeEdge('info', 'agent')],
      loops: {},
    },
  },
  {
    id: uuid('low-balance'),
    name: 'Low Balance Warning',
    details: {
      tagline: 'Alert when an account balance drops below a threshold',
      about:
        'Monitors a Flow account balance and triggers an alert when it drops below a configured threshold. Useful for ensuring accounts have enough FLOW for transaction fees.',
    },
    tags: ['flow', 'alerts', 'balance', 'operations'],
    state: {
      blocks: {
        trigger: makeBlock('trigger', 'flow_trigger', 'Flow Balance Change', { x: 100, y: 200 }, {
          selectedTriggerId: 'flow_balance_change',
          addressFilter: '',
          token: 'flow',
          threshold: '10',
          direction: 'below',
        }),
        agent: makeBlock('agent', 'agent', 'Alert', { x: 450, y: 200 }, {
          systemPrompt:
            'Generate an urgent low balance alert for a Flow account. Include the current balance, the threshold, and recommended actions.',
          prompt:
            'LOW BALANCE ALERT: Account {{trigger.address}} FLOW balance is {{trigger.balance}} (threshold: 10). Previous balance: {{trigger.previousBalance}}.',
        }),
      },
      edges: [makeEdge('trigger', 'agent')],
      loops: {},
    },
  },
  {
    id: uuid('nft-received'),
    name: 'NFT Received Notification',
    details: {
      tagline: 'Get notified when your account receives an NFT',
      about:
        'Monitors your Flow account for incoming NFT transfers. Useful for tracking when NFTs are airdropped, purchased, or sent to your account.',
    },
    tags: ['flow', 'nft', 'notifications', 'personal'],
    state: {
      blocks: {
        trigger: makeBlock('trigger', 'flow_trigger', 'Flow NFT Transfer', { x: 100, y: 200 }, {
          selectedTriggerId: 'flow_nft_transfer',
          collection: '',
          addressFilter: '',
        }),
        metadata: makeBlock('metadata', 'flow_get_nft', 'Get NFT Details', { x: 450, y: 200 }, {
          nftType: '{{trigger.nftType}}',
          nftId: '{{trigger.nftId}}',
        }),
        agent: makeBlock('agent', 'agent', 'Describe NFT', { x: 800, y: 200 }, {
          systemPrompt:
            'Create a friendly notification about receiving an NFT. Include the collection name, NFT ID, and who sent it.',
          prompt:
            'NFT received! {{trigger.nftType}} #{{trigger.nftId}} from {{trigger.from}}. Details: {{metadata.content}}',
        }),
      },
      edges: [makeEdge('trigger', 'metadata'), makeEdge('metadata', 'agent')],
      loops: {},
    },
  },
]

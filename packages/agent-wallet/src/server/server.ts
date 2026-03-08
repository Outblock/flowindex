import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig, type AgentWalletConfig } from '../config/env.js';
import { configureFcl } from '../config/fcl.js';
import { LocalSigner } from '../signer/local.js';
import { CloudSigner } from '../signer/cloud.js';
import type { FlowSigner } from '../signer/interface.js';
import { FlowIndexClient } from '../flowindex/client.js';

export interface ServerContext {
  config: AgentWalletConfig;
  signer: FlowSigner;
  cloudSigner: CloudSigner;
  flowIndexClient: FlowIndexClient;
}

export async function createServer(): Promise<McpServer> {
  const config = loadConfig();

  // Configure FCL before creating signers
  await configureFcl(config.network);

  let signer: FlowSigner;
  const cloudSigner = new CloudSigner(config);

  if (config.signerType === 'local-mnemonic' || config.signerType === 'local-key') {
    const local = new LocalSigner(config);
    await local.init();
    signer = local;
  } else {
    await cloudSigner.init();
    signer = cloudSigner;
  }

  const flowIndexClient = new FlowIndexClient(config.flowindexUrl);
  const ctx: ServerContext = { config, signer, cloudSigner, flowIndexClient };

  const server = new McpServer(
    { name: "flow-agent-wallet", version: "0.1.0" },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: false, listChanged: true },
        logging: {},
      },
    }
  );

  // Import and register tools
  const { registerWalletTools } = await import('../tools/wallet.js');
  registerWalletTools(server, ctx);

  const { registerTemplateTools } = await import('../tools/templates.js');
  registerTemplateTools(server, ctx);

  const { registerApprovalTools } = await import('../tools/approval.js');
  registerApprovalTools(server, ctx);

  const { registerFlowQueryTools } = await import('../tools/flow-query.js');
  registerFlowQueryTools(server, ctx);

  const { registerEvmTools } = await import('../tools/evm.js');
  registerEvmTools(server, ctx);

  const info = signer.info();
  console.error(`Flow Agent Wallet MCP Server v0.1.0`);
  console.error(`Network: ${config.network}`);
  console.error(`Signer: ${info.type} | Flow: ${info.flowAddress || 'none'} | EVM: ${info.evmAddress || 'none'}`);
  console.error(`Approval: ${config.approvalRequired ? 'required' : 'headless'}`);

  return server;
}

import { WebSocketServer, type WebSocket } from 'ws';
import { CadenceLSPClient } from './lspClient.js';
import { DepsWorkspace, type FlowNetwork } from './depsWorkspace.js';
import { hasAddressImports, extractAddressImports, rewriteToStringImports } from './importUtils.js';

const PORT = parseInt(process.env.LSP_PORT || '3001', 10);
const FLOW_COMMAND = process.env.FLOW_COMMAND || 'flow';

// One LSP client + workspace per network
const clients = new Map<string, CadenceLSPClient>();
const workspaces = new Map<string, DepsWorkspace>();

async function getWorkspace(network: FlowNetwork): Promise<DepsWorkspace> {
  let ws = workspaces.get(network);
  if (!ws) {
    ws = new DepsWorkspace(FLOW_COMMAND, network);
    await ws.init();
    workspaces.set(network, ws);
  }
  return ws;
}

async function getClient(network: FlowNetwork): Promise<CadenceLSPClient> {
  let client = clients.get(network);
  if (client) return client;

  const ws = await getWorkspace(network);
  client = new CadenceLSPClient({
    flowCommand: FLOW_COMMAND,
    network,
    cwd: ws.getDir(),
  });
  await client.ensureInitialized();
  clients.set(network, client);
  return client;
}

// Track per-connection state
interface ConnectionState {
  network: FlowNetwork;
  client: CadenceLSPClient;
  workspace: DepsWorkspace;
  openDocs: Set<string>; // URIs opened on this connection
  notificationHandler: (method: string, params: any) => void;
}

const wss = new WebSocketServer({ port: PORT, path: '/lsp' });

wss.on('listening', () => {
  console.log(`[LSP Server] WebSocket listening on :${PORT}/lsp`);
});

wss.on('connection', (socket: WebSocket) => {
  console.log('[LSP Server] Client connected');
  let state: ConnectionState | null = null;

  socket.on('message', async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // Init message: { type: "init", network: "mainnet" }
    if (msg.type === 'init') {
      const network = (['mainnet', 'testnet', 'emulator'].includes(msg.network)
        ? msg.network
        : 'mainnet') as FlowNetwork;

      try {
        const client = await getClient(network);
        const workspace = await getWorkspace(network);

        // Listen for notifications from LSP and relay to this WebSocket
        const notificationHandler = (method: string, params: any) => {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
          }
        };
        client.on('notification', notificationHandler);

        state = { network, client, workspace, openDocs: new Set(), notificationHandler };
        socket.send(JSON.stringify({ type: 'ready' }));
        console.log(`[LSP Server] Initialized for ${network}`);
      } catch (err: any) {
        socket.send(JSON.stringify({ type: 'error', message: err.message }));
      }
      return;
    }

    // JSON-RPC messages — forward to LSP
    if (!state) {
      socket.send(JSON.stringify({ type: 'error', message: 'Send init message first' }));
      return;
    }

    const { client, workspace } = state;

    // Intercept didOpen and didChange to install deps + rewrite imports
    if (msg.method === 'textDocument/didOpen' || msg.method === 'textDocument/didChange') {
      const doc = msg.params?.textDocument;
      const code = msg.method === 'textDocument/didOpen'
        ? msg.params?.textDocument?.text
        : msg.params?.contentChanges?.[0]?.text;

      if (code && hasAddressImports(code)) {
        const imports = extractAddressImports(code);
        // Install deps (non-blocking for subsequent messages, but we await here)
        await workspace.installDeps(imports);
        // Rewrite imports in the code
        const rewritten = rewriteToStringImports(code);
        if (msg.method === 'textDocument/didOpen') {
          msg.params.textDocument.text = rewritten;
        } else {
          msg.params.contentChanges[0].text = rewritten;
        }
      }

      if (msg.method === 'textDocument/didOpen' && doc?.uri) {
        state.openDocs.add(doc.uri);
      }
    }

    if (msg.method === 'textDocument/didClose') {
      const uri = msg.params?.textDocument?.uri;
      if (uri) state.openDocs.delete(uri);
    }

    // Forward to LSP
    if ('id' in msg && msg.id !== undefined) {
      // Request — forward and relay response
      try {
        const result = await client.request(msg.method, msg.params);
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      } catch (err: any) {
        socket.send(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          error: { code: -32000, message: err.message },
        }));
      }
    } else {
      // Notification — just forward
      client.notify(msg.method, msg.params);
    }
  });

  socket.on('close', () => {
    console.log('[LSP Server] Client disconnected');
    if (state) {
      // Close documents opened by this connection
      for (const uri of state.openDocs) {
        state.client.notify('textDocument/didClose', { textDocument: { uri } });
      }
      // Remove notification listener
      state.client.removeListener('notification', state.notificationHandler);
      state = null;
    }
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[LSP Server] Shutting down...');
  for (const client of clients.values()) {
    await client.shutdown();
  }
  wss.close();
  process.exit(0);
});

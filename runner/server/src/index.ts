import { WebSocketServer, type WebSocket } from 'ws';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { CadenceLSPClient } from './lspClient.js';
import { DepsWorkspace, type FlowNetwork } from './depsWorkspace.js';
import { hasAddressImports, extractAddressImports, rewriteToStringImports } from './importUtils.js';
import { app as httpApp } from './http.js';

const PORT = parseInt(process.env.LSP_PORT || '3002', 10);
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '3003', 10);
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
  openDocs: Map<string, string>; // Server-side URI -> current document text
  docVersions: Map<string, number>;
  clientToServerUri: Map<string, string>;
  serverToClientUri: Map<string, string>;
  emittedDeps: Set<string>;
  pendingDeps: Set<string>;
  recheckTimer: ReturnType<typeof setTimeout> | null;
  importAddressByName: Map<string, string>;
  notificationHandler: (method: string, params: any) => void;
}

function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

function getWordAtPosition(lineText: string, character: number): string | null {
  if (!lineText) return null;
  let idx = Math.max(0, Math.min(character, lineText.length - 1));
  if (!isWordChar(lineText[idx]) && idx > 0 && isWordChar(lineText[idx - 1])) {
    idx -= 1;
  }
  if (!isWordChar(lineText[idx])) return null;

  let start = idx;
  let end = idx + 1;
  while (start > 0 && isWordChar(lineText[start - 1])) start -= 1;
  while (end < lineText.length && isWordChar(lineText[end])) end += 1;
  return lineText.slice(start, end);
}

function parseAddressImports(code: string): Map<string, string> {
  const imports = new Map<string, string>();
  const re = /import\s+([\w,\s]+?)\s+from\s+0x([0-9a-fA-F]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    const address = `0x${m[2].toLowerCase()}`;
    for (const name of names) {
      imports.set(name, address);
    }
  }
  return imports;
}

function parseStringImports(code: string): string[] {
  const imports: string[] = [];
  const re = /import\s+"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    imports.push(m[1]);
  }
  return imports;
}

function getLineText(code: string, line: number): string {
  const lines = code.split('\n');
  if (line < 0 || line >= lines.length) return '';
  return lines[line];
}

function findReceiverBeforeSymbol(lineText: string, symbol: string): string | null {
  const idx = lineText.indexOf(`.${symbol}`);
  if (idx <= 0) return null;
  let end = idx;
  let start = end - 1;
  while (start >= 0 && isWordChar(lineText[start])) start -= 1;
  const receiver = lineText.slice(start + 1, end).trim();
  return receiver.length > 0 ? receiver : null;
}

function inferAliasFromReceiver(receiver: string, code: string, imports: Map<string, string>): string | null {
  if (imports.has(receiver)) return receiver;
  const escaped = receiver.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const declRe = new RegExp(`\\b(?:let|var)\\s+${escaped}\\s*:\\s*([^\\n]+)`, 'm');
  const decl = code.match(declRe)?.[1];
  if (!decl) return null;
  for (const alias of imports.keys()) {
    if (decl.includes(`${alias}.`)) {
      return alias;
    }
  }
  return null;
}

function locateSymbolInCode(source: string, symbol: string): { startLine: number; startChar: number; endChar: number } | null {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`\\bfun\\s+${escaped}\\b`),
    new RegExp(`\\b(?:let|var)\\s+${escaped}\\b`),
    new RegExp(`\\b(?:entitlement|resource|struct|contract|interface|attachment|enum|event)\\s+${escaped}\\b`),
    new RegExp(`\\b${escaped}\\b`),
  ];

  for (const lineIdxAndText of source.split('\n').entries()) {
    const lineIdx = lineIdxAndText[0];
    const lineText = lineIdxAndText[1];
    for (const re of patterns) {
      const match = lineText.match(re);
      if (!match) continue;
      const symbolIdx = lineText.indexOf(symbol, match.index ?? 0);
      if (symbolIdx === -1) continue;
      return { startLine: lineIdx, startChar: symbolIdx, endChar: symbolIdx + symbol.length };
    }
  }

  return null;
}

function isInvalidDefinitionResult(result: any): boolean {
  if (!result) return true;
  const locations = Array.isArray(result) ? result : [result];
  if (locations.length === 0) return true;
  for (const loc of locations) {
    const line = loc?.range?.start?.line;
    if (typeof line !== 'number') return true;
    if (line < 0 || line > 1_000_000) return true;
  }
  return false;
}

function sendDependencyResolved(
  socket: WebSocket,
  dep: { name: string; address: string },
  depCode: string,
): void {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify({
    jsonrpc: '2.0',
    method: 'flow/dependencyResolved',
    params: {
      address: dep.address.startsWith('0x') ? dep.address : `0x${dep.address}`,
      contractName: dep.name,
      code: depCode,
    },
  }));
}

function queueDependencyInstall(
  dep: { name: string; address: string },
  state: ConnectionState,
  socket: WebSocket,
): void {
  const depKey = `${dep.address.toLowerCase()}.${dep.name}`;
  if (state.emittedDeps.has(depKey) || state.pendingDeps.has(depKey)) return;

  state.pendingDeps.add(depKey);
  void state.workspace.installDeps([dep])
    .then(async () => {
      const depCode = await state.workspace.getDependencyCode(dep.address, dep.name);
      if (!depCode) return;
      state.emittedDeps.add(depKey);
      sendDependencyResolved(socket, dep, depCode);
      scheduleOpenDocumentRecheck(state);
    })
    .catch((error) => {
      console.error(`[LSP Server] Failed to resolve dependency ${depKey}:`, error);
    })
    .finally(() => {
      state.pendingDeps.delete(depKey);
    });
}

function scheduleOpenDocumentRecheck(state: ConnectionState): void {
  if (state.recheckTimer) return;
  state.recheckTimer = setTimeout(() => {
    state.recheckTimer = null;
    for (const [uri, text] of state.openDocs.entries()) {
      const nextVersion = (state.docVersions.get(uri) ?? 1) + 1;
      state.docVersions.set(uri, nextVersion);
      state.client.notify('textDocument/didChange', {
        textDocument: { uri, version: nextVersion },
        contentChanges: [{ text }],
      });
    }
  }, 80);
}

async function loadDependencySource(
  alias: string,
  address: string,
  state: ConnectionState,
): Promise<{ uri: string; source: string } | null> {
  const clientUri = `file:///deps/${address}/${alias}.cdc`;
  const mappedServerUri = state.clientToServerUri.get(clientUri);
  if (mappedServerUri) {
    const openSource = state.openDocs.get(mappedServerUri);
    if (openSource) return { uri: clientUri, source: openSource };
  }

  const diskSource = await state.workspace.getDependencyCode(address, alias);
  if (!diskSource) return null;
  return { uri: clientUri, source: diskSource };
}

async function fallbackDefinition(
  msg: any,
  state: ConnectionState,
): Promise<any | null> {
  const uri = msg?.params?.textDocument?.uri;
  const pos = msg?.params?.position;
  if (!uri || typeof pos?.line !== 'number' || typeof pos?.character !== 'number') {
    return null;
  }

  const currentDoc = state.openDocs.get(uri);
  if (!currentDoc) return null;

  const lineText = getLineText(currentDoc, pos.line);
  const symbol = getWordAtPosition(lineText, pos.character);
  if (!symbol) return null;

  const imports = parseAddressImports(currentDoc);
  if (imports.size === 0) {
    for (const name of parseStringImports(currentDoc)) {
      const addr = state.importAddressByName.get(name);
      if (addr) imports.set(name, addr);
    }
  }
  if (imports.size === 0) return null;

  let preferredAlias: string | null = null;
  for (const alias of imports.keys()) {
    if (lineText.includes(`${alias}.${symbol}`) || lineText.includes(`${alias}.`)) {
      preferredAlias = alias;
      break;
    }
  }
  if (!preferredAlias) {
    const receiver = findReceiverBeforeSymbol(lineText, symbol);
    if (receiver) {
      preferredAlias = inferAliasFromReceiver(receiver, currentDoc, imports);
    }
  }
  if (!preferredAlias && imports.has(symbol)) {
    preferredAlias = symbol;
  }

  const candidates: { uri: string; source: string }[] = [];
  if (preferredAlias) {
    const address = imports.get(preferredAlias);
    if (address) {
      const preferred = await loadDependencySource(preferredAlias, address, state);
      if (preferred) candidates.push(preferred);
    }
  }
  for (const [alias, address] of imports.entries()) {
    if (alias === preferredAlias) continue;
    const dep = await loadDependencySource(alias, address, state);
    if (dep) candidates.push(dep);
  }

  for (const dep of candidates) {
    const hit = locateSymbolInCode(dep.source, symbol);
    if (!hit) continue;
    return {
      uri: dep.uri,
      range: {
        start: { line: hit.startLine, character: hit.startChar },
        end: { line: hit.startLine, character: hit.endChar },
      },
    };
  }

  return null;
}

function safeRelativePathFromFileUri(uri: string): string | null {
  if (!uri.startsWith('file://')) return null;
  try {
    const absolutePath = fileURLToPath(uri);
    const normalized = absolutePath
      .replace(/^[A-Za-z]:/, (drive) => drive.replace(':', '_'))
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    return normalized.length > 0 ? normalized : 'main.cdc';
  } catch {
    return null;
  }
}

async function mapClientUriToServer(uri: string, state: ConnectionState): Promise<string> {
  if (!uri.startsWith('file://')) return uri;

  const existing = state.clientToServerUri.get(uri);
  if (existing) return existing;

  const workspaceDir = state.workspace.getDir();
  const workspacePrefix = pathToFileURL(`${workspaceDir}/`).toString();
  if (uri.startsWith(workspacePrefix)) {
    state.clientToServerUri.set(uri, uri);
    state.serverToClientUri.set(uri, uri);
    return uri;
  }

  const relative = safeRelativePathFromFileUri(uri);
  if (!relative) return uri;

  const mappedPath = join(workspaceDir, relative);
  await mkdir(dirname(mappedPath), { recursive: true });
  const mappedUri = pathToFileURL(mappedPath).toString();

  state.clientToServerUri.set(uri, mappedUri);
  state.serverToClientUri.set(mappedUri, uri);
  return mappedUri;
}

function mapServerUriToClient(uri: string, state: ConnectionState): string {
  return state.serverToClientUri.get(uri) ?? uri;
}

async function remapUrisForServer(value: any, state: ConnectionState): Promise<void> {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) await remapUrisForServer(item, state);
    return;
  }
  if (typeof value !== 'object') return;

  const entries = Object.entries(value as Record<string, any>);
  for (const [key, nested] of entries) {
    if ((key === 'uri' || key.endsWith('Uri')) && typeof nested === 'string') {
      (value as Record<string, any>)[key] = await mapClientUriToServer(nested, state);
      continue;
    }
    await remapUrisForServer(nested, state);
  }
}

function remapUrisForClient(value: any, state: ConnectionState): void {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) remapUrisForClient(item, state);
    return;
  }
  if (typeof value !== 'object') return;

  const entries = Object.entries(value as Record<string, any>);
  for (const [key, nested] of entries) {
    if ((key === 'uri' || key.endsWith('Uri')) && typeof nested === 'string') {
      (value as Record<string, any>)[key] = mapServerUriToClient(nested, state);
      continue;
    }
    remapUrisForClient(nested, state);
  }
}

const wss = new WebSocketServer({ port: PORT, path: '/lsp' });

wss.on('listening', () => {
  console.log(`[LSP Server] WebSocket listening on :${PORT}/lsp`);
});

// Start HTTP server
const httpServer = httpApp.listen(HTTP_PORT, () => {
  console.log(`[HTTP Server] Listening on :${HTTP_PORT}`);
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
        const connectionState: ConnectionState = {
          network,
          client,
          workspace,
          openDocs: new Map(),
          docVersions: new Map(),
          clientToServerUri: new Map(),
          serverToClientUri: new Map(),
          emittedDeps: new Set(),
          pendingDeps: new Set(),
          recheckTimer: null,
          importAddressByName: new Map(),
          notificationHandler: () => {},
        };

        // Listen for notifications from LSP and relay to this WebSocket
        const notificationHandler = (method: string, params: any) => {
          if (socket.readyState === socket.OPEN) {
            const clonedParams = params ? structuredClone(params) : params;
            remapUrisForClient(clonedParams, connectionState);
            socket.send(JSON.stringify({ jsonrpc: '2.0', method, params: clonedParams }));
          }
        };
        connectionState.notificationHandler = notificationHandler;
        client.on('notification', notificationHandler);

        state = connectionState;
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

    const { client } = state;

    // Intercept didOpen and didChange to install deps + rewrite imports
    if (typeof msg.method === 'string' && msg.method.startsWith('textDocument/')) {
      await remapUrisForServer(msg.params, state);
    }

    if (msg.method === 'textDocument/didOpen' || msg.method === 'textDocument/didChange') {
      const doc = msg.params?.textDocument;
      const code = msg.method === 'textDocument/didOpen'
        ? msg.params?.textDocument?.text
        : msg.params?.contentChanges?.[0]?.text;

      if (code && hasAddressImports(code)) {
        const imports = extractAddressImports(code);
        for (const dep of imports) {
          state.importAddressByName.set(dep.name, `0x${dep.address.toLowerCase()}`);
          queueDependencyInstall(dep, state, socket);
        }

        // Rewrite imports in the code
        const rewritten = rewriteToStringImports(code);
        if (msg.method === 'textDocument/didOpen') {
          msg.params.textDocument.text = rewritten;
        } else {
          msg.params.contentChanges[0].text = rewritten;
        }
      }

      if (msg.method === 'textDocument/didOpen' && doc?.uri) {
        state.openDocs.set(doc.uri, msg.params?.textDocument?.text ?? '');
        state.docVersions.set(doc.uri, Number(msg.params?.textDocument?.version ?? 1));
      }
    }

    if (msg.method === 'textDocument/didChange') {
      const uri = msg.params?.textDocument?.uri;
      const nextText = msg.params?.contentChanges?.[0]?.text;
      if (uri && typeof nextText === 'string') {
        state.openDocs.set(uri, nextText);
        const incomingVersion = Number(msg.params?.textDocument?.version);
        if (Number.isFinite(incomingVersion)) {
          state.docVersions.set(uri, incomingVersion);
        }
      }
    }

    if (msg.method === 'textDocument/didClose') {
      const uri = msg.params?.textDocument?.uri;
      if (uri) {
        state.openDocs.delete(uri);
        state.docVersions.delete(uri);
      }
    }

    if (msg.method === 'initialize') {
      const initResult = client.getInitializeResult();
      socket.send(JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: initResult ?? { capabilities: {} },
      }));
      return;
    }

    if (msg.method === 'initialized') {
      return;
    }

    // Forward to LSP
    if ('id' in msg && msg.id !== undefined) {
      // Request — forward and relay response
      try {
        let result = await client.request(msg.method, msg.params);
        if (msg.method === 'textDocument/definition' && isInvalidDefinitionResult(result)) {
          const fallback = await fallbackDefinition(msg, state);
          if (fallback) {
            result = fallback;
          }
        }
        const clonedResult = result ? structuredClone(result) : result;
        remapUrisForClient(clonedResult, state);
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: clonedResult }));
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
      for (const uri of state.openDocs.keys()) {
        state.client.notify('textDocument/didClose', { textDocument: { uri } });
      }
      if (state.recheckTimer) {
        clearTimeout(state.recheckTimer);
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
  httpServer.close();
  wss.close();
  process.exit(0);
});

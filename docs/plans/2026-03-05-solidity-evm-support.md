# Solidity & Flow EVM Support — Implementation Plan (Phase 1: LSP + Editor)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Solidity smart contract editing with full language intelligence (autocomplete, diagnostics, hover, go-to-definition) to the Cadence Runner, powered by a server-side Solidity LSP.

**Architecture:** Server-side `@nomicfoundation/solidity-language-server` spawned per-network, proxied over WebSocket at `/lsp-sol`. Client-side `LspAdapter` (generalized from existing `MonacoLspAdapter`) connects to it. `CadenceEditor` becomes language-aware via file extension detection. Solidity templates added to file system.

**Tech Stack:** `@nomicfoundation/solidity-language-server`, Monaco built-in `sol` language, WebSocket, Node.js stdio

---

### Task 1: Add Solidity Language Server to Server Dependencies

**Files:**
- Modify: `runner/server/package.json`

**Step 1: Install the Solidity language server package**

```bash
cd runner/server && bun add @nomicfoundation/solidity-language-server
```

This installs the Nomic Foundation's Solidity LSP with platform-specific native binaries (slang).

**Step 2: Verify the binary exists**

```bash
ls runner/server/node_modules/@nomicfoundation/solidity-language-server/dist/
```

Expected: should contain `index.js` or similar entry point.

Find the exact way to spawn it:

```bash
cd runner/server && node -e "const path = require.resolve('@nomicfoundation/solidity-language-server'); console.log(path)"
```

**Step 3: Commit**

```bash
git add runner/server/package.json runner/server/bun.lock
git commit -m "chore(runner): add @nomicfoundation/solidity-language-server dependency"
```

---

### Task 2: Create SolidityLSPClient

**Files:**
- Create: `runner/server/src/solidityLspClient.ts`

A class that spawns the Solidity language server process over stdio, manages JSON-RPC communication. Mirrors `CadenceLSPClient` but spawns `solidity-language-server --stdio` instead of `flow cadence language-server`.

**Step 1: Create the SolidityLSPClient class**

```typescript
// runner/server/src/solidityLspClient.ts
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface SolidityLSPClientOptions {
  /** Path to solidity-language-server binary or 'node' with args */
  cwd: string;
}

export class SolidityLSPClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private pendingRequests = new Map<number, PendingRequest>();
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private initResult: any = null;
  private cwd: string;

  constructor(opts: SolidityLSPClientOptions) {
    super();
    this.cwd = opts.cwd;
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._initialize();
    return this.initPromise;
  }

  private async _initialize(): Promise<void> {
    // Resolve the solidity-language-server entry point
    const serverPath = require.resolve(
      '@nomicfoundation/solidity-language-server',
      { paths: [process.cwd()] }
    );

    try {
      this.process = spawn('node', [serverPath, '--stdio'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this.cwd,
      });
    } catch (e: any) {
      throw new Error(`Failed to start Solidity LSP: ${e.message}`);
    }

    await new Promise<void>((resolve, reject) => {
      this.process!.on('error', (err) =>
        reject(new Error(`Failed to start Solidity LSP: ${err.message}`))
      );
      this.process!.on('spawn', () => resolve());
    });

    this.process.stdout!.on('data', (data: Buffer) => this.onData(data));
    this.process.stderr!.on('data', (data: Buffer) => {
      console.error('[Solidity LSP stderr]', data.toString());
    });

    this.process.on('exit', (code) => {
      console.error(`[Solidity LSP] process exited with code ${code}`);
      this.initialized = false;
      this.initPromise = null;
      for (const [, req] of this.pendingRequests) {
        req.reject(new Error('Solidity LSP process exited'));
        clearTimeout(req.timer);
      }
      this.pendingRequests.clear();
    });

    const initResult = await this.request('initialize', {
      processId: process.pid,
      capabilities: {
        textDocument: {
          completion: {
            completionItem: {
              snippetSupport: true,
              documentationFormat: ['markdown', 'plaintext'],
            },
          },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          signatureHelp: {
            signatureInformation: {
              documentationFormat: ['markdown', 'plaintext'],
            },
          },
          definition: {},
          references: {},
          documentSymbol: {},
          publishDiagnostics: {},
          formatting: {},
          rename: {},
          codeAction: {},
        },
      },
      rootUri: pathToFileURL(this.cwd).toString(),
      workspaceFolders: [
        {
          uri: pathToFileURL(this.cwd).toString(),
          name: 'solidity-workspace',
        },
      ],
    });

    this.notify('initialized', {});
    this.initResult = initResult;
    this.initialized = true;
  }

  private onData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
    while (this.tryParseMessage()) {}
  }

  private tryParseMessage(): boolean {
    const headerEnd = this.buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return false;

    const header = this.buffer.subarray(0, headerEnd).toString('ascii');
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) return false;

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    if (this.buffer.length < bodyStart + contentLength) return false;

    const body = this.buffer
      .subarray(bodyStart, bodyStart + contentLength)
      .toString('utf-8');
    this.buffer = this.buffer.subarray(bodyStart + contentLength);

    try {
      const message = JSON.parse(body);
      this.handleMessage(message);
    } catch (e) {
      console.error('[Solidity LSP] Failed to parse message:', e);
    }

    return true;
  }

  private handleMessage(message: any): void {
    if (
      'id' in message &&
      message.id !== undefined &&
      ('result' in message || 'error' in message)
    ) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result);
        }
      }
      return;
    }

    // Request from server to client (e.g. client/registerCapability)
    if ('id' in message && message.id !== undefined && message.method) {
      try {
        this.send({ jsonrpc: '2.0', id: message.id, result: null });
      } catch (e) {
        console.error(
          '[Solidity LSP] Failed to reply to server request:',
          e
        );
      }
      this.emit('notification', message.method, message.params);
      this.emit(message.method, message.params);
      return;
    }

    if (message.method) {
      this.emit('notification', message.method, message.params);
      this.emit(message.method, message.params);
    }
  }

  getInitializeResult(): any {
    return this.initResult;
  }

  async request(
    method: string,
    params: any,
    timeoutMs = 30000
  ): Promise<any> {
    if (method !== 'initialize') {
      await this.ensureInitialized();
    }

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new Error(
            `Solidity LSP request '${method}' timed out after ${timeoutMs}ms`
          )
        );
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params: any): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  private send(message: any): void {
    if (!this.process?.stdin?.writable) {
      throw new Error('Solidity LSP process not available');
    }
    const body = JSON.stringify(message);
    const contentLength = Buffer.byteLength(body, 'utf-8');
    this.process.stdin.write(
      `Content-Length: ${contentLength}\r\n\r\n${body}`
    );
  }

  async shutdown(): Promise<void> {
    if (!this.process || this.process.killed) return;
    try {
      await this.request('shutdown', null, 5000);
      this.notify('exit', null);
    } catch {
      this.process.kill();
    }
  }
}
```

**Step 2: Verify it compiles**

```bash
cd runner/server && bun run build
```

Expected: no TypeScript errors.

**Step 3: Commit**

```bash
git add runner/server/src/solidityLspClient.ts
git commit -m "feat(runner): add SolidityLSPClient for stdio LSP management"
```

---

### Task 3: Create SolidityWorkspace

**Files:**
- Create: `runner/server/src/solidityWorkspace.ts`

Creates a temp directory with a minimal `foundry.toml` so the Solidity language server has a valid project root. Syncs `.sol` files from client connections.

**Step 1: Create the workspace class**

```typescript
// runner/server/src/solidityWorkspace.ts
import { writeFile, access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export type EvmNetwork = 'mainnet' | 'testnet';

const EVM_CHAIN_IDS: Record<EvmNetwork, number> = {
  mainnet: 747,
  testnet: 545,
};

const EVM_RPC_URLS: Record<EvmNetwork, string> = {
  mainnet: 'https://mainnet.evm.nodes.onflow.org',
  testnet: 'https://testnet.evm.nodes.onflow.org',
};

/**
 * Persistent workspace for Solidity LSP per network.
 * Creates a temp directory with foundry.toml so the language server
 * has a valid project root with Flow EVM configuration.
 */
export class SolidityWorkspace {
  private dir: string;
  private network: EvmNetwork;

  constructor(network: EvmNetwork) {
    this.network = network;
    this.dir = join(tmpdir(), `solidity-lsp-workspace-${network}`);
  }

  getDir(): string {
    return this.dir;
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await mkdir(join(this.dir, 'src'), { recursive: true });

    // Create foundry.toml if it doesn't exist
    const foundryPath = join(this.dir, 'foundry.toml');
    try {
      await access(foundryPath);
    } catch {
      const chainId = EVM_CHAIN_IDS[this.network];
      const rpcUrl = EVM_RPC_URLS[this.network];
      await writeFile(
        foundryPath,
        `[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.28"

[rpc_endpoints]
flow_${this.network} = "${rpcUrl}"

[etherscan]
flow_${this.network} = { key = "", chain = ${chainId}, url = "${rpcUrl}" }
`,
        'utf-8'
      );
    }

    // Create a minimal remappings.txt for common imports
    const remappingsPath = join(this.dir, 'remappings.txt');
    try {
      await access(remappingsPath);
    } catch {
      await writeFile(remappingsPath, '', 'utf-8');
    }
  }
}
```

**Step 2: Verify it compiles**

```bash
cd runner/server && bun run build
```

**Step 3: Commit**

```bash
git add runner/server/src/solidityWorkspace.ts
git commit -m "feat(runner): add SolidityWorkspace for Solidity LSP project scaffolding"
```

---

### Task 4: Add /lsp-sol WebSocket Endpoint to Server

**Files:**
- Modify: `runner/server/src/index.ts`

Add a second `WebSocketServer` at `/lsp-sol` that proxies Solidity LSP connections. Simpler than the Cadence handler since Solidity doesn't need import rewriting or dependency installation.

**Step 1: Add imports and Solidity state management**

At the top of `runner/server/src/index.ts`, add:

```typescript
import { SolidityLSPClient } from './solidityLspClient.js';
import { SolidityWorkspace, type EvmNetwork } from './solidityWorkspace.js';
```

After the existing Cadence client/workspace maps, add:

```typescript
// Solidity LSP: one client + workspace per network
const solidityClients = new Map<string, SolidityLSPClient>();
const solidityWorkspaces = new Map<string, SolidityWorkspace>();

async function getSolidityWorkspace(network: EvmNetwork): Promise<SolidityWorkspace> {
  let ws = solidityWorkspaces.get(network);
  if (!ws) {
    ws = new SolidityWorkspace(network);
    await ws.init();
    solidityWorkspaces.set(network, ws);
  }
  return ws;
}

async function getSolidityClient(network: EvmNetwork): Promise<SolidityLSPClient> {
  let client = solidityClients.get(network);
  if (client) return client;

  const ws = await getSolidityWorkspace(network);
  client = new SolidityLSPClient({ cwd: ws.getDir() });
  await client.ensureInitialized();
  solidityClients.set(network, client);
  return client;
}
```

**Step 2: Add the /lsp-sol WebSocket server**

After the existing `wss` definition, add a second WebSocket server on the same port but different path. Since `ws` library doesn't support multiple paths on one server natively, we need to use `noServer` mode or a second port.

Simplest approach: use the same HTTP server with path routing.

Replace the existing `const wss = new WebSocketServer(...)` and add:

```typescript
import { createServer } from 'node:http';

const httpServer = createServer();

const wss = new WebSocketServer({ noServer: true, path: '/lsp' });
const wssSolidity = new WebSocketServer({ noServer: true, path: '/lsp-sol' });

httpServer.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url!, `http://${request.headers.host}`).pathname;
  if (pathname === '/lsp') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else if (pathname === '/lsp-sol') {
    wssSolidity.handleUpgrade(request, socket, head, (ws) => {
      wssSolidity.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

httpServer.listen(PORT, () => {
  console.log(`[LSP Server] HTTP+WebSocket listening on :${PORT}`);
});
```

Remove the old `wss.on('listening', ...)` block since `httpServer.listen` handles that now.

**Step 3: Add Solidity connection handler**

```typescript
interface SolidityConnectionState {
  network: EvmNetwork;
  client: SolidityLSPClient;
  openDocs: Map<string, string>;
  docVersions: Map<string, number>;
  notificationHandler: (method: string, params: any) => void;
}

wssSolidity.on('connection', (socket: WebSocket) => {
  console.log('[Solidity LSP] Client connected');
  let state: SolidityConnectionState | null = null;

  socket.on('message', async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // Init message: { type: "init", network: "mainnet" | "testnet" }
    if (msg.type === 'init') {
      const network = (['mainnet', 'testnet'].includes(msg.network)
        ? msg.network
        : 'mainnet') as EvmNetwork;

      try {
        const client = await getSolidityClient(network);
        const connectionState: SolidityConnectionState = {
          network,
          client,
          openDocs: new Map(),
          docVersions: new Map(),
          notificationHandler: () => {},
        };

        const notificationHandler = (method: string, params: any) => {
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
          }
        };
        connectionState.notificationHandler = notificationHandler;
        client.on('notification', notificationHandler);

        state = connectionState;
        socket.send(JSON.stringify({ type: 'ready' }));
        console.log(`[Solidity LSP] Initialized for ${network}`);
      } catch (err: any) {
        console.error('[Solidity LSP] Init error:', err);
        socket.send(JSON.stringify({ type: 'error', message: err.message }));
      }
      return;
    }

    if (!state) {
      socket.send(JSON.stringify({ type: 'error', message: 'Send init message first' }));
      return;
    }

    const { client } = state;

    // Track open/changed/closed documents
    if (msg.method === 'textDocument/didOpen') {
      const uri = msg.params?.textDocument?.uri;
      if (uri) {
        state.openDocs.set(uri, msg.params.textDocument.text ?? '');
        state.docVersions.set(uri, Number(msg.params.textDocument.version ?? 1));
      }
    }
    if (msg.method === 'textDocument/didChange') {
      const uri = msg.params?.textDocument?.uri;
      const text = msg.params?.contentChanges?.[0]?.text;
      if (uri && typeof text === 'string') {
        state.openDocs.set(uri, text);
      }
    }
    if (msg.method === 'textDocument/didClose') {
      const uri = msg.params?.textDocument?.uri;
      if (uri) {
        state.openDocs.delete(uri);
        state.docVersions.delete(uri);
      }
    }

    // Intercept initialize — return cached result
    if (msg.method === 'initialize') {
      const initResult = client.getInitializeResult();
      socket.send(JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: initResult ?? { capabilities: {} },
      }));
      return;
    }
    if (msg.method === 'initialized') return;

    // Forward requests and notifications
    if ('id' in msg && msg.id !== undefined) {
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
      client.notify(msg.method, msg.params);
    }
  });

  socket.on('close', () => {
    console.log('[Solidity LSP] Client disconnected');
    if (state) {
      for (const uri of state.openDocs.keys()) {
        state.client.notify('textDocument/didClose', { textDocument: { uri } });
      }
      state.client.removeListener('notification', state.notificationHandler);
      state = null;
    }
  });
});
```

**Step 4: Update graceful shutdown**

In the existing `SIGTERM` handler, add:

```typescript
for (const client of solidityClients.values()) {
  await client.shutdown();
}
```

**Step 5: Verify build**

```bash
cd runner/server && bun run build
```

**Step 6: Commit**

```bash
git add runner/server/src/index.ts
git commit -m "feat(runner): add /lsp-sol WebSocket endpoint for Solidity LSP"
```

---

### Task 5: Generalize MonacoLspAdapter for Multi-Language Support

**Files:**
- Modify: `runner/src/editor/monacoLspAdapter.ts`

The existing `MonacoLspAdapter` is mostly language-agnostic already. Add a `languageId` parameter so it can register providers for either `cadence` or `sol`. Remove the Cadence-specific `prefetchImports` call from `openDocument`/`changeDocument` — that belongs in the hook layer.

**Step 1: Add languageId to constructor options**

In `MonacoLspAdapterOptions`, add:

```typescript
interface MonacoLspAdapterOptions {
  skipInitialize?: boolean;
  resolveDocumentContent?: (uri: string) => string | undefined;
  languageId?: string;        // default: 'cadence'
  markerOwner?: string;       // default: 'cadence-lsp'
  beforeOpen?: (code: string) => Promise<void>;   // replaces prefetchImports
  beforeChange?: (code: string) => Promise<void>;
}
```

Change `registerProviders()` to use `this.options.languageId || CADENCE_LANGUAGE_ID`.

Change `handleDiagnostics()` to use `this.options.markerOwner || 'cadence-lsp'`.

Change `openDocument()` and `changeDocument()` to use `this.options.beforeOpen` / `this.options.beforeChange` instead of calling `prefetchImports` directly.

Change `openDocument()` to use `this.options.languageId || 'cadence'` in the `languageId` field of the `textDocument/didOpen` notification.

**Step 2: Update useLsp.ts to pass beforeOpen/beforeChange**

When constructing `MonacoLspAdapter` in `useLsp.ts`:

```typescript
const adapter = new MonacoLspAdapter(bridge!, monacoInstance, {
  skipInitialize: useServerLsp,
  languageId: CADENCE_LANGUAGE_ID,
  markerOwner: 'cadence-lsp',
  beforeOpen: (code) => prefetchImports(code),
  beforeChange: (code) => prefetchImports(code),
  resolveDocumentContent: (uri: string) => { ... },
});
```

**Step 3: Verify build**

```bash
cd runner && bun run build
```

**Step 4: Commit**

```bash
git add runner/src/editor/monacoLspAdapter.ts runner/src/editor/useLsp.ts
git commit -m "refactor(runner): generalize MonacoLspAdapter for multi-language support"
```

---

### Task 6: Create useSolidityLsp Hook

**Files:**
- Create: `runner/src/editor/useSolidityLsp.ts`

Hook that connects to `/lsp-sol` WebSocket, creates a `MonacoLspAdapter` for the `sol` language. Simpler than `useLsp` since no WASM fallback or import prefetching is needed.

**Step 1: Create the hook**

```typescript
// runner/src/editor/useSolidityLsp.ts
import { useEffect, useRef, useCallback, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import { createWebSocketBridge, type LSPBridge } from './languageServer';
import { MonacoLspAdapter, type DefinitionTarget } from './monacoLspAdapter';
import type { ProjectState } from '../fs/fileSystem';

const SOLIDITY_LANGUAGE_ID = 'sol';

export function useSolidityLsp(
  monacoInstance: typeof Monaco | null,
  project: ProjectState,
  network: 'mainnet' | 'testnet'
) {
  const adapterRef = useRef<MonacoLspAdapter | null>(null);
  const initializingRef = useRef(false);
  const openDocsRef = useRef<Set<string>>(new Set());
  const [isReady, setIsReady] = useState(false);

  // Determine WebSocket URL
  const lspWsUrl = import.meta.env.VITE_SOL_LSP_WS_URL
    || (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/lsp-sol';

  // Initialize Solidity LSP when Monaco becomes available
  useEffect(() => {
    if (!monacoInstance || initializingRef.current || adapterRef.current) return;

    // Only init if there are .sol files in the project
    const hasSolFiles = project.files.some((f) => f.path.endsWith('.sol'));
    if (!hasSolFiles) return;

    initializingRef.current = true;

    (async () => {
      try {
        console.log('[Solidity LSP] Connecting...');
        const bridge = await createWebSocketBridge(lspWsUrl, network);
        console.log('[Solidity LSP] Connected');

        const adapter = new MonacoLspAdapter(bridge, monacoInstance, {
          skipInitialize: true,
          languageId: SOLIDITY_LANGUAGE_ID,
          markerOwner: 'solidity-lsp',
        });
        await adapter.initialize();

        adapterRef.current = adapter;
        setIsReady(true);
        console.log('[Solidity LSP] Ready');

        // Open existing .sol documents
        for (const file of project.files) {
          if (!file.path.endsWith('.sol')) continue;
          const uri = `file:///${file.path}`;
          adapter.openDocument(uri, file.content);
          openDocsRef.current.add(uri);
        }
      } catch (err) {
        console.error('[Solidity LSP] Failed to connect:', err);
        initializingRef.current = false;
      }
    })();
  }, [monacoInstance, network, project.files, lspWsUrl]);

  // Sync .sol documents with LSP when project files change
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;

    const currentPaths = new Set(
      project.files.filter((f) => f.path.endsWith('.sol')).map((f) => f.path)
    );

    for (const file of project.files) {
      if (!file.path.endsWith('.sol')) continue;
      const uri = `file:///${file.path}`;
      if (!openDocsRef.current.has(uri)) {
        adapter.openDocument(uri, file.content);
        openDocsRef.current.add(uri);
      }
    }

    for (const uri of openDocsRef.current) {
      const path = uri.replace('file:///', '');
      if (!currentPaths.has(path)) {
        adapter.closeDocument(uri);
        openDocsRef.current.delete(uri);
      }
    }
  }, [project.files, isReady]);

  const notifyChange = useCallback((path: string, content: string) => {
    const adapter = adapterRef.current;
    if (!adapter || !path.endsWith('.sol')) return;
    const uri = `file:///${path}`;
    if (openDocsRef.current.has(uri)) {
      adapter.changeDocument(uri, content);
    }
  }, []);

  const goToDefinition = useCallback(async (
    path: string,
    line: number,
    column: number,
  ): Promise<DefinitionTarget | null> => {
    const adapter = adapterRef.current;
    if (!adapter || !path.endsWith('.sol')) return null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const target = await adapter.findDefinition(`file:///${path}`, line, column);
      if (target) return target;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return null;
  }, []);

  return { notifyChange, goToDefinition, isReady };
}
```

**Step 2: Verify build**

```bash
cd runner && bun run build
```

**Step 3: Commit**

```bash
git add runner/src/editor/useSolidityLsp.ts
git commit -m "feat(runner): add useSolidityLsp hook for Solidity editor intelligence"
```

---

### Task 7: Make CadenceEditor Language-Aware

**Files:**
- Modify: `runner/src/editor/CadenceEditor.tsx`

Currently hardcoded to Cadence language. Make it detect `.sol` files and switch to the `sol` Monaco language. Keep all other behavior (keybindings, options) the same.

**Step 1: Add language detection**

Add a helper and update the `<Editor>` component:

```typescript
function detectLanguage(path?: string): string {
  if (path?.endsWith('.sol')) return 'sol';
  return CADENCE_LANGUAGE_ID;
}
```

Change the `<Editor>` props:

```tsx
<Editor
  language={detectLanguage(path)}
  theme={darkMode ? CADENCE_DARK_THEME : CADENCE_LIGHT_THEME}
  ...
/>
```

**Note:** The themes work for both Cadence and Solidity since Monaco's built-in `sol` tokenizer will use the same theme token colors. If needed, Solidity-specific theme tweaks can be added later.

**Step 2: Skip TextMate grammar for non-Cadence files**

In `handleBeforeMount`, the TextMate grammar is loaded for Cadence. This is fine since TextMate only overrides the Cadence language tokenizer, not Solidity.

**Step 3: Verify build**

```bash
cd runner && bun run build
```

**Step 4: Commit**

```bash
git add runner/src/editor/CadenceEditor.tsx
git commit -m "feat(runner): make editor language-aware for Solidity files"
```

---

### Task 8: Wire Solidity LSP into App.tsx

**Files:**
- Modify: `runner/src/App.tsx`

Add `useSolidityLsp` alongside `useLsp`. Route `notifyChange` and `goToDefinition` calls to the appropriate hook based on file extension.

**Step 1: Add the hook**

Import and call `useSolidityLsp`:

```typescript
import { useSolidityLsp } from './editor/useSolidityLsp';

// Inside the App component, after the existing useLsp call:
const {
  notifyChange: notifySolChange,
  goToDefinition: solGoToDefinition,
  isReady: solLspReady,
} = useSolidityLsp(monacoInstance, project, network);
```

**Step 2: Create unified notifyChange and goToDefinition**

```typescript
const handleNotifyChange = useCallback((path: string, content: string) => {
  if (path.endsWith('.sol')) {
    notifySolChange(path, content);
  } else {
    notifyChange(path, content);
  }
}, [notifyChange, notifySolChange]);

const handleGoToDefinition = useCallback(async (
  path: string, line: number, column: number
): Promise<boolean> => {
  if (path.endsWith('.sol')) {
    const target = await solGoToDefinition(path, line, column);
    // ... same navigation logic as existing Cadence handler
    return !!target;
  }
  // ... existing Cadence go-to-definition logic
}, [solGoToDefinition, /* existing deps */]);
```

Pass `handleNotifyChange` to the editor's `onChange` path.

**Step 3: Verify build**

```bash
cd runner && bun run build
```

**Step 4: Commit**

```bash
git add runner/src/App.tsx
git commit -m "feat(runner): wire Solidity LSP into main app"
```

---

### Task 9: Add Solidity Templates to File System

**Files:**
- Modify: `runner/src/fs/fileSystem.ts`

Add Solidity project templates: Simple Storage (learning), ERC-20 Token, and a Cross-VM example.

**Step 1: Add templates**

Append to the `TEMPLATES` array:

```typescript
{
  label: 'Simple Storage (Solidity)',
  description: 'Basic Solidity contract on Flow EVM',
  icon: 'box',
  files: [{
    path: 'src/SimpleStorage.sol',
    content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract SimpleStorage {
    uint256 private storedValue;

    event ValueChanged(uint256 newValue);

    function set(uint256 value) public {
        storedValue = value;
        emit ValueChanged(value);
    }

    function get() public view returns (uint256) {
        return storedValue;
    }
}
`,
    language: 'sol',
  }],
  activeFile: 'src/SimpleStorage.sol',
  folders: ['src'],
},
{
  label: 'ERC-20 Token (Solidity)',
  description: 'Standard ERC-20 token on Flow EVM',
  icon: 'coins',
  files: [{
    path: 'src/MyToken.sol',
    content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MyToken {
    string public name;
    string public symbol;
    uint8 public decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint256 _initialSupply) {
        name = _name;
        symbol = _symbol;
        totalSupply = _initialSupply * 10 ** decimals;
        balanceOf[msg.sender] = totalSupply;
        emit Transfer(address(0), msg.sender, totalSupply);
    }

    function transfer(address to, uint256 value) public returns (bool) {
        require(balanceOf[msg.sender] >= value, "Insufficient balance");
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) public returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) public returns (bool) {
        require(balanceOf[from] >= value, "Insufficient balance");
        require(allowance[from][msg.sender] >= value, "Insufficient allowance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        allowance[from][msg.sender] -= value;
        emit Transfer(from, to, value);
        return true;
    }
}
`,
    language: 'sol',
  }],
  activeFile: 'src/MyToken.sol',
  folders: ['src'],
},
```

**Step 2: Update language detection in file creation**

In `createFile()`, auto-detect language from extension:

```typescript
export function createFile(state: ProjectState, path: string, content: string): ProjectState {
  // ... existing logic ...
  const language = path.endsWith('.sol') ? 'sol' : 'cadence';
  // ... use language in new FileEntry
}
```

**Step 3: Verify build**

```bash
cd runner && bun run build
```

**Step 4: Commit**

```bash
git add runner/src/fs/fileSystem.ts
git commit -m "feat(runner): add Solidity templates and language detection"
```

---

### Task 10: Add File Type Icons to FileExplorer

**Files:**
- Modify: `runner/src/components/FileExplorer.tsx`

Show different icons for `.sol` vs `.cdc` files.

**Step 1: Add Solidity icon differentiation**

Find where file icons are rendered and add:

```typescript
function getFileIcon(path: string): string {
  if (path.endsWith('.sol')) return '◆'; // or use a Lucide icon
  if (path.endsWith('.cdc')) return '◇';
  return '📄';
}
```

Or if using Lucide icons, use different icons/colors:
- `.cdc` files: green accent (existing)
- `.sol` files: blue/purple accent

**Step 2: Verify build**

```bash
cd runner && bun run build
```

**Step 3: Commit**

```bash
git add runner/src/components/FileExplorer.tsx
git commit -m "feat(runner): add file type icons for Solidity files"
```

---

### Task 11: Update nginx.conf for /lsp-sol Proxy

**Files:**
- Modify: `runner/nginx.conf`

Add WebSocket proxy for the new `/lsp-sol` endpoint.

**Step 1: Add location block**

Find the existing `/lsp` location block and add a similar one for `/lsp-sol`:

```nginx
location /lsp-sol {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 86400;
}
```

**Step 2: Commit**

```bash
git add runner/nginx.conf
git commit -m "feat(runner): add nginx proxy for /lsp-sol WebSocket endpoint"
```

---

### Task 12: Update Dockerfile for Solidity LSP

**Files:**
- Modify: `runner/Dockerfile`

The server-builder stage already installs server dependencies. Since `@nomicfoundation/solidity-language-server` is now in `runner/server/package.json`, it will be installed automatically. But we need to ensure the native binaries are available in the runtime stage.

**Step 1: Update runtime to copy server node_modules**

The existing Dockerfile already copies `node_modules` from server-builder:
```dockerfile
COPY --from=server-builder /app/server/node_modules /app/server/node_modules
```

This should include the Solidity LSP and its native binaries. However, we may need to ensure glibc compatibility for the native slang binaries.

**Step 2: Verify the alpine runtime has necessary libs**

The existing Dockerfile already installs `gcompat libc6-compat`. This should be sufficient for the native binaries. If not, we may need to switch to a non-alpine base or add specific libs.

**Step 3: Commit**

```bash
git add runner/Dockerfile
git commit -m "chore(runner): ensure Dockerfile supports Solidity LSP native binaries"
```

---

### Task 13: Integration Test — End-to-End Verification

**Step 1: Start the server locally**

```bash
cd runner/server && bun run build && node dist/index.js
```

Expected: logs showing both Cadence and Solidity LSP servers starting.

**Step 2: Test Solidity LSP via WebSocket**

Use `wscat` or a simple script to connect to `/lsp-sol`:

```bash
# Install wscat if needed
bun add -g wscat

# Connect and send init
wscat -c ws://localhost:3001/lsp-sol
> {"type":"init","network":"mainnet"}
```

Expected: `{"type":"ready"}` response.

**Step 3: Start the full runner dev server**

```bash
cd runner && bun run dev
```

**Step 4: Test in browser**

1. Open the runner at `http://localhost:5177`
2. Create a new file `Storage.sol` via AI or file explorer
3. Type Solidity code — verify syntax highlighting works
4. Verify diagnostics appear (red squiggles for errors)
5. Verify autocomplete triggers on `.` or typing keywords

**Step 5: Verify runner build**

```bash
cd runner && bun run build
```

Expected: no errors.

---

## Future Phases (Not in this plan)

### Phase 2: Compile + Deploy
- `POST /compile-sol` server endpoint using `solc-js`
- EVM wallet connection (MetaMask via ethers.js)
- Contract deployment to Flow EVM
- Deployment results in ResultPanel

### Phase 3: Interaction + Cross-VM
- ABI-based contract interaction UI
- Read/write function calls
- Cross-VM templates (Cadence ↔ EVM)
- AI assistant Solidity/EVM knowledge updates

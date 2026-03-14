# Solidity & Flow EVM Support — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Solidity editing, compilation, and EVM deployment to the Cadence Runner, making it a dual-language IDE for Flow.

**Architecture:** Server-side Solidity LSP (Rust binary via stdio) mirrors existing Cadence LSP pattern. Client-side solc WASM for compilation. wagmi + viem for EVM wallet. Local key manager extended for EOA.

**Tech Stack:** solidity-language-server (Rust), solc-js (WASM), wagmi, viem, @tanstack/react-query

---

## Chunk 1: Server-side Solidity LSP + nginx

### Task 1: SolidityLspClient

**Files:**
- Create: `runner/server/src/solidityLspClient.ts`

This mirrors `runner/server/src/lspClient.ts` (CadenceLSPClient) but spawns `solidity-language-server --stdio` instead of `flow cadence language-server`.

- [ ] **Step 1: Create SolidityLspClient class**

```typescript
// runner/server/src/solidityLspClient.ts
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface SolidityLSPClientOptions {
  command?: string;
  cwd?: string;
}

export class SolidityLSPClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private pendingRequests = new Map<number, PendingRequest>();
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private initResult: any = null;
  private command: string;
  private cwd?: string;

  constructor(opts: SolidityLSPClientOptions = {}) {
    super();
    this.command = opts.command ?? 'solidity-language-server';
    this.cwd = opts.cwd;
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._initialize();
    return this.initPromise;
  }

  private async _initialize(): Promise<void> {
    this.process = spawn(this.command, ['--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(this.cwd ? { cwd: this.cwd } : {}),
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      console.error(`[Solidity LSP stderr] ${data.toString().trim()}`);
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, data]);
      this.processBuffer();
    });

    this.process.on('exit', (code) => {
      console.log(`[Solidity LSP] Process exited with code ${code}`);
      this.initialized = false;
    });

    // Send initialize request
    const result = await this.request('initialize', {
      processId: process.pid,
      capabilities: {
        textDocument: {
          completion: { completionItem: { snippetSupport: true } },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          signatureHelp: { signatureInformation: { documentationFormat: ['markdown'] } },
          publishDiagnostics: { relatedInformation: true },
        },
      },
      rootUri: this.cwd ? `file://${this.cwd}` : 'file:///',
    });

    this.initResult = result;
    this.notify('initialized', {});
    this.initialized = true;
  }

  getInitializeResult(): any {
    return this.initResult;
  }

  request(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Solidity LSP request ${method} timed out`));
      }, 10000);
      this.pendingRequests.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params: any): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  private send(msg: any): void {
    if (!this.process?.stdin?.writable) return;
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    this.process.stdin.write(header + body);
  }

  private processBuffer(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = this.buffer.subarray(0, headerEnd).toString();
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) { this.buffer = this.buffer.subarray(headerEnd + 4); continue; }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + contentLength) break;

      const body = this.buffer.subarray(bodyStart, bodyStart + contentLength).toString();
      this.buffer = this.buffer.subarray(bodyStart + contentLength);

      try {
        const msg = JSON.parse(body);
        if ('id' in msg && (msg.result !== undefined || msg.error !== undefined)) {
          const pending = this.pendingRequests.get(msg.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(msg.id);
            if (msg.error) pending.reject(msg.error);
            else pending.resolve(msg.result);
          }
        } else if ('method' in msg) {
          this.emit('notification', msg.method, msg.params);
        }
      } catch { /* ignore parse errors */ }
    }
  }

  async shutdown(): Promise<void> {
    if (!this.process) return;
    try {
      await this.request('shutdown', null);
      this.notify('exit', null);
    } catch { /* ignore */ }
    this.process.kill();
    this.process = null;
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd runner/server && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add runner/server/src/solidityLspClient.ts
git commit -m "feat(runner): add SolidityLSPClient for server-side Solidity LSP"
```

### Task 2: Add /lsp-sol WebSocket handler to server

**Files:**
- Modify: `runner/server/src/index.ts`

Add a second WebSocketServer on a new port (3004) for Solidity LSP connections. Much simpler than Cadence — no import rewriting, no dependency resolution. Just forward JSON-RPC between WebSocket and the Solidity LSP process.

- [ ] **Step 1: Add Solidity LSP imports and state at the top of index.ts**

After line 8 (`import { app as httpApp } from './http.js';`), add:

```typescript
import { SolidityLSPClient } from './solidityLspClient.js';
```

After line 13 (`const FLOW_COMMAND = ...`), add:

```typescript
const SOL_LSP_PORT = parseInt(process.env.SOL_LSP_PORT || '3004', 10);
const SOL_LSP_COMMAND = process.env.SOL_LSP_COMMAND || 'solidity-language-server';
```

After line 17 (`const workspaces = ...`), add:

```typescript
// One Solidity LSP client (no per-network separation needed)
let solClient: SolidityLSPClient | null = null;

async function getSolClient(): Promise<SolidityLSPClient> {
  if (solClient) return solClient;
  solClient = new SolidityLSPClient({ command: SOL_LSP_COMMAND });
  await solClient.ensureInitialized();
  return solClient;
}
```

- [ ] **Step 2: Add /lsp-sol WebSocket server after the existing wss setup (after line 404)**

After the HTTP server setup block, add:

```typescript
// Solidity LSP WebSocket server
const solWss = new WebSocketServer({ port: SOL_LSP_PORT, path: '/lsp-sol' });

solWss.on('listening', () => {
  console.log(`[Solidity LSP] WebSocket listening on :${SOL_LSP_PORT}/lsp-sol`);
});

interface SolConnectionState {
  client: SolidityLSPClient;
  openDocs: Map<string, string>;
  docVersions: Map<string, number>;
  notificationHandler: (method: string, params: any) => void;
}

solWss.on('connection', (socket: WebSocket) => {
  console.log('[Solidity LSP] Client connected');
  let state: SolConnectionState | null = null;

  socket.on('message', async (raw) => {
    let msg: any;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    // Init message
    if (msg.type === 'init') {
      try {
        const client = await getSolClient();
        const connectionState: SolConnectionState = {
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
        console.log('[Solidity LSP] Initialized');
      } catch (err: any) {
        socket.send(JSON.stringify({ type: 'error', message: err.message }));
      }
      return;
    }

    if (!state) {
      socket.send(JSON.stringify({ type: 'error', message: 'Send init message first' }));
      return;
    }

    const { client } = state;

    // Track open docs
    if (msg.method === 'textDocument/didOpen') {
      const uri = msg.params?.textDocument?.uri;
      if (uri) {
        state.openDocs.set(uri, msg.params?.textDocument?.text ?? '');
        state.docVersions.set(uri, Number(msg.params?.textDocument?.version ?? 1));
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
      if (uri) { state.openDocs.delete(uri); state.docVersions.delete(uri); }
    }

    // initialize → return cached result
    if (msg.method === 'initialize') {
      socket.send(JSON.stringify({
        jsonrpc: '2.0', id: msg.id,
        result: client.getInitializeResult() ?? { capabilities: {} },
      }));
      return;
    }
    if (msg.method === 'initialized') return;

    // Forward requests
    if ('id' in msg && msg.id !== undefined) {
      try {
        const result = await client.request(msg.method, msg.params);
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
      } catch (err: any) {
        socket.send(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
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

- [ ] **Step 3: Add Solidity LSP to graceful shutdown (modify the existing SIGTERM handler)**

In the existing `process.on('SIGTERM', ...)` handler, add before `process.exit(0)`:

```typescript
if (solClient) await solClient.shutdown();
solWss.close();
```

- [ ] **Step 4: Verify it compiles**

Run: `cd runner/server && npx tsc --noEmit`

- [ ] **Step 5: Commit**

```bash
git add runner/server/src/index.ts
git commit -m "feat(runner): add /lsp-sol WebSocket endpoint for Solidity LSP"
```

### Task 3: Add nginx proxy for /lsp-sol

**Files:**
- Modify: `runner/nginx.conf`

- [ ] **Step 1: Add /lsp-sol location block after the existing /lsp block (line 15)**

```nginx
    location /lsp-sol {
        proxy_pass http://127.0.0.1:3004;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
```

- [ ] **Step 2: Commit**

```bash
git add runner/nginx.conf
git commit -m "feat(runner): add nginx proxy for /lsp-sol WebSocket"
```

### Task 4: Add solidity-language-server to Dockerfile

**Files:**
- Modify: `runner/Dockerfile`

- [ ] **Step 1: After the Flow CLI install block (line 57), add Solidity LSP binary download**

```dockerfile
# Install Solidity Language Server (Rust binary)
RUN SOL_LSP_VERSION=v0.1.32 \
    && wget -qO /tmp/sol-lsp.tar.gz \
    "https://github.com/mmsaki/solidity-language-server/releases/download/${SOL_LSP_VERSION}/solidity-language-server-x86_64-unknown-linux-gnu.tar.gz" \
    && tar -xzf /tmp/sol-lsp.tar.gz -C /usr/local/bin/ \
    && chmod +x /usr/local/bin/solidity-language-server \
    && rm -f /tmp/sol-lsp.tar.gz
```

- [ ] **Step 2: Update EXPOSE to include port 3004**

Change `EXPOSE 80 3003` to `EXPOSE 80 3003 3004`

- [ ] **Step 3: Commit**

```bash
git add runner/Dockerfile
git commit -m "feat(runner): add solidity-language-server to Docker image"
```

---

## Chunk 2: Frontend — Editor Multi-language Support

### Task 5: Add useSolidityLsp hook

**Files:**
- Create: `runner/src/editor/useSolidityLsp.ts`

Simplified version of `useLsp.ts` — connects to `/lsp-sol` WebSocket, no WASM mode, no dependency prefetching.

- [ ] **Step 1: Create the hook**

```typescript
// runner/src/editor/useSolidityLsp.ts
import { useEffect, useRef, useCallback, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import { createWebSocketBridge, type LSPBridge } from './languageServer';
import { MonacoLspAdapter, type DefinitionTarget } from './monacoLspAdapter';
import type { ProjectState } from '../fs/fileSystem';

/**
 * Hook that manages the Solidity LSP lifecycle.
 * Server-side only (no WASM fallback) — connects to /lsp-sol WebSocket.
 */
export function useSolidityLsp(
  monacoInstance: typeof Monaco | null,
  project: ProjectState,
  enabled: boolean,
) {
  const adapterRef = useRef<MonacoLspAdapter | null>(null);
  const initializingRef = useRef(false);
  const openDocsRef = useRef<Set<string>>(new Set());
  const [isReady, setIsReady] = useState(false);
  const [lspError, setLspError] = useState(false);

  const lspWsUrl = import.meta.env.VITE_SOL_LSP_WS_URL
    || (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/lsp-sol';

  const teardown = useCallback(() => {
    const adapter = adapterRef.current;
    if (adapter) {
      for (const uri of openDocsRef.current) {
        adapter.closeDocument(uri);
      }
      openDocsRef.current.clear();
      adapter.dispose();
      adapterRef.current = null;
    }
    initializingRef.current = false;
    setIsReady(false);
  }, []);

  useEffect(() => {
    if (!monacoInstance || !enabled) {
      teardown();
      return;
    }
    if (initializingRef.current || adapterRef.current) return;
    initializingRef.current = true;
    setLspError(false);

    (async () => {
      try {
        const bridge = await createWebSocketBridge(lspWsUrl, 'mainnet');
        const adapter = new MonacoLspAdapter(bridge, monacoInstance, {
          skipInitialize: true,
          languageId: 'sol',
        });
        await adapter.initialize();
        adapterRef.current = adapter;
        setIsReady(true);

        // Open existing .sol files
        for (const file of project.files) {
          if (!file.path.endsWith('.sol')) continue;
          const uri = `file:///${file.path}`;
          adapter.openDocument(uri, file.content);
          openDocsRef.current.add(uri);
        }
      } catch (err) {
        console.error('[Solidity LSP] Failed:', err);
        initializingRef.current = false;
        setLspError(true);
      }
    })();

    return teardown;
  }, [monacoInstance, enabled, lspWsUrl, teardown, project.files]);

  // Sync .sol documents
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;

    const solFiles = project.files.filter(f => f.path.endsWith('.sol'));
    const currentPaths = new Set(solFiles.map(f => f.path));

    for (const file of solFiles) {
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
    if (!adapter) return;
    const uri = `file:///${path}`;
    if (openDocsRef.current.has(uri)) {
      adapter.changeDocument(uri, content);
    }
  }, []);

  const goToDefinition = useCallback(async (
    path: string, line: number, column: number,
  ): Promise<DefinitionTarget | null> => {
    const adapter = adapterRef.current;
    if (!adapter) return null;
    return adapter.findDefinition(`file:///${path}`, line, column);
  }, []);

  return { notifyChange, goToDefinition, isReady, lspError };
}
```

- [ ] **Step 2: Commit**

```bash
git add runner/src/editor/useSolidityLsp.ts
git commit -m "feat(runner): add useSolidityLsp hook"
```

### Task 6: Parameterize MonacoLspAdapter for multi-language

**Files:**
- Modify: `runner/src/editor/monacoLspAdapter.ts`

The adapter is already mostly language-agnostic. We need to:
1. Accept `languageId` in options (defaults to `'cadence'` for backward compat)
2. Use it when registering providers and setting markers

- [ ] **Step 1: Add languageId to MonacoLspAdapterOptions**

In the `MonacoLspAdapterOptions` interface (line 51), add:

```typescript
languageId?: string;
```

- [ ] **Step 2: Replace hardcoded CADENCE_LANGUAGE_ID in registerProviders**

In `registerProviders()` (line 494), replace the 4 hardcoded `CADENCE_LANGUAGE_ID` references with `this.languageId`:

Add a field to the class (after line 234):
```typescript
private languageId: string;
```

In constructor (after line 240):
```typescript
this.languageId = options.languageId || CADENCE_LANGUAGE_ID;
```

Replace in `registerProviders()`:
- Line 500: `m.languages.registerCompletionItemProvider(CADENCE_LANGUAGE_ID,` → `m.languages.registerCompletionItemProvider(this.languageId,`
- Line 546: `m.languages.registerHoverProvider(CADENCE_LANGUAGE_ID,` → `m.languages.registerHoverProvider(this.languageId,`
- Line 590: `m.languages.registerDefinitionProvider(CADENCE_LANGUAGE_ID,` → `m.languages.registerDefinitionProvider(this.languageId,`
- Line 597: `m.languages.registerSignatureHelpProvider(CADENCE_LANGUAGE_ID,` → `m.languages.registerSignatureHelpProvider(this.languageId,`

Replace in `handleDiagnostics()`:
- Line 285: `this.monaco.editor.setModelMarkers(model, 'cadence-lsp', markers)` → `this.monaco.editor.setModelMarkers(model, \`\${this.languageId}-lsp\`, markers)`

Replace in `openDocument()`:
- Line 638: `languageId: 'cadence',` → `languageId: this.languageId,`

- [ ] **Step 3: Verify it compiles**

Run: `cd runner && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add runner/src/editor/monacoLspAdapter.ts
git commit -m "refactor(runner): parameterize MonacoLspAdapter language ID for multi-language support"
```

### Task 7: Make CadenceEditor language-aware

**Files:**
- Modify: `runner/src/editor/CadenceEditor.tsx`

When the `path` prop ends with `.sol`, use Monaco's built-in `sol` language ID instead of the Cadence language. The editor component name stays the same (it's the only editor component).

- [ ] **Step 1: Detect language from file path and switch language/theme**

At the top of the component function (after line 24), add:

```typescript
const isSolidity = path?.endsWith('.sol') ?? false;
const language = isSolidity ? 'sol' : CADENCE_LANGUAGE_ID;
const theme = isSolidity
  ? (darkMode ? 'vs-dark' : 'vs')
  : (darkMode ? CADENCE_DARK_THEME : CADENCE_LIGHT_THEME);
```

Then update the `<Editor>` JSX (line 107-108):
- `language={CADENCE_LANGUAGE_ID}` → `language={language}`
- `theme={darkMode ? CADENCE_DARK_THEME : CADENCE_LIGHT_THEME}` → `theme={theme}`

Also skip Cadence-specific initialization for Solidity files. In `handleBeforeMount` (line 35), wrap the Cadence registration:

```typescript
const handleBeforeMount: BeforeMount = useCallback((monaco) => {
  monacoRef.current = monaco;
  if (!isSolidity) {
    registerCadenceLanguage(monaco);
    registerCadenceThemes(monaco);
    activateCadenceTextmate(monaco).then(() => setTmReady(true)).catch(console.error);
  }
  onMonacoReady?.(monaco);
}, [onMonacoReady, isSolidity]);
```

- [ ] **Step 2: Commit**

```bash
git add runner/src/editor/CadenceEditor.tsx
git commit -m "feat(runner): make editor language-aware for .sol files"
```

### Task 8: Add Solidity templates and file type detection

**Files:**
- Modify: `runner/src/fs/fileSystem.ts`

- [ ] **Step 1: Add Solidity templates to the TEMPLATES array (after line 337)**

```typescript
  {
    label: 'Simple Storage (Solidity)',
    description: 'Basic getter/setter contract on Flow EVM',
    icon: 'box',
    files: [{
      path: 'SimpleStorage.sol',
      content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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
    activeFile: 'SimpleStorage.sol',
  },
  {
    label: 'ERC-20 Token (Solidity)',
    description: 'Minimal fungible token on Flow EVM',
    icon: 'coins',
    files: [{
      path: 'MyToken.sol',
      content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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

    function transfer(address to, uint256 amount) public returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) public returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        emit Transfer(from, to, amount);
        return true;
    }
}
`,
      language: 'sol',
    }],
    activeFile: 'MyToken.sol',
  },
  {
    label: 'Cross-VM (Cadence ↔ EVM)',
    description: 'Call a Solidity contract from Cadence via EVM.run()',
    icon: 'arrow-left-right',
    files: [
      {
        path: 'Counter.sol',
        content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Counter {
    uint256 public count;

    function increment() public {
        count += 1;
    }

    function getCount() public view returns (uint256) {
        return count;
    }
}
`,
        language: 'sol',
      },
      {
        path: 'call_evm.cdc',
        content: `import EVM from 0xe467b9dd11fa00df

/// Call a deployed Solidity contract's getCount() function.
/// Replace the address below with your deployed Counter address.
access(all) fun main(evmContractHex: String): UInt256 {
    let contractAddr = EVM.addressFromString(evmContractHex)

    // getCount() selector = keccak256("getCount()")[:4] = 0xa87d942c
    let calldata: [UInt8] = [0xa8, 0x7d, 0x94, 0x2c]

    let result = EVM.run(
        tx: nil,
        coinbase: contractAddr,
        callData: calldata
    )

    // Decode uint256 from result (32 bytes, big-endian)
    var value: UInt256 = 0
    for byte in result.data {
        value = value << 8 + UInt256(byte)
    }
    return value
}
`,
      },
    ],
    activeFile: 'Counter.sol',
    folders: [],
  },
```

- [ ] **Step 2: Update InlineFolderInput to support .sol extension**

In `runner/src/components/FileExplorer.tsx`, the `InlineFolderInput` component (line 101-102) auto-appends `.cdc`. Update to support both:

```typescript
// Change line 102-103:
const path = name.endsWith('.cdc') || name.endsWith('.sol') ? name : `${name}.cdc`;
```

Also update line 113-114 (the onBlur handler) the same way.

And update the `handleCreate` in `FileExplorer` (line 342):
```typescript
const path = name.endsWith('.cdc') || name.endsWith('.sol') ? name : `${name}.cdc`;
```

Update the placeholder on line 120:
```
placeholder="filename.cdc or .sol"
```

And line 404:
```
placeholder={createMode === 'folder' ? 'folder/name' : 'filename.cdc or .sol'}
```

- [ ] **Step 3: Add .sol file icon in FileExplorer TreeItem**

In `FileExplorer.tsx` line 277-281, update the file icon logic:

```typescript
{node.name.endsWith('.cdc') ? (
  <CadenceIcon className="w-3.5 h-3.5 shrink-0" />
) : node.name.endsWith('.sol') ? (
  <File className="w-3.5 h-3.5 shrink-0 text-blue-400" />
) : (
  <File className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
)}
```

- [ ] **Step 4: Commit**

```bash
git add runner/src/fs/fileSystem.ts runner/src/components/FileExplorer.tsx
git commit -m "feat(runner): add Solidity templates and .sol file support"
```

---

## Chunk 3: wagmi + viem + EVM Wallet

### Task 9: Add Flow EVM chain definitions and wagmi config

**Files:**
- Create: `runner/src/flow/evmChains.ts`
- Create: `runner/src/flow/wagmiConfig.ts`

- [ ] **Step 1: Install dependencies**

Run: `cd runner && bun add wagmi viem @tanstack/react-query`

- [ ] **Step 2: Create Flow EVM chain definitions**

```typescript
// runner/src/flow/evmChains.ts
import { defineChain } from 'viem';

export const flowEvmMainnet = defineChain({
  id: 747,
  name: 'Flow EVM',
  nativeCurrency: { name: 'FLOW', symbol: 'FLOW', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://mainnet.evm.nodes.onflow.org'] },
  },
  blockExplorers: {
    default: { name: 'FlowDiver', url: 'https://evm.flowdiver.io' },
  },
});

export const flowEvmTestnet = defineChain({
  id: 545,
  name: 'Flow EVM Testnet',
  nativeCurrency: { name: 'FLOW', symbol: 'FLOW', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet.evm.nodes.onflow.org'] },
  },
  blockExplorers: {
    default: { name: 'FlowDiver', url: 'https://evm-testnet.flowdiver.io' },
  },
  testnet: true,
});
```

- [ ] **Step 3: Create wagmi config**

```typescript
// runner/src/flow/wagmiConfig.ts
import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { flowEvmMainnet, flowEvmTestnet } from './evmChains';

export const wagmiConfig = createConfig({
  chains: [flowEvmMainnet, flowEvmTestnet],
  connectors: [injected()],
  transports: {
    [flowEvmMainnet.id]: http(),
    [flowEvmTestnet.id]: http(),
  },
});
```

- [ ] **Step 4: Commit**

```bash
git add runner/src/flow/evmChains.ts runner/src/flow/wagmiConfig.ts runner/package.json runner/bun.lock
git commit -m "feat(runner): add Flow EVM chain definitions and wagmi config"
```

### Task 10: Wrap App with wagmi + react-query providers

**Files:**
- Modify: `runner/src/App.tsx` (imports + provider wrapping)
- Modify: `runner/src/main.tsx` (or wherever App is mounted)

- [ ] **Step 1: Check entry point**

Run: `cat runner/src/main.tsx` to find where `<App />` is rendered.

- [ ] **Step 2: Add WagmiProvider and QueryClientProvider in main.tsx (or App.tsx top-level)**

Add imports and wrap `<App />`:

```typescript
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from './flow/wagmiConfig';

const queryClient = new QueryClient();

// Wrap App:
<QueryClientProvider client={queryClient}>
  <WagmiProvider config={wagmiConfig}>
    <App />
  </WagmiProvider>
</QueryClientProvider>
```

- [ ] **Step 3: Commit**

```bash
git add runner/src/main.tsx
git commit -m "feat(runner): wrap app with WagmiProvider for EVM wallet support"
```

### Task 11: Update WalletButton for dual wallet (Flow + EVM)

**Files:**
- Modify: `runner/src/components/WalletButton.tsx`

Add EVM wallet display alongside existing Flow wallet. Show context-aware wallet based on active file type.

- [ ] **Step 1: Add EVM wallet imports and state**

```typescript
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { flowEvmMainnet, flowEvmTestnet } from '../flow/evmChains';
```

Add `activeFileLanguage` prop to WalletButtonProps:

```typescript
activeFileLanguage?: 'cadence' | 'sol';
```

- [ ] **Step 2: Add EVM wallet hooks inside the component**

```typescript
const { address: evmAddress, isConnected: evmConnected } = useAccount();
const { connect: connectEvm } = useConnect();
const { disconnect: disconnectEvm } = useDisconnect();
const { switchChain } = useSwitchChain();

const isSolidity = activeFileLanguage === 'sol';
```

- [ ] **Step 3: Add EVM connect option to the dropdown**

After the existing "FCL Wallet" button in the not-connected dropdown, add:

```typescript
<button
  onClick={() => {
    connectEvm({ connector: injected() });
    setOpen(false);
  }}
  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-700 transition-colors"
>
  <Globe className="w-3.5 h-3.5 text-orange-400" />
  EVM Wallet
</button>
```

Import `Globe` from lucide-react.

- [ ] **Step 4: Show EVM address when connected and Solidity file is active**

When `evmConnected && isSolidity`, show the EVM address with orange accent instead of emerald:

```typescript
if (evmConnected && isSolidity) {
  const truncatedEvm = evmAddress
    ? `${evmAddress.slice(0, 6)}...${evmAddress.slice(-4)}`
    : '';
  return (
    <button
      onClick={() => onViewAccount?.(evmAddress!)}
      className="flex items-center gap-1.5 text-xs text-orange-400 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded px-2 py-1 transition-colors"
    >
      <Avatar size={16} name={evmAddress!} variant="beam" colors={colorsFromAddress(evmAddress!)} />
      <span className="font-mono">{truncatedEvm}</span>
    </button>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add runner/src/components/WalletButton.tsx
git commit -m "feat(runner): add EVM wallet support to WalletButton"
```

### Task 12: Wire EVM chain switching to network selector

**Files:**
- Modify: `runner/src/App.tsx` (network change handler)

- [ ] **Step 1: Import EVM chain config and useSwitchChain**

```typescript
import { useSwitchChain } from 'wagmi';
import { flowEvmMainnet, flowEvmTestnet } from './flow/evmChains';
```

- [ ] **Step 2: Sync EVM chain when Flow network changes**

Where the network is changed (find the network toggle handler), add:

```typescript
const { switchChain } = useSwitchChain();

// After setting network state:
const evmChainId = newNetwork === 'mainnet' ? flowEvmMainnet.id : flowEvmTestnet.id;
switchChain?.({ chainId: evmChainId });
```

- [ ] **Step 3: Pass activeFileLanguage to WalletButton**

Determine language from active file:
```typescript
const activeFileLanguage = project.activeFile.endsWith('.sol') ? 'sol' : 'cadence';
```

Pass to WalletButton: `activeFileLanguage={activeFileLanguage}`

- [ ] **Step 4: Commit**

```bash
git add runner/src/App.tsx
git commit -m "feat(runner): sync EVM chain with Flow network selector"
```

---

## Chunk 4: Client-side Compilation + Deployment

### Task 13: Add solc WASM compilation module

**Files:**
- Create: `runner/src/flow/evmExecute.ts`

- [ ] **Step 1: Install solc**

Run: `cd runner && bun add solc`

- [ ] **Step 2: Create the compilation module**

```typescript
// runner/src/flow/evmExecute.ts
import type { Abi } from 'viem';

interface CompilationResult {
  success: boolean;
  contracts: Array<{
    name: string;
    abi: Abi;
    bytecode: `0x${string}`;
  }>;
  errors: string[];
  warnings: string[];
}

export async function compileSolidity(source: string, fileName = 'Contract.sol'): Promise<CompilationResult> {
  // Dynamic import to avoid loading solc WASM on startup
  const solc = await import('solc');

  const input = {
    language: 'Solidity',
    sources: {
      [fileName]: { content: source },
    },
    settings: {
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object'],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors: string[] = [];
  const warnings: string[] = [];

  if (output.errors) {
    for (const err of output.errors) {
      if (err.severity === 'error') errors.push(err.formattedMessage || err.message);
      else warnings.push(err.formattedMessage || err.message);
    }
  }

  if (errors.length > 0 || !output.contracts) {
    return { success: false, contracts: [], errors, warnings };
  }

  const contracts: CompilationResult['contracts'] = [];
  const fileContracts = output.contracts[fileName];
  if (fileContracts) {
    for (const [name, contract] of Object.entries(fileContracts) as [string, any][]) {
      contracts.push({
        name,
        abi: contract.abi,
        bytecode: `0x${contract.evm.bytecode.object}`,
      });
    }
  }

  return { success: true, contracts, errors, warnings };
}
```

- [ ] **Step 3: Commit**

```bash
git add runner/src/flow/evmExecute.ts runner/package.json runner/bun.lock
git commit -m "feat(runner): add client-side Solidity compilation via solc WASM"
```

### Task 14: Add Solidity run/deploy logic to App.tsx

**Files:**
- Modify: `runner/src/App.tsx`

- [ ] **Step 1: Import compilation module and wagmi hooks**

```typescript
import { compileSolidity } from './flow/evmExecute';
import { useAccount, useWalletClient } from 'wagmi';
import { deployContract } from 'viem';
```

- [ ] **Step 2: Detect file language for run button**

Near the `codeType` detection, add:

```typescript
const isSolidityFile = project.activeFile.endsWith('.sol');
```

- [ ] **Step 3: Add Solidity compile/deploy handler**

Create `handleRunSolidity` alongside `handleRunDirect`:

```typescript
const handleRunSolidity = useCallback(async () => {
  if (loading) return;
  setLoading(true);
  setResult(null);

  try {
    const compilation = await compileSolidity(activeCode, project.activeFile);

    if (!compilation.success) {
      setResult({
        type: 'error',
        data: compilation.errors.join('\n'),
      });
      return;
    }

    if (compilation.warnings.length > 0) {
      console.warn('[Solidity]', compilation.warnings.join('\n'));
    }

    const contract = compilation.contracts[0];
    if (!contract) {
      setResult({ type: 'error', data: 'No contracts found in source' });
      return;
    }

    setResult({
      type: 'success',
      data: JSON.stringify({
        compiled: true,
        contractName: contract.name,
        abi: contract.abi,
        bytecodeLength: contract.bytecode.length,
      }, null, 2),
    });

    // TODO: If wallet connected, deploy via viem
  } catch (err: any) {
    setResult({ type: 'error', data: err.message });
  } finally {
    setLoading(false);
  }
}, [activeCode, loading, project.activeFile]);
```

- [ ] **Step 4: Route handleRun based on file type**

Modify `handleRun` to check file type first:

```typescript
// At the top of handleRun:
if (isSolidityFile) {
  handleRunSolidity();
  return;
}
// ... existing Cadence logic
```

- [ ] **Step 5: Update run button label/color for Solidity**

Where the run button is rendered (around line 1607), make it context-aware:

```typescript
const runButtonLabel = isSolidityFile
  ? (evmConnected ? 'Compile & Deploy' : 'Compile')
  : (loading ? 'Running...' : 'Run');

const runButtonColor = isSolidityFile
  ? 'bg-orange-600 hover:bg-orange-500'
  : 'bg-emerald-600 hover:bg-emerald-500';
```

- [ ] **Step 6: Commit**

```bash
git add runner/src/App.tsx
git commit -m "feat(runner): add context-aware Solidity compile/deploy flow"
```

### Task 15: Wire Solidity LSP into App

**Files:**
- Modify: `runner/src/App.tsx`

- [ ] **Step 1: Import and initialize Solidity LSP**

```typescript
import { useSolidityLsp } from './editor/useSolidityLsp';
```

In the App component, after the existing `useLsp` call:

```typescript
const hasSolFiles = project.files.some(f => f.path.endsWith('.sol'));
const {
  notifyChange: notifySolChange,
  goToDefinition: goToSolDefinition,
  isReady: solLspReady,
} = useSolidityLsp(monacoInstance, project, hasSolFiles);
```

- [ ] **Step 2: Route LSP notifications based on file type**

Where `notifyChange` is called (content change handler), route by extension:

```typescript
const handleContentChange = useCallback((path: string, content: string) => {
  if (path.endsWith('.sol')) {
    notifySolChange(path, content);
  } else {
    notifyChange(path, content);
  }
}, [notifyChange, notifySolChange]);
```

Similarly for goToDefinition:

```typescript
const handleGoToDefinition = useCallback(async (path: string, line: number, col: number) => {
  if (path.endsWith('.sol')) {
    return goToSolDefinition(path, line, col);
  }
  return goToDefinition(path, line, col);
}, [goToDefinition, goToSolDefinition]);
```

- [ ] **Step 3: Commit**

```bash
git add runner/src/App.tsx
git commit -m "feat(runner): wire Solidity LSP into main app"
```

---

## Chunk 5: Local Key EOA Support

### Task 16: Extend localKeyManager for EVM EOA

**Files:**
- Modify: `runner/src/auth/localKeyManager.ts`

The local key already stores `publicKeySecp256k1`. For EVM EOA, we need to derive an Ethereum address from the secp256k1 public key.

- [ ] **Step 1: Add evmAddressFromPublicKey function**

```typescript
/**
 * Derive EVM address from secp256k1 public key.
 * EVM address = last 20 bytes of keccak256(uncompressed pubkey without 04 prefix).
 */
export function evmAddressFromSecp256k1(publicKeyHex: string): string {
  // This requires keccak256 — use viem's utility
  // Import at top: import { keccak256, toHex } from 'viem';
  const pubBytes = hexToBytes(publicKeyHex);
  const hash = keccak256(toHex(pubBytes));
  return `0x${hash.slice(-40)}`;
}
```

Note: This needs `keccak256` from viem. Add the import at the top of the file.

- [ ] **Step 2: Export helper to get EVM address from a LocalKey**

```typescript
export function getEvmAddress(key: LocalKey): string {
  return evmAddressFromSecp256k1(key.publicKeySecp256k1);
}
```

- [ ] **Step 3: Commit**

```bash
git add runner/src/auth/localKeyManager.ts
git commit -m "feat(runner): add EVM EOA address derivation to local key manager"
```

### Task 17: Final integration — build test

- [ ] **Step 1: Run TypeScript check**

Run: `cd runner && npx tsc --noEmit`
Fix any type errors.

- [ ] **Step 2: Run build**

Run: `cd runner && bun run build`
Fix any build errors.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(runner): resolve build errors for Solidity EVM support"
```

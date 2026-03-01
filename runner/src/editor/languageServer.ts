import { CadenceLanguageServer, type Callbacks } from '@onflow/cadence-language-server';
import type { Message } from 'vscode-jsonrpc';

const WASM_URL = new URL(
  '@onflow/cadence-language-server/dist/cadence-language-server.wasm',
  import.meta.url
).href;

// Cache of resolved contract sources: "0xADDR.ContractName" -> code
const addressCodeCache = new Map<string, string>();

// Also cache the "all contracts at address" concatenated form
const addressAllCodeCache = new Map<string, string>();

/** Synchronously fetch contract source for an address from Flow REST API.
 * The Go WASM LSP calls getAddressCode synchronously — cannot use async/fetch. */
function fetchAddressCodeSync(address: string, accessNode: string): string | undefined {
  const normalized = address.replace(/^0x/, '').padStart(16, '0');
  const url = `${accessNode}/v1/accounts/0x${normalized}?expand=contracts`;
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, false); // synchronous
    xhr.send();
    if (xhr.status !== 200) return undefined;
    const data = JSON.parse(xhr.responseText);
    const contracts = data?.contracts;
    if (!contracts || typeof contracts !== 'object') return undefined;
    // Concatenate all contract sources at this address
    const sources: string[] = [];
    for (const [, encoded] of Object.entries(contracts)) {
      if (typeof encoded === 'string' && encoded.length > 0) {
        try {
          sources.push(atob(encoded));
        } catch {
          sources.push(encoded as string);
        }
      }
    }
    return sources.length > 0 ? sources.join('\n\n') : undefined;
  } catch {
    return undefined;
  }
}

/** Fetch a specific contract by name from a Flow account */
function extractContractByName(address: string, contractName: string, accessNode: string): string | undefined {
  const normalized = address.replace(/^0x/, '').padStart(16, '0');
  const url = `${accessNode}/v1/accounts/0x${normalized}?expand=contracts`;
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    xhr.send();
    if (xhr.status !== 200) return undefined;
    const data = JSON.parse(xhr.responseText);
    const contracts = data?.contracts;
    if (!contracts || typeof contracts !== 'object') return undefined;
    const encoded = contracts[contractName];
    if (typeof encoded === 'string' && encoded.length > 0) {
      try { return atob(encoded); } catch { return encoded; }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

// Track which address contracts have been resolved (for dependency UI)
type DependencyListener = (address: string, contractName: string, code: string) => void;
let depListener: DependencyListener | null = null;

export function onDependencyResolved(listener: DependencyListener) {
  depListener = listener;
}

export function clearAddressCache() {
  addressCodeCache.clear();
}

let currentAccessNode = 'https://rest-mainnet.onflow.org';
let currentGetStringCode: ((location: string) => string | undefined) | null = null;

/** Pre-populate the address code cache from project dependency files.
 * This avoids synchronous XHR when the LSP resolves imports. */
export function preloadCacheFromFiles(files: { path: string; content: string }[]) {
  for (const file of files) {
    // deps/0xADDR/ContractName.cdc -> cache key "0xADDR.ContractName"
    const match = file.path.match(/^deps\/(0x[0-9a-fA-F]+)\/([^/]+)\.cdc$/);
    if (match) {
      const cacheKey = `${match[1]}.${match[2]}`;
      if (!addressCodeCache.has(cacheKey)) {
        addressCodeCache.set(cacheKey, file.content);
      }
    }
  }
}

/** Parse Cadence source for `import X from 0xADDR` and `import A, B from 0xADDR` statements */
function parseImports(code: string): { name: string; address: string }[] {
  // Match: import <names> from <address>  (names can be comma-separated)
  const re = /import\s+([\w,\s]+?)\s+from\s+(0x[0-9a-fA-F]+)/g;
  const results: { name: string; address: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const names = m[1].split(',').map((n) => n.trim()).filter(Boolean);
    const address = m[2];
    for (const name of names) {
      results.push({ name, address });
    }
  }
  return results;
}

/** Async fetch a specific contract from Flow REST API */
async function fetchContractAsync(
  address: string,
  contractName: string,
  accessNode: string
): Promise<string | undefined> {
  const normalized = address.replace(/^0x/, '').padStart(16, '0');
  const url = `${accessNode}/v1/accounts/0x${normalized}?expand=contracts`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return undefined;
    const data = await resp.json();
    const contracts = data?.contracts;
    if (!contracts || typeof contracts !== 'object') return undefined;
    const encoded = contracts[contractName];
    if (typeof encoded === 'string' && encoded.length > 0) {
      try { return atob(encoded); } catch { return encoded; }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Normalize Flow address to 0x + 16 hex chars */
function normalizeAddress(address: string): string {
  const bare = address.replace(/^0x/, '').padStart(16, '0');
  return `0x${bare}`;
}

/** Pre-fetch all dependencies for the given code (and transitive deps)
 * asynchronously, populating addressCodeCache so synchronous LSP callbacks
 * don't need to make blocking XHR calls. */
export async function prefetchDependencies(
  code: string,
  accessNode: string,
  depCallback?: (address: string, contractName: string, code: string) => void,
  maxDepth = 6
): Promise<void> {
  const visited = new Set<string>();
  const queue: { name: string; address: string; depth: number }[] = [];

  // Seed with direct imports
  for (const imp of parseImports(code)) {
    const addr = normalizeAddress(imp.address);
    const key = `${addr}.${imp.name}`;
    if (!addressCodeCache.has(key)) {
      queue.push({ name: imp.name, address: addr, depth: 0 });
    }
  }

  while (queue.length > 0) {
    // Fetch current batch in parallel
    const batch = queue.splice(0, queue.length);
    const fetches = batch
      .filter((item) => {
        const key = `${item.address}.${item.name}`;
        if (visited.has(key) || addressCodeCache.has(key)) return false;
        visited.add(key);
        return true;
      })
      .map(async (item) => {
        const contractCode = await fetchContractAsync(item.address, item.name, accessNode);
        if (!contractCode) return;
        const key = `${item.address}.${item.name}`;
        addressCodeCache.set(key, contractCode);
        depCallback?.(item.address, item.name, contractCode);

        // Parse transitive imports
        if (item.depth < maxDepth) {
          for (const sub of parseImports(contractCode)) {
            const addr = normalizeAddress(sub.address);
            const subKey = `${addr}.${sub.name}`;
            if (!visited.has(subKey) && !addressCodeCache.has(subKey)) {
              queue.push({ name: sub.name, address: addr, depth: item.depth + 1 });
            }
          }
        }
      });

    await Promise.all(fetches);
  }
}

export function setAccessNode(node: string) {
  currentAccessNode = node;
}

export function setStringCodeResolver(resolver: (location: string) => string | undefined) {
  currentGetStringCode = resolver;
}

export interface LSPBridge {
  sendToServer: (message: Message) => void;
  setMessageHandler: (handler: (message: Message) => void) => void;
  dispose: () => void;
}

let serverInstance: CadenceLanguageServer | null = null;
let bridgeInstance: LSPBridge | null = null;

export async function createLSPBridge(
  onMessage: (message: Message) => void
): Promise<LSPBridge> {
  // Reuse existing if available
  if (bridgeInstance) {
    bridgeInstance.setMessageHandler(onMessage);
    return bridgeInstance;
  }

  const callbacks: Callbacks = {
    toClient: onMessage,
    getAddressCode: (address: string) => {
      // LSP may pass "address.ContractName" or just "address"
      const parts = address.split('.');
      const addrPart = parts[0].replace(/^0x/, '').padStart(16, '0');
      const contractName = parts[1]; // may be undefined
      const addrKey = `0x${addrPart}`;

      // Cache by full identifier if contract name specified
      const cacheKey = contractName ? `${addrKey}.${contractName}` : addrKey;
      if (addressCodeCache.has(cacheKey)) return addressCodeCache.get(cacheKey);

      // Fetch all contracts at this address
      const allCode = fetchAddressCodeSync(addrKey, currentAccessNode);
      if (!allCode) return undefined;

      // If a specific contract name is requested, try to extract just that contract
      if (contractName) {
        const contractCode = extractContractByName(addrKey, contractName, currentAccessNode);
        if (contractCode) {
          addressCodeCache.set(cacheKey, contractCode);
          depListener?.(addrKey, contractName, contractCode);
          return contractCode;
        }
      }

      addressCodeCache.set(cacheKey, allCode);
      depListener?.(addrKey, contractName || 'contract', allCode);
      return allCode;
    },
    getStringCode: (location: string) => {
      return currentGetStringCode?.(location);
    },
    onServerClose: () => {
      serverInstance = null;
      bridgeInstance = null;
    },
  };

  const server = await CadenceLanguageServer.create(WASM_URL, callbacks);
  serverInstance = server;

  const bridge: LSPBridge = {
    sendToServer: (message: Message) => {
      server.callbacks.toServer?.(null, message);
    },
    setMessageHandler: (handler: (message: Message) => void) => {
      server.callbacks.toClient = handler;
    },
    dispose: () => {
      server.close();
      serverInstance = null;
      bridgeInstance = null;
    },
  };

  bridgeInstance = bridge;
  return bridge;
}

export function getLSPBridge(): LSPBridge | null {
  return bridgeInstance;
}

/** Create an LSP bridge that communicates via WebSocket to a server-side LSP proxy. */
export function createWebSocketBridge(url: string): Promise<LSPBridge> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let messageHandler: ((msg: Message) => void) | null = null;

    ws.onopen = () => {
      resolve({
        sendToServer: (msg: Message) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
          }
        },
        setMessageHandler: (handler) => {
          messageHandler = handler;
        },
        dispose: () => ws.close(),
      });
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string);
        // Skip non-JSON-RPC control messages (type: "ready", "error")
        if (data.type) return;
        messageHandler?.(data as Message);
      } catch { /* ignore parse errors */ }
    };

    ws.onerror = () => reject(new Error('WebSocket LSP connection failed'));
  });
}

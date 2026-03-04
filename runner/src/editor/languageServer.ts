import type { Message } from 'vscode-jsonrpc';

// Cache of resolved contract sources: "0xADDR.ContractName" -> code
const addressCodeCache = new Map<string, string>();

// Also cache the "all contracts at address" concatenated form
const addressAllCodeCache = new Map<string, string>();


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

/** Convenience wrapper: prefetch imports for the current access node. */
export async function prefetchImports(code: string): Promise<void> {
  return prefetchDependencies(code, currentAccessNode, depListener ?? undefined);
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


/** Create an LSP bridge that communicates via WebSocket to a server-side LSP proxy. */
export function createWebSocketBridge(
  url: string,
  network: 'mainnet' | 'testnet' | 'emulator' = 'mainnet',
): Promise<LSPBridge> {
  let normalizedUrl = url;
  try {
    const parsed = new URL(url, location.href);
    if (!parsed.pathname || parsed.pathname === '/') {
      parsed.pathname = '/lsp';
      normalizedUrl = parsed.toString();
    }
  } catch {
    // Keep original URL if parsing fails.
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(normalizedUrl);
    let messageHandler: ((msg: Message) => void) | null = null;
    let settled = false;
    let ready = false;

    const bridge: LSPBridge = {
      sendToServer: (msg: Message) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      },
      setMessageHandler: (handler) => {
        messageHandler = handler;
      },
      dispose: () => ws.close(),
    };

    const readyTimeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('LSP server init timeout'));
      }
    }, 30000);

    ws.onopen = () => {
      // Bootstrap server-side session first; bridge resolves only after ready.
      ws.send(JSON.stringify({ type: 'init', network }));
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string);
        if (data.type === 'ready') {
          ready = true;
          if (!settled) {
            settled = true;
            clearTimeout(readyTimeout);
            resolve(bridge);
          }
          return;
        }
        if (data.type === 'error') {
          if (!settled) {
            settled = true;
            clearTimeout(readyTimeout);
            reject(new Error(data.message || 'LSP server init failed'));
          }
          return;
        }
        // Skip other control messages.
        if (data.type) return;
        if (data.method === 'flow/dependencyResolved' && data.params) {
          const address = data.params.address as string | undefined;
          const contractName = data.params.contractName as string | undefined;
          const code = data.params.code as string | undefined;
          if (address && contractName && typeof code === 'string') {
            depListener?.(address, contractName, code);
          }
          return;
        }
        messageHandler?.(data as Message);
      } catch { /* ignore parse errors */ }
    };

    ws.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(readyTimeout);
        reject(new Error('WebSocket LSP connection failed'));
      }
    };

    ws.onclose = () => {
      if (!settled && !ready) {
        settled = true;
        clearTimeout(readyTimeout);
        reject(new Error('WebSocket LSP closed before ready'));
      }
    };
  });
}

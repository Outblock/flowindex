import { CadenceLanguageServer, type Callbacks } from '@onflow/cadence-language-server';
import type { Message } from 'vscode-jsonrpc';

const WASM_URL = new URL(
  '@onflow/cadence-language-server/dist/cadence-language-server.wasm',
  import.meta.url
).href;

// Cache of resolved contract sources: address -> code
const addressCodeCache = new Map<string, string>();

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

export function setAccessNode(node: string) {
  currentAccessNode = node;
}

export function setStringCodeResolver(resolver: (location: string) => string | undefined) {
  currentGetStringCode = resolver;
}

export interface LSPBridge {
  server: CadenceLanguageServer;
  sendToServer: (message: Message) => void;
  dispose: () => void;
}

let serverInstance: CadenceLanguageServer | null = null;
let bridgeInstance: LSPBridge | null = null;

export async function createLSPBridge(
  onMessage: (message: Message) => void
): Promise<LSPBridge> {
  // Reuse existing if available
  if (bridgeInstance) {
    bridgeInstance.server.callbacks.toClient = onMessage;
    return bridgeInstance;
  }

  const callbacks: Callbacks = {
    toClient: onMessage,
    getAddressCode: (address: string) => {
      // LSP may pass "address.ContractName" or just "address"
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
    server,
    sendToServer: (message: Message) => {
      server.callbacks.toServer?.(null, message);
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

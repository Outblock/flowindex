/**
 * Cadence LSP v2 bridge using @outblock/cadence-language-server npm package.
 *
 * The LSP runs inside a Web Worker so WASM execution and synchronous
 * import resolution don't block the main thread.
 */

import type { Message } from 'vscode-jsonrpc';
import type { LSPBridge } from './languageServer';
import { CadenceLanguageServer } from '@outblock/cadence-language-server';

let instance: CadenceLanguageServer | null = null;

export function setV2AccessNode(node: string) {
  instance?.setAccessNode(node);
}

export function setV2StringCodeResolver(resolver: (location: string) => string | undefined) {
  // The npm package uses push-based string code.
  // We store the resolver and the caller (useLsp) will push files via preloadV2Cache.
  _stringResolver = resolver;
}

let _stringResolver: ((location: string) => string | undefined) | null = null;

/** Pre-populate address code cache from dependency files */
export function preloadV2Cache(files: { path: string; content: string }[]) {
  if (!instance) {
    console.debug('[LSP v2 cache] No instance yet, skipping preload');
    return;
  }

  const depFiles = files.filter(f => f.path.startsWith('deps/'));
  console.debug(`[LSP v2 cache] Preloading ${files.length} files (${depFiles.length} deps)`);

  // Push string code for local files
  instance.clearStringCode();
  for (const file of files) {
    // Push as string import (filename without .cdc extension)
    const name = file.path.replace(/\.cdc$/, '');
    instance.setStringCode(name, file.content);
    instance.setStringCode(file.path, file.content);

    // Also check for deps format: deps/0xADDR/ContractName.cdc
    const match = file.path.match(/^deps\/(0x[0-9a-fA-F]+)\/([^/]+)\.cdc$/);
    if (match) {
      console.debug(`[LSP v2 cache] preloadAddressCode(${match[1]}, ${match[2]}, ${file.content.length} bytes)`);
      instance.preloadAddressCode(match[1], match[2], file.content);
    }
  }
}

export async function createV2LSPBridge(
  onMessage: (message: Message) => void,
): Promise<LSPBridge> {
  // Served from public/ — worker needs importScripts for wasm_exec.js
  // so all three files (worker, wasm, wasm_exec) must be at the same path level
  const wasmUrl = '/cadence-language-server.wasm';
  const workerUrl = '/cadence-lsp-worker.js';

  let messageHandler = onMessage;

  instance = await CadenceLanguageServer.create({
    wasmUrl,
    workerUrl,
    onMessage(msg: string) {
      try {
        const parsed = JSON.parse(msg);
        messageHandler(parsed as Message);
      } catch (e) {
        console.error('[LSP v2] Failed to parse server message:', e);
      }
    },
    onError(error: string) {
      console.error('[LSP v2] Worker error:', error);
    },
    onReady() {
      console.log('[LSP v2] WASM loaded and ready (Web Worker)');
    },
  });

  const bridge: LSPBridge = {
    sendToServer: (message: Message) => {
      instance?.sendToServer(JSON.stringify(message));
    },
    setMessageHandler: (handler: (message: Message) => void) => {
      messageHandler = handler;
    },
    dispose: () => {
      instance?.dispose();
      instance = null;
    },
  };

  return bridge;
}

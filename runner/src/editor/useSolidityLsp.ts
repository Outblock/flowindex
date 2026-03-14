import { useEffect, useRef, useCallback, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import { type LSPBridge } from './languageServer';
import { MonacoLspAdapter, type DefinitionTarget } from './monacoLspAdapter';
import type { ProjectState } from '../fs/fileSystem';

const SOL_LANGUAGE_ID = 'sol';

/** Create a WebSocket bridge to the Solidity LSP server at /lsp-sol.
 *  Simplified version of createWebSocketBridge — no init handshake needed,
 *  the Solidity LSP proxy is ready once the WebSocket opens. */
function createSolWebSocketBridge(url: string): Promise<LSPBridge> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let messageHandler: ((msg: import('vscode-jsonrpc').Message) => void) | null = null;
    let settled = false;

    const bridge: LSPBridge = {
      sendToServer: (msg) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      },
      setMessageHandler: (handler) => {
        messageHandler = handler;
      },
      dispose: () => ws.close(),
    };

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('Solidity LSP connection timeout'));
      }
    }, 15000);

    ws.onopen = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(bridge);
      }
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data as string);
        // Skip control messages
        if (data.type) return;
        messageHandler?.(data as import('vscode-jsonrpc').Message);
      } catch { /* ignore parse errors */ }
    };

    ws.onerror = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error('Solidity LSP WebSocket error'));
      }
    };

    ws.onclose = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error('Solidity LSP WebSocket closed before open'));
      }
    };
  });
}

/** Hook that manages the Solidity LSP lifecycle.
 *  Server mode only (WebSocket to /lsp-sol), no WASM fallback.
 *  Only activates when `enabled` is true (i.e., there are .sol files). */
export function useSolidityLsp(
  monacoInstance: typeof Monaco | null,
  project: ProjectState,
  enabled: boolean,
) {
  const adapterRef = useRef<MonacoLspAdapter | null>(null);
  const bridgeRef = useRef<LSPBridge | null>(null);
  const initializingRef = useRef(false);
  const openDocsRef = useRef<Set<string>>(new Set());
  const [isReady, setIsReady] = useState(false);
  const [lspError, setLspError] = useState(false);

  const lspWsUrl = import.meta.env.VITE_SOL_LSP_WS_URL
    || (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/lsp-sol';

  // Teardown
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
    if (bridgeRef.current) {
      bridgeRef.current.dispose();
      bridgeRef.current = null;
    }
    initializingRef.current = false;
    setIsReady(false);
  }, []);

  // Initialize Solidity LSP when enabled and Monaco is available
  useEffect(() => {
    if (!monacoInstance || !enabled) {
      if (adapterRef.current) teardown();
      return;
    }

    if (initializingRef.current || adapterRef.current) return;
    initializingRef.current = true;
    setLspError(false);

    (async () => {
      try {
        console.log('[Sol-LSP] Connecting to Solidity LSP...');
        const bridge = await createSolWebSocketBridge(lspWsUrl);
        bridgeRef.current = bridge;
        console.log('[Sol-LSP] Connected');

        const adapter = new MonacoLspAdapter(bridge, monacoInstance, {
          skipInitialize: true,
          languageId: SOL_LANGUAGE_ID,
        });
        await adapter.initialize();

        adapterRef.current = adapter;
        setIsReady(true);
        console.log('[Sol-LSP] Solidity Language Server ready');

        // Open existing .sol files
        for (const file of project.files) {
          if (!file.path.endsWith('.sol')) continue;
          const uri = `file:///${file.path}`;
          adapter.openDocument(uri, file.content);
          openDocsRef.current.add(uri);
        }
      } catch (err) {
        console.error('[Sol-LSP] Failed to connect:', err);
        initializingRef.current = false;
        setLspError(true);
      }
    })();

    return () => teardown();
  }, [monacoInstance, enabled, lspWsUrl, teardown, project.files]);

  // Sync .sol documents when project files change
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;

    const solFiles = project.files.filter((f) => f.path.endsWith('.sol'));
    const currentPaths = new Set(solFiles.map((f) => f.path));

    // Open new .sol documents
    for (const file of solFiles) {
      const uri = `file:///${file.path}`;
      if (!openDocsRef.current.has(uri)) {
        adapter.openDocument(uri, file.content);
        openDocsRef.current.add(uri);
      }
    }

    // Close removed .sol documents
    for (const uri of openDocsRef.current) {
      const path = uri.replace('file:///', '');
      if (!currentPaths.has(path)) {
        adapter.closeDocument(uri);
        openDocsRef.current.delete(uri);
      }
    }
  }, [project.files, isReady]);

  // Notify LSP of content changes for .sol files
  const notifyChange = useCallback((path: string, content: string) => {
    if (!path.endsWith('.sol')) return;
    const adapter = adapterRef.current;
    if (!adapter) return;
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
    if (!path.endsWith('.sol')) return null;
    const adapter = adapterRef.current;
    if (!adapter) return null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const target = await adapter.findDefinition(`file:///${path}`, line, column);
      if (target) return target;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return null;
  }, []);

  return { notifyChange, goToDefinition, isReady, lspError };
}

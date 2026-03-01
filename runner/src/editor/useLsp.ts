import { useEffect, useRef, useCallback, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import {
  createLSPBridge, createWebSocketBridge, setAccessNode, setStringCodeResolver,
  onDependencyResolved, preloadCacheFromFiles, prefetchDependencies,
  type LSPBridge,
} from './languageServer';
import { MonacoLspAdapter } from './monacoLspAdapter';
import type { ProjectState } from '../fs/fileSystem';
import type { FlowNetwork } from '../flow/networks';

/** Hook that manages the Cadence WASM LSP lifecycle.
 * Initializes after Monaco is ready, syncs open documents with the LSP.
 * Pre-fetches dependencies asynchronously to avoid blocking the main thread. */
export function useLsp(
  monacoInstance: typeof Monaco | null,
  project: ProjectState,
  network: FlowNetwork,
  onDependency?: (address: string, contractName: string, code: string) => void
) {
  const adapterRef = useRef<MonacoLspAdapter | null>(null);
  const initializingRef = useRef(false);
  const openDocsRef = useRef<Set<string>>(new Set());
  const [isReady, setIsReady] = useState(false);
  const [loadingDeps, setLoadingDeps] = useState(false);

  // Update access node when network changes
  useEffect(() => {
    const restNode = network === 'mainnet'
      ? 'https://rest-mainnet.onflow.org'
      : 'https://rest-testnet.onflow.org';
    setAccessNode(restNode);
  }, [network]);

  // Set up string code resolver for local file imports
  useEffect(() => {
    setStringCodeResolver((location: string) => {
      const file = project.files.find(
        (f) => f.path === location || f.path === `${location}.cdc`
      );
      return file?.content;
    });
  }, [project.files]);

  // Set up dependency listener
  useEffect(() => {
    if (onDependency) {
      onDependencyResolved(onDependency);
    }
    return () => onDependencyResolved(() => {});
  }, [onDependency]);

  // Determine LSP WebSocket URL (auto-detect from current host, or use env override)
  const lspWsUrl = import.meta.env.VITE_LSP_WS_URL
    || (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/lsp';

  // Initialize LSP when Monaco becomes available
  useEffect(() => {
    if (!monacoInstance || initializingRef.current || adapterRef.current) return;
    initializingRef.current = true;

    (async () => {
      let bridge: LSPBridge;
      let useServerLsp = false;

      // Try server-side LSP first (via WebSocket)
      try {
        console.log('[LSP] Trying server-side LSP...');
        bridge = await createWebSocketBridge(lspWsUrl);
        // Send init message with network
        bridge.sendToServer({ type: 'init', network } as any);
        // Wait for "ready" confirmation — the WebSocket bridge skips type messages,
        // so we just proceed. The server will start handling JSON-RPC after init.
        useServerLsp = true;
        console.log('[LSP] Connected to server-side LSP');
      } catch {
        // Fall back to WASM LSP
        console.log('[LSP] Server unavailable, falling back to WASM');

        try {
          // Pre-populate cache from existing dependency files
          preloadCacheFromFiles(project.files);

          // Async pre-fetch all dependencies for editable files
          const accessNode = network === 'mainnet'
            ? 'https://rest-mainnet.onflow.org'
            : 'https://rest-testnet.onflow.org';

          const editableFiles = project.files.filter((f) => !f.readOnly);
          const allCode = editableFiles.map((f) => f.content).join('\n');

          if (allCode.includes('import ')) {
            setLoadingDeps(true);
            console.log('[LSP] Pre-fetching dependencies...');
            await prefetchDependencies(allCode, accessNode, onDependency);
            console.log('[LSP] Dependencies pre-fetched');
            setLoadingDeps(false);
          }

          bridge = await createLSPBridge(() => {});
        } catch (err) {
          console.error('[LSP] Failed to initialize:', err);
          initializingRef.current = false;
          return;
        }
      }

      try {
        const adapter = new MonacoLspAdapter(bridge!, monacoInstance);

        // Server-side LSP already has its own initialize — only send from client for WASM
        if (!useServerLsp) {
          await adapter.initialize();
        } else {
          // For server LSP, just register providers (server already initialized the LSP)
          await adapter.initialize();
        }

        adapterRef.current = adapter;
        setIsReady(true);
        console.log('[LSP] Cadence Language Server ready');

        // Open existing documents
        for (const file of project.files) {
          const uri = `file:///${file.path}`;
          adapter.openDocument(uri, file.content);
          openDocsRef.current.add(uri);
        }
      } catch (err) {
        console.error('[LSP] Failed to initialize adapter:', err);
        initializingRef.current = false;
      }
    })();
  }, [monacoInstance]);

  // Sync documents with LSP when project files change (after init)
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;

    const currentPaths = new Set(project.files.map((f) => f.path));

    // Open new documents (including readOnly deps for import resolution)
    for (const file of project.files) {
      const uri = `file:///${file.path}`;
      if (!openDocsRef.current.has(uri)) {
        adapter.openDocument(uri, file.content);
        openDocsRef.current.add(uri);
      }
    }

    // Close removed documents
    for (const uri of openDocsRef.current) {
      const path = uri.replace('file:///', '');
      if (!currentPaths.has(path)) {
        adapter.closeDocument(uri);
        openDocsRef.current.delete(uri);
      }
    }
  }, [project.files, isReady]);

  // Notify LSP of content changes for the active file
  const notifyChange = useCallback((path: string, content: string) => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    const uri = `file:///${path}`;
    if (openDocsRef.current.has(uri)) {
      adapter.changeDocument(uri, content);
    }
  }, []);

  return { notifyChange, isReady, loadingDeps };
}

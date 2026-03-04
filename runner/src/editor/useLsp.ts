import { useEffect, useRef, useCallback, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import {
  createWebSocketBridge, setAccessNode, setStringCodeResolver,
  onDependencyResolved, prefetchDependencies,
  type LSPBridge,
} from './languageServer';
import {
  createV2LSPBridge, setV2AccessNode, setV2StringCodeResolver, preloadV2Cache,
} from './languageServerV2';
import { MonacoLspAdapter, type DefinitionTarget } from './monacoLspAdapter';
import type { ProjectState } from '../fs/fileSystem';
import type { FlowNetwork } from '../flow/networks';

export type LspMode = 'wasm' | 'server';

function buildDependencyKey(code: string): string {
  const re = /import\s+([\w,\s]+?)\s+from\s+(0x[0-9a-fA-F]+)/g;
  const keys = new Set<string>();
  let m: RegExpExecArray | null;

  while ((m = re.exec(code)) !== null) {
    const names = m[1].split(',').map((n) => n.trim()).filter(Boolean);
    const address = m[2].toLowerCase();
    for (const name of names) {
      keys.add(`${address}.${name}`);
    }
  }

  if (keys.size === 0) return '';
  return Array.from(keys).sort().join('|');
}

/** Hook that manages the Cadence LSP lifecycle.
 * Supports two modes:
 * - 'wasm': WASM v2 running in Web Worker (default, zero latency)
 * - 'server': Server-side LSP via WebSocket (more powerful)
 */
export function useLsp(
  monacoInstance: typeof Monaco | null,
  project: ProjectState,
  network: FlowNetwork,
  lspMode: LspMode,
  onDependency?: (address: string, contractName: string, code: string) => void
) {
  const adapterRef = useRef<MonacoLspAdapter | null>(null);
  const initializingRef = useRef(false);
  const openDocsRef = useRef<Set<string>>(new Set());
  const projectRef = useRef(project);
  const prefetchedDepsKeyRef = useRef('');
  const prefetchPromiseRef = useRef<Promise<void> | null>(null);
  const currentModeRef = useRef<LspMode | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [loadingDeps, setLoadingDeps] = useState(false);
  const [activeMode, setActiveMode] = useState<LspMode | null>(null);

  const prefetchForCode = useCallback(async (code: string) => {
    const depKey = buildDependencyKey(code);
    if (!depKey) return;

    const scopedKey = `${network}:${depKey}`;
    if (prefetchedDepsKeyRef.current === scopedKey) return;

    if (prefetchPromiseRef.current) {
      await prefetchPromiseRef.current;
      if (prefetchedDepsKeyRef.current === scopedKey) return;
    }

    const accessNode = network === 'mainnet'
      ? 'https://rest-mainnet.onflow.org'
      : 'https://rest-testnet.onflow.org';

    setLoadingDeps(true);
    const task = (async () => {
      await prefetchDependencies(code, accessNode, onDependency);
      prefetchedDepsKeyRef.current = scopedKey;
    })().finally(() => {
      if (prefetchPromiseRef.current === task) {
        prefetchPromiseRef.current = null;
      }
      setLoadingDeps(false);
    });

    prefetchPromiseRef.current = task;
    await task;
  }, [network, onDependency]);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  // Update access node when network changes
  useEffect(() => {
    const restNode = network === 'mainnet'
      ? 'https://rest-mainnet.onflow.org'
      : 'https://rest-testnet.onflow.org';
    setAccessNode(restNode);
    setV2AccessNode(restNode);
  }, [network]);

  // Set up string code resolver for local file imports
  useEffect(() => {
    const resolver = (location: string) => {
      const file = project.files.find(
        (f) => f.path === location || f.path === `${location}.cdc`
      );
      return file?.content;
    };
    setStringCodeResolver(resolver);
    setV2StringCodeResolver(resolver);
  }, [project.files]);

  // Set up dependency listener
  useEffect(() => {
    if (onDependency) {
      onDependencyResolved(onDependency);
    }
    return () => onDependencyResolved(() => {});
  }, [onDependency]);

  // Determine LSP WebSocket URL
  const lspWsUrl = import.meta.env.VITE_LSP_WS_URL
    || (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/lsp';

  // Teardown current LSP adapter
  const teardown = useCallback(() => {
    const adapter = adapterRef.current;
    if (adapter) {
      // Close all open documents
      for (const uri of openDocsRef.current) {
        adapter.closeDocument(uri);
      }
      openDocsRef.current.clear();
      adapter.dispose();
      adapterRef.current = null;
    }
    initializingRef.current = false;
    currentModeRef.current = null;
    setIsReady(false);
    setActiveMode(null);
  }, []);

  // Initialize LSP when Monaco becomes available or mode changes
  useEffect(() => {
    if (!monacoInstance) return;

    // If mode changed, teardown and reinitialize
    if (currentModeRef.current !== null && currentModeRef.current !== lspMode) {
      teardown();
    }

    if (initializingRef.current || adapterRef.current) return;
    initializingRef.current = true;

    (async () => {
      let bridge: LSPBridge;
      let useServerLsp = false;

      if (lspMode === 'server') {
        // Server-side LSP via WebSocket
        try {
          console.log('[LSP] Connecting to server-side LSP...');
          bridge = await createWebSocketBridge(lspWsUrl, network);
          useServerLsp = true;
          console.log('[LSP] Connected to server-side LSP');
        } catch (err) {
          console.error('[LSP] Server LSP unavailable:', err);
          initializingRef.current = false;
          return;
        }
      } else {
        // WASM v2 (Web Worker)
        try {
          console.log('[LSP] Initializing WASM v2...');
          preloadV2Cache(project.files);

          const editableFiles = project.files.filter((f) => !f.readOnly);
          const allCode = editableFiles.map((f) => f.content).join('\n');
          if (allCode.includes('import ')) {
            console.log('[LSP v2] Pre-fetching dependencies...');
            await prefetchForCode(allCode);
            console.log('[LSP v2] Dependencies pre-fetched');
          }

          bridge = await createV2LSPBridge(() => {});
          console.log('[LSP] WASM v2 initialized');
        } catch (err) {
          console.error('[LSP] WASM v2 failed:', err);
          initializingRef.current = false;
          return;
        }
      }

      try {
        const adapter = new MonacoLspAdapter(bridge!, monacoInstance, {
          skipInitialize: useServerLsp,
          resolveDocumentContent: (uri: string) => {
            if (!uri.startsWith('file:///')) return undefined;
            const path = decodeURIComponent(uri.slice('file:///'.length));
            return projectRef.current.files.find((f) => f.path === path)?.content;
          },
        });
        await adapter.initialize();

        adapterRef.current = adapter;
        currentModeRef.current = lspMode;
        setIsReady(true);
        setActiveMode(lspMode);
        console.log(`[LSP] Cadence Language Server ready (${lspMode})`);

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
  }, [monacoInstance, lspMode, network, prefetchForCode, project.files, lspWsUrl, teardown]);

  // Pre-fetch dependencies so fallback definition can use deps models quickly.
  useEffect(() => {
    if (!isReady) return;
    const editableFiles = project.files.filter((f) => !f.readOnly);
    const allCode = editableFiles.map((f) => f.content).join('\n');
    if (!allCode.includes('import ')) return;
    void prefetchForCode(allCode);
  }, [isReady, project.files, prefetchForCode]);

  // Sync documents with LSP when project files change (after init)
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;

    const currentPaths = new Set(project.files.map((f) => f.path));

    // Open new documents
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

  const goToDefinition = useCallback(async (
    path: string,
    line: number,
    column: number,
  ): Promise<DefinitionTarget | null> => {
    const adapter = adapterRef.current;
    if (!adapter) return null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const target = await adapter.findDefinition(`file:///${path}`, line, column);
      if (target) return target;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return null;
  }, []);

  return { notifyChange, goToDefinition, isReady, loadingDeps, activeMode };
}

import { useEffect, useRef, useCallback, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import {
  createLSPBridge, createWebSocketBridge, setAccessNode, setStringCodeResolver,
  onDependencyResolved, preloadCacheFromFiles, prefetchDependencies, prefetchImports,
  type LSPBridge,
} from './languageServer';
import { MonacoLspAdapter, type DefinitionTarget } from './monacoLspAdapter';
import type { ProjectState } from '../fs/fileSystem';
import type { FlowNetwork } from '../flow/networks';

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
  const projectRef = useRef(project);
  const prefetchedDepsKeyRef = useRef('');
  const prefetchPromiseRef = useRef<Promise<void> | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [loadingDeps, setLoadingDeps] = useState(false);

  const prefetchForCode = useCallback(async (code: string) => {
    const depKey = buildDependencyKey(code);
    if (!depKey) return;

    const scopedKey = `${network}:${depKey}`;
    if (prefetchedDepsKeyRef.current === scopedKey) return;

    // Serialize prefetch calls to avoid duplicate REST requests during rapid edits.
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
        bridge = await createWebSocketBridge(lspWsUrl, network);
        useServerLsp = true;
        console.log('[LSP] Connected to server-side LSP');
      } catch {
        // Fall back to WASM LSP
        console.log('[LSP] Server unavailable, falling back to WASM');

        try {
          // Pre-populate cache from existing dependency files
          preloadCacheFromFiles(project.files);

          const editableFiles = project.files.filter((f) => !f.readOnly);
          const allCode = editableFiles.map((f) => f.content).join('\n');

          if (allCode.includes('import ')) {
            console.log('[LSP] Pre-fetching dependencies...');
            await prefetchForCode(allCode);
            console.log('[LSP] Dependencies pre-fetched');
          }

          bridge = await createLSPBridge(() => {});
        } catch (err) {
          console.error('[LSP] Failed to initialize:', err);
          initializingRef.current = false;
          return;
        }
      }

      try {
        const adapter = new MonacoLspAdapter(bridge!, monacoInstance, {
          skipInitialize: useServerLsp,
          languageId: 'cadence',
          markerOwner: 'cadence-lsp',
          beforeOpen: (code) => prefetchImports(code),
          beforeChange: (code) => prefetchImports(code),
          resolveDocumentContent: (uri: string) => {
            if (!uri.startsWith('file:///')) return undefined;
            const path = decodeURIComponent(uri.slice('file:///'.length));
            return projectRef.current.files.find((f) => f.path === path)?.content;
          },
        });
        await adapter.initialize();

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
  }, [monacoInstance, network, onDependency, prefetchForCode, project.files, lspWsUrl]);

  // Pre-fetch dependencies in server-side mode as well, so fallback definition can use deps models quickly.
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

  return { notifyChange, goToDefinition, isReady, loadingDeps };
}

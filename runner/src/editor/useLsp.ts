import { useEffect, useRef, useCallback, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import {
  createLSPBridge, setAccessNode, setStringCodeResolver,
  onDependencyResolved, preloadCacheFromFiles, prefetchDependencies,
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

  // Initialize LSP when Monaco becomes available
  useEffect(() => {
    if (!monacoInstance || initializingRef.current || adapterRef.current) return;
    initializingRef.current = true;

    (async () => {
      try {
        console.log('[LSP] Initializing Cadence Language Server...');

        // Pre-populate cache from existing dependency files (e.g. from localStorage)
        preloadCacheFromFiles(project.files);

        // Async pre-fetch all dependencies for editable files
        // This populates addressCodeCache BEFORE the LSP starts resolving imports,
        // so the synchronous getAddressCode callback hits cache instead of doing XHR.
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

        const bridge = await createLSPBridge(() => {});
        const adapter = new MonacoLspAdapter(bridge, monacoInstance);
        await adapter.initialize();
        adapterRef.current = adapter;
        setIsReady(true);
        console.log('[LSP] Cadence Language Server ready');

        // Open existing documents (including readOnly deps so the LSP can resolve imports)
        for (const file of project.files) {
          const uri = `file:///${file.path}`;
          adapter.openDocument(uri, file.content);
          openDocsRef.current.add(uri);
        }
      } catch (err) {
        console.error('[LSP] Failed to initialize:', err);
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

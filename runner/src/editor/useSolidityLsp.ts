import { useEffect, useRef, useCallback, useState } from 'react';
import type * as Monaco from 'monaco-editor';
import { createWebSocketBridge, type LSPBridge } from './languageServer';
import { MonacoLspAdapter, type DefinitionTarget } from './monacoLspAdapter';
import type { ProjectState } from '../fs/fileSystem';

const SOLIDITY_LANGUAGE_ID = 'sol';

/**
 * Hook that manages a Solidity LSP connection via WebSocket.
 * Unlike the Cadence LSP hook, this is server-only (no WASM fallback)
 * and only activates when the project contains .sol files.
 */
export function useSolidityLsp(
  monacoInstance: typeof Monaco | null,
  project: ProjectState,
  network: 'mainnet' | 'testnet',
) {
  const adapterRef = useRef<MonacoLspAdapter | null>(null);
  const initializingRef = useRef(false);
  const openDocsRef = useRef<Set<string>>(new Set());
  const [isReady, setIsReady] = useState(false);

  // Determine LSP WebSocket URL
  const lspWsUrl = import.meta.env.VITE_SOL_LSP_WS_URL
    || (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/lsp-sol';

  // Check if the project has any .sol files
  const hasSolFiles = project.files.some((f) => f.path.endsWith('.sol'));

  // Initialize LSP when Monaco is available and .sol files exist
  useEffect(() => {
    if (!monacoInstance || !hasSolFiles || initializingRef.current || adapterRef.current) return;
    initializingRef.current = true;

    (async () => {
      let bridge: LSPBridge;
      try {
        console.log('[SOL-LSP] Connecting to server-side Solidity LSP...');
        bridge = await createWebSocketBridge(lspWsUrl, network);
        console.log('[SOL-LSP] Connected');
      } catch (err) {
        console.warn('[SOL-LSP] Server unavailable:', err);
        initializingRef.current = false;
        return;
      }

      try {
        const adapter = new MonacoLspAdapter(bridge, monacoInstance, {
          skipInitialize: true,
          languageId: SOLIDITY_LANGUAGE_ID,
          markerOwner: 'solidity-lsp',
        });
        await adapter.initialize();

        adapterRef.current = adapter;
        setIsReady(true);
        console.log('[SOL-LSP] Solidity Language Server ready');

        // Open existing .sol documents
        for (const file of project.files) {
          if (!file.path.endsWith('.sol')) continue;
          const uri = `file:///${file.path}`;
          adapter.openDocument(uri, file.content);
          openDocsRef.current.add(uri);
        }
      } catch (err) {
        console.error('[SOL-LSP] Failed to initialize adapter:', err);
        initializingRef.current = false;
      }
    })();
  }, [monacoInstance, hasSolFiles, network, lspWsUrl]);

  // Sync .sol documents with LSP when project files change
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;

    const currentPaths = new Set(project.files.map((f) => f.path));

    // Open new .sol documents
    for (const file of project.files) {
      if (!file.path.endsWith('.sol')) continue;
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

  return { notifyChange, goToDefinition, isReady };
}

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

export type LspMode = 'auto' | 'wasm' | 'server';

const LSP_WASM_URL = '/cadence-language-server.wasm';

/** Check if the WASM file is in the browser's HTTP cache.
 *  Uses a HEAD request — fast and doesn't re-download. */
async function isWasmCached(): Promise<boolean> {
  try {
    const resp = await fetch(LSP_WASM_URL, { method: 'HEAD', cache: 'only-if-cached', mode: 'same-origin' });
    return resp.ok;
  } catch {
    return false;
  }
}

/** Pre-fetch the LSP WASM with progress tracking.
 *  The browser caches the response so the worker's subsequent fetch is instant. */
async function prefetchWasmWithProgress(
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch(LSP_WASM_URL, { signal });
  const total = Number(resp.headers.get('content-length') || 0);
  if (!total || !resp.body) {
    // Can't track progress — just consume the response to cache it
    await resp.arrayBuffer();
    onProgress(100);
    return;
  }
  const reader = resp.body.getReader();
  let loaded = 0;
  try {
    for (;;) {
      if (signal?.aborted) { reader.cancel(); return; }
      const { done, value } = await reader.read();
      if (done) break;
      loaded += value.byteLength;
      onProgress(Math.min(99, Math.round((loaded / total) * 100)));
    }
    onProgress(100);
  } catch (err) {
    reader.cancel();
    throw err;
  }
}

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
  const wasmAbortRef = useRef<AbortController | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [lspError, setLspError] = useState(false);
  const [loadingDeps, setLoadingDeps] = useState(false);
  const [activeMode, setActiveMode] = useState<LspMode | null>(null);
  const [wasmProgress, setWasmProgress] = useState<number | null>(null);

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
    // Abort any in-progress WASM download
    if (wasmAbortRef.current) {
      wasmAbortRef.current.abort();
      wasmAbortRef.current = null;
    }
    setWasmProgress(null);

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
    setLspError(false);

    (async () => {
      let bridge: LSPBridge;
      let useServerLsp = false;

      // Resolve 'auto' → check WASM cache, use wasm if cached, else server + background download
      let resolvedMode: 'wasm' | 'server' = lspMode === 'auto'
        ? (await isWasmCached() ? 'wasm' : 'server')
        : (lspMode as 'wasm' | 'server');

      if (resolvedMode === 'server') {
        // Server-side LSP via WebSocket
        try {
          console.log('[LSP] Connecting to server-side LSP...');
          bridge = await createWebSocketBridge(lspWsUrl, network);
          useServerLsp = true;
          console.log('[LSP] Connected to server-side LSP');
        } catch (err) {
          console.error('[LSP] Server LSP unavailable, falling back to WASM:', err);
          // If in auto mode and server fails, fall back to WASM
          if (lspMode === 'auto') {
            resolvedMode = 'wasm';
          } else {
            initializingRef.current = false;
            setLspError(true);
            return;
          }
        }

        // In auto mode with server: background-download WASM for next time
        if (lspMode === 'auto' && useServerLsp) {
          prefetchWasmWithProgress(() => {}).catch(() => {});
        }
      }

      if (resolvedMode === 'wasm' && !useServerLsp) {
        // WASM v2 (Web Worker)
        try {
          console.log('[LSP] Initializing WASM v2...');
          setWasmProgress(0);
          const abortCtrl = new AbortController();
          wasmAbortRef.current = abortCtrl;

          // Pre-fetch WASM with progress tracking (browser caches it for the worker)
          // and pre-fetch contract dependencies in parallel
          const editableFiles = project.files.filter((f) => !f.readOnly);
          const allCode = editableFiles.map((f) => f.content).join('\n');
          const tasks: Promise<void>[] = [
            prefetchWasmWithProgress((pct) => setWasmProgress(pct), abortCtrl.signal),
          ];
          if (allCode.includes('import ')) {
            console.log('[LSP v2] Pre-fetching dependencies...');
            tasks.push(prefetchForCode(allCode).then(() => {
              console.log('[LSP v2] Dependencies pre-fetched');
            }));
          }
          await Promise.all(tasks);

          bridge = await createV2LSPBridge(() => {});
          // Preload AFTER instance is created so address code is pushed into the worker
          preloadV2Cache(projectRef.current.files);
          setWasmProgress(null);
          console.log('[LSP] WASM v2 initialized');
        } catch (err) {
          console.error('[LSP] WASM v2 failed:', err);
          setWasmProgress(null);
          initializingRef.current = false;
          setLspError(true);
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
        setActiveMode(useServerLsp ? 'server' : 'wasm');
        console.log(`[LSP] Cadence Language Server ready (${lspMode}${lspMode === 'auto' ? ` → ${useServerLsp ? 'server' : 'wasm'}` : ''})`);

        // Open existing documents
        for (const file of project.files) {
          const uri = `file:///${file.path}`;
          adapter.openDocument(uri, file.content);
          openDocsRef.current.add(uri);
        }
      } catch (err) {
        console.error('[LSP] Failed to initialize adapter:', err);
        initializingRef.current = false;
        setLspError(true);
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

  // Push updated files to v2 cache whenever project files change (e.g. new deps added),
  // then nudge LSP to re-check open documents so import errors clear.
  useEffect(() => {
    if (lspMode === 'wasm') {
      const depFiles = project.files.filter(f => f.path.startsWith('deps/'));
      if (depFiles.length > 0) {
        preloadV2Cache(project.files);
        // Re-send open editable docs to trigger LSP re-analysis with new deps
        const adapter = adapterRef.current;
        if (adapter) {
          for (const file of project.files) {
            if (file.readOnly) continue;
            const uri = `file:///${file.path}`;
            if (openDocsRef.current.has(uri)) {
              adapter.changeDocument(uri, file.content);
            }
          }
        }
      }
    }
  }, [project.files, lspMode]);

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

  return { notifyChange, goToDefinition, isReady, lspError, loadingDeps, activeMode, wasmProgress };
}

/// <reference lib="webworker" />

// Web Worker for Solidity compilation via solc.
// Uses the solc wrapper + soljson.js loaded as a raw script to avoid
// Vite ESM transformation breaking Emscripten's Module pattern.
// Supports multi-file compilation and version selection from CDN.

import soljsonUrl from 'solc/soljson.js?url';

const CDN_BASE = 'https://binaries.soliditylang.org/bin';

// Cache compiler instances by version key ("bundled" or version string)
const compilerCache = new Map<string, any>();

/** Load the bundled solc that ships with the app. */
async function loadBundledSolc() {
  if (compilerCache.has('bundled')) return compilerCache.get('bundled');

  const response = await fetch(soljsonUrl);
  const script = await response.text();

  (self as any).Module = (self as any).Module || {};
  // eslint-disable-next-line no-eval
  (0, eval)(script);

  const soljson = (self as any).Module;
  const compile = soljson.cwrap('solidity_compile', 'string', ['string', 'number', 'number']);

  const compiler = {
    compile(input: string) {
      return compile(input, 0, 0);
    },
  };

  compilerCache.set('bundled', compiler);
  return compiler;
}

/** Load a specific solc version from the Solidity CDN. */
async function loadCdnSolc(version: string) {
  if (compilerCache.has(version)) return compilerCache.get(version);

  // Fetch the release list to resolve the version to a filename
  const listResp = await fetch(`${CDN_BASE}/list.json`);
  if (!listResp.ok) throw new Error(`Failed to fetch solc release list: ${listResp.status}`);
  const list = await listResp.json();

  // Try exact match first (e.g. "0.8.24"), then prefixed (e.g. "v0.8.24")
  const release: string | undefined =
    list.releases[version] ?? list.releases[`v${version}`];
  if (!release) {
    throw new Error(`solc version ${version} not found in CDN releases`);
  }

  const binResp = await fetch(`${CDN_BASE}/${release}`);
  if (!binResp.ok) throw new Error(`Failed to fetch solc ${release}: ${binResp.status}`);
  const script = await binResp.text();

  // Save and restore Module so loading a CDN version doesn't clobber the bundled one
  const savedModule = (self as any).Module;

  // Wait for Emscripten runtime initialization via a Promise
  const soljson = await new Promise<any>((resolve) => {
    (self as any).Module = {
      onRuntimeInitialized() {
        resolve((self as any).Module);
      },
    };
    // eslint-disable-next-line no-eval
    (0, eval)(script);
    // Some builds initialize synchronously — check if cwrap is already available
    if (typeof (self as any).Module?.cwrap === 'function') {
      resolve((self as any).Module);
    }
  });

  // Restore previous Module
  (self as any).Module = savedModule;

  const compile = soljson.cwrap('solidity_compile', 'string', ['string', 'number', 'number']);

  const compiler = {
    compile(input: string) {
      return compile(input, 0, 0);
    },
  };

  compilerCache.set(version, compiler);
  return compiler;
}

/**
 * Load a solc compiler instance.
 * If version is provided, fetches that specific version from the Solidity CDN.
 * Otherwise, uses the bundled solc.
 */
async function loadSolcVersion(version?: string) {
  if (version) {
    return loadCdnSolc(version);
  }
  return loadBundledSolc();
}

// ---------------------------------------------------------------------------
// npm import resolver — fetches Solidity sources from jsdelivr CDN
// ---------------------------------------------------------------------------

const JSDELIVR_BASE = 'https://cdn.jsdelivr.net/npm';

/** Cache fetched npm files so repeat compiles don't re-download */
const npmCache = new Map<string, string>();

/** Extract all import paths from Solidity source */
function extractImports(source: string): string[] {
  const imports: string[] = [];
  // Match: import "path"; import { X } from "path"; import "path" as Y;
  const re = /import\s+(?:[^"']*\s+from\s+)?["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    imports.push(m[1]);
  }
  return imports;
}

/** Check if an import path is an npm package (not relative/absolute) */
function isNpmImport(path: string): boolean {
  return !path.startsWith('.') && !path.startsWith('/');
}

/**
 * Resolve an npm import path to a jsdelivr URL.
 * e.g. "@openzeppelin/contracts/token/ERC20/ERC20.sol"
 *   -> "https://cdn.jsdelivr.net/npm/@openzeppelin/contracts/token/ERC20/ERC20.sol"
 */
function npmToUrl(importPath: string): string {
  return `${JSDELIVR_BASE}/${importPath}`;
}

/**
 * Resolve a relative import from within an npm package.
 * e.g. base="@openzeppelin/contracts/token/ERC20/ERC20.sol", rel="../utils/Context.sol"
 *   -> "@openzeppelin/contracts/token/utils/Context.sol"
 */
function resolveRelative(basePath: string, relPath: string): string {
  const parts = basePath.split('/');
  parts.pop(); // remove filename
  for (const seg of relPath.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/**
 * Recursively resolve all npm imports for the given sources.
 * Fetches from jsdelivr CDN and adds to the resolved map.
 */
async function resolveNpmImports(
  localSources: Record<string, string>,
  resolved: Map<string, string>,
  maxDepth = 20,
): Promise<void> {
  // Collect all sources to scan (local + already resolved)
  const toScan: [string, string][] = [
    ...Object.entries(localSources),
    ...resolved.entries(),
  ];

  const pending = new Set<string>();

  for (const [filePath, content] of toScan) {
    for (const imp of extractImports(content)) {
      let npmPath: string;
      if (isNpmImport(imp)) {
        npmPath = imp;
      } else if (imp.startsWith('.') && isNpmImport(filePath)) {
        // Relative import inside an npm package
        npmPath = resolveRelative(filePath, imp);
      } else {
        continue; // local relative import — skip
      }

      if (localSources[npmPath] || resolved.has(npmPath)) continue;
      pending.add(npmPath);
    }
  }

  if (pending.size === 0 || maxDepth <= 0) return;

  // Fetch all pending in parallel
  const fetches = [...pending].map(async (npmPath) => {
    if (npmCache.has(npmPath)) {
      return { path: npmPath, content: npmCache.get(npmPath)! };
    }
    const url = npmToUrl(npmPath);
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Failed to fetch ${npmPath} from CDN (${resp.status}): ${url}`);
    }
    const content = await resp.text();
    npmCache.set(npmPath, content);
    return { path: npmPath, content };
  });

  const results = await Promise.all(fetches);
  for (const { path, content } of results) {
    resolved.set(path, content);
  }

  // Recurse to resolve transitive dependencies
  await resolveNpmImports(localSources, resolved, maxDepth - 1);
}

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

interface CompileRequest {
  id: number;
  source: string;
  fileName: string;
  /** All .sol files keyed by path, for multi-file compilation */
  sources?: Record<string, string>;
  /** Optional solc version override (e.g. "0.8.24") */
  solcVersion?: string;
}

self.onmessage = async (e: MessageEvent<CompileRequest>) => {
  const { id, source, fileName, sources: multiSources, solcVersion } = e.data;

  try {
    const compiler = await loadSolcVersion(solcVersion);

    // Build local sources from either multi-file or single-file input
    const localSources: Record<string, string> = {};
    if (multiSources) {
      for (const [name, content] of Object.entries(multiSources)) {
        localSources[name] = content;
      }
    } else {
      localSources[fileName] = source;
    }

    // Resolve npm imports (e.g. @openzeppelin/contracts/...)
    const npmResolved = new Map<string, string>();
    try {
      await resolveNpmImports(localSources, npmResolved);
    } catch (resolveErr: any) {
      self.postMessage({
        id,
        success: false,
        contracts: [],
        errors: [`Import resolution failed: ${resolveErr.message}`],
        warnings: [],
      });
      return;
    }

    // Merge local + npm sources
    const allSources: Record<string, { content: string }> = {};
    for (const [name, content] of Object.entries(localSources)) {
      allSources[name] = { content };
    }
    for (const [name, content] of npmResolved.entries()) {
      allSources[name] = { content };
    }

    const input = {
      language: 'Solidity',
      sources: allSources,
      settings: {
        outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
      },
    };

    const output = JSON.parse(compiler.compile(JSON.stringify(input)));
    const errors: string[] = [];
    const warnings: string[] = [];

    if (output.errors) {
      for (const err of output.errors) {
        if (err.severity === 'error') errors.push(err.formattedMessage || err.message);
        else warnings.push(err.formattedMessage || err.message);
      }
    }

    if (errors.length > 0 || !output.contracts) {
      self.postMessage({ id, success: false, contracts: [], errors, warnings });
      return;
    }

    // Collect contracts from ALL files in the output, not just the primary file
    const contracts: any[] = [];
    for (const [sourceFile, fileContracts] of Object.entries(output.contracts) as [string, any][]) {
      if (fileContracts) {
        for (const [name, contract] of Object.entries(fileContracts) as [string, any][]) {
          contracts.push({
            name,
            abi: contract.abi,
            bytecode: `0x${contract.evm.bytecode.object}`,
            sourceFile,
          });
        }
      }
    }

    self.postMessage({ id, success: true, contracts, errors, warnings });
  } catch (err: any) {
    self.postMessage({
      id,
      success: false,
      contracts: [],
      errors: [err.message || String(err)],
      warnings: [],
    });
  }
};

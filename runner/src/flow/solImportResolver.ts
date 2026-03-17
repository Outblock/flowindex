/**
 * Solidity npm import resolver — pre-fetches dependencies from jsdelivr CDN.
 * Used during editing to warm the cache before compilation.
 */

const JSDELIVR_BASE = 'https://cdn.jsdelivr.net/npm';

/** Cache fetched npm files (shared with solcWorker via same origin) */
const cache = new Map<string, string>();

/** Pending fetches to avoid duplicate requests */
const inflight = new Map<string, Promise<string>>();

/** Extract all import paths from Solidity source */
export function extractImports(source: string): string[] {
  const imports: string[] = [];
  const re = /import\s+(?:[^"']*\s+from\s+)?["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    imports.push(m[1]);
  }
  return imports;
}

/** Check if an import path is an npm package (not relative/absolute) */
export function isNpmImport(path: string): boolean {
  return !path.startsWith('.') && !path.startsWith('/');
}

/** Resolve a relative import from within an npm package */
function resolveRelative(basePath: string, relPath: string): string {
  const parts = basePath.split('/');
  parts.pop();
  for (const seg of relPath.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/** Fetch a single npm file, with dedup and caching */
async function fetchNpmFile(npmPath: string): Promise<string> {
  const cached = cache.get(npmPath);
  if (cached) return cached;

  const existing = inflight.get(npmPath);
  if (existing) return existing;

  const promise = (async () => {
    const resp = await fetch(`${JSDELIVR_BASE}/${npmPath}`);
    if (!resp.ok) throw new Error(`${resp.status}: ${npmPath}`);
    const content = await resp.text();
    cache.set(npmPath, content);
    inflight.delete(npmPath);
    return content;
  })();

  inflight.set(npmPath, promise);
  return promise;
}

export interface ResolveResult {
  /** All resolved npm files keyed by import path */
  resolved: Record<string, string>;
  /** Errors encountered during resolution */
  errors: string[];
}

/**
 * Recursively resolve all npm imports from the given local sources.
 * Returns resolved files and any errors.
 */
export async function resolveAllNpmImports(
  localSources: Record<string, string>,
  maxDepth = 20,
): Promise<ResolveResult> {
  const resolved = new Map<string, string>();
  const errors: string[] = [];

  async function resolve(
    sources: Map<string, string>,
    depth: number,
  ): Promise<void> {
    if (depth <= 0) return;

    const pending = new Set<string>();

    for (const [filePath, content] of sources) {
      for (const imp of extractImports(content)) {
        let npmPath: string;
        if (isNpmImport(imp)) {
          npmPath = imp;
        } else if (imp.startsWith('.') && isNpmImport(filePath)) {
          npmPath = resolveRelative(filePath, imp);
        } else {
          continue;
        }
        if (localSources[npmPath] || resolved.has(npmPath)) continue;
        pending.add(npmPath);
      }
    }

    if (pending.size === 0) return;

    const newSources = new Map<string, string>();
    const fetches = [...pending].map(async (npmPath) => {
      try {
        const content = await fetchNpmFile(npmPath);
        resolved.set(npmPath, content);
        newSources.set(npmPath, content);
      } catch (err: any) {
        errors.push(err.message);
      }
    });

    await Promise.all(fetches);

    if (newSources.size > 0) {
      await resolve(newSources, depth - 1);
    }
  }

  const initial = new Map(Object.entries(localSources));
  await resolve(initial, maxDepth);

  return {
    resolved: Object.fromEntries(resolved),
    errors,
  };
}

/** Check if source has any unresolved npm imports */
export function hasNpmImports(source: string): boolean {
  return extractImports(source).some(isNpmImport);
}

import { useState, useEffect, useRef } from 'react';
import { hasNpmImports, resolveAllNpmImports, type ResolveResult } from './solImportResolver';

/**
 * Hook that auto-resolves npm imports while editing Solidity files.
 * Debounces changes and fetches dependencies from jsdelivr CDN.
 *
 * @param sources - All .sol files keyed by path
 * @param active - Whether to activate (only when .sol files exist)
 * @returns loading state and resolved dependencies
 */
export function useSolImports(
  sources: Record<string, string>,
  active: boolean,
) {
  const [loading, setLoading] = useState(false);
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const abortRef = useRef(0);

  useEffect(() => {
    if (!active) return;

    // Quick check: any source has npm imports?
    const needsResolve = Object.values(sources).some(hasNpmImports);
    if (!needsResolve) {
      setResolved({});
      setErrors([]);
      return;
    }

    const generation = ++abortRef.current;

    // Debounce 500ms
    const timer = setTimeout(async () => {
      if (generation !== abortRef.current) return;
      setLoading(true);
      try {
        const result: ResolveResult = await resolveAllNpmImports(sources);
        if (generation !== abortRef.current) return;
        setResolved(result.resolved);
        setErrors(result.errors);
      } catch {
        // ignore — errors are in result.errors
      } finally {
        if (generation === abortRef.current) setLoading(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [sources, active]);

  return { loading, resolved, errors };
}

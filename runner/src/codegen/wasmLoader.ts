/**
 * Lazy-loader for the cadence-codegen WASM binary.
 *
 * The WASM (compiled from Go) exposes two global functions after loading:
 *   cadenceCodegenAnalyze(code, filename?) -> JSON string
 *   cadenceCodegenGenerate(reportJSON, lang) -> generated code or JSON error
 *
 * This module provides a typed wrapper that loads the WASM on first use
 * and caches the loading promise for subsequent calls.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CodegenLanguage = 'typescript' | 'swift' | 'go';

export interface CodegenResult {
  code: string;
  error?: string;
}

// Globals exposed by the WASM after go.run()
declare global {
  // eslint-disable-next-line no-var
  var cadenceCodegenAnalyze: ((code: string, filename?: string) => string) | undefined;
  // eslint-disable-next-line no-var
  var cadenceCodegenGenerate: ((reportJSON: string, lang: string) => string) | undefined;
  // Ready callback set before WASM instantiation; Go calls it once init is done.
  // eslint-disable-next-line no-var
  var __cadenceCodegenReady: (() => void) | undefined;

  // Go's wasm_exec.js adds the Go constructor to globalThis
  class Go {
    importObject: WebAssembly.Imports;
    run(instance: WebAssembly.Instance): Promise<void>;
  }
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let loadPromise: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// Script loader helper
// ---------------------------------------------------------------------------

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if the script is already loaded
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

// ---------------------------------------------------------------------------
// Core loader
// ---------------------------------------------------------------------------

/**
 * Ensure the cadence-codegen WASM is loaded and ready.
 * Safe to call multiple times -- only the first call triggers loading,
 * subsequent calls return the same cached promise.
 */
export async function ensureCodegenLoaded(): Promise<void> {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    // 1. Load Go's WASM runtime (adds `Go` constructor to globalThis)
    await loadScript('/codegen-wasm_exec.js');

    // 2. Create a Go instance
    const go = new Go();

    // 3. Set up a ready promise so we can wait for the Go init callback
    const readyPromise = new Promise<void>((resolve) => {
      globalThis.__cadenceCodegenReady = () => resolve();
    });

    // 4. Fetch and instantiate the WASM binary
    const result = await WebAssembly.instantiateStreaming(
      fetch('/codegen.wasm'),
      go.importObject,
    );

    // 5. Start the Go runtime (blocks forever, don't await)
    go.run(result.instance);

    // 6. Wait for the WASM to signal readiness
    await readyPromise;
  })();

  // If loading fails, clear the cached promise so a retry is possible
  loadPromise.catch(() => {
    loadPromise = null;
  });

  return loadPromise;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze Cadence source code and return the report JSON.
 * Analyze once, then call generateFromReport() per language.
 *
 * Must be called after `await ensureCodegenLoaded()`.
 */
export function analyzeCode(
  code: string,
  filename?: string,
): { report: string } | { error: string } {
  const analyze = globalThis.cadenceCodegenAnalyze;
  if (!analyze) {
    return { error: 'Codegen WASM not loaded. Call ensureCodegenLoaded() first.' };
  }

  const reportJSON = analyze(code, filename);

  try {
    const parsed = JSON.parse(reportJSON);
    if (parsed && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string') {
      return { error: parsed.error };
    }
  } catch {
    // Not JSON error — treat as valid report
  }

  return { report: reportJSON };
}

/**
 * Generate code from a previously-obtained report JSON.
 */
export function generateFromReport(
  reportJSON: string,
  language: CodegenLanguage,
): CodegenResult {
  const generate = globalThis.cadenceCodegenGenerate;
  if (!generate) {
    return { code: '', error: 'Codegen WASM not loaded.' };
  }

  const output = generate(reportJSON, language);

  try {
    const parsed = JSON.parse(output);
    if (parsed && typeof parsed === 'object' && 'error' in parsed && typeof parsed.error === 'string') {
      return { code: '', error: parsed.error };
    }
  } catch {
    // Not JSON — this is the actual generated code (success)
  }

  return { code: output };
}

# Runner Cadence Codegen Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Codegen" tab to the Runner Result Panel that converts Cadence code (script/transaction/contract) into TypeScript, Swift, or Go entirely in the browser via WASM.

**Architecture:** The `Outblock/cadence-codegen` Go tool gets a new `cmd/wasm/main.go` entry point compiled to WASM. The runner frontend lazy-loads this WASM on first use, calls `analyzeCode()` to parse Cadence, then `generateCode()` per target language. Results display in a new tab in the existing ResultPanel with language pills and a read-only Monaco editor.

**Tech Stack:** Go WASM (`GOOS=js GOARCH=wasm`), `@outblock/cadence-codegen` (analyzer + generators), Monaco Editor (read-only), React, TailwindCSS, Lucide icons.

---

## Task 1: Add WASM entry point to cadence-codegen repo

This task is done in a **separate repo** (`Outblock/cadence-codegen`). It produces a `codegen.wasm` file that the runner will consume.

**Files:**
- Create: `cmd/wasm/main.go`
- Create: `Makefile` (or update existing build scripts)

**Step 1: Clone and create WASM entry point**

```bash
cd /tmp
git clone https://github.com/Outblock/cadence-codegen.git
cd cadence-codegen
mkdir -p cmd/wasm
```

Create `cmd/wasm/main.go`:

```go
//go:build js && wasm

package main

import (
	"encoding/json"
	"syscall/js"

	"github.com/outblock/cadence-codegen/internal/analyzer"
	goGen "github.com/outblock/cadence-codegen/internal/generator/golang"
	swiftGen "github.com/outblock/cadence-codegen/internal/generator/swift"
	tsGen "github.com/outblock/cadence-codegen/internal/generator/typescript"
)

func analyzeCode() js.Func {
	return js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) < 1 {
			return map[string]any{"error": "missing cadence source argument"}
		}
		code := args[0].String()
		filename := "main.cdc"
		if len(args) > 1 && args[1].String() != "" {
			filename = args[1].String()
		}

		a := analyzer.New()
		a.SetIncludeBase64(true)
		if err := a.AnalyzeCode(code, filename); err != nil {
			return map[string]any{"error": err.Error()}
		}
		report := a.GetReport()
		data, err := json.Marshal(report)
		if err != nil {
			return map[string]any{"error": err.Error()}
		}
		return string(data)
	})
}

func generateCode() js.Func {
	return js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) < 2 {
			return map[string]any{"error": "need (reportJSON, language)"}
		}
		reportJSON := args[0].String()
		lang := args[1].String()

		var report analyzer.Report
		if err := json.Unmarshal([]byte(reportJSON), &report); err != nil {
			return map[string]any{"error": "invalid report JSON: " + err.Error()}
		}

		var output string
		switch lang {
		case "typescript":
			gen := tsGen.New(report)
			output = gen.Generate()
		case "swift":
			gen := swiftGen.New(report)
			output = gen.Generate()
		case "go":
			gen := goGen.New(report)
			output = gen.Generate()
		default:
			return map[string]any{"error": "unsupported language: " + lang}
		}
		return output
	})
}

func main() {
	js.Global().Set("cadenceCodegenAnalyze", analyzeCode())
	js.Global().Set("cadenceCodegenGenerate", generateCode())

	// Block forever so the WASM stays alive
	select {}
}
```

> **Note:** The analyzer may not have an `AnalyzeCode(code, filename)` method yet — it currently has `AnalyzeFile()` and `AnalyzeDirectory()`. We may need to add a string-based method. Check `internal/analyzer/analyzer.go` — if `analyzeContractCode()` or similar exists as unexported, export it or add a wrapper. The key requirement is: accept a code string + filename, return `*Report`.

**Step 2: Build WASM**

```bash
cp "$(go env GOROOT)/misc/wasm/wasm_exec.js" ./cmd/wasm/
GOOS=js GOARCH=wasm go build -o codegen.wasm ./cmd/wasm/
ls -lh codegen.wasm  # Check size
```

Expected: builds successfully, produces `codegen.wasm` (~5-15MB).

If it fails due to `onflow/cadence` WASM incompatibility, we fall back to **server-side approach** (see Fallback section at end).

**Step 3: Test locally**

Create a quick Node.js test:
```bash
node --experimental-wasm-modules -e "
const fs = require('fs');
globalThis.require = require;
require('./cmd/wasm/wasm_exec.js');
const go = new Go();
const wasmBuffer = fs.readFileSync('./codegen.wasm');
WebAssembly.instantiate(wasmBuffer, go.importObject).then(result => {
  go.run(result.instance);
  const report = cadenceCodegenAnalyze('access(all) fun main(): String { return \"hello\" }');
  console.log('Report:', report);
  const ts = cadenceCodegenGenerate(report, 'typescript');
  console.log('TypeScript:', ts);
  process.exit(0);
});
"
```

**Step 4: Commit and publish**

```bash
git add cmd/wasm/ Makefile
git commit -m "feat: add WASM build target for browser codegen"
```

Publish the `codegen.wasm` + `wasm_exec.js` as a GitHub release asset, or copy directly to the runner's `public/` directory.

---

## Task 2: Add WASM loader to runner

**Files:**
- Create: `runner/src/codegen/wasmLoader.ts`
- Copy: `codegen.wasm` → `runner/public/codegen.wasm`
- Copy: `wasm_exec.js` → `runner/public/codegen-wasm_exec.js`

**Step 1: Copy WASM artifacts**

```bash
cp /tmp/cadence-codegen/codegen.wasm runner/public/
cp /tmp/cadence-codegen/cmd/wasm/wasm_exec.js runner/public/codegen-wasm_exec.js
```

**Step 2: Create wasmLoader.ts**

```typescript
// runner/src/codegen/wasmLoader.ts

declare global {
  function cadenceCodegenAnalyze(code: string, filename?: string): string;
  function cadenceCodegenGenerate(reportJSON: string, lang: string): string;

  // Go WASM support
  class Go {
    importObject: WebAssembly.Imports;
    run(instance: WebAssembly.Instance): Promise<void>;
  }
}

let loaded = false;
let loading: Promise<void> | null = null;

export async function ensureCodegenLoaded(): Promise<void> {
  if (loaded) return;
  if (loading) return loading;

  loading = (async () => {
    // Load wasm_exec.js (Go runtime)
    if (typeof Go === 'undefined') {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/codegen-wasm_exec.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load codegen wasm_exec.js'));
        document.head.appendChild(script);
      });
    }

    const go = new Go();
    const result = await WebAssembly.instantiateStreaming(
      fetch('/codegen.wasm'),
      go.importObject,
    );
    // Don't await — go.run() blocks until WASM exits (which is never)
    go.run(result.instance);
    loaded = true;
  })();

  return loading;
}

export type CodegenLanguage = 'typescript' | 'swift' | 'go';

export interface CodegenResult {
  code: string;
  error?: string;
}

export function analyzeAndGenerate(
  cadenceCode: string,
  language: CodegenLanguage,
  filename?: string,
): CodegenResult {
  const reportJSON = cadenceCodegenAnalyze(cadenceCode, filename);

  // Check if analyze returned an error object
  try {
    const parsed = JSON.parse(reportJSON);
    if (parsed.error) {
      return { code: '', error: parsed.error };
    }
  } catch {
    // Not JSON error, treat as valid report
  }

  const output = cadenceCodegenGenerate(reportJSON, language);

  // Check if generate returned an error object
  if (typeof output === 'object' && (output as any).error) {
    return { code: '', error: (output as any).error };
  }

  return { code: output };
}
```

**Step 3: Verify TypeScript compiles**

```bash
cd runner && npx tsc --noEmit src/codegen/wasmLoader.ts
```

**Step 4: Commit**

```bash
git add src/codegen/ public/codegen.wasm public/codegen-wasm_exec.js
git commit -m "feat(runner): add cadence-codegen WASM loader"
```

---

## Task 3: Create CodegenPanel component

**Files:**
- Create: `runner/src/components/CodegenPanel.tsx`

**Step 1: Create the component**

```tsx
// runner/src/components/CodegenPanel.tsx

import { useState, useCallback, useMemo } from 'react';
import { Loader2, Copy, Check, Download, Play } from 'lucide-react';
import {
  ensureCodegenLoaded,
  analyzeAndGenerate,
  type CodegenLanguage,
} from '../codegen/wasmLoader';

interface CodegenPanelProps {
  code: string;
  filename?: string;
}

const LANGUAGES: { key: CodegenLanguage; label: string; ext: string; monacoLang: string }[] = [
  { key: 'typescript', label: 'TypeScript', ext: 'ts', monacoLang: 'typescript' },
  { key: 'swift', label: 'Swift', ext: 'swift', monacoLang: 'swift' },
  { key: 'go', label: 'Go', ext: 'go', monacoLang: 'go' },
];

export default function CodegenPanel({ code, filename }: CodegenPanelProps) {
  const [language, setLanguage] = useState<CodegenLanguage>('typescript');
  const [results, setResults] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  // Track which source code was used for current results
  const [generatedFrom, setGeneratedFrom] = useState<string>('');

  const generated = results[language] || '';
  const isStale = generatedFrom !== code;
  const langConfig = LANGUAGES.find((l) => l.key === language)!;

  const handleGenerate = useCallback(async () => {
    if (!code.trim()) {
      setError('No Cadence code to convert');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await ensureCodegenLoaded();

      // Generate for all languages at once (analyze is the expensive part)
      const newResults: Record<string, string> = {};
      for (const lang of LANGUAGES) {
        const result = analyzeAndGenerate(code, lang.key, filename);
        if (result.error) {
          setError(result.error);
          setLoading(false);
          return;
        }
        newResults[lang.key] = result.code;
      }

      setResults(newResults);
      setGeneratedFrom(code);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setLoading(false);
  }, [code, filename]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(generated).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [generated]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([generated], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const baseName = (filename || 'cadence').replace(/\.cdc$/, '');
    a.download = `${baseName}.${langConfig.ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [generated, filename, langConfig]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-2">
        {/* Language pills */}
        <div className="flex items-center bg-zinc-800 rounded overflow-hidden border border-zinc-700">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.key}
              onClick={() => setLanguage(lang.key)}
              className={`px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                language === lang.key
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {lang.label}
            </button>
          ))}
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={loading || !code.trim()}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded border transition-colors bg-emerald-900/50 text-emerald-400 border-emerald-700 hover:bg-emerald-800/50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Play className="w-3 h-3" />
          )}
          {loading ? 'Generating...' : 'Generate'}
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Copy + Download (only when there's output) */}
        {generated && (
          <>
            <button
              onClick={handleCopy}
              className={`flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded border transition-colors ${
                copied
                  ? 'bg-emerald-900/50 text-emerald-400 border-emerald-700'
                  : 'bg-zinc-800 text-zinc-500 border-zinc-700 hover:text-zinc-300 hover:border-zinc-600'
              }`}
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded border transition-colors bg-zinc-800 text-zinc-500 border-zinc-700 hover:text-zinc-300 hover:border-zinc-600"
            >
              <Download className="w-3 h-3" />
              .{langConfig.ext}
            </button>
          </>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto font-mono text-xs">
        {error ? (
          <div className="text-red-400 p-2 bg-red-900/20 rounded border border-red-800">
            {error}
          </div>
        ) : !generated ? (
          <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
            {isStale && generatedFrom
              ? 'Code changed — click Generate to update'
              : 'Click Generate to convert your Cadence code'}
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-all leading-relaxed text-zinc-300 p-1">
            {generated}
          </pre>
        )}
      </div>
    </div>
  );
}
```

> **Note:** We use a plain `<pre>` for generated code initially. If we want Monaco readonly viewer with proper syntax highlighting, that can be a follow-up enhancement — it adds significant bundle weight and complexity for a secondary feature. The `<pre>` is good enough for v1.

**Step 2: Commit**

```bash
git add src/components/CodegenPanel.tsx
git commit -m "feat(runner): add CodegenPanel component"
```

---

## Task 4: Wire CodegenPanel into ResultPanel

**Files:**
- Modify: `runner/src/components/ResultPanel.tsx`
- Modify: `runner/src/App.tsx` (pass `code` prop)

**Step 1: Update ResultPanel to accept code prop and add Codegen tab**

In `ResultPanel.tsx`:

1. Add to imports:
```typescript
import { lazy, Suspense } from 'react';
import { Loader2, Code2, List, Copy, Check, Braces } from 'lucide-react';

const CodegenPanel = lazy(() => import('./CodegenPanel'));
```

2. Update `ResultPanelProps`:
```typescript
interface ResultPanelProps {
  results: ExecutionResult[];
  loading: boolean;
  network?: 'mainnet' | 'testnet';
  code?: string;
  filename?: string;
}
```

3. Update `Tab` type:
```typescript
type Tab = 'result' | 'events' | 'logs' | 'codegen';
```

4. Add `codegen` to the tabs array (after `logs`):
```typescript
{ key: 'codegen' as Tab, label: 'Codegen' },
```

5. Add codegen content branch before the closing `)}` of the content section (after the logs `<div>`):

```tsx
) : tab === 'codegen' ? (
  <Suspense fallback={<div className="flex items-center justify-center h-full text-zinc-600"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading...</div>}>
    <CodegenPanel code={code || ''} filename={filename} />
  </Suspense>
```

6. Update the function signature:
```typescript
export default function ResultPanel({ results, loading, network, code, filename }: ResultPanelProps) {
```

**Step 2: Pass code to ResultPanel in App.tsx**

Find the line (around line 1352):
```tsx
<ResultPanel results={results} loading={loading} network={network} />
```

Change to:
```tsx
<ResultPanel results={results} loading={loading} network={network} code={activeCode} filename={project.activeFile} />
```

**Step 3: Build and verify**

```bash
cd runner && bun run build
```

Expected: builds successfully with no TypeScript errors.

**Step 4: Commit**

```bash
git add src/components/ResultPanel.tsx src/App.tsx
git commit -m "feat(runner): wire CodegenPanel into ResultPanel as new tab"
```

---

## Task 5: Syntax highlighting for generated code (enhancement)

**Files:**
- Modify: `runner/src/components/CodegenPanel.tsx`

**Step 1: Add shiki-based highlighting**

The runner already has `shiki` as a dependency and `useShiki.ts` hook. Use it for syntax highlighting the generated code instead of plain `<pre>`:

```typescript
import { useShiki } from '../hooks/useShiki';
```

Inside the component, add:
```typescript
const highlighted = useShiki(generated, langConfig.monacoLang);
```

Replace the `<pre>` render with:
```tsx
{highlighted ? (
  <div
    className="leading-relaxed p-1 [&_pre]:!bg-transparent [&_code]:!bg-transparent"
    dangerouslySetInnerHTML={{ __html: highlighted }}
  />
) : (
  <pre className="whitespace-pre-wrap break-all leading-relaxed text-zinc-300 p-1">
    {generated}
  </pre>
)}
```

**Step 2: Build and verify**

```bash
cd runner && bun run build
```

**Step 3: Commit**

```bash
git add src/components/CodegenPanel.tsx
git commit -m "feat(runner): add syntax highlighting to codegen output"
```

---

## Fallback: Server-side approach

If Go WASM compilation fails (e.g., `onflow/cadence` has unsupported syscalls), fall back to:

1. `npm install @outblock/cadence-codegen` in `runner/`
2. Add endpoint to `runner/server/`:
   ```typescript
   app.post('/api/codegen', async (req, res) => {
     const { code, language } = req.body;
     // Write code to temp file, spawn CLI, return output
     const tmp = await fs.mkdtemp('/tmp/codegen-');
     const input = path.join(tmp, 'main.cdc');
     await fs.writeFile(input, code);
     const { stdout } = await exec(`cadence-codegen ${language} ${input} /dev/stdout`);
     res.json({ code: stdout });
   });
   ```
3. Update `wasmLoader.ts` to call the API instead of WASM.

This is the backup plan — try WASM first.

---

## Execution Order

1. **Task 1** (cadence-codegen WASM) — must succeed before everything else
2. **Task 2** (WASM loader) — depends on Task 1 artifacts
3. **Task 3** (CodegenPanel) — can be done in parallel with Task 2
4. **Task 4** (wire into ResultPanel) — depends on Tasks 2 + 3
5. **Task 5** (syntax highlighting) — enhancement, depends on Task 4

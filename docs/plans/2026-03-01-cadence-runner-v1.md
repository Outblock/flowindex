# V1: Common Scripts Run Button — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Run Script" button to the Common Scripts tab on the contract detail page, allowing users to execute read-only Cadence scripts directly against Flow mainnet with parameter input and formatted result display.

**Architecture:** Frontend-only change. FCL `fcl.query()` executes scripts directly against Flow Access Node (already configured). Parameters parsed from Cadence `fun main(...)` signature. Results displayed as formatted JSON.

**Tech Stack:** React, @onflow/fcl (existing), SyntaxHighlighter (existing), TailwindCSS (existing)

---

### Task 1: Add Parameter Parsing Utility

**Files:**
- Create: `frontend/app/utils/cadenceParams.ts`

**Step 1: Create the parameter parser**

```typescript
// frontend/app/utils/cadenceParams.ts

export interface CadenceParam {
  name: string;
  type: string;
}

/**
 * Parse parameters from a Cadence script's main function signature.
 * Handles: fun main(name: Type, name2: Type2): ReturnType
 */
export function parseMainParams(code: string): CadenceParam[] {
  // Match fun main(...) allowing for access modifiers
  const match = code.match(/fun\s+main\s*\(([^)]*)\)/);
  if (!match || !match[1].trim()) return [];

  return match[1].split(',').map(param => {
    const parts = param.trim().split(':').map(s => s.trim());
    return { name: parts[0], type: parts[1] || 'String' };
  }).filter(p => p.name);
}

/**
 * Map a Cadence type string to an FCL type constructor name.
 * Returns the string name to look up on the `t` object in fcl.query args callback.
 */
export function fclTypeName(cadenceType: string): string {
  const t = cadenceType.trim();
  // Handle Optional types (e.g., "Address?")
  const base = t.replace('?', '');

  const map: Record<string, string> = {
    'Address': 'Address',
    'String': 'String',
    'Bool': 'Bool',
    'Int': 'Int',
    'Int8': 'Int8',
    'Int16': 'Int16',
    'Int32': 'Int32',
    'Int64': 'Int64',
    'Int128': 'Int128',
    'Int256': 'Int256',
    'UInt': 'UInt',
    'UInt8': 'UInt8',
    'UInt16': 'UInt16',
    'UInt32': 'UInt32',
    'UInt64': 'UInt64',
    'UInt128': 'UInt128',
    'UInt256': 'UInt256',
    'Fix64': 'Fix64',
    'UFix64': 'UFix64',
    'Character': 'Character',
    'Path': 'Path',
  };

  if (map[base]) {
    return t.endsWith('?') ? `Optional(${map[base]})` : map[base];
  }

  // Array types: [Type]
  const arrayMatch = base.match(/^\[(.+)\]$/);
  if (arrayMatch) {
    return `Array(${fclTypeName(arrayMatch[1])})`;
  }

  // Dictionary types: {KeyType: ValueType}
  const dictMatch = base.match(/^\{(.+)\s*:\s*(.+)\}$/);
  if (dictMatch) {
    return `Dictionary({key: ${fclTypeName(dictMatch[1])}, value: ${fclTypeName(dictMatch[2])}})`;
  }

  // Fallback to String for unknown types
  return 'String';
}

/**
 * Build FCL args callback from parameter values.
 */
export function buildFclArgs(params: CadenceParam[], values: Record<string, string>) {
  return (arg: any, t: any) => {
    return params.map(p => {
      const raw = values[p.name] || '';
      const typeName = fclTypeName(p.type);

      // Resolve the FCL type from the type name string
      const fclType = resolveType(t, typeName);

      // Coerce value based on type
      let value: any = raw;
      if (p.type === 'Bool') {
        value = raw === 'true';
      }
      if (p.type === 'UFix64' || p.type === 'Fix64') {
        // FCL expects string with decimal for Fix64 types
        value = raw.includes('.') ? raw : `${raw}.0`;
      }
      if (p.type.endsWith('?') && raw === '') {
        value = null;
      }

      return arg(value, fclType);
    });
  };
}

function resolveType(t: any, typeName: string): any {
  // Handle Optional(X)
  const optMatch = typeName.match(/^Optional\((.+)\)$/);
  if (optMatch) return t.Optional(resolveType(t, optMatch[1]));

  // Handle Array(X)
  const arrMatch = typeName.match(/^Array\((.+)\)$/);
  if (arrMatch) return t.Array(resolveType(t, arrMatch[1]));

  // Handle Dictionary({key: X, value: Y})
  const dictMatch = typeName.match(/^Dictionary\(\{key:\s*(.+),\s*value:\s*(.+)\}\)$/);
  if (dictMatch) return t.Dictionary({key: resolveType(t, dictMatch[1]), value: resolveType(t, dictMatch[2])});

  // Simple type
  return t[typeName] || t.String;
}
```

**Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to cadenceParams.ts

**Step 3: Commit**

```bash
git add frontend/app/utils/cadenceParams.ts
git commit -m "feat: add Cadence parameter parsing utility for script execution"
```

---

### Task 2: Add Script Execution UI to Common Scripts Tab

**Files:**
- Modify: `frontend/app/routes/contracts/$id.tsx`

**Step 1: Add imports and state**

At top of file, add imports:
```typescript
import * as fcl from '@onflow/fcl';
import { parseMainParams, buildFclArgs, type CadenceParam } from '~/utils/cadenceParams';
```

Add state variables near existing script state (around line 172):
```typescript
const [scriptParams, setScriptParams] = useState<CadenceParam[]>([]);
const [paramValues, setParamValues] = useState<Record<string, string>>({});
const [scriptResult, setScriptResult] = useState<string | null>(null);
const [scriptError, setScriptError] = useState<string | null>(null);
const [scriptRunning, setScriptRunning] = useState(false);
```

**Step 2: Add parameter parsing effect**

After the existing `loadScriptText` function, add:
```typescript
// Parse parameters when script text changes
useEffect(() => {
  if (selectedScriptText) {
    const params = parseMainParams(selectedScriptText);
    setScriptParams(params);
    setParamValues({});
    setScriptResult(null);
    setScriptError(null);
  }
}, [selectedScriptText]);
```

**Step 3: Add execution handler**

```typescript
const runScript = async () => {
  if (!selectedScriptText) return;
  setScriptRunning(true);
  setScriptResult(null);
  setScriptError(null);

  try {
    const args = scriptParams.length > 0
      ? buildFclArgs(scriptParams, paramValues)
      : undefined;

    const result = await fcl.query({
      cadence: selectedScriptText,
      args,
      limit: 9999,
    });

    setScriptResult(
      typeof result === 'object'
        ? JSON.stringify(result, null, 2)
        : String(result)
    );
  } catch (err: any) {
    let msg = err?.message || err?.toString() || 'Unknown error';
    // Extract root cause from Flow error chains
    if (msg.includes('error caused by:')) {
      msg = msg.split('error caused by:').pop()?.trim() || msg;
    }
    setScriptError(msg);
  } finally {
    setScriptRunning(false);
  }
};
```

**Step 4: Modify the right panel UI**

Replace the right panel section (around lines 777-804) with:

```tsx
{/* Right panel - script code + execution */}
<div className={`flex-1 flex flex-col overflow-hidden ${theme === 'dark' ? 'bg-[#1e1e1e]' : 'bg-zinc-50'}`}>
  {scriptTextLoading ? (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="w-5 h-5 animate-spin text-zinc-400" />
    </div>
  ) : selectedScriptText ? (
    <>
      {/* Toolbar */}
      <div className={`flex items-center justify-between px-3 py-2 border-b ${theme === 'dark' ? 'border-zinc-700 bg-[#252526]' : 'border-zinc-200 bg-white'}`}>
        <span className={`text-xs font-medium ${theme === 'dark' ? 'text-zinc-300' : 'text-zinc-600'}`}>
          {scripts.find(s => s.script_hash === selectedScript)?.label || selectedScript?.slice(0, 12)}
        </span>
        <button
          onClick={runScript}
          disabled={scriptRunning}
          className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium transition-colors ${
            scriptRunning
              ? 'bg-zinc-600 text-zinc-400 cursor-not-allowed'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white'
          }`}
        >
          {scriptRunning ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Play className="w-3 h-3" />
          )}
          {scriptRunning ? 'Running...' : 'Run Script'}
        </button>
      </div>

      {/* Code viewer */}
      <div className="flex-1 overflow-auto">
        <SyntaxHighlighter
          language="swift"
          style={syntaxTheme}
          customStyle={{
            margin: 0,
            padding: '1rem',
            fontSize: '11px',
            lineHeight: '1.6',
            minHeight: '100%',
            background: 'transparent',
          }}
          showLineNumbers={true}
          lineNumberStyle={{ minWidth: "2em", paddingRight: "1em", color: theme === 'dark' ? "#555" : "#999", userSelect: "none", textAlign: "right" }}
        >
          {selectedScriptText}
        </SyntaxHighlighter>
      </div>

      {/* Parameters section (if script has params) */}
      {scriptParams.length > 0 && (
        <div className={`border-t px-3 py-2 ${theme === 'dark' ? 'border-zinc-700 bg-[#1e1e1e]' : 'border-zinc-200 bg-zinc-50'}`}>
          <div className={`text-[10px] font-medium uppercase tracking-wider mb-2 ${theme === 'dark' ? 'text-zinc-500' : 'text-zinc-400'}`}>
            Parameters
          </div>
          <div className="space-y-1.5">
            {scriptParams.map(p => (
              <div key={p.name} className="flex items-center gap-2">
                <label className={`text-xs w-24 shrink-0 ${theme === 'dark' ? 'text-zinc-400' : 'text-zinc-500'}`}>
                  {p.name} <span className="text-[10px] opacity-60">({p.type})</span>
                </label>
                <input
                  type="text"
                  value={paramValues[p.name] || ''}
                  onChange={e => setParamValues(prev => ({ ...prev, [p.name]: e.target.value }))}
                  placeholder={p.type === 'Address' ? '0x...' : p.type}
                  className={`flex-1 text-xs px-2 py-1 rounded border outline-none ${
                    theme === 'dark'
                      ? 'bg-zinc-800 border-zinc-600 text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500'
                      : 'bg-white border-zinc-300 text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400'
                  }`}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Result section */}
      {(scriptResult !== null || scriptError !== null) && (
        <div className={`border-t px-3 py-2 max-h-48 overflow-auto ${theme === 'dark' ? 'border-zinc-700' : 'border-zinc-200'}`}>
          <div className={`text-[10px] font-medium uppercase tracking-wider mb-1.5 ${
            scriptError ? 'text-red-400' : theme === 'dark' ? 'text-zinc-500' : 'text-zinc-400'
          }`}>
            {scriptError ? 'Error' : 'Result'}
          </div>
          {scriptError ? (
            <pre className="text-xs text-red-400 whitespace-pre-wrap break-all font-mono">{scriptError}</pre>
          ) : (
            <pre className={`text-xs whitespace-pre-wrap break-all font-mono ${theme === 'dark' ? 'text-emerald-400' : 'text-emerald-700'}`}>
              {scriptResult}
            </pre>
          )}
        </div>
      )}
    </>
  ) : (
    <div className={`flex items-center justify-center h-full text-sm ${theme === 'dark' ? 'text-zinc-500' : 'text-zinc-400'}`}>
      Select a script to view its code
    </div>
  )}
</div>
```

**Step 5: Add Play icon import**

Add `Play` to the lucide-react import at top of file (find the existing lucide import line and add `Play`):
```typescript
// Find the existing import from lucide-react and add Play and Loader2
import { ..., Play, Loader2, ... } from 'lucide-react';
```

Note: `Loader2` may already be imported. Check the existing imports first.

**Step 6: Verify build**

Run: `cd frontend && bun run build 2>&1 | tail -20`
Expected: Build succeeds

**Step 7: Commit**

```bash
git add frontend/app/routes/contracts/\$id.tsx
git commit -m "feat: add Run Script button to Common Scripts tab with parameter input and result display"
```

---

### Task 3: Test Manually & Polish

**Step 1: Start frontend dev server**

Run: `cd frontend && bun run dev`

**Step 2: Navigate to a contract with common scripts**

Open: `http://localhost:5173/contracts/A.0b2a3299cc857e29.FastBreakV1?tab=scripts`

Test:
1. Select a script from the sidebar
2. Verify "Run Script" button appears in toolbar
3. If script has parameters, verify parameter inputs appear
4. Click "Run Script" — verify execution and result display
5. Test with a bad parameter — verify error display

**Step 3: Test edge cases**

- Script with no parameters (should run directly)
- Script with Address parameter (e.g., `0x1654653399040a61`)
- Script that returns complex objects
- Script that fails (verify error message is readable)
- Rapid clicks on Run (verify no duplicate executions)

**Step 4: Final commit if any polish needed**

```bash
git add -A
git commit -m "fix: polish script execution UI"
```

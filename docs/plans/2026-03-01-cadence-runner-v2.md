# V2: Cadence Runner Standalone Project — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone Cadence Runner playground (runner.flowindex.io) with Monaco Editor, Cadence LSP via WASM, FCL script/transaction execution, wallet connection, AI chat integration, and iframe embedding in the main FlowIndex site.

**Architecture:** Independent Vite+React project. Monaco Editor with custom Cadence language. Cadence WASM Language Server for in-browser type checking (from reference project). FCL direct-connect for execution. AI Chat panel reused from main project. Backend adds one proxy endpoint for cadence-mcp static checking fallback.

**Tech Stack:** Vite, React 19, TailwindCSS, Monaco Editor, @onflow/fcl, @ai-sdk/react, monaco-languageclient (Cadence WASM LSP)

**Reference Project:** https://github.com/bluesign/runnerDnzDev — Next.js Cadence runner with Monaco + WASM LSP + FCL. Key files to study: `src/components/editor/Cadence/cadence.js` (language def), `src/state/dispatch.ts` (execution), `language-server.ts` (WASM LSP), `src/utils/cadenceValueConverter.ts` (result formatting).

---

### Task 1: Scaffold the Runner Project

**Files:**
- Create: `runner/package.json`
- Create: `runner/vite.config.ts`
- Create: `runner/tsconfig.json`
- Create: `runner/index.html`
- Create: `runner/src/main.tsx`
- Create: `runner/src/App.tsx`
- Create: `runner/tailwind.config.js`
- Create: `runner/postcss.config.js`

**Step 1: Create project directory**

```bash
mkdir -p runner/src runner/public
```

**Step 2: Create package.json**

```json
{
  "name": "cadence-runner",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@ai-sdk/react": "^3.0.103",
    "@monaco-editor/react": "^4.7.0",
    "@onflow/fcl": "^1.21.9",
    "ai": "^6.0.101",
    "axios": "^1.13.4",
    "clsx": "^2.1.0",
    "lucide-react": "^0.563.0",
    "monaco-editor": "^0.50.0",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-json-view-lite": "^2.1.0",
    "tailwind-merge": "^2.2.0"
  },
  "devDependencies": {
    "@types/react": "^19.2.13",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^5.1.3",
    "autoprefixer": "^10.4.24",
    "postcss": "^8.5.6",
    "tailwindcss": "^3.4.19",
    "typescript": "^5.9.3",
    "vite": "^7.3.1"
  }
}
```

**Step 3: Create vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '~': '/src',
    },
  },
  optimizeDeps: {
    include: ['monaco-editor'],
  },
  worker: {
    format: 'es',
  },
});
```

**Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true,
    "paths": { "~/*": ["./src/*"] }
  },
  "include": ["src"]
}
```

**Step 5: Create index.html, main.tsx, App.tsx shell**

`runner/index.html`:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cadence Runner — FlowIndex</title>
</head>
<body class="h-screen overflow-hidden">
  <div id="root" class="h-full"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

`runner/src/main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

`runner/src/App.tsx`:
```tsx
export default function App() {
  return (
    <div className="h-screen flex flex-col bg-zinc-900 text-zinc-100">
      <header className="h-12 border-b border-zinc-700 flex items-center px-4 gap-3">
        <span className="text-sm font-semibold">Cadence Runner</span>
      </header>
      <main className="flex-1 flex items-center justify-center text-zinc-500">
        Editor coming soon
      </main>
    </div>
  );
}
```

`runner/src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body { margin: 0; font-family: 'GeistMono', 'SF Mono', monospace; }
```

`runner/tailwind.config.js`:
```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

`runner/postcss.config.js`:
```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

**Step 6: Install and verify**

```bash
cd runner && bun install && bun run dev
```
Expected: Dev server starts, shows "Cadence Runner" header with placeholder

**Step 7: Commit**

```bash
git add runner/
git commit -m "feat: scaffold standalone Cadence Runner project"
```

---

### Task 2: Monaco Editor + Cadence Language

**Files:**
- Create: `runner/src/editor/cadenceLanguage.ts` (Cadence language definition for Monaco)
- Create: `runner/src/editor/CadenceEditor.tsx` (Monaco editor component)
- Create: `runner/src/editor/cadenceTheme.ts` (Dark/light themes)

**Step 1: Create Cadence language definition**

Port from reference project (`src/components/editor/Cadence/cadence.js`):

```typescript
// runner/src/editor/cadenceLanguage.ts
import type * as Monaco from 'monaco-editor';

export function registerCadenceLanguage(monaco: typeof Monaco) {
  // Register language
  monaco.languages.register({
    id: 'cadence',
    extensions: ['.cdc'],
    aliases: ['Cadence', 'cadence'],
  });

  // Monarch tokenizer
  monaco.languages.setMonarchTokensProvider('cadence', {
    defaultToken: '',
    tokenPostfix: '.cadence',

    keywords: [
      'if', 'else', 'return', 'continue', 'break', 'while', 'for', 'in',
      'switch', 'case', 'default', 'fun', 'let', 'var', 'import', 'from',
      'transaction', 'prepare', 'execute', 'pre', 'post',
      'access', 'all', 'self', 'account', 'contract', 'resource', 'struct',
      'event', 'emit', 'interface', 'attachment', 'require', 'entitlement',
      'mapping', 'view', 'remove', 'destroy', 'create', 'nil',
      'true', 'false', 'as', 'as!', 'as?',
    ],

    typeKeywords: [
      'String', 'Bool', 'Character', 'Address', 'Void', 'Never', 'AnyStruct', 'AnyResource',
      'Int', 'Int8', 'Int16', 'Int32', 'Int64', 'Int128', 'Int256',
      'UInt', 'UInt8', 'UInt16', 'UInt32', 'UInt64', 'UInt128', 'UInt256',
      'Word8', 'Word16', 'Word32', 'Word64', 'Word128', 'Word256',
      'Fix64', 'UFix64',
      'Path', 'StoragePath', 'CapabilityPath', 'PublicPath', 'PrivatePath',
      'Type', 'Account', 'Capability',
    ],

    accessModifiers: ['access', 'entitlement'],

    operators: [
      '=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=',
      '&&', '||', '++', '--', '+', '-', '*', '/', '&', '|', '^',
      '%', '<<', '>>', '>>>', '+=', '-=', '*=', '/=', '&=', '|=',
      '^=', '%=', '<<=', '>>=', '>>>=', '<-', '<-!',
    ],

    symbols: /[=><!~?:&|+\-*/^%]+/,

    tokenizer: {
      root: [
        // Import statements
        [/(import)(\s+)(\w+)(\s+)(from)(\s+)(0x[0-9a-fA-F]+)/, [
          'keyword', '', 'type.identifier', '', 'keyword', '', 'number.hex',
        ]],

        // Access control
        [/access\s*\(\s*(all|self|account|contract)\s*\)/, 'keyword'],

        // Identifiers and keywords
        [/[a-zA-Z_]\w*/, {
          cases: {
            '@typeKeywords': 'type.identifier',
            '@keywords': 'keyword',
            '@default': 'identifier',
          },
        }],

        // Whitespace
        { include: '@whitespace' },

        // Delimiters
        [/[{}()\[\]]/, '@brackets'],
        [/[<>](?!@symbols)/, '@brackets'],

        // Operators
        [/@symbols/, {
          cases: {
            '@operators': 'operator',
            '@default': '',
          },
        }],

        // Numbers
        [/0x[0-9a-fA-F]+/, 'number.hex'],
        [/\d*\.\d+([eE][\-+]?\d+)?/, 'number.float'],
        [/\d+/, 'number'],

        // Strings
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/"/, { token: 'string.quote', bracket: '@open', next: '@string' }],
      ],

      string: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, { token: 'string.quote', bracket: '@close', next: '@pop' }],
      ],

      whitespace: [
        [/[ \t\r\n]+/, 'white'],
        [/\/\*/, 'comment', '@comment'],
        [/\/\/.*$/, 'comment'],
      ],

      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],
    },
  });

  // Bracket definitions
  monaco.languages.setLanguageConfiguration('cadence', {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
    ],
    folding: {
      markers: {
        start: /^\s*\/\/\s*#?region\b/,
        end: /^\s*\/\/\s*#?endregion\b/,
      },
    },
  });
}
```

**Step 2: Create Cadence dark/light themes**

```typescript
// runner/src/editor/cadenceTheme.ts
import type * as Monaco from 'monaco-editor';

export function registerCadenceThemes(monaco: typeof Monaco) {
  monaco.editor.defineTheme('cadence-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: 'c586c0' },
      { token: 'type.identifier', foreground: '4ec9b0' },
      { token: 'identifier', foreground: '9cdcfe' },
      { token: 'number', foreground: 'b5cea8' },
      { token: 'number.hex', foreground: 'b5cea8' },
      { token: 'number.float', foreground: 'b5cea8' },
      { token: 'string', foreground: 'ce9178' },
      { token: 'comment', foreground: '6a9955' },
      { token: 'operator', foreground: 'd4d4d4' },
    ],
    colors: {
      'editor.background': '#1e1e1e',
    },
  });

  monaco.editor.defineTheme('cadence-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: 'af00db' },
      { token: 'type.identifier', foreground: '267f99' },
      { token: 'identifier', foreground: '001080' },
      { token: 'number', foreground: '098658' },
      { token: 'number.hex', foreground: '098658' },
      { token: 'string', foreground: 'a31515' },
      { token: 'comment', foreground: '008000' },
    ],
    colors: {
      'editor.background': '#fafafa',
    },
  });
}
```

**Step 3: Create CadenceEditor component**

```typescript
// runner/src/editor/CadenceEditor.tsx
import { useRef, useCallback } from 'react';
import Editor, { type OnMount, type BeforeMount } from '@monaco-editor/react';
import { registerCadenceLanguage } from './cadenceLanguage';
import { registerCadenceThemes } from './cadenceTheme';
import type * as Monaco from 'monaco-editor';

interface CadenceEditorProps {
  code: string;
  onChange: (value: string) => void;
  onRun?: () => void;
  darkMode?: boolean;
}

export function CadenceEditor({ code, onChange, onRun, darkMode = true }: CadenceEditorProps) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);

  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    registerCadenceLanguage(monaco);
    registerCadenceThemes(monaco);
  }, []);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;

    // Ctrl/Cmd+Enter to run
    editor.addAction({
      id: 'run-cadence',
      label: 'Run Cadence Code',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => onRun?.(),
    });

    editor.focus();
  }, [onRun]);

  return (
    <Editor
      language="cadence"
      theme={darkMode ? 'cadence-dark' : 'cadence-light'}
      value={code}
      onChange={(v) => onChange(v || '')}
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        lineHeight: 20,
        fontFamily: "'GeistMono', 'SF Mono', 'Fira Code', monospace",
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 4,
        wordWrap: 'on',
        padding: { top: 12 },
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        renderLineHighlight: 'line',
      }}
    />
  );
}
```

**Step 4: Wire into App.tsx**

```tsx
// runner/src/App.tsx
import { useState } from 'react';
import { CadenceEditor } from './editor/CadenceEditor';

const DEFAULT_CODE = `// Welcome to Cadence Runner
// Press Ctrl+Enter to run

access(all) fun main(): String {
    return "Hello, Flow!"
}
`;

export default function App() {
  const [code, setCode] = useState(DEFAULT_CODE);

  return (
    <div className="h-screen flex flex-col bg-zinc-900 text-zinc-100">
      <header className="h-12 border-b border-zinc-700 flex items-center px-4 gap-3 shrink-0">
        <span className="text-sm font-semibold">Cadence Runner</span>
      </header>
      <main className="flex-1 overflow-hidden">
        <CadenceEditor code={code} onChange={setCode} darkMode={true} />
      </main>
    </div>
  );
}
```

**Step 5: Verify**

```bash
cd runner && bun run dev
```
Expected: Monaco editor loads with Cadence syntax highlighting, default code shown

**Step 6: Commit**

```bash
git add runner/src/editor/ runner/src/App.tsx
git commit -m "feat: add Monaco Editor with Cadence language support and themes"
```

---

### Task 3: FCL Configuration + Network Switching

**Files:**
- Create: `runner/src/flow/fclConfig.ts`
- Create: `runner/src/flow/networks.ts`
- Modify: `runner/src/App.tsx`

**Step 1: Create network config**

```typescript
// runner/src/flow/networks.ts
export type FlowNetwork = 'mainnet' | 'testnet';

export const NETWORK_CONFIG: Record<FlowNetwork, Record<string, string>> = {
  mainnet: {
    'accessNode.api': 'https://rest-mainnet.onflow.org',
    'discovery.wallet': 'https://fcl-discovery.onflow.org/authn',
    'flow.network': 'mainnet',
    '0xFungibleToken': '0xf233dcee88fe0abe',
    '0xFlowToken': '0x1654653399040a61',
    '0xNonFungibleToken': '0x1d7e57aa55817448',
    '0xMetadataViews': '0x1d7e57aa55817448',
    '0xEVM': '0xe467b9dd11fa00df',
  },
  testnet: {
    'accessNode.api': 'https://rest-testnet.onflow.org',
    'discovery.wallet': 'https://fcl-discovery.onflow.org/testnet/authn',
    'flow.network': 'testnet',
    '0xFungibleToken': '0x9a0766d93b6608b7',
    '0xFlowToken': '0x7e60df042a9c0868',
    '0xNonFungibleToken': '0x631e88ae7f1d7c20',
    '0xMetadataViews': '0x631e88ae7f1d7c20',
    '0xEVM': '0x8c5303eaa26202d6',
  },
};
```

**Step 2: Create FCL config utility**

```typescript
// runner/src/flow/fclConfig.ts
import * as fcl from '@onflow/fcl';
import { NETWORK_CONFIG, type FlowNetwork } from './networks';

export function configureFcl(network: FlowNetwork) {
  const config = NETWORK_CONFIG[network];
  Object.entries(config).forEach(([key, value]) => {
    fcl.config().put(key, value);
  });
}

export { fcl };
```

**Step 3: Add network selector to App header**

Update `runner/src/App.tsx` to include network switching:

```tsx
import { useState, useEffect } from 'react';
import { CadenceEditor } from './editor/CadenceEditor';
import { configureFcl } from './flow/fclConfig';
import type { FlowNetwork } from './flow/networks';

// ...existing code...

export default function App() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [network, setNetwork] = useState<FlowNetwork>('mainnet');

  useEffect(() => {
    configureFcl(network);
  }, [network]);

  return (
    <div className="h-screen flex flex-col bg-zinc-900 text-zinc-100">
      <header className="h-12 border-b border-zinc-700 flex items-center px-4 gap-3 shrink-0">
        <span className="text-sm font-semibold">Cadence Runner</span>
        <div className="flex-1" />
        <select
          value={network}
          onChange={e => setNetwork(e.target.value as FlowNetwork)}
          className="text-xs bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-zinc-200"
        >
          <option value="mainnet">Mainnet</option>
          <option value="testnet">Testnet</option>
        </select>
      </header>
      <main className="flex-1 overflow-hidden">
        <CadenceEditor code={code} onChange={setCode} darkMode={true} />
      </main>
    </div>
  );
}
```

**Step 4: Verify and commit**

```bash
cd runner && bun run build
git add runner/src/flow/ runner/src/App.tsx
git commit -m "feat: add FCL config with mainnet/testnet network switching"
```

---

### Task 4: Script & Transaction Execution

**Files:**
- Create: `runner/src/flow/execute.ts`
- Create: `runner/src/components/ResultPanel.tsx`
- Create: `runner/src/components/ParamPanel.tsx`
- Modify: `runner/src/App.tsx`

**Step 1: Create execution engine**

```typescript
// runner/src/flow/execute.ts
import * as fcl from '@onflow/fcl';
import { parseMainParams, buildFclArgs, type CadenceParam } from './cadenceParams';

// Copy cadenceParams.ts from frontend/app/utils/cadenceParams.ts
// (reuse the V1 utility created in Task 1 of V1 plan)

export interface ExecutionResult {
  type: 'script_result' | 'tx_submitted' | 'tx_sealed' | 'error';
  data: any;
  events?: any[];
  txId?: string;
}

export function detectCodeType(code: string): 'script' | 'transaction' {
  return code.includes('transaction') && code.includes('prepare')
    ? 'transaction'
    : 'script';
}

export async function executeScript(
  code: string,
  paramValues: Record<string, string>
): Promise<ExecutionResult> {
  const params = parseMainParams(code);
  const args = params.length > 0 ? buildFclArgs(params, paramValues) : undefined;

  try {
    const result = await fcl.query({ cadence: code, args, limit: 9999 });
    return { type: 'script_result', data: result };
  } catch (err: any) {
    return { type: 'error', data: extractError(err) };
  }
}

export async function executeTransaction(
  code: string,
  paramValues: Record<string, string>
): Promise<AsyncGenerator<ExecutionResult>> {
  // Check wallet connection
  const user = await fcl.currentUser.snapshot();
  if (!user?.addr) {
    await fcl.authenticate();
    const newUser = await fcl.currentUser.snapshot();
    if (!newUser?.addr) {
      throw new Error('Wallet connection required to send transactions');
    }
  }

  const params = parseMainParams(code);
  const args = params.length > 0 ? buildFclArgs(params, paramValues) : undefined;

  const txId = await fcl.mutate({
    cadence: code,
    args,
    proposer: fcl.currentUser,
    payer: fcl.currentUser,
    limit: 9999,
  });

  // Return async generator for progressive updates
  return (async function* () {
    yield { type: 'tx_submitted' as const, data: txId, txId };

    try {
      const result = await fcl.tx(txId).onceSealed();
      yield {
        type: 'tx_sealed' as const,
        data: result,
        events: result.events,
        txId,
      };
    } catch (err: any) {
      yield { type: 'error' as const, data: extractError(err) };
    }
  })();
}

function extractError(err: any): string {
  let msg = err?.message || err?.errorMessage || err?.toString() || 'Unknown error';
  if (msg.includes('error caused by:')) {
    msg = msg.split('error caused by:').pop()?.trim() || msg;
  }
  return msg;
}
```

**Step 2: Create result panel component**

```tsx
// runner/src/components/ResultPanel.tsx
import { useState } from 'react';
import type { ExecutionResult } from '~/flow/execute';

interface ResultPanelProps {
  results: ExecutionResult[];
  loading: boolean;
}

export function ResultPanel({ results, loading }: ResultPanelProps) {
  const [activeTab, setActiveTab] = useState<'result' | 'events' | 'logs'>('result');

  const lastResult = results[results.length - 1];
  const events = results.flatMap(r => r.events || []);

  return (
    <div className="h-full flex flex-col">
      {/* Tabs */}
      <div className="flex border-b border-zinc-700 text-xs">
        {(['result', 'events', 'logs'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 capitalize ${
              activeTab === tab
                ? 'text-zinc-100 border-b border-emerald-500'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {tab}
            {tab === 'events' && events.length > 0 && (
              <span className="ml-1 text-[10px] text-zinc-500">({events.length})</span>
            )}
          </button>
        ))}
        {loading && (
          <div className="ml-auto px-3 py-1.5 text-[10px] text-yellow-400 animate-pulse">
            Executing...
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3 font-mono text-xs">
        {activeTab === 'result' && (
          lastResult ? (
            <pre className={`whitespace-pre-wrap break-all ${
              lastResult.type === 'error' ? 'text-red-400' : 'text-emerald-400'
            }`}>
              {typeof lastResult.data === 'object'
                ? JSON.stringify(lastResult.data, null, 2)
                : String(lastResult.data)}
            </pre>
          ) : (
            <div className="text-zinc-600">Press Ctrl+Enter or click Run to execute</div>
          )
        )}

        {activeTab === 'events' && (
          events.length > 0 ? (
            <div className="space-y-2">
              {events.map((e, i) => (
                <div key={i} className="border border-zinc-700 rounded p-2">
                  <div className="text-zinc-400 text-[10px] mb-1">{e.type}</div>
                  <pre className="text-zinc-300 whitespace-pre-wrap">
                    {JSON.stringify(e.data || e, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-zinc-600">No events</div>
          )
        )}

        {activeTab === 'logs' && (
          <div className="space-y-1">
            {results.map((r, i) => (
              <div key={i} className={`${
                r.type === 'error' ? 'text-red-400' :
                r.type === 'tx_submitted' ? 'text-yellow-400' :
                'text-zinc-400'
              }`}>
                [{r.type}] {typeof r.data === 'string' ? r.data : JSON.stringify(r.data)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 3: Create parameter panel component**

```tsx
// runner/src/components/ParamPanel.tsx
import type { CadenceParam } from '~/flow/cadenceParams';

interface ParamPanelProps {
  params: CadenceParam[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}

export function ParamPanel({ params, values, onChange }: ParamPanelProps) {
  if (params.length === 0) return null;

  return (
    <div className="border-t border-zinc-700 px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wider mb-2 text-zinc-500">
        Parameters
      </div>
      <div className="space-y-1.5">
        {params.map(p => (
          <div key={p.name} className="flex items-center gap-2">
            <label className="text-xs w-28 shrink-0 text-zinc-400">
              {p.name} <span className="text-[10px] opacity-60">({p.type})</span>
            </label>
            <input
              type="text"
              value={values[p.name] || ''}
              onChange={e => onChange({ ...values, [p.name]: e.target.value })}
              placeholder={p.type === 'Address' ? '0x...' : p.type}
              className="flex-1 text-xs px-2 py-1 rounded border bg-zinc-800 border-zinc-600 text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 outline-none"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Step 4: Wire execution into App.tsx**

Update App.tsx with full layout: header (network + wallet + run) → editor (top) → params + results (bottom resizable panel).

The full App component should include:
- State for code, network, results, params, loading
- `useEffect` to parse params when code changes
- `runCode()` handler that detects type and calls `executeScript` or `executeTransaction`
- Wallet connect button that calls `fcl.authenticate()`
- Current user display from `fcl.currentUser.subscribe()`
- Split layout: editor top, result panel bottom

**Step 5: Verify and commit**

```bash
cd runner && bun run build
git add runner/src/
git commit -m "feat: add script/transaction execution with params and result display"
```

---

### Task 5: Wallet Connection UI

**Files:**
- Create: `runner/src/components/WalletButton.tsx`
- Modify: `runner/src/App.tsx`

**Step 1: Create wallet button component**

```tsx
// runner/src/components/WalletButton.tsx
import { useState, useEffect } from 'react';
import * as fcl from '@onflow/fcl';
import { Wallet, LogOut } from 'lucide-react';

export function WalletButton() {
  const [user, setUser] = useState<{ addr?: string } | null>(null);

  useEffect(() => {
    return fcl.currentUser.subscribe(setUser);
  }, []);

  if (user?.addr) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-emerald-400 font-mono">
          {user.addr.slice(0, 6)}...{user.addr.slice(-4)}
        </span>
        <button
          onClick={() => fcl.unauthenticate()}
          className="text-zinc-500 hover:text-zinc-300"
          title="Disconnect"
        >
          <LogOut className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => fcl.authenticate()}
      className="flex items-center gap-1.5 px-3 py-1 rounded text-xs bg-zinc-800 border border-zinc-600 text-zinc-300 hover:bg-zinc-700"
    >
      <Wallet className="w-3.5 h-3.5" />
      Connect Wallet
    </button>
  );
}
```

**Step 2: Add to App header and verify**

**Step 3: Commit**

```bash
git add runner/src/components/WalletButton.tsx runner/src/App.tsx
git commit -m "feat: add FCL wallet connection with Blocto/Lilico discovery"
```

---

### Task 6: cadence-mcp Static Checking (Backend Proxy)

**Files:**
- Modify: `backend/internal/api/v1_handlers_contracts.go` (or new file)
- Modify: `backend/internal/api/routes_registration.go`
- Create: `runner/src/editor/useCadenceCheck.ts`

**Step 1: Add backend proxy endpoint**

```go
// In v1_handlers_contracts.go or a new v1_handlers_cadence.go

func (s *Server) handleCadenceCheck(w http.ResponseWriter, r *http.Request) {
    var req struct {
        Code    string `json:"code"`
        Network string `json:"network"`
    }
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        writeAPIError(w, http.StatusBadRequest, "invalid request body")
        return
    }

    // TODO: Forward to cadence-mcp cadence_check endpoint
    // For now, return empty diagnostics (static checking will work via
    // the WASM LSP in the browser, this is a fallback)
    writeAPIResponse(w, http.StatusOK, map[string]any{
        "diagnostics": []any{},
        "valid":       true,
    })
}
```

Register route:
```go
r.HandleFunc("/api/cadence/check", s.handleCadenceCheck).Methods("POST", "OPTIONS")
```

**Step 2: Create frontend hook for debounced checking**

```typescript
// runner/src/editor/useCadenceCheck.ts
import { useEffect, useRef } from 'react';
import type * as Monaco from 'monaco-editor';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'https://api.flowindex.io';

export function useCadenceCheck(
  editorRef: React.RefObject<Monaco.editor.IStandaloneCodeEditor | null>,
  code: string,
  network: string
) {
  const timerRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (!editorRef.current || !code.trim()) return;

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const { data } = await axios.post(`${API_URL}/api/cadence/check`, {
          code,
          network,
        });

        const model = editorRef.current?.getModel();
        if (!model) return;

        const monaco = await import('monaco-editor');
        const markers: Monaco.editor.IMarkerData[] = (data.diagnostics || []).map((d: any) => ({
          severity: d.severity === 'error'
            ? monaco.MarkerSeverity.Error
            : monaco.MarkerSeverity.Warning,
          message: d.message,
          startLineNumber: d.startLine || 1,
          startColumn: d.startColumn || 1,
          endLineNumber: d.endLine || d.startLine || 1,
          endColumn: d.endColumn || 100,
        }));

        monaco.editor.setModelMarkers(model, 'cadence', markers);
      } catch {
        // Silently fail — checking is best-effort
      }
    }, 500);

    return () => clearTimeout(timerRef.current);
  }, [code, network]);
}
```

**Step 3: Commit**

```bash
git add backend/internal/api/ runner/src/editor/useCadenceCheck.ts
git commit -m "feat: add cadence-mcp static checking proxy and frontend hook"
```

---

### Task 7: AI Chat Panel Integration

**Files:**
- Create: `runner/src/components/AIPanel.tsx`
- Modify: `runner/src/App.tsx`

**Step 1: Create AI panel**

The AI panel uses `@ai-sdk/react` `useChat` hook, connecting to the same AI chat backend (`ai.flowindex.io`). It renders in a collapsible left sidebar. Code blocks in AI responses get an "Insert to Editor" button.

Key implementation:
- `useChat({ api: AI_CHAT_URL + '/api/chat' })`
- Custom message renderer that detects Cadence code blocks
- "Insert" button calls `onInsertCode(code)` callback → replaces editor content
- Collapsible via state toggle

**Step 2: Wire into App layout**

```
[AI Panel (280px, collapsible)] | [Editor + Result Panel]
```

**Step 3: Commit**

```bash
git add runner/src/components/AIPanel.tsx runner/src/App.tsx
git commit -m "feat: add AI Chat panel with code insertion into editor"
```

---

### Task 8: iframe Embedding in Main Site

**Files:**
- Create: `frontend/app/routes/developer/runner.tsx`
- Modify: `frontend/app/components/developer/DeveloperLayout.tsx`

**Step 1: Create runner route with iframe**

```tsx
// frontend/app/routes/developer/runner.tsx
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/developer/runner')({
  component: RunnerPage,
});

function RunnerPage() {
  const RUNNER_URL = import.meta.env.VITE_RUNNER_URL || 'https://runner.flowindex.io';

  return (
    <div className="h-[calc(100vh-4rem)]">
      <iframe
        src={RUNNER_URL}
        className="w-full h-full border-0"
        allow="clipboard-write"
        title="Cadence Runner"
      />
    </div>
  );
}
```

**Step 2: Add sidebar link in DeveloperLayout**

Add "Cadence Runner" entry to the developer sidebar navigation.

**Step 3: Add "Open in Runner" button to Common Scripts tab**

In `contracts/$id.tsx`, add a button next to "Run Script" that navigates to the runner with the script code:
```tsx
<a
  href={`${RUNNER_URL}?code=${btoa(selectedScriptText)}`}
  target="_blank"
  rel="noopener"
  className="flex items-center gap-1 px-2 py-1 rounded text-xs text-zinc-400 hover:text-zinc-200"
>
  <ExternalLink className="w-3 h-3" />
  Open in Runner
</a>
```

**Step 4: Commit**

```bash
git add frontend/app/routes/developer/runner.tsx frontend/app/components/developer/DeveloperLayout.tsx frontend/app/routes/contracts/\$id.tsx
git commit -m "feat: embed Cadence Runner in developer portal via iframe"
```

---

### Task 9: Deployment Setup

**Files:**
- Create: `runner/Dockerfile`
- Modify: `.github/workflows/deploy.yml`

**Step 1: Create Dockerfile for runner**

```dockerfile
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

**Step 2: Create nginx.conf for SPA routing**

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

**Step 3: Add deploy step in GitHub Actions**

Add runner build+deploy to the existing deploy workflow, similar to the frontend deployment.

**Step 4: Commit**

```bash
git add runner/Dockerfile runner/nginx.conf .github/workflows/deploy.yml
git commit -m "feat: add runner deployment config"
```

---

### Task 10: URL Parameter Loading + Polish

**Files:**
- Modify: `runner/src/App.tsx`

**Step 1: Read URL params on load**

```typescript
// In App.tsx, on mount:
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const codeParam = params.get('code');
  const networkParam = params.get('network') as FlowNetwork | null;

  if (codeParam) {
    try {
      setCode(atob(codeParam));
    } catch {
      setCode(codeParam); // Maybe not base64
    }
  }
  if (networkParam && ['mainnet', 'testnet'].includes(networkParam)) {
    setNetwork(networkParam);
  }
}, []);
```

**Step 2: Add localStorage persistence for code**

```typescript
// Save code to localStorage on change (debounced)
useEffect(() => {
  const timer = setTimeout(() => {
    localStorage.setItem('runner:code', code);
    localStorage.setItem('runner:network', network);
  }, 1000);
  return () => clearTimeout(timer);
}, [code, network]);

// Load from localStorage on mount (if no URL params)
const [code, setCode] = useState(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('code')) return atob(params.get('code')!);
  return localStorage.getItem('runner:code') || DEFAULT_CODE;
});
```

**Step 3: Final polish and commit**

```bash
git add runner/
git commit -m "feat: add URL param loading and localStorage persistence"
```

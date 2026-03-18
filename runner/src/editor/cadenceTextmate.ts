/**
 * Wire the official Cadence TextMate grammar into Monaco.
 *
 * Uses vscode-textmate + vscode-oniguruma so we get the exact same
 * tokenization as VS Code / GitHub.
 */
import type { editor, languages } from 'monaco-editor';
import { INITIAL, Registry, parseRawGrammar } from 'vscode-textmate';
import { loadWASM, createOnigScanner, createOnigString } from 'vscode-oniguruma';
import cadenceGrammarJson from './cadence.tmGrammar.json';
import { CADENCE_LANGUAGE_ID } from './cadenceLanguage';

// ── Scope → Monaco token mapping ──────────────────────────────────
// Monaco themes use simple token names; TextMate uses hierarchical scopes.
// Map TM scopes to Monaco token names so our cadenceTheme colours apply.
const SCOPE_TO_TOKEN: [RegExp, string][] = [
  [/^punctuation\.definition\.comment/, 'comment'],
  [/^comment/, 'comment'],
  [/^string/, 'string'],
  [/^constant\.numeric/, 'number'],
  [/^constant\.language/, 'keyword'],
  [/^keyword\.operator\.move/, 'operator.move'],
  [/^keyword\.operator/, 'operator'],
  [/^keyword\.control\.import/, 'keyword'],
  [/^keyword/, 'keyword'],
  [/^storage\.type/, 'keyword'],
  [/^storage\.modifier/, 'keyword'],
  [/^entity\.name\.function/, 'function'],
  [/^entity\.name\.type/, 'type'],
  [/^entity\.name/, 'type'],
  [/^support\.type/, 'type'],
  [/^support\.function/, 'function'],
  [/^variable\.parameter/, 'parameter'],
  [/^variable\.other/, 'variable.property'],
  [/^variable/, 'identifier'],
  [/^punctuation\.separator\.mapping/, 'operator'],
  [/^punctuation/, 'delimiter'],
  [/^meta\.function-call/, 'function'],
];

function tmScopeToMonacoToken(scopes: string[]): string {
  // Walk scopes from most-specific to least-specific
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    for (const [re, token] of SCOPE_TO_TOKEN) {
      if (re.test(scope)) return token;
    }
  }
  return '';
}

// ── WASM loading (once) ───────────────────────────────────────────
let wasmReady: Promise<void> | null = null;

// Vite resolves this import to a URL for the wasm asset
import onigWasmUrl from 'vscode-oniguruma/release/onig.wasm?url';

function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    wasmReady = fetch(onigWasmUrl)
      .then((r) => r.arrayBuffer())
      .then((buf) => loadWASM(buf as any));
  }
  return wasmReady;
}

// ── Public API ────────────────────────────────────────────────────

let registered = false;

export async function activateCadenceTextmate(
  monaco: typeof import('monaco-editor'),
): Promise<void> {
  if (registered) return;
  registered = true;

  console.log('[cadence-textmate] Loading oniguruma WASM...');
  await ensureWasm();
  console.log('[cadence-textmate] WASM loaded, creating grammar registry');

  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async (scopeName: string) => {
      if (scopeName === 'source.cadence') {
        return parseRawGrammar(JSON.stringify(cadenceGrammarJson), 'cadence.tmGrammar.json');
      }
      return null;
    },
  });

  const grammar = await registry.loadGrammar('source.cadence');
  if (!grammar) {
    console.warn('[cadence-textmate] Failed to load grammar');
    return;
  }

  console.log('[cadence-textmate] Grammar loaded, registering token provider');

  // Use TokensProvider (NOT EncodedTokensProvider) so Monaco maps our
  // string token names through its own theme system.  EncodedTokensProvider
  // returns binary tokens that need the TM registry to carry a theme —
  // without that every token renders as mtk1 (white).
  const tokensProvider: languages.TokensProvider = {
    getInitialState(): languages.IState {
      return INITIAL as unknown as languages.IState;
    },

    tokenize(line: string, state: languages.IState): languages.ILineTokens {
      const tmState = state as ReturnType<typeof INITIAL.clone>;
      const result = grammar.tokenizeLine(line, tmState);
      const tokens: languages.IToken[] = result.tokens.map((t) => ({
        startIndex: t.startIndex,
        scopes: tmScopeToMonacoToken(t.scopes),
      }));
      return {
        tokens,
        endState: result.ruleStack as unknown as languages.IState,
      };
    },
  };

  // Register — this overrides the Monarch tokenizer for 'cadence'
  monaco.languages.setTokensProvider(CADENCE_LANGUAGE_ID, tokensProvider);
  console.log('[cadence-textmate] Token provider registered for', CADENCE_LANGUAGE_ID);
}

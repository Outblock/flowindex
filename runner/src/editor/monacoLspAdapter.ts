/**
 * Bridges the Cadence WASM Language Server (JSON-RPC) to Monaco editor providers.
 * This avoids the complexity of monaco-languageclient version compat issues
 * by manually wiring LSP request/response to Monaco's provider APIs.
 */
import type * as Monaco from 'monaco-editor';
import type { Message } from 'vscode-jsonrpc';
import type { LSPBridge } from './languageServer';
import { prefetchImports } from './languageServer';
import { CADENCE_LANGUAGE_ID } from './cadenceLanguage';

interface LSPDiagnostic {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  message: string;
  severity?: number;
  source?: string;
}

interface LSPCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { value: string; kind?: string };
  insertText?: string;
  insertTextFormat?: number;
  textEdit?: {
    newText: string;
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  };
  command?: {
    title?: string;
    command: string;
    arguments?: unknown[];
  };
  sortText?: string;
  filterText?: string;
}

const LSP_KIND_KEYWORD = 14;
const LSP_KIND_SNIPPET = 15;
const LSP_INSERT_TEXT_FORMAT_SNIPPET = 2;

interface LSPHoverResult {
  contents: string | { value: string; language?: string; kind?: string } | Array<string | { value: string; language?: string }>;
  range?: { start: { line: number; character: number }; end: { line: number; character: number } };
}

interface MonacoLspAdapterOptions {
  skipInitialize?: boolean;
  resolveDocumentContent?: (uri: string) => string | undefined;
  languageId?: string;
}

export interface DefinitionTarget {
  uri: string;
  line: number;
  character: number;
}

// LSP method constants
const DID_OPEN = 'textDocument/didOpen';
const DID_CHANGE = 'textDocument/didChange';
const DID_CLOSE = 'textDocument/didClose';
const COMPLETION = 'textDocument/completion';
const HOVER = 'textDocument/hover';
const SIGNATURE_HELP = 'textDocument/signatureHelp';
const DEFINITION = 'textDocument/definition';
const PUBLISH_DIAGNOSTICS = 'textDocument/publishDiagnostics';
const INITIALIZE = 'initialize';
const INITIALIZED = 'initialized';

let requestId = 0;
const pendingRequests = new Map<number, { resolve: (result: any) => void; reject: (err: any) => void }>();

function nextId(): number {
  return ++requestId;
}

function sendRequest(bridge: LSPBridge, method: string, params: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = nextId();
    pendingRequests.set(id, { resolve, reject });
    bridge.sendToServer({ jsonrpc: '2.0', id, method, params } as any);
    // Timeout after 10s
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`LSP request ${method} timed out`));
      }
    }, 10000);
  });
}

function sendNotification(bridge: LSPBridge, method: string, params: any) {
  bridge.sendToServer({ jsonrpc: '2.0', method, params } as any);
}

function prefetchImportsInBackground(code: string) {
  void prefetchImports(code).catch((error) => {
    console.warn('[LSP] Background import prefetch failed:', error);
  });
}

// Track open documents and their versions
const documentVersions = new Map<string, number>();

function fileUri(path: string): string {
  if (path.startsWith('file://')) return path;
  return `file://${path.startsWith('/') ? '' : '/'}${path}`;
}

function isMemberAccessContext(
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
): boolean {
  const linePrefix = model.getLineContent(position.lineNumber).slice(0, Math.max(0, position.column - 1));
  return /(?:\.|\?\.)[A-Za-z_0-9]*$/.test(linePrefix);
}

function filterCompletionItemsForContext(
  items: LSPCompletionItem[],
  model: Monaco.editor.ITextModel,
  position: Monaco.Position,
): LSPCompletionItem[] {
  if (!isMemberAccessContext(model, position)) {
    return items;
  }

  return items.filter((item) => {
    if ((item.sortText ?? '').startsWith('1')) {
      return false;
    }
    return item.kind !== LSP_KIND_KEYWORD && item.kind !== LSP_KIND_SNIPPET;
  });
}

function containsSnippetTabstop(text: string | undefined): boolean {
  if (!text) {
    return false;
  }

  return /\$(?:0|\d+|\{\d+(?::[^}]*)?\})/.test(text);
}

function getCompletionInsertText(item: LSPCompletionItem): string {
  return item.textEdit?.newText || item.insertText || item.label;
}

function isSnippetCompletionItem(item: LSPCompletionItem): boolean {
  if (item.insertTextFormat === LSP_INSERT_TEXT_FORMAT_SNIPPET) {
    return true;
  }

  return containsSnippetTabstop(getCompletionInsertText(item));
}

function toMonacoRange(
  monaco: typeof Monaco,
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  },
): Monaco.IRange {
  return new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  );
}

function toMonacoCommand(command: LSPCompletionItem['command']): Monaco.languages.Command | undefined {
  if (!command?.command) {
    return undefined;
  }

  return {
    id: command.command,
    title: command.title || command.command,
    arguments: command.arguments,
  };
}

/** Convert LSP severity (1=Error, 2=Warning, 3=Info, 4=Hint) to Monaco severity */
function toMonacoSeverity(monaco: typeof Monaco, lspSeverity?: number): Monaco.MarkerSeverity {
  switch (lspSeverity) {
    case 1: return monaco.MarkerSeverity.Error;
    case 2: return monaco.MarkerSeverity.Warning;
    case 3: return monaco.MarkerSeverity.Info;
    case 4: return monaco.MarkerSeverity.Hint;
    default: return monaco.MarkerSeverity.Error;
  }
}

/** Convert LSP CompletionItemKind to Monaco */
function toMonacoCompletionKind(monaco: typeof Monaco, kind?: number): Monaco.languages.CompletionItemKind {
  // LSP kinds map roughly to Monaco kinds
  const map: Record<number, Monaco.languages.CompletionItemKind> = {
    1: monaco.languages.CompletionItemKind.Text,
    2: monaco.languages.CompletionItemKind.Method,
    3: monaco.languages.CompletionItemKind.Function,
    4: monaco.languages.CompletionItemKind.Constructor,
    5: monaco.languages.CompletionItemKind.Field,
    6: monaco.languages.CompletionItemKind.Variable,
    7: monaco.languages.CompletionItemKind.Class,
    8: monaco.languages.CompletionItemKind.Interface,
    9: monaco.languages.CompletionItemKind.Module,
    10: monaco.languages.CompletionItemKind.Property,
    11: monaco.languages.CompletionItemKind.Unit,
    12: monaco.languages.CompletionItemKind.Value,
    13: monaco.languages.CompletionItemKind.Enum,
    14: monaco.languages.CompletionItemKind.Keyword,
    15: monaco.languages.CompletionItemKind.Snippet,
    16: monaco.languages.CompletionItemKind.Color,
    17: monaco.languages.CompletionItemKind.File,
    18: monaco.languages.CompletionItemKind.Reference,
    19: monaco.languages.CompletionItemKind.Folder,
    20: monaco.languages.CompletionItemKind.EnumMember,
    21: monaco.languages.CompletionItemKind.Constant,
    22: monaco.languages.CompletionItemKind.Struct,
    23: monaco.languages.CompletionItemKind.Event,
    24: monaco.languages.CompletionItemKind.Operator,
    25: monaco.languages.CompletionItemKind.TypeParameter,
  };
  return map[kind ?? 1] ?? monaco.languages.CompletionItemKind.Text;
}

export class MonacoLspAdapter {
  private bridge: LSPBridge;
  private monaco: typeof Monaco;
  private options: MonacoLspAdapterOptions;
  private disposables: Monaco.IDisposable[] = [];
  private initialized = false;
  private languageId: string;

  constructor(bridge: LSPBridge, monaco: typeof Monaco, options: MonacoLspAdapterOptions = {}) {
    this.bridge = bridge;
    this.monaco = monaco;
    this.options = options;
    this.languageId = options.languageId || CADENCE_LANGUAGE_ID;

    // Handle messages from LSP server
    bridge.setMessageHandler(this.handleServerMessage.bind(this));
  }

  private handleServerMessage(message: Message) {
    const msg = message as any;
    // Response to a request we sent
    if ('id' in msg && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = pendingRequests.get(msg.id);
      if (pending) {
        pendingRequests.delete(msg.id);
        if (msg.error) {
          pending.reject(msg.error);
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // Notification from server
    if ('method' in msg) {
      if (msg.method === PUBLISH_DIAGNOSTICS) {
        this.handleDiagnostics(msg.params);
      }
    }
  }

  private handleDiagnostics(params: { uri: string; diagnostics: LSPDiagnostic[] }) {
    const uri = this.monaco.Uri.parse(params.uri);
    const model = this.monaco.editor.getModel(uri);
    if (!model) return;

    const markers: Monaco.editor.IMarkerData[] = params.diagnostics.map((d) => ({
      severity: toMonacoSeverity(this.monaco, d.severity),
      message: d.message,
      startLineNumber: d.range.start.line + 1,
      startColumn: d.range.start.character + 1,
      endLineNumber: d.range.end.line + 1,
      endColumn: d.range.end.character + 1,
      source: d.source || 'cadence',
    }));

    this.monaco.editor.setModelMarkers(model, `${this.languageId}-lsp`, markers);
  }

  async initialize() {
    if (this.initialized) return;

    if (!this.options.skipInitialize) {
      // Send initialize request
      await sendRequest(this.bridge, INITIALIZE, {
        processId: null,
        capabilities: {
          textDocument: {
            completion: {
              completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'] },
            },
            hover: { contentFormat: ['markdown', 'plaintext'] },
            signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'] } },
            publishDiagnostics: { relatedInformation: true },
          },
        },
        rootUri: 'file:///',
      });

      // Send initialized notification
      sendNotification(this.bridge, INITIALIZED, {});
    }

    // Register Monaco providers
    this.registerProviders();
    this.initialized = true;
  }

  private fallbackDependencyDefinition(
    model: Monaco.editor.ITextModel,
    position: Monaco.Position,
  ): Monaco.languages.Location[] | null {
    const m = this.monaco;
    const symbol = model.getWordAtPosition(position)?.word;
    if (!symbol || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(symbol)) return null;

    // Prefer currently opened dependency models.
    const openedDep = m.editor.getModels().find((depModel) =>
      depModel.uri.path.endsWith(`/${symbol}.cdc`)
    );
    if (openedDep) {
      return [{
        uri: openedDep.uri,
        range: new m.Range(1, 1, 1, 1),
      }];
    }

    const source = model.getValue();

    // Fallback for `import X from 0xADDR` if dependency model isn't opened yet.
    const importsRe = /import\s+([\w,\s]+?)\s+from\s+0x([0-9a-fA-F]+)/g;
    let match: RegExpExecArray | null;
    while ((match = importsRe.exec(source)) !== null) {
      const names = match[1].split(',').map((s) => s.trim()).filter(Boolean);
      if (!names.includes(symbol)) continue;
      const address = `0x${match[2]}`;
      const depUri = `file:///deps/${address}/${symbol}.cdc`;
      if (!this.ensureModelForUri(depUri)) return null;
      return [{
        uri: m.Uri.parse(depUri),
        range: new m.Range(1, 1, 1, 1),
      }];
    }

    // Search symbol inside imported dependency models (method/field/type definitions).
    importsRe.lastIndex = 0;
    while ((match = importsRe.exec(source)) !== null) {
      const names = match[1].split(',').map((s) => s.trim()).filter(Boolean);
      const address = `0x${match[2]}`;
      for (const name of names) {
        const depUri = `file:///deps/${address}/${name}.cdc`;
        if (!this.ensureModelForUri(depUri)) continue;
        const depModel = m.editor.getModel(m.Uri.parse(depUri));
        if (!depModel) continue;
        const range = this.findSymbolRangeInModel(depModel, symbol);
        if (!range) continue;
        return [{ uri: depModel.uri, range }];
      }
    }

    // Last resort: scan any already-opened dependency model.
    const anyDepModel = m.editor.getModels().find((depModel) => {
      if (!depModel.uri.path.startsWith('/deps/')) return false;
      return this.findSymbolRangeInModel(depModel, symbol) != null;
    });
    if (anyDepModel) {
      const range = this.findSymbolRangeInModel(anyDepModel, symbol)!;
      return [{ uri: anyDepModel.uri, range }];
    }

    return null;
  }

  private findSymbolRangeInModel(
    model: Monaco.editor.ITextModel,
    symbol: string,
  ): Monaco.Range | null {
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`\\bfun\\s+${escaped}\\b`),
      new RegExp(`\\b(?:let|var)\\s+${escaped}\\b`),
      new RegExp(`\\b(?:entitlement|resource|struct|contract|interface|attachment|enum|event)\\s+${escaped}\\b`),
      new RegExp(`\\b${escaped}\\b`),
    ];

    for (const re of patterns) {
      for (let line = 1; line <= model.getLineCount(); line += 1) {
        const lineText = model.getLineContent(line);
        const hit = lineText.match(re);
        if (!hit) continue;
        const start = lineText.indexOf(symbol, hit.index ?? 0);
        if (start < 0) continue;
        return new this.monaco.Range(line, start + 1, line, start + symbol.length + 1);
      }
    }
    return null;
  }

  private ensureModelForUri(uriString: string): boolean {
    const m = this.monaco;
    const uri = m.Uri.parse(uriString);
    if (m.editor.getModel(uri)) return true;

    const content = this.options.resolveDocumentContent?.(uri.toString());
    if (typeof content !== 'string') return false;

    try {
      m.editor.createModel(content, CADENCE_LANGUAGE_ID, uri);
    } catch {
      // Ignore create race; re-check below.
    }
    return m.editor.getModel(uri) != null;
  }

  private async resolveDefinition(
    model: Monaco.editor.ITextModel,
    position: Monaco.Position,
  ): Promise<Monaco.languages.Location[] | null> {
    const m = this.monaco;
    try {
      const result = await sendRequest(this.bridge, DEFINITION, {
        textDocument: { uri: model.uri.toString() },
        position: { line: position.lineNumber - 1, character: position.column - 1 },
      });
      if (!result) return this.fallbackDependencyDefinition(model, position);
      const locations = Array.isArray(result) ? result : [result];
      const mapped = locations
        .filter((loc: any) => {
          const line = loc?.range?.start?.line;
          return typeof line === 'number' && line >= 0 && line < 1_000_000;
        })
        .map((loc: any) => {
          if (!this.ensureModelForUri(loc.uri)) return null;
          return {
            uri: m.Uri.parse(loc.uri),
            range: new m.Range(
              loc.range.start.line + 1,
              loc.range.start.character + 1,
              loc.range.end.line + 1,
              loc.range.end.character + 1
            ),
          };
        })
        .filter(Boolean) as Monaco.languages.Location[];

      if (mapped.length > 0) {
        const symbol = model.getWordAtPosition(position)?.word;
        const sourceLine = model.getLineContent(position.lineNumber);
        if (symbol && sourceLine.includes(`.${symbol}`)) {
          const adjusted = mapped.map((loc) => {
            const targetModel = m.editor.getModel(loc.uri);
            if (!targetModel) return loc;
            const preferredRange = this.findSymbolRangeInModel(targetModel, symbol);
            if (!preferredRange) return loc;
            return { uri: loc.uri, range: preferredRange };
          });
          return adjusted;
        }
        return mapped;
      }
      return this.fallbackDependencyDefinition(model, position);
    } catch {
      return this.fallbackDependencyDefinition(model, position);
    }
  }

  async findDefinition(uri: string, line: number, character: number): Promise<DefinitionTarget | null> {
    const normalizedUri = uri.startsWith('file://') ? uri : fileUri(uri);
    const modelUri = this.monaco.Uri.parse(normalizedUri);
    this.ensureModelForUri(modelUri.toString());
    const model = this.monaco.editor.getModel(modelUri);
    if (!model) return null;

    const position = new this.monaco.Position(line + 1, character + 1);
    const locations = await this.resolveDefinition(model, position);
    if (!locations || locations.length === 0) return null;

    const target = locations[0];
    return {
      uri: target.uri.toString(),
      line: target.range.startLineNumber - 1,
      character: target.range.startColumn - 1,
    };
  }

  private registerProviders() {
    const m = this.monaco;
    const self = this;

    // Completion provider
    this.disposables.push(
      m.languages.registerCompletionItemProvider(this.languageId, {
        triggerCharacters: ['.', ':', '<'],
        provideCompletionItems: async (model, position) => {
          try {
            const result = await sendRequest(self.bridge, COMPLETION, {
              textDocument: { uri: model.uri.toString() },
              position: { line: position.lineNumber - 1, character: position.column - 1 },
            });
            if (!result) return { suggestions: [] };
            const rawItems: LSPCompletionItem[] = Array.isArray(result) ? result : result.items || [];
            const contextualItems = filterCompletionItemsForContext(rawItems, model, position);
            // Filter out items with empty labels (Monaco rejects them)
            const items = contextualItems.filter((item) => item.label && item.label.length > 0);
            const word = model.getWordUntilPosition(position);
            const fallbackRange = new m.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
            return {
              suggestions: items.map((item) => ({
                label: item.label,
                kind: toMonacoCompletionKind(m, item.kind),
                detail: item.detail,
                documentation: typeof item.documentation === 'string'
                  ? item.documentation
                  : item.documentation
                  ? { value: item.documentation.value || '' }
                  : undefined,
                insertText: getCompletionInsertText(item),
                insertTextRules: isSnippetCompletionItem(item)
                  ? m.languages.CompletionItemInsertTextRule.InsertAsSnippet
                  : undefined,
                range: item.textEdit?.range
                  ? toMonacoRange(m, item.textEdit.range)
                  : fallbackRange,
                sortText: item.sortText,
                filterText: item.filterText,
                command: toMonacoCommand(item.command),
              })),
            };
          } catch {
            return { suggestions: [] };
          }
        },
      })
    );

    // Hover provider
    this.disposables.push(
      m.languages.registerHoverProvider(this.languageId, {
        provideHover: async (model, position) => {
          try {
            const result: LSPHoverResult | null = await sendRequest(self.bridge, HOVER, {
              textDocument: { uri: model.uri.toString() },
              position: { line: position.lineNumber - 1, character: position.column - 1 },
            });
            if (!result || !result.contents) return null;

            let value: string;
            if (typeof result.contents === 'string') {
              value = result.contents;
            } else if (Array.isArray(result.contents)) {
              value = result.contents
                .map((c) => (typeof c === 'string' ? c : `\`\`\`${c.language || ''}\n${c.value}\n\`\`\``))
                .join('\n\n');
            } else if ('value' in result.contents) {
              value = result.contents.kind === 'markdown'
                ? result.contents.value
                : `\`\`\`\n${result.contents.value}\n\`\`\``;
            } else {
              return null;
            }

            return {
              contents: [{ value, isTrusted: true }],
              range: result.range
                ? new m.Range(
                    result.range.start.line + 1,
                    result.range.start.character + 1,
                    result.range.end.line + 1,
                    result.range.end.character + 1
                  )
                : undefined,
            };
          } catch {
            return null;
          }
        },
      })
    );

    // Definition provider
    this.disposables.push(
      m.languages.registerDefinitionProvider(this.languageId, {
        provideDefinition: async (model, position) => self.resolveDefinition(model, position),
      })
    );

    // Signature help provider
    this.disposables.push(
      m.languages.registerSignatureHelpProvider(this.languageId, {
        signatureHelpTriggerCharacters: ['(', ','],
        provideSignatureHelp: async (model, position) => {
          try {
            const result = await sendRequest(self.bridge, SIGNATURE_HELP, {
              textDocument: { uri: model.uri.toString() },
              position: { line: position.lineNumber - 1, character: position.column - 1 },
            });
            if (!result) return null;
            return {
              value: {
                signatures: (result.signatures || []).map((sig: any) => ({
                  label: sig.label,
                  documentation: sig.documentation,
                  parameters: (sig.parameters || []).map((p: any) => ({
                    label: p.label,
                    documentation: p.documentation,
                  })),
                })),
                activeSignature: result.activeSignature || 0,
                activeParameter: result.activeParameter || 0,
              },
              dispose: () => {},
            };
          } catch {
            return null;
          }
        },
      })
    );
  }

  /** Notify LSP that a document was opened.
   *  Sync immediately so completion and hover use the latest buffer.
   *  Dependency prefetch runs in the background. */
  openDocument(uri: string, code: string) {
    const version = 1;
    documentVersions.set(uri, version);
    sendNotification(this.bridge, DID_OPEN, {
      textDocument: {
        uri: fileUri(uri),
        languageId: this.languageId,
        version,
        text: code,
      },
    });
    prefetchImportsInBackground(code);
  }

  /** Notify LSP that a document changed.
   *  Sync immediately so completion does not lag behind the editor buffer.
   *  Dependency prefetch runs in the background. */
  changeDocument(uri: string, code: string) {
    const version = (documentVersions.get(uri) || 0) + 1;
    documentVersions.set(uri, version);
    sendNotification(this.bridge, DID_CHANGE, {
      textDocument: { uri: fileUri(uri), version },
      contentChanges: [{ text: code }],
    });
    prefetchImportsInBackground(code);
  }

  /** Notify LSP that a document was closed */
  closeDocument(uri: string) {
    documentVersions.delete(uri);
    sendNotification(this.bridge, DID_CLOSE, {
      textDocument: { uri: fileUri(uri) },
    });
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    pendingRequests.clear();
    documentVersions.clear();
    this.initialized = false;
  }
}

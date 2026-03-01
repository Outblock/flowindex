/**
 * Bridges the Cadence WASM Language Server (JSON-RPC) to Monaco editor providers.
 * This avoids the complexity of monaco-languageclient version compat issues
 * by manually wiring LSP request/response to Monaco's provider APIs.
 */
import type * as Monaco from 'monaco-editor';
import type { Message } from 'vscode-jsonrpc';
import type { LSPBridge } from './languageServer';
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
  textEdit?: any;
  sortText?: string;
  filterText?: string;
}

interface LSPHoverResult {
  contents: string | { value: string; language?: string; kind?: string } | Array<string | { value: string; language?: string }>;
  range?: { start: { line: number; character: number }; end: { line: number; character: number } };
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

// Track open documents and their versions
const documentVersions = new Map<string, number>();

function fileUri(path: string): string {
  if (path.startsWith('file://')) return path;
  return `file://${path.startsWith('/') ? '' : '/'}${path}`;
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
  private disposables: Monaco.IDisposable[] = [];
  private initialized = false;

  constructor(bridge: LSPBridge, monaco: typeof Monaco) {
    this.bridge = bridge;
    this.monaco = monaco;

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

    this.monaco.editor.setModelMarkers(model, 'cadence-lsp', markers);
  }

  async initialize() {
    if (this.initialized) return;

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

    // Register Monaco providers
    this.registerProviders();
    this.initialized = true;
  }

  private registerProviders() {
    const m = this.monaco;
    const self = this;

    // Completion provider
    this.disposables.push(
      m.languages.registerCompletionItemProvider(CADENCE_LANGUAGE_ID, {
        triggerCharacters: ['.', ':', '<'],
        provideCompletionItems: async (model, position) => {
          try {
            const result = await sendRequest(self.bridge, COMPLETION, {
              textDocument: { uri: model.uri.toString() },
              position: { line: position.lineNumber - 1, character: position.column - 1 },
            });
            if (!result) return { suggestions: [] };
            const rawItems: LSPCompletionItem[] = Array.isArray(result) ? result : result.items || [];
            // Filter out items with empty labels (Monaco rejects them)
            const items = rawItems.filter((item) => item.label && item.label.length > 0);
            const word = model.getWordUntilPosition(position);
            const range = new m.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
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
                insertText: item.insertText || item.label,
                insertTextRules: item.insertTextFormat === 2
                  ? m.languages.CompletionItemInsertTextRule.InsertAsSnippet
                  : undefined,
                range,
                sortText: item.sortText,
                filterText: item.filterText,
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
      m.languages.registerHoverProvider(CADENCE_LANGUAGE_ID, {
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
      m.languages.registerDefinitionProvider(CADENCE_LANGUAGE_ID, {
        provideDefinition: async (model, position) => {
          try {
            const result = await sendRequest(self.bridge, DEFINITION, {
              textDocument: { uri: model.uri.toString() },
              position: { line: position.lineNumber - 1, character: position.column - 1 },
            });
            if (!result) return null;
            const locations = Array.isArray(result) ? result : [result];
            return locations.map((loc: any) => ({
              uri: m.Uri.parse(loc.uri),
              range: new m.Range(
                loc.range.start.line + 1,
                loc.range.start.character + 1,
                loc.range.end.line + 1,
                loc.range.end.character + 1
              ),
            }));
          } catch {
            return null;
          }
        },
      })
    );

    // Signature help provider
    this.disposables.push(
      m.languages.registerSignatureHelpProvider(CADENCE_LANGUAGE_ID, {
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

  /** Notify LSP that a document was opened */
  openDocument(uri: string, code: string) {
    const version = 1;
    documentVersions.set(uri, version);
    sendNotification(this.bridge, DID_OPEN, {
      textDocument: {
        uri: fileUri(uri),
        languageId: 'cadence',
        version,
        text: code,
      },
    });
  }

  /** Notify LSP that a document changed */
  changeDocument(uri: string, code: string) {
    const version = (documentVersions.get(uri) || 0) + 1;
    documentVersions.set(uri, version);
    sendNotification(this.bridge, DID_CHANGE, {
      textDocument: { uri: fileUri(uri), version },
      contentChanges: [{ text: code }],
    });
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

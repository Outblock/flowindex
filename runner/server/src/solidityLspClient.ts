import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { pathToFileURL } from 'node:url';

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface SolidityLSPClientOptions {
  cwd: string;
}

export class SolidityLSPClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private pendingRequests = new Map<number, PendingRequest>();
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private initResult: any = null;
  private cwd: string;

  constructor(opts: SolidityLSPClientOptions) {
    super();
    this.cwd = opts.cwd;
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._initialize();
    return this.initPromise;
  }

  private async _initialize(): Promise<void> {
    // Resolve the solidity language server entry point
    const require = createRequire(import.meta.url);
    const serverEntry = require.resolve(
      '@nomicfoundation/solidity-language-server/out/index.js',
    );

    try {
      this.process = spawn('node', [serverEntry, '--stdio'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this.cwd,
      });
    } catch (e: any) {
      throw new Error(`Failed to start Solidity language server: ${e.message}`);
    }

    // Wait for spawn
    await new Promise<void>((resolve, reject) => {
      this.process!.on('error', (err) =>
        reject(new Error(`Failed to start Solidity language server: ${err.message}`)),
      );
      this.process!.on('spawn', () => resolve());
    });

    this.process.stdout!.on('data', (data: Buffer) => this.onData(data));
    this.process.stderr!.on('data', (data: Buffer) => {
      console.error('[Sol LSP stderr]', data.toString());
    });

    this.process.on('exit', (code) => {
      console.error(`[Sol LSP] process exited with code ${code}`);
      this.initialized = false;
      this.initPromise = null;
      for (const [, req] of this.pendingRequests) {
        req.reject(new Error('Solidity LSP process exited'));
        clearTimeout(req.timer);
      }
      this.pendingRequests.clear();
    });

    const initResult = await this.request('initialize', {
      processId: process.pid,
      capabilities: {
        textDocument: {
          completion: {
            completionItem: {
              snippetSupport: true,
              documentationFormat: ['markdown', 'plaintext'],
            },
          },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          signatureHelp: {
            signatureInformation: {
              documentationFormat: ['markdown', 'plaintext'],
            },
          },
          definition: {},
          references: {},
          documentSymbol: {},
          publishDiagnostics: {},
        },
      },
      rootUri: pathToFileURL(this.cwd).toString(),
      workspaceFolders: [
        {
          uri: pathToFileURL(this.cwd).toString(),
          name: 'solidity-workspace',
        },
      ],
    });

    this.notify('initialized', {});
    this.initResult = initResult;
    this.initialized = true;
  }

  private onData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
    while (this.tryParseMessage()) {}
  }

  private tryParseMessage(): boolean {
    const headerEnd = this.buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return false;

    const header = this.buffer.subarray(0, headerEnd).toString('ascii');
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) return false;

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    if (this.buffer.length < bodyStart + contentLength) return false;

    const body = this.buffer
      .subarray(bodyStart, bodyStart + contentLength)
      .toString('utf-8');
    this.buffer = this.buffer.subarray(bodyStart + contentLength);

    try {
      const message = JSON.parse(body);
      this.handleMessage(message);
    } catch (e) {
      console.error('[Sol LSP] Failed to parse message:', e);
    }

    return true;
  }

  private handleMessage(message: any): void {
    // Response to a request
    if (
      'id' in message &&
      message.id !== undefined &&
      ('result' in message || 'error' in message)
    ) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        this.pendingRequests.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result);
        }
      }
      return;
    }

    // Request from server to client (e.g. client/registerCapability)
    if ('id' in message && message.id !== undefined && message.method) {
      try {
        this.send({ jsonrpc: '2.0', id: message.id, result: null });
      } catch (e) {
        console.error('[Sol LSP] Failed to reply to server request:', e);
      }
      this.emit('notification', message.method, message.params);
      this.emit(message.method, message.params);
      return;
    }

    // Notification from server
    if (message.method) {
      this.emit('notification', message.method, message.params);
      this.emit(message.method, message.params);
    }
  }

  getInitializeResult(): any {
    return this.initResult;
  }

  async request(
    method: string,
    params: any,
    timeoutMs = 30000,
  ): Promise<any> {
    if (method !== 'initialize') {
      await this.ensureInitialized();
    }

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(
          new Error(
            `Solidity LSP request '${method}' timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params: any): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  private send(message: any): void {
    if (!this.process?.stdin?.writable) {
      throw new Error('Solidity LSP process not available');
    }
    const body = JSON.stringify(message);
    const contentLength = Buffer.byteLength(body, 'utf-8');
    this.process.stdin.write(
      `Content-Length: ${contentLength}\r\n\r\n${body}`,
    );
  }

  async shutdown(): Promise<void> {
    if (!this.process || this.process.killed) return;
    try {
      await this.request('shutdown', null, 5000);
      this.notify('exit', null);
    } catch {
      this.process.kill();
    }
  }
}

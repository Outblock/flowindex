import { execFile } from 'node:child_process';
import { writeFile, readFile, access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export type FlowNetwork = 'mainnet' | 'testnet' | 'emulator';

/**
 * Persistent workspace that caches installed dependencies per network.
 * Uses `flow dependencies install` to fetch contracts from mainnet/testnet.
 */
export class DepsWorkspace {
  private dir: string;
  private flowCommand: string;
  private network: FlowNetwork;
  private installedContracts = new Set<string>();

  constructor(flowCommand: string, network: FlowNetwork) {
    this.flowCommand = flowCommand;
    this.network = network;
    this.dir = join(tmpdir(), `cadence-lsp-deps-${network}`);
  }

  getDir(): string {
    return this.dir;
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const flowJsonPath = join(this.dir, 'flow.json');
    try {
      await access(flowJsonPath);
      // flow.json exists — recover previously installed deps
      const raw = await readFile(flowJsonPath, 'utf-8');
      const config = JSON.parse(raw);
      if (config.dependencies) {
        for (const name of Object.keys(config.dependencies)) {
          this.installedContracts.add(name);
        }
      }
    } catch {
      // Create fresh flow.json with network config
      await writeFile(flowJsonPath, JSON.stringify({
        networks: {
          mainnet: 'access.mainnet.nodes.onflow.org:9000',
          testnet: 'access.devnet.nodes.onflow.org:9000',
          emulator: '127.0.0.1:3569',
        },
      }, null, 2), 'utf-8');
    }
  }

  /** Install dependencies for contracts not yet cached */
  async installDeps(imports: { name: string; address: string }[]): Promise<void> {
    const missing = imports.filter((i) => !this.installedContracts.has(i.name));
    if (missing.length === 0) return;

    for (const dep of missing) {
      const depSpec = `${this.network}://0x${dep.address}.${dep.name}`;
      await new Promise<void>((resolve) => {
        execFile(
          this.flowCommand,
          ['dependencies', 'install', depSpec],
          { cwd: this.dir, timeout: 60000 },
          (error, _stdout, stderr) => {
            if (!error) {
              this.installedContracts.add(dep.name);
            } else {
              console.error(`[deps] Failed to install ${dep.name}: ${stderr}`);
            }
            resolve();
          },
        );
      });
    }
  }
}

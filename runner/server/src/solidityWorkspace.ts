import { writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Creates and manages a temporary workspace directory with a minimal
 * foundry.toml configured for Flow EVM Solidity compilation.
 */
export class SolidityWorkspace {
  private dir: string;

  constructor() {
    this.dir = join(tmpdir(), 'solidity-lsp-workspace');
  }

  getDir(): string {
    return this.dir;
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await mkdir(join(this.dir, 'src'), { recursive: true });

    const foundryToml = join(this.dir, 'foundry.toml');
    try {
      await access(foundryToml);
      // Already exists, skip
    } catch {
      await writeFile(
        foundryToml,
        [
          '[profile.default]',
          'src = "src"',
          'out = "out"',
          'libs = ["lib"]',
          'evm_version = "london"',
          'solc_version = "0.8.24"',
          '',
        ].join('\n'),
        'utf-8',
      );
    }
  }
}

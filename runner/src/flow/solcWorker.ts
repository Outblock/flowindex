/// <reference lib="webworker" />

// Web Worker for Solidity compilation via solc.
// Uses the solc wrapper + soljson.js loaded as a raw script to avoid
// Vite ESM transformation breaking Emscripten's Module pattern.

import soljsonUrl from 'solc/soljson.js?url';

let solc: any = null;

async function loadSolc() {
  if (solc) return solc;

  // Fetch and eval soljson.js to get the Emscripten Module with cwrap/ccall
  const response = await fetch(soljsonUrl);
  const script = await response.text();

  // Provide a Module object for Emscripten to populate
  (self as any).Module = (self as any).Module || {};
  // eslint-disable-next-line no-eval
  (0, eval)(script);

  const soljson = (self as any).Module;

  // Use solc's wrapper to create the compile interface
  // The wrapper expects: soljson.cwrap, soljson._solidity_version, etc.
  // We inline a minimal compile function instead of importing the full wrapper
  // (the wrapper uses Node.js requires like memorystream, follow-redirects)
  const compile = soljson.cwrap('solidity_compile', 'string', ['string', 'number', 'number']);

  solc = {
    compile(input: string) {
      return compile(input, 0, 0);
    },
  };

  return solc;
}

interface CompileRequest {
  id: number;
  source: string;
  fileName: string;
}

self.onmessage = async (e: MessageEvent<CompileRequest>) => {
  const { id, source, fileName } = e.data;

  try {
    const compiler = await loadSolc();

    const input = {
      language: 'Solidity',
      sources: { [fileName]: { content: source } },
      settings: {
        outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
      },
    };

    const output = JSON.parse(compiler.compile(JSON.stringify(input)));
    const errors: string[] = [];
    const warnings: string[] = [];

    if (output.errors) {
      for (const err of output.errors) {
        if (err.severity === 'error') errors.push(err.formattedMessage || err.message);
        else warnings.push(err.formattedMessage || err.message);
      }
    }

    if (errors.length > 0 || !output.contracts) {
      self.postMessage({ id, success: false, contracts: [], errors, warnings });
      return;
    }

    const contracts: any[] = [];
    const fileContracts = output.contracts[fileName];
    if (fileContracts) {
      for (const [name, contract] of Object.entries(fileContracts) as [string, any][]) {
        contracts.push({
          name,
          abi: contract.abi,
          bytecode: `0x${contract.evm.bytecode.object}`,
        });
      }
    }

    self.postMessage({ id, success: true, contracts, errors, warnings });
  } catch (err: any) {
    self.postMessage({
      id,
      success: false,
      contracts: [],
      errors: [err.message || String(err)],
      warnings: [],
    });
  }
};

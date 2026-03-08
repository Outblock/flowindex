/**
 * Cadence Template Registry
 *
 * Loads .cdc files from disk, enriches them with metadata,
 * and exposes lookup helpers for the MCP tools layer.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TemplateArg {
  name: string;
  type: string;
  description: string;
}

export interface Template {
  name: string;
  category: string;
  type: 'transaction' | 'script';
  description: string;
  cadence: string;
  args: TemplateArg[];
}

interface TemplateMeta {
  description: string;
  args: TemplateArg[];
}

// ---------------------------------------------------------------------------
// Hand-curated metadata for the most important templates
// ---------------------------------------------------------------------------

const TEMPLATE_META: Record<string, TemplateMeta> = {
  transfer_tokens_v3: {
    description:
      'Transfer fungible tokens to a recipient address. Uses LostAndFound for safe delivery.',
    args: [
      { name: 'vaultIdentifier', type: 'String', description: 'Fully qualified vault type identifier, e.g. "A.1654653399040a61.FlowToken.Vault"' },
      { name: 'recipient', type: 'Address', description: 'Recipient Flow address' },
      { name: 'amount', type: 'UFix64', description: 'Amount of tokens to transfer' },
    ],
  },
  enable_token_storage_v2: {
    description:
      'Enable storage, receiver, and metadata capabilities for a fungible token vault on the signer account.',
    args: [
      { name: 'vaultIdentifier', type: 'String', description: 'Fully qualified vault type identifier' },
    ],
  },
  get_token_balance_storage: {
    description:
      'Query all fungible token vault balances held by an address, including available Flow balance.',
    args: [
      { name: 'address', type: 'Address', description: 'Account address to query balances for' },
    ],
  },
  send_nft: {
    description:
      'Transfer a single NFT to a recipient address.',
    args: [
      { name: 'identifier', type: 'String', description: 'Fully qualified NFT collection type identifier' },
      { name: 'recipientAddr', type: 'Address', description: 'Recipient Flow address' },
      { name: 'withdrawID', type: 'UInt64', description: 'ID of the NFT to transfer' },
    ],
  },
  batch_send_nft_v3: {
    description:
      'Transfer multiple NFTs to a recipient address in a single transaction. Uses LostAndFound for safe delivery.',
    args: [
      { name: 'identifier', type: 'String', description: 'Fully qualified NFT collection type identifier' },
      { name: 'recipient', type: 'Address', description: 'Recipient Flow address' },
      { name: 'ids', type: '[UInt64]', description: 'Array of NFT IDs to transfer' },
    ],
  },
  create_coa: {
    description:
      'Create a Cadence-Owned Account (COA) for EVM interop and fund it with an initial FLOW deposit.',
    args: [
      { name: 'amount', type: 'UFix64', description: 'Initial FLOW amount to deposit into the COA' },
    ],
  },
  call_contract: {
    description:
      'Call an EVM smart contract from the signer\'s COA with optional value transfer.',
    args: [
      { name: 'toEVMAddressHex', type: 'String', description: 'Target EVM contract address (hex)' },
      { name: 'amount', type: 'UFix64', description: 'FLOW value to send with the call' },
      { name: 'data', type: '[UInt8]', description: 'ABI-encoded calldata as byte array' },
      { name: 'gasLimit', type: 'UInt64', description: 'Gas limit for the EVM call' },
    ],
  },
  transfer_flow_to_evm_address: {
    description:
      'Transfer FLOW from Cadence balance to an EVM address via the signer\'s COA.',
    args: [
      { name: 'recipientEVMAddressHex', type: 'String', description: 'Recipient EVM address (hex)' },
      { name: 'amount', type: 'UFix64', description: 'Amount of FLOW to transfer' },
      { name: 'gasLimit', type: 'UInt64', description: 'Gas limit for the EVM transfer' },
    ],
  },
  bridge_tokens_to_evm_address_v2: {
    description:
      'Bridge fungible tokens from Cadence to an EVM address via FlowEVMBridge. Handles onboarding automatically.',
    args: [
      { name: 'vaultIdentifier', type: 'String', description: 'Fully qualified vault type identifier to bridge' },
      { name: 'amount', type: 'UFix64', description: 'Amount of tokens to bridge' },
      { name: 'recipient', type: 'String', description: 'Recipient EVM address (hex string)' },
    ],
  },
  bridge_tokens_from_evm_to_flow_v3: {
    description:
      'Bridge fungible tokens from EVM back to a Flow Cadence account via FlowEVMBridge.',
    args: [
      { name: 'vaultIdentifier', type: 'String', description: 'Fully qualified vault type identifier to bridge' },
      { name: 'amount', type: 'UInt256', description: 'Amount of tokens in EVM base units (wei-like)' },
      { name: 'recipient', type: 'Address', description: 'Flow address to receive the bridged tokens' },
    ],
  },
};

// ---------------------------------------------------------------------------
// Template loading
// ---------------------------------------------------------------------------

let templatesCache: Template[] | null = null;

function cadenceDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = dirname(thisFile);
  return join(thisDir, 'cadence');
}

function detectType(cadence: string): 'transaction' | 'script' {
  // Scripts define `access(all) fun main` or `pub fun main`; transactions use `transaction`
  if (/^\s*transaction\s*[({]/m.test(cadence)) {
    return 'transaction';
  }
  return 'script';
}

/**
 * Parse Cadence argument names and types from the source.
 * Handles both `transaction(arg: Type, ...)` and `fun main(arg: Type, ...)` signatures.
 */
function parseArgsFromCadence(cadence: string): TemplateArg[] {
  // Match the parameter list for transaction or fun main
  const txMatch = cadence.match(/transaction\s*\(([^)]*)\)/);
  const fnMatch = cadence.match(/fun\s+main\s*\(([^)]*)\)/);
  const paramStr = txMatch?.[1] ?? fnMatch?.[1];
  if (!paramStr || paramStr.trim() === '') return [];

  const args: TemplateArg[] = [];
  // Split on commas, but be careful with nested brackets like [UInt64]
  let depth = 0;
  let current = '';
  for (const ch of paramStr) {
    if (ch === '[' || ch === '{' || ch === '<') depth++;
    else if (ch === ']' || ch === '}' || ch === '>') depth--;
    else if (ch === ',' && depth === 0) {
      args.push(parseOneArg(current.trim()));
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) {
    args.push(parseOneArg(current.trim()));
  }
  return args;
}

function parseOneArg(s: string): TemplateArg {
  // e.g. "vaultIdentifier: String" or "ids: [UInt64]"
  const colonIdx = s.indexOf(':');
  if (colonIdx === -1) {
    return { name: s.trim(), type: 'Unknown', description: '' };
  }
  const name = s.slice(0, colonIdx).trim();
  const type = s.slice(colonIdx + 1).trim();
  return { name, type, description: '' };
}

function loadTemplatesFromDisk(): Template[] {
  const baseDir = cadenceDir();
  const templates: Template[] = [];

  let categories: string[];
  try {
    categories = readdirSync(baseDir).filter((entry) => {
      try {
        return statSync(join(baseDir, entry)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    console.error(`[template-registry] Could not read cadence directory: ${baseDir}`);
    return [];
  }

  for (const category of categories) {
    const catDir = join(baseDir, category);
    let files: string[];
    try {
      files = readdirSync(catDir).filter((f) => f.endsWith('.cdc'));
    } catch {
      continue;
    }

    for (const file of files) {
      const name = basename(file, '.cdc');
      const cadence = readFileSync(join(catDir, file), 'utf-8');
      const meta = TEMPLATE_META[name];

      const template: Template = {
        name,
        category,
        type: detectType(cadence),
        description: meta?.description ?? `Cadence ${detectType(cadence)} from ${category}/${file}`,
        cadence,
        args: meta?.args ?? parseArgsFromCadence(cadence),
      };

      templates.push(template);
    }
  }

  return templates;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getTemplates(): Template[] {
  if (!templatesCache) {
    templatesCache = loadTemplatesFromDisk();
  }
  return templatesCache;
}

export function getTemplate(name: string): Template | undefined {
  return getTemplates().find((t) => t.name === name);
}

export function listTemplates(category?: string): Template[] {
  const all = getTemplates();
  if (!category) return all;
  return all.filter((t) => t.category === category);
}

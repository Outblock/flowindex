# Solidity Tooling Enhancements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Solidity development experience in the runner with contract interaction, multi-file imports, constructor arguments, revert reason parsing, and solc version management.

**Architecture:** Six independent features layered onto the existing compile→deploy flow. Contract interaction is a new panel component. Multi-file import extends the solcWorker. Constructor args and revert parsing extend evmExecute.ts and App.tsx. Solc version selection adds a CDN-backed binary fetcher. All UI matches existing dark theme (zinc/emerald/orange).

**Tech Stack:** React, TypeScript, viem 2, wagmi 3, Tailwind, Web Worker (solcWorker)

**Reference:** [scaffold-ui/packages/debug-contracts/](https://github.com/scaffold-eth/scaffold-ui) for ABI→UI patterns

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `runner/src/components/ContractInteraction.tsx` | Main deployed-contract interaction panel — lists functions, input forms, call/transact buttons, result display |
| `runner/src/components/SolidityParamInput.tsx` | Type-aware input component for Solidity ABI params (address, uint, bool, string, bytes, tuple, arrays) |
| `runner/src/flow/evmContract.ts` | Read/write contract call functions via viem (`readContract`, `writeContract`, `estimateGas`) |
| `runner/src/flow/evmRevert.ts` | Revert reason decoder — parses custom errors, Panic codes, require strings from revert data |
| `runner/e2e/solidity-interaction.spec.ts` | E2E tests for contract interaction flow |

### Modified Files

| File | Changes |
|------|---------|
| `runner/src/flow/evmExecute.ts` | Add `compileSolidityMultiFile()` — passes all .sol files to worker; extend `deploySolidity()` for constructor args |
| `runner/src/flow/solcWorker.ts` | Accept `sources: Record<string, string>` for multi-file; add import callback for resolving local imports |
| `runner/src/App.tsx` | Wire constructor arg detection, contract interaction state, multi-file compilation, deploy result → interaction panel |
| `runner/src/components/ResultPanel.tsx` | Add "Interact" tab for deployed contracts; show revert reasons in error display |
| `runner/src/components/ParamPanel.tsx` | N/A — Solidity uses its own `SolidityParamInput` (different type system from Cadence) |

---

## Chunk 1: Contract Interaction (Core Feature)

### Task 1: Contract call/transact functions (evmContract.ts)

**Files:**
- Create: `runner/src/flow/evmContract.ts`

- [ ] **Step 1: Create evmContract.ts with readContract and writeContract wrappers**

```typescript
// runner/src/flow/evmContract.ts
import { type Abi, type AbiFunction, createPublicClient, http, decodeFunctionResult, encodeFunctionData } from 'viem';
import type { WalletClient } from 'viem';
import type { Chain } from 'viem/chains';

export interface ContractCallResult {
  success: boolean;
  data?: any;           // Decoded return value
  rawData?: string;     // Hex return data
  txHash?: string;      // For write calls
  gasUsed?: bigint;
  error?: string;
  revertReason?: string;
}

export interface DeployedContract {
  address: `0x${string}`;
  name: string;
  abi: Abi;
  deployTxHash: string;
  chainId: number;
}

function getPublicClient(chain: Chain) {
  return createPublicClient({ chain, transport: http() });
}

/** Call a view/pure function (no tx, no gas) */
export async function callContractRead(
  chain: Chain,
  contract: DeployedContract,
  functionName: string,
  args: unknown[],
): Promise<ContractCallResult> {
  const client = getPublicClient(chain);
  try {
    const data = await client.readContract({
      address: contract.address,
      abi: contract.abi,
      functionName,
      args,
    });
    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.shortMessage || err.message };
  }
}

/** Send a state-changing transaction */
export async function callContractWrite(
  walletClient: WalletClient,
  contract: DeployedContract,
  functionName: string,
  args: unknown[],
  value?: bigint,
): Promise<ContractCallResult> {
  const [account] = await walletClient.getAddresses();
  if (!account) return { success: false, error: 'No EVM account connected' };

  try {
    const hash = await walletClient.writeContract({
      address: contract.address,
      abi: contract.abi,
      functionName,
      args,
      value,
      account,
      chain: walletClient.chain,
    });

    const client = getPublicClient(walletClient.chain!);
    const receipt = await client.waitForTransactionReceipt({ hash });

    return {
      success: receipt.status === 'success',
      txHash: hash,
      gasUsed: receipt.gasUsed,
      error: receipt.status === 'reverted' ? 'Transaction reverted' : undefined,
    };
  } catch (err: any) {
    return { success: false, error: err.shortMessage || err.message };
  }
}

/** Estimate gas for a function call */
export async function estimateContractGas(
  chain: Chain,
  contract: DeployedContract,
  functionName: string,
  args: unknown[],
  from: `0x${string}`,
  value?: bigint,
): Promise<bigint | null> {
  const client = getPublicClient(chain);
  try {
    return await client.estimateContractGas({
      address: contract.address,
      abi: contract.abi,
      functionName,
      args,
      account: from,
      value,
    });
  } catch {
    return null;
  }
}

/** Helper: get read and write functions from ABI */
export function categorizeAbiFunctions(abi: Abi) {
  const fns = abi.filter((item): item is AbiFunction => item.type === 'function');
  return {
    read: fns.filter(f => f.stateMutability === 'view' || f.stateMutability === 'pure'),
    write: fns.filter(f => f.stateMutability === 'nonpayable' || f.stateMutability === 'payable'),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add runner/src/flow/evmContract.ts
git commit -m "feat(runner): add evmContract read/write call functions"
```

---

### Task 2: Solidity parameter input component (SolidityParamInput.tsx)

**Files:**
- Create: `runner/src/components/SolidityParamInput.tsx`

Maps ABI input types to appropriate form fields. Reference: scaffold-ui `ContractInput.tsx`.

- [ ] **Step 1: Create SolidityParamInput.tsx**

```typescript
// runner/src/components/SolidityParamInput.tsx
import { useState } from 'react';
import type { AbiParameter } from 'viem';

interface SolidityParamInputProps {
  param: AbiParameter;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

function placeholderForType(type: string): string {
  if (type === 'address') return '0x...';
  if (type === 'bool') return 'true / false';
  if (type === 'string') return 'text';
  if (type.startsWith('uint')) return '0';
  if (type.startsWith('int')) return '0 (can be negative)';
  if (type.startsWith('bytes')) return '0x...';
  if (type.endsWith('[]')) return '["value1","value2"]';
  if (type === 'tuple') return '{"field": "value"}';
  return '';
}

function labelForType(type: string): string {
  if (type === 'address') return 'address';
  if (type === 'bool') return 'bool';
  if (type === 'string') return 'string';
  if (type.startsWith('uint')) return type;
  if (type.startsWith('int')) return type;
  if (type.startsWith('bytes')) return type;
  return type;
}

export default function SolidityParamInput({ param, value, onChange, error }: SolidityParamInputProps) {
  const type = param.type;
  const name = param.name || param.type;

  // Bool: toggle switch
  if (type === 'bool') {
    return (
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-zinc-400 font-mono flex-1">
          {name} <span className="text-zinc-600">({type})</span>
        </label>
        <button
          onClick={() => onChange(value === 'true' ? 'false' : 'true')}
          className={`w-8 h-4 rounded-full transition-colors relative ${
            value === 'true' ? 'bg-orange-600' : 'bg-zinc-700'
          }`}
        >
          <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
            value === 'true' ? 'translate-x-4' : 'translate-x-0.5'
          }`} />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      <label className="text-[11px] text-zinc-400 font-mono">
        {name} <span className="text-zinc-600">({labelForType(type)})</span>
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholderForType(type)}
        className={`w-full px-2 py-1 text-xs font-mono rounded border bg-zinc-800 text-zinc-200 outline-none transition-colors
          ${error
            ? 'border-red-500 focus:border-red-400'
            : 'border-zinc-700 focus:border-orange-500'
          }`}
      />
      {error && <div className="text-[10px] text-red-400">{error}</div>}
    </div>
  );
}

/** Parse string input to the correct JS type for viem */
export function parseParamValue(type: string, raw: string): unknown {
  if (type === 'bool') return raw === 'true';
  if (type === 'address') return raw as `0x${string}`;
  if (type.startsWith('uint') || type.startsWith('int')) {
    return BigInt(raw);
  }
  if (type.startsWith('bytes')) {
    return raw.startsWith('0x') ? raw : `0x${raw}`;
  }
  if (type === 'string') return raw;
  // Arrays and tuples: parse as JSON
  if (type.endsWith('[]') || type === 'tuple') {
    return JSON.parse(raw);
  }
  return raw;
}
```

- [ ] **Step 2: Commit**

```bash
git add runner/src/components/SolidityParamInput.tsx
git commit -m "feat(runner): add SolidityParamInput component with type-aware inputs"
```

---

### Task 3: Contract interaction panel (ContractInteraction.tsx)

**Files:**
- Create: `runner/src/components/ContractInteraction.tsx`

This is the main UI — renders after deployment, shows all functions from ABI, allows calling them. Reference: scaffold-ui `ContractReadMethods.tsx` / `ContractWriteMethods.tsx`.

- [ ] **Step 1: Create ContractInteraction.tsx**

```typescript
// runner/src/components/ContractInteraction.tsx
import { useState, useCallback, useMemo } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { BookOpen, Pencil, ChevronDown, ChevronRight, Loader2, Copy, Check, ExternalLink } from 'lucide-react';
import type { AbiFunction } from 'viem';
import type { DeployedContract, ContractCallResult } from '../flow/evmContract';
import { callContractRead, callContractWrite, categorizeAbiFunctions } from '../flow/evmContract';
import SolidityParamInput, { parseParamValue } from './SolidityParamInput';
import type { Chain } from 'viem/chains';

interface ContractInteractionProps {
  contract: DeployedContract;
  chain: Chain;
}

/** Single function card — inputs, call button, result */
function FunctionCard({
  fn,
  contract,
  chain,
  isWrite,
}: {
  fn: AbiFunction;
  contract: DeployedContract;
  chain: Chain;
  isWrite: boolean;
}) {
  const [expanded, setExpanded] = useState(fn.inputs.length === 0);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});
  const [ethValue, setEthValue] = useState('');
  const [result, setResult] = useState<ContractCallResult | null>(null);
  const [loading, setLoading] = useState(false);
  const { data: walletClient } = useWalletClient();

  const handleCall = useCallback(async () => {
    setLoading(true);
    setResult(null);
    try {
      const args = fn.inputs.map((input, i) => {
        const key = input.name || `arg${i}`;
        return parseParamValue(input.type, paramValues[key] || '');
      });

      let res: ContractCallResult;
      if (isWrite) {
        if (!walletClient) {
          setResult({ success: false, error: 'Connect EVM wallet first' });
          return;
        }
        const value = fn.stateMutability === 'payable' && ethValue
          ? BigInt(ethValue)
          : undefined;
        res = await callContractWrite(walletClient, contract, fn.name, args, value);
      } else {
        res = await callContractRead(chain, contract, fn.name, args);
      }
      setResult(res);
    } catch (err: any) {
      setResult({ success: false, error: err.message });
    } finally {
      setLoading(false);
    }
  }, [fn, paramValues, ethValue, contract, chain, isWrite, walletClient]);

  const hasInputs = fn.inputs.length > 0;

  return (
    <div className="border border-zinc-700 rounded bg-zinc-800/50">
      {/* Header */}
      <button
        onClick={() => hasInputs ? setExpanded(!expanded) : handleCall()}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-700/30 transition-colors"
      >
        {hasInputs ? (
          expanded ? <ChevronDown className="w-3 h-3 text-zinc-500" /> : <ChevronRight className="w-3 h-3 text-zinc-500" />
        ) : (
          isWrite
            ? <Pencil className="w-3 h-3 text-orange-400" />
            : <BookOpen className="w-3 h-3 text-blue-400" />
        )}
        <span className="text-xs font-mono text-zinc-200">{fn.name}</span>
        {!hasInputs && !isWrite && result?.success && (
          <span className="ml-auto text-xs font-mono text-emerald-400 truncate max-w-[200px]">
            → {formatResult(result.data)}
          </span>
        )}
        {loading && <Loader2 className="w-3 h-3 animate-spin text-zinc-500 ml-auto" />}
      </button>

      {/* Expanded: inputs + call button + result */}
      {expanded && hasInputs && (
        <div className="px-3 pb-3 space-y-2 border-t border-zinc-700/50">
          <div className="pt-2 space-y-2">
            {fn.inputs.map((input, i) => {
              const key = input.name || `arg${i}`;
              return (
                <SolidityParamInput
                  key={key}
                  param={input}
                  value={paramValues[key] || ''}
                  onChange={(v) => setParamValues(prev => ({ ...prev, [key]: v }))}
                />
              );
            })}
            {fn.stateMutability === 'payable' && (
              <div className="space-y-0.5">
                <label className="text-[11px] text-zinc-400 font-mono">
                  value <span className="text-zinc-600">(wei)</span>
                </label>
                <input
                  type="text"
                  value={ethValue}
                  onChange={(e) => setEthValue(e.target.value)}
                  placeholder="0"
                  className="w-full px-2 py-1 text-xs font-mono rounded border border-zinc-700 bg-zinc-800 text-zinc-200 outline-none focus:border-orange-500"
                />
              </div>
            )}
          </div>
          <button
            onClick={handleCall}
            disabled={loading}
            className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
              isWrite
                ? 'bg-orange-600 hover:bg-orange-500 text-white disabled:bg-orange-800'
                : 'bg-blue-600 hover:bg-blue-500 text-white disabled:bg-blue-800'
            }`}
          >
            {loading ? 'Calling...' : isWrite ? 'Write' : 'Read'}
          </button>
          {result && <ResultDisplay result={result} />}
        </div>
      )}

      {/* Auto-queried result for zero-arg reads */}
      {!hasInputs && expanded && result && (
        <div className="px-3 pb-3 border-t border-zinc-700/50 pt-2">
          <ResultDisplay result={result} />
        </div>
      )}
    </div>
  );
}

function ResultDisplay({ result }: { result: ContractCallResult }) {
  const [copied, setCopied] = useState(false);
  const text = result.success ? formatResult(result.data) : result.error || 'Unknown error';

  return (
    <div className={`text-xs font-mono p-2 rounded border ${
      result.success
        ? 'bg-emerald-900/20 border-emerald-700/50 text-emerald-300'
        : 'bg-red-900/20 border-red-700/50 text-red-400'
    }`}>
      <div className="flex items-start gap-2">
        <span className="flex-1 break-all whitespace-pre-wrap">{text}</span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="shrink-0 text-zinc-500 hover:text-zinc-300"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </button>
      </div>
      {result.txHash && (
        <div className="mt-1 text-zinc-500">
          tx: <span className="text-blue-400">{result.txHash}</span>
        </div>
      )}
      {result.gasUsed && (
        <div className="text-zinc-600">gas: {result.gasUsed.toString()}</div>
      )}
    </div>
  );
}

function formatResult(data: any): string {
  if (data === undefined || data === null) return 'null';
  if (typeof data === 'bigint') return data.toString();
  if (typeof data === 'object') return JSON.stringify(data, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
  return String(data);
}

export default function ContractInteraction({ contract, chain }: ContractInteractionProps) {
  const { read, write } = useMemo(() => categorizeAbiFunctions(contract.abi), [contract.abi]);

  return (
    <div className="space-y-3">
      {/* Contract header */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-orange-400">{contract.name}</span>
        <span className="text-[10px] font-mono text-zinc-500 truncate">{contract.address}</span>
      </div>

      {/* Read functions */}
      {read.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-blue-400 font-semibold mb-1.5 flex items-center gap-1">
            <BookOpen className="w-3 h-3" /> Read ({read.length})
          </div>
          <div className="space-y-1">
            {read.map(fn => (
              <FunctionCard key={fn.name} fn={fn} contract={contract} chain={chain} isWrite={false} />
            ))}
          </div>
        </div>
      )}

      {/* Write functions */}
      {write.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-orange-400 font-semibold mb-1.5 flex items-center gap-1">
            <Pencil className="w-3 h-3" /> Write ({write.length})
          </div>
          <div className="space-y-1">
            {write.map(fn => (
              <FunctionCard key={fn.name} fn={fn} contract={contract} chain={chain} isWrite={true} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add runner/src/components/ContractInteraction.tsx
git commit -m "feat(runner): add ContractInteraction panel with read/write function cards"
```

---

### Task 4: Wire contract interaction into ResultPanel

**Files:**
- Modify: `runner/src/components/ResultPanel.tsx`

Add an "Interact" tab that shows the ContractInteraction panel when a contract has been deployed.

- [ ] **Step 1: Add DeployedContract to ResultPanel props and Interact tab**

In `ResultPanel.tsx`:
- Add `deployedContract?: DeployedContract` and `chain?: Chain` to `ResultPanelProps`
- Add `'interact'` to the `Tab` type union
- Add the Interact tab to the tabs array (only when `deployedContract` is set)
- Render `<ContractInteraction>` when the interact tab is active

```typescript
// Add to imports
import ContractInteraction from './ContractInteraction';
import type { DeployedContract } from '../flow/evmContract';
import type { Chain } from 'viem/chains';

// Update ResultPanelProps
interface ResultPanelProps {
  results: ExecutionResult[];
  loading: boolean;
  network?: FlowNetwork;
  code?: string;
  filename?: string;
  codeType?: 'script' | 'transaction' | 'contract';
  onFixWithAI?: (errorMessage: string) => void;
  deployedContract?: DeployedContract;   // NEW
  chain?: Chain;                          // NEW
}

// Update Tab type
type Tab = 'result' | 'events' | 'logs' | 'codegen' | 'interact';

// In the tabs array, conditionally add interact tab
const tabs: { key: Tab; label: string; count?: number }[] = [
  { key: 'result', label: 'Result' },
  { key: 'events', label: 'Events', count: allEvents.length },
  { key: 'logs', label: 'Logs', count: results.length },
  { key: 'codegen', label: 'Codegen' },
  ...(deployedContract ? [{ key: 'interact' as Tab, label: 'Interact' }] : []),
];

// Render interact tab content (alongside the codegen tab, outside the overflow div)
{tab === 'interact' && deployedContract && chain && (
  <div className="flex-1 min-h-0 overflow-auto p-3">
    <ContractInteraction contract={deployedContract} chain={chain} />
  </div>
)}
```

- [ ] **Step 2: Commit**

```bash
git add runner/src/components/ResultPanel.tsx
git commit -m "feat(runner): add Interact tab to ResultPanel for deployed contracts"
```

---

### Task 5: Wire deploy result → interaction state in App.tsx

**Files:**
- Modify: `runner/src/App.tsx`

After a successful deploy, store the `DeployedContract` in state and auto-switch to the Interact tab.

- [ ] **Step 1: Add deployed contract state and pass to ResultPanel**

```typescript
// Add import
import type { DeployedContract } from './flow/evmContract';

// Add state (near other EVM state, ~line 784)
const [deployedContract, setDeployedContract] = useState<DeployedContract | null>(null);

// In handleRunSolidity, after successful deploy (~line 974):
const deployResult = await deploySolidity(walletClient, contract.abi, contract.bytecode, contract.name);
setDeployedContract({
  address: deployResult.contractAddress,
  name: deployResult.contractName,
  abi: contract.abi,
  deployTxHash: deployResult.transactionHash,
  chainId: walletClient.chain?.id ?? 747,
});
// ... existing setResults call stays

// Determine active chain for interaction
const activeEvmChain = network === 'testnet' ? flowEvmTestnet : flowEvmMainnet;

// In ResultPanel JSX, add new props:
<ResultPanel
  results={results}
  loading={loading}
  network={network}
  code={activeCode}
  filename={project.activeFile}
  codeType={codeType}
  onFixWithAI={handleFixWithAI}
  deployedContract={deployedContract ?? undefined}   // NEW
  chain={activeEvmChain}                              // NEW
/>
```

- [ ] **Step 2: Clear deployed contract when switching files or recompiling**

```typescript
// In handleRunSolidity, at the start (after setResults([])):
setDeployedContract(null);

// When active file changes (if there's a useEffect for activeFile):
// deployedContract persists across file switches — that's fine,
// user can still interact while editing other files
```

- [ ] **Step 3: Commit**

```bash
git add runner/src/App.tsx
git commit -m "feat(runner): wire deployed contract state to ResultPanel interact tab"
```

---

### Task 6: E2E test for contract interaction flow

**Files:**
- Create: `runner/e2e/solidity-interaction.spec.ts`

Note: Full interaction tests require a live Flow EVM testnet connection + funded wallet. We test what we can without that: template loading, compilation, and UI state. Tests that need a wallet are marked with `.skip` and documented.

- [ ] **Step 1: Write interaction e2e tests**

```typescript
// runner/e2e/solidity-interaction.spec.ts
import { test, expect, type Page } from '@playwright/test';

/** Load a template by clicking it in the AI panel sidebar. */
async function loadTemplate(page: Page, templateName: string) {
  const templatesSection = page.locator('text=Templates').first();
  if (!(await templatesSection.isVisible().catch(() => false))) {
    const aiToggle = page.locator('[aria-label="AI"]').or(page.locator('button:has(svg.lucide-bot)')).first();
    if (await aiToggle.isVisible().catch(() => false)) {
      await aiToggle.click();
      await page.waitForTimeout(500);
    }
  }
  await page.locator('button', { hasText: templateName }).first().click();
  await page.waitForTimeout(500);
}

test.describe('Solidity Contract Interaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1000);
  });

  test('compile shows ABI with function names', async ({ page }) => {
    test.setTimeout(120_000);
    await loadTemplate(page, 'Simple Storage');

    const compileBtn = page.locator('button', { hasText: 'Compile' }).first();
    await compileBtn.click();

    // Result should show ABI with set and get functions
    await expect(
      page.locator('text=SimpleStorage').nth(1)
    ).toBeVisible({ timeout: 90_000 });
  });

  test('no Interact tab without deployment', async ({ page }) => {
    test.setTimeout(120_000);
    await loadTemplate(page, 'Simple Storage');

    const compileBtn = page.locator('button', { hasText: 'Compile' }).first();
    await compileBtn.click();

    // Wait for compile to finish
    await expect(page.locator('.json-tree-string', { hasText: 'SimpleStorage' })).toBeVisible({ timeout: 90_000 });

    // Interact tab should NOT appear (no deployment)
    await expect(page.locator('button', { hasText: 'Interact' })).not.toBeVisible();
  });

  // Tests below require EVM wallet connection + testnet funds
  // Run manually: npx playwright test e2e/solidity-interaction.spec.ts -g "deploy"
  test.skip('shows Interact tab after deployment', async ({ page }) => {
    // Requires: MetaMask connected to Flow EVM testnet with funded account
    // 1. Load Simple Storage template
    // 2. Click "Compile & Deploy"
    // 3. Approve tx in wallet
    // 4. Verify "Interact" tab appears
    // 5. Verify set() and get() functions are listed
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd runner && node node_modules/@playwright/test/cli.js test e2e/solidity-interaction.spec.ts --reporter=list
```

- [ ] **Step 3: Commit**

```bash
git add runner/e2e/solidity-interaction.spec.ts
git commit -m "test(runner): add e2e tests for Solidity contract interaction"
```

---

## Chunk 2: Multi-File Import Support

### Task 7: Extend solcWorker for multi-file compilation

**Files:**
- Modify: `runner/src/flow/solcWorker.ts`

The worker currently only accepts a single source file. Extend it to accept all `.sol` files from the project so that `import "./IERC20.sol"` works.

- [ ] **Step 1: Update CompileRequest to accept multiple sources**

```typescript
// In solcWorker.ts, update the interface:
interface CompileRequest {
  id: number;
  source: string;          // Primary file content (backward compat)
  fileName: string;        // Primary file name
  sources?: Record<string, string>;  // All .sol files: { "IERC20.sol": "...", "MyToken.sol": "..." }
}

// In self.onmessage handler, build sources from either single or multi-file:
const allSources: Record<string, { content: string }> = {};
if (e.data.sources) {
  for (const [name, content] of Object.entries(e.data.sources)) {
    allSources[name] = { content };
  }
} else {
  allSources[fileName] = { content: source };
}

const input = {
  language: 'Solidity',
  sources: allSources,
  settings: {
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};

// Collect contracts from ALL files, not just the primary one:
const contracts: any[] = [];
if (output.contracts) {
  for (const [file, fileContracts] of Object.entries(output.contracts) as [string, any][]) {
    for (const [name, contract] of Object.entries(fileContracts) as [string, any][]) {
      contracts.push({
        name,
        abi: contract.abi,
        bytecode: `0x${contract.evm.bytecode.object}`,
        sourceFile: file,  // Track which file this came from
      });
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add runner/src/flow/solcWorker.ts
git commit -m "feat(runner): extend solcWorker for multi-file compilation"
```

---

### Task 8: Add compileSolidityMultiFile to evmExecute.ts

**Files:**
- Modify: `runner/src/flow/evmExecute.ts`

Add a function that gathers all `.sol` files from the project and passes them to the worker.

- [ ] **Step 1: Add multi-file compile function**

```typescript
// In evmExecute.ts, add:

/** Compile with all .sol files in the project for import resolution */
export async function compileSolidityMultiFile(
  primaryFile: string,
  allSolFiles: Array<{ path: string; content: string }>,
): Promise<CompilationResult> {
  const w = getWorker();
  const id = nextId++;

  const sources: Record<string, string> = {};
  for (const file of allSolFiles) {
    sources[file.path] = file.content;
  }

  return new Promise((resolve, reject) => {
    function handler(e: MessageEvent) {
      if (e.data.id !== id) return;
      w.removeEventListener('message', handler);
      w.removeEventListener('error', errorHandler);
      resolve(e.data as CompilationResult);
    }
    function errorHandler(e: ErrorEvent) {
      w.removeEventListener('message', handler);
      w.removeEventListener('error', errorHandler);
      reject(new Error(e.message));
    }
    w.addEventListener('message', handler);
    w.addEventListener('error', errorHandler);
    w.postMessage({ id, source: '', fileName: primaryFile, sources });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add runner/src/flow/evmExecute.ts
git commit -m "feat(runner): add compileSolidityMultiFile for import resolution"
```

---

### Task 9: Wire multi-file compilation into App.tsx

**Files:**
- Modify: `runner/src/App.tsx`

Replace `compileSolidity(activeCode, project.activeFile)` with `compileSolidityMultiFile` when the project has multiple .sol files.

- [ ] **Step 1: Update handleRunSolidity**

```typescript
// In App.tsx imports, add:
import { compileSolidity, compileSolidityMultiFile, deploySolidity } from './flow/evmExecute';

// In handleRunSolidity, replace the compilation call:
const solFiles = project.files.filter(f => f.path.endsWith('.sol'));
const compilation = solFiles.length > 1
  ? await compileSolidityMultiFile(
      project.activeFile,
      solFiles.map(f => ({ path: f.path, content: f.content })),
    )
  : await compileSolidity(activeCode, project.activeFile);
```

- [ ] **Step 2: Commit**

```bash
git add runner/src/App.tsx
git commit -m "feat(runner): use multi-file compilation when project has multiple .sol files"
```

---

## Chunk 3: Constructor Arguments

### Task 10: Parse constructor from ABI and show param inputs

**Files:**
- Modify: `runner/src/App.tsx`

When a Solidity contract has a constructor with parameters, show input fields before deploy.

- [ ] **Step 1: Detect constructor and show param inputs**

Add state for constructor args near other Solidity state:

```typescript
// State for Solidity constructor params
const [solidityConstructorArgs, setSolidityConstructorArgs] = useState<Record<string, string>>({});
const [lastCompiledAbi, setLastCompiledAbi] = useState<Abi | null>(null);

// After successful compilation, store ABI and check for constructor:
const contract = compilation.contracts[0];
setLastCompiledAbi(contract.abi);

// Get constructor from ABI
const constructor = contract.abi.find((item): item is AbiFunction =>
  item.type === 'constructor'
) as { inputs: AbiParameter[] } | undefined;
```

If the constructor has inputs, show a param panel between compile result and deploy. Modify `handleRunSolidity`:

```typescript
// After compilation succeeds:
if (constructor?.inputs?.length) {
  // Show compile result + constructor param panel, DON'T auto-deploy
  setResults([compileResult, {
    type: 'log',
    data: `Constructor requires ${constructor.inputs.length} argument(s). Fill in parameters and click Deploy.`,
  }]);
  return; // Stop here — user fills params, then clicks Deploy separately
}

// No constructor args → auto-deploy as before
if (evmConnected && walletClient) { ... }
```

- [ ] **Step 2: Add constructor args to deploySolidity**

In `evmExecute.ts`, update `deploySolidity` to accept constructor args:

```typescript
export async function deploySolidity(
  walletClient: WalletClient,
  abi: Abi,
  bytecode: `0x${string}`,
  contractName: string,
  constructorArgs?: unknown[],  // NEW
): Promise<DeployResult> {
  // ...
  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    account,
    chain: walletClient.chain,
    args: constructorArgs,  // NEW — viem encodes them automatically
  });
  // ...
}
```

- [ ] **Step 3: Add a Deploy button that uses constructor args**

In App.tsx, add a separate `handleDeploySolidity` callback:

```typescript
const handleDeploySolidity = useCallback(async () => {
  if (!walletClient || !lastCompiledAbi) return;
  setLoading(true);

  const contract = /* get from last compilation */ ;
  const constructor = lastCompiledAbi.find(item => item.type === 'constructor');
  const args = constructor?.inputs?.map((input, i) => {
    const key = input.name || `arg${i}`;
    return parseParamValue(input.type, solidityConstructorArgs[key] || '');
  }) || [];

  try {
    const result = await deploySolidity(walletClient, contract.abi, contract.bytecode, contract.name, args);
    // ... same deploy result handling as before
  } catch { ... }
  finally { setLoading(false); }
}, [walletClient, lastCompiledAbi, solidityConstructorArgs]);
```

Wire a "Deploy" button that appears when constructor args are present and wallet is connected. Add it near the Run button area or in the result panel.

- [ ] **Step 4: Render constructor param inputs in the result panel area**

When `lastCompiledAbi` has a constructor with inputs, render `SolidityParamInput` for each parameter below the compile result, with a "Deploy" button.

This can be done in ResultPanel or as a section in App.tsx between the editor and result panel. Keeping it in the result panel area is simpler — add a `constructorInputs` section:

```typescript
// In ResultPanel, after the last result, if constructor params exist:
{constructorParams && constructorParams.length > 0 && (
  <div className="mt-3 space-y-2 border-t border-zinc-700 pt-3">
    <div className="text-[10px] uppercase tracking-wider text-orange-400 font-semibold">
      Constructor Arguments
    </div>
    {constructorParams.map((param, i) => (
      <SolidityParamInput
        key={param.name || i}
        param={param}
        value={constructorArgValues[param.name || `arg${i}`] || ''}
        onChange={(v) => onConstructorArgChange(param.name || `arg${i}`, v)}
      />
    ))}
    <button onClick={onDeploy} disabled={!walletConnected} className="...orange button styles...">
      Deploy
    </button>
  </div>
)}
```

- [ ] **Step 5: Commit**

```bash
git add runner/src/flow/evmExecute.ts runner/src/App.tsx runner/src/components/ResultPanel.tsx
git commit -m "feat(runner): support constructor arguments for Solidity contract deployment"
```

---

## Chunk 4: Revert Reason Parsing

### Task 11: Revert reason decoder (evmRevert.ts)

**Files:**
- Create: `runner/src/flow/evmRevert.ts`

Parse revert data from failed transactions: `Error(string)`, `Panic(uint256)`, and custom errors.

- [ ] **Step 1: Create evmRevert.ts**

```typescript
// runner/src/flow/evmRevert.ts
import { decodeErrorResult, type Abi } from 'viem';

/** Well-known Panic codes from Solidity */
const PANIC_CODES: Record<number, string> = {
  0x00: 'Generic compiler panic',
  0x01: 'Assert failed',
  0x11: 'Arithmetic overflow/underflow',
  0x12: 'Division by zero',
  0x21: 'Conversion to invalid enum value',
  0x22: 'Access to incorrectly encoded storage byte array',
  0x31: 'pop() on empty array',
  0x32: 'Array index out of bounds',
  0x41: 'Too much memory allocated',
  0x51: 'Called zero-initialized function variable',
};

export interface ParsedRevert {
  type: 'require' | 'panic' | 'custom' | 'unknown';
  message: string;
  panicCode?: number;
  errorName?: string;
  args?: readonly unknown[];
}

/** Try to decode revert data into a human-readable reason */
export function parseRevertReason(errorData: string, abi?: Abi): ParsedRevert {
  if (!errorData || errorData === '0x') {
    return { type: 'unknown', message: 'Transaction reverted without reason' };
  }

  // Error(string) — standard require/revert message
  // Selector: 0x08c379a0
  if (errorData.startsWith('0x08c379a0')) {
    try {
      const decoded = decodeErrorResult({
        abi: [{ type: 'error', name: 'Error', inputs: [{ type: 'string', name: 'message' }] }],
        data: errorData as `0x${string}`,
      });
      return {
        type: 'require',
        message: String(decoded.args?.[0] || 'Reverted'),
        errorName: 'Error',
        args: decoded.args,
      };
    } catch { /* fall through */ }
  }

  // Panic(uint256)
  // Selector: 0x4e487b71
  if (errorData.startsWith('0x4e487b71')) {
    try {
      const decoded = decodeErrorResult({
        abi: [{ type: 'error', name: 'Panic', inputs: [{ type: 'uint256', name: 'code' }] }],
        data: errorData as `0x${string}`,
      });
      const code = Number(decoded.args?.[0] ?? 0);
      return {
        type: 'panic',
        message: PANIC_CODES[code] || `Panic(0x${code.toString(16)})`,
        panicCode: code,
        errorName: 'Panic',
        args: decoded.args,
      };
    } catch { /* fall through */ }
  }

  // Custom error — try decoding against provided ABI
  if (abi) {
    try {
      const decoded = decodeErrorResult({
        abi,
        data: errorData as `0x${string}`,
      });
      const args = decoded.args?.map(a => typeof a === 'bigint' ? a.toString() : String(a));
      return {
        type: 'custom',
        message: `${decoded.errorName}(${args?.join(', ') || ''})`,
        errorName: decoded.errorName,
        args: decoded.args,
      };
    } catch { /* not a known error in ABI */ }
  }

  return {
    type: 'unknown',
    message: `Reverted with data: ${errorData.slice(0, 66)}${errorData.length > 66 ? '...' : ''}`,
  };
}

/** Extract revert data from a viem error object */
export function extractRevertData(error: any): string | null {
  // viem wraps revert data in various error types
  const data = error?.data?.data || error?.cause?.data?.data || error?.data;
  if (typeof data === 'string' && data.startsWith('0x')) return data;

  // Sometimes the hex is embedded in the message
  const msg = error?.message || error?.shortMessage || '';
  const hexMatch = msg.match(/0x[0-9a-fA-F]{8,}/);
  return hexMatch ? hexMatch[0] : null;
}
```

- [ ] **Step 2: Commit**

```bash
git add runner/src/flow/evmRevert.ts
git commit -m "feat(runner): add revert reason decoder with require/panic/custom error support"
```

---

### Task 12: Wire revert parsing into deploy and contract calls

**Files:**
- Modify: `runner/src/flow/evmContract.ts`
- Modify: `runner/src/flow/evmExecute.ts`

- [ ] **Step 1: Add revert parsing to callContractWrite**

In `evmContract.ts`, update the catch block in `callContractWrite`:

```typescript
import { parseRevertReason, extractRevertData } from './evmRevert';

// In callContractWrite catch:
} catch (err: any) {
  const revertData = extractRevertData(err);
  const parsed = revertData ? parseRevertReason(revertData, contract.abi) : null;
  return {
    success: false,
    error: parsed?.message || err.shortMessage || err.message,
    revertReason: parsed?.message,
  };
}
```

- [ ] **Step 2: Add revert parsing to deploySolidity**

In `evmExecute.ts`, update the deploy error handling:

```typescript
import { parseRevertReason, extractRevertData } from './evmRevert';

// In deploySolidity, wrap the deployContract call:
try {
  const hash = await walletClient.deployContract({ ... });
  // ...
} catch (err: any) {
  const revertData = extractRevertData(err);
  const parsed = revertData ? parseRevertReason(revertData, abi) : null;
  throw new Error(parsed?.message || err.shortMessage || err.message);
}
```

- [ ] **Step 3: Commit**

```bash
git add runner/src/flow/evmContract.ts runner/src/flow/evmExecute.ts
git commit -m "feat(runner): integrate revert reason parsing into deploy and contract calls"
```

---

## Chunk 5: Solc Version Selection

### Task 13: Solc version fetcher and selector UI

**Files:**
- Modify: `runner/src/flow/solcWorker.ts`
- Modify: `runner/src/App.tsx`

Currently the worker loads the bundled `solc/soljson.js` (v0.8.34). Allow loading different versions from the Solidity CDN (`https://binaries.soliditylang.org/bin/`).

- [ ] **Step 1: Add version-aware loading to solcWorker**

```typescript
// In solcWorker.ts, update CompileRequest:
interface CompileRequest {
  id: number;
  source: string;
  fileName: string;
  sources?: Record<string, string>;
  solcVersion?: string;  // e.g. "0.8.24", "0.8.28" — if omitted, uses bundled version
}

// Cache multiple compiler versions
const compilerCache = new Map<string, any>();

async function loadSolcVersion(version?: string): Promise<any> {
  // Default: use bundled version
  if (!version) return loadSolc();

  const cacheKey = version;
  if (compilerCache.has(cacheKey)) return compilerCache.get(cacheKey)!;

  // Fetch from Solidity CDN
  // Version list: https://binaries.soliditylang.org/bin/list.json
  // Binary: https://binaries.soliditylang.org/bin/soljson-v{version}+commit.{hash}.js
  // For simplicity, fetch the list first to find the exact filename
  const listResp = await fetch('https://binaries.soliditylang.org/bin/list.json');
  const list = await listResp.json();

  // Find the release matching this version
  const release = list.releases[version];
  if (!release) throw new Error(`Solc version ${version} not found`);

  const binUrl = `https://binaries.soliditylang.org/bin/${release}`;
  const response = await fetch(binUrl);
  const script = await response.text();

  // Reset Module for this version
  const prevModule = (self as any).Module;
  (self as any).Module = {};
  (0, eval)(script);
  const soljson = (self as any).Module;
  (self as any).Module = prevModule;

  const compile = soljson.cwrap('solidity_compile', 'string', ['string', 'number', 'number']);
  const compiler = { compile: (input: string) => compile(input, 0, 0) };

  compilerCache.set(cacheKey, compiler);
  return compiler;
}

// In self.onmessage, use loadSolcVersion:
const compiler = await loadSolcVersion(e.data.solcVersion);
```

- [ ] **Step 2: Add version parameter to compileSolidity**

In `evmExecute.ts`:

```typescript
export async function compileSolidity(
  source: string,
  fileName = 'Contract.sol',
  solcVersion?: string,
): Promise<CompilationResult> {
  // ... same as before but add solcVersion to postMessage
  w.postMessage({ id, source, fileName, solcVersion });
}

export async function compileSolidityMultiFile(
  primaryFile: string,
  allSolFiles: Array<{ path: string; content: string }>,
  solcVersion?: string,
): Promise<CompilationResult> {
  // ... same but add solcVersion to postMessage
  w.postMessage({ id, source: '', fileName: primaryFile, sources, solcVersion });
}
```

- [ ] **Step 3: Auto-detect version from pragma**

In `evmExecute.ts`, add a helper:

```typescript
/** Extract solc version from pragma statement, e.g. "pragma solidity ^0.8.24;" → "0.8.24" */
export function detectPragmaVersion(source: string): string | undefined {
  const match = source.match(/pragma\s+solidity\s+[\^~>=<]*(\d+\.\d+\.\d+)/);
  return match?.[1];
}
```

- [ ] **Step 4: Wire into App.tsx**

In `handleRunSolidity`, auto-detect and pass version:

```typescript
import { detectPragmaVersion } from './flow/evmExecute';

// In handleRunSolidity:
const detectedVersion = detectPragmaVersion(activeCode);
// Only use detected version if it differs from bundled (0.8.34)
const solcVersion = detectedVersion && detectedVersion !== '0.8.34' ? detectedVersion : undefined;

const compilation = solFiles.length > 1
  ? await compileSolidityMultiFile(project.activeFile, solFiles.map(...), solcVersion)
  : await compileSolidity(activeCode, project.activeFile, solcVersion);
```

- [ ] **Step 5: Show detected version in compile result**

Update the compile result in `handleRunSolidity`:

```typescript
const compileResult: ExecutionResult = {
  type: 'script_result',
  data: JSON.stringify({
    compiled: true,
    contractName: contract.name,
    solcVersion: solcVersion || '0.8.34',
    abi: contract.abi,
    bytecodeSize: Math.floor(contract.bytecode.length / 2) + ' bytes',
  }, null, 2),
};
```

- [ ] **Step 6: Commit**

```bash
git add runner/src/flow/solcWorker.ts runner/src/flow/evmExecute.ts runner/src/App.tsx
git commit -m "feat(runner): add solc version selection with pragma auto-detect and CDN loading"
```

---

## Chunk 6: Gas Estimation Display

### Task 14: Show gas estimate before deployment

**Files:**
- Modify: `runner/src/flow/evmExecute.ts`
- Modify: `runner/src/App.tsx`

- [ ] **Step 1: Add gas estimation to deploy flow**

In `evmExecute.ts`, add an estimate function:

```typescript
export async function estimateDeployGas(
  chain: Chain,
  abi: Abi,
  bytecode: `0x${string}`,
  from: `0x${string}`,
  constructorArgs?: unknown[],
): Promise<bigint | null> {
  const { createPublicClient, http } = await import('viem');
  const client = createPublicClient({ chain, transport: http() });
  try {
    return await client.estimateContractGas({
      abi,
      bytecode,
      account: from,
      args: constructorArgs,
    });
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Wire gas estimate into handleRunSolidity**

In App.tsx, after compilation and before deploy, estimate gas:

```typescript
// After compile result, before deploy:
if (evmConnected && walletClient && evmAddress) {
  // Estimate gas
  const gasEstimate = await estimateDeployGas(activeEvmChain, contract.abi, contract.bytecode, evmAddress);
  setResults([compileResult, {
    type: 'log',
    data: `Deploying to Flow EVM...${gasEstimate ? ` (estimated gas: ${gasEstimate.toLocaleString()})` : ''}`,
  }]);
  // ... proceed with deploy
}
```

- [ ] **Step 3: Commit**

```bash
git add runner/src/flow/evmExecute.ts runner/src/App.tsx
git commit -m "feat(runner): show gas estimate before Solidity contract deployment"
```

---

## Summary

| Chunk | Tasks | What it delivers |
|-------|-------|-----------------|
| 1. Contract Interaction | Tasks 1-6 | Read/write function calls after deployment |
| 2. Multi-File Imports | Tasks 7-9 | `import "./IERC20.sol"` works |
| 3. Constructor Args | Task 10 | Deploy contracts with constructor parameters |
| 4. Revert Parsing | Tasks 11-12 | Human-readable error messages on revert |
| 5. Solc Versions | Task 13 | Auto-detect pragma, load any solc version from CDN |
| 6. Gas Estimation | Task 14 | Gas estimate shown before deploy |

### Not in scope (future iterations)
- **@openzeppelin imports** — would require bundling OZ contracts or fetching from npm registry; use OZ Wizard to inline code for now
- **Contract verification** (Blockscout API) — separate feature
- **Transaction tracing** (`debug_traceTransaction`) — needs RPC support investigation
- **Solidity unit tests** — needs server-side Foundry/Hardhat, large scope

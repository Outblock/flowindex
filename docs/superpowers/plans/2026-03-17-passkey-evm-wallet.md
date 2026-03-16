# Passkey EVM Wallet Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ERC-4337 smart wallet support on Flow-EVM so passkey users get a unified identity across Cadence and EVM, compatible with external dApps via WalletConnect.

**Architecture:** Coinbase Smart Wallet contracts deployed on Flow-EVM, self-hosted Alto bundler for UserOp submission, new `packages/evm-wallet` TypeScript package for client-side UserOp construction + passkey signing + WalletConnect. Backend changes are minimal — one new DB column, one new edge function endpoint, one updated query.

**Tech Stack:** Foundry (Solidity deployment), Alto (bundler), viem (EVM client), @walletconnect/web3wallet, @simplewebauthn/browser (WebAuthn), Deno (edge functions)

**Spec:** `docs/superpowers/specs/2026-03-17-passkey-evm-wallet-design.md`

---

## File Structure

### New Files

```
scripts/deploy-smart-wallet/
├── foundry.toml                    # Foundry project config
├── script/DeployFactory.s.sol      # Deployment script for CoinbaseSmartWalletFactory
├── .env.example                    # RPC URL + deployer key template
└── README.md                       # Deployment instructions

packages/evm-wallet/
├── package.json                    # @flowindex/evm-wallet, deps: viem, @walletconnect/web3wallet
├── tsconfig.json                   # TypeScript config extending root
├── src/
│   ├── index.ts                    # Public exports
│   ├── constants.ts                # Chain config, contract addresses, ABIs
│   ├── factory.ts                  # Counterfactual address computation via factory.getAddress()
│   ├── bundler-client.ts           # Alto bundler JSON-RPC client (eth_sendUserOperation, etc.)
│   ├── signer.ts                   # Passkey → ERC-4337 SignatureWrapper encoding
│   ├── user-op.ts                  # UserOperation construction + gas estimation
│   ├── provider.ts                 # EIP-1193 provider wrapping UserOp logic
│   └── walletconnect.ts            # WalletConnect v2 session management
├── test/
│   ├── factory.test.ts             # Address computation tests
│   ├── signer.test.ts              # Signature encoding tests
│   ├── bundler-client.test.ts      # Bundler RPC tests
│   ├── user-op.test.ts             # UserOp construction tests
│   └── provider.test.ts            # Provider method routing tests

supabase/migrations/
└── 20260317000000_evm_address.sql  # Add evm_address column to passkey_credentials

docker-compose.yml                  # Add alto-bundler service (additive)
```

### Modified Files

```
packages/auth-core/src/types.ts:22-28         # Add evmAddress to PasskeyAccount
packages/auth-core/src/passkey-client.ts:212   # Add saveEvmAddress() + update listAccounts()
supabase/functions/passkey-auth/index.ts:760   # Add /wallet/save-evm-address + update /wallet/accounts
```

---

## Chunk 1: Contract Deployment + Bundler Infrastructure

### Task 1: Foundry Deployment Script

**Files:**
- Create: `scripts/deploy-smart-wallet/foundry.toml`
- Create: `scripts/deploy-smart-wallet/script/DeployFactory.s.sol`
- Create: `scripts/deploy-smart-wallet/.env.example`

- [ ] **Step 1: Initialize Foundry project**

```bash
cd scripts && mkdir deploy-smart-wallet && cd deploy-smart-wallet
forge init --no-git --no-commit
```

- [ ] **Step 2: Install Coinbase Smart Wallet as dependency**

```bash
cd scripts/deploy-smart-wallet
forge install coinbase/smart-wallet --no-git --no-commit
forge install base-org/webauthn-sol --no-git --no-commit
```

- [ ] **Step 3: Create foundry.toml**

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.23"
bytecode_hash = "none"
evm_version = "paris"

[profile.default.optimizer]
enabled = true
runs = 1000000

[rpc_endpoints]
flow_evm_testnet = "${FLOW_EVM_TESTNET_RPC}"
flow_evm_mainnet = "${FLOW_EVM_MAINNET_RPC}"

[etherscan]
flow_evm_testnet = { key = "", url = "https://evm-testnet.flowscan.io/api" }
flow_evm_mainnet = { key = "", url = "https://evm.flowscan.io/api" }
```

- [ ] **Step 4: Create deployment script**

```solidity
// script/DeployFactory.s.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {CoinbaseSmartWalletFactory} from "smart-wallet/src/CoinbaseSmartWalletFactory.sol";
import {CoinbaseSmartWallet} from "smart-wallet/src/CoinbaseSmartWallet.sol";

contract DeployFactory is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        // Deploy implementation
        CoinbaseSmartWallet implementation = new CoinbaseSmartWallet();
        console.log("Implementation:", address(implementation));

        // Deploy factory
        CoinbaseSmartWalletFactory factory = new CoinbaseSmartWalletFactory(address(implementation));
        console.log("Factory:", address(factory));

        vm.stopBroadcast();
    }
}
```

- [ ] **Step 5: Create .env.example**

```bash
# .env.example
FLOW_EVM_TESTNET_RPC=https://testnet.evm.nodes.onflow.org
FLOW_EVM_MAINNET_RPC=https://mainnet.evm.nodes.onflow.org
DEPLOYER_PRIVATE_KEY=0x...
```

- [ ] **Step 6: Verify compilation**

Run: `cd scripts/deploy-smart-wallet && forge build`
Expected: Compilation successful

- [ ] **Step 7: Deploy to Flow-EVM testnet**

```bash
cd scripts/deploy-smart-wallet
source .env
forge script script/DeployFactory.s.sol:DeployFactory \
  --rpc-url $FLOW_EVM_TESTNET_RPC \
  --broadcast \
  --verify
```

Expected: Two contract addresses logged (implementation + factory). Record these.

- [ ] **Step 8: Verify factory works — predict an address**

```bash
# Call factory.getAddress() with a test owner + nonce 0
cast call <FACTORY_ADDRESS> \
  "getAddress(bytes[],uint256)(address)" \
  "[0x$(python3 -c 'print("00"*64)')]" 0 \
  --rpc-url $FLOW_EVM_TESTNET_RPC
```

Expected: Returns a non-zero address (the counterfactual address for the zero public key owner).

- [ ] **Step 9: Commit**

```bash
git add scripts/deploy-smart-wallet/
git commit -m "feat: add Foundry deployment script for Coinbase Smart Wallet on Flow-EVM"
```

---

### Task 2: Alto Bundler Docker Setup

**Files:**
- Modify: `docker-compose.yml`
- Create: `bundler/.env.example`

- [ ] **Step 1: Create bundler env template**

```bash
# bundler/.env.example
ALTO_RPC_URL=https://testnet.evm.nodes.onflow.org
ALTO_EXECUTOR_PRIVATE_KEY=0x...
ALTO_UTILITY_PRIVATE_KEY=0x...
ALTO_ENTRYPOINTS=0x0000000071727De22E5E9d8BAf0edAc6f37da032
ALTO_PORT=4337
```

- [ ] **Step 2: Add alto-bundler service to docker-compose.yml**

Add after the last service definition in `docker-compose.yml`:

```yaml
  alto-bundler:
    image: ghcr.io/pimlicolabs/alto:latest
    restart: unless-stopped
    ports:
      - "4337:4337"
    environment:
      - ALTO_RPC_URL=${ALTO_RPC_URL:-https://testnet.evm.nodes.onflow.org}
      - ALTO_EXECUTOR_PRIVATE_KEYS=${ALTO_EXECUTOR_PRIVATE_KEY}
      - ALTO_UTILITY_PRIVATE_KEY=${ALTO_UTILITY_PRIVATE_KEY}
      - ALTO_ENTRYPOINTS=${ALTO_ENTRYPOINTS:-0x0000000071727De22E5E9d8BAf0edAc6f37da032}
      - ALTO_SAFE_MODE=false
      - ALTO_CHAIN_TYPE=default
      - ALTO_DEPLOY_SIMULATIONS_CONTRACT=true
      - ALTO_LOG_LEVEL=debug
      - ALTO_PORT=4337
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:4337/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

> **Note:** Alto may not publish an official Docker image at `ghcr.io/pimlicolabs/alto`. If not, create a simple `bundler/Dockerfile`:
> ```dockerfile
> FROM node:20-slim
> RUN npm install -g @pimlico/alto
> ENTRYPOINT ["alto"]
> ```
> Then use `build: ./bundler` instead of `image:` in docker-compose.

- [ ] **Step 3: Generate bundler wallet keys**

```bash
# Generate executor key
cast wallet new
# Generate utility key
cast wallet new
```

Record both addresses. Fund them on Flow-EVM testnet with FLOW.

- [ ] **Step 4: Test Alto starts locally**

```bash
# With .env populated
docker compose up alto-bundler -d
docker compose logs alto-bundler -f
```

Expected: Alto starts, logs "Simulation contracts deployed" on first run, begins polling for UserOps.

- [ ] **Step 5: Verify bundler JSON-RPC responds**

```bash
curl -s http://localhost:4337 \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_supportedEntryPoints","id":1}' | jq
```

Expected: Returns `["0x0000000071727De22E5E9d8BAf0edAc6f37da032"]`

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml bundler/
git commit -m "feat: add Alto bundler service for ERC-4337 on Flow-EVM"
```

---

## Chunk 2: evm-wallet Package Core

### Task 3: Package Scaffold + Constants

**Files:**
- Create: `packages/evm-wallet/package.json`
- Create: `packages/evm-wallet/tsconfig.json`
- Create: `packages/evm-wallet/src/constants.ts`
- Create: `packages/evm-wallet/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@flowindex/evm-wallet",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "viem": "^2.25.0"
  },
  "devDependencies": {
    "vitest": "^3.0.0",
    "typescript": "^5.7.0"
  },
  "peerDependencies": {
    "@walletconnect/web3wallet": "^1.17.0",
    "@walletconnect/core": "^2.18.0"
  },
  "peerDependenciesMeta": {
    "@walletconnect/web3wallet": { "optional": true },
    "@walletconnect/core": { "optional": true }
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3: Create constants.ts**

```typescript
// packages/evm-wallet/src/constants.ts
import { defineChain } from "viem"

// Flow-EVM chain definition (not in viem's default chain list)
export const flowEvmMainnet = defineChain({
  id: 747,
  name: "Flow EVM",
  nativeCurrency: { name: "Flow", symbol: "FLOW", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://mainnet.evm.nodes.onflow.org"] },
  },
  blockExplorers: {
    default: { name: "FlowDiver", url: "https://evm.flowdiver.io" },
  },
})

export const flowEvmTestnet = defineChain({
  id: 545,
  name: "Flow EVM Testnet",
  nativeCurrency: { name: "Flow", symbol: "FLOW", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet.evm.nodes.onflow.org"] },
  },
  testnet: true,
})

// Canonical ERC-4337 EntryPoint v0.7
export const ENTRYPOINT_V07_ADDRESS = "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as const

// Deployed after Task 1 — update with actual addresses
export const FACTORY_ADDRESS = "0x_PLACEHOLDER_FACTORY" as const

// Minimal ABIs (only what we need)
export const FACTORY_ABI = [
  {
    name: "getAddress",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owners", type: "bytes[]" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "createAccount",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "owners", type: "bytes[]" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
] as const

export const SMART_WALLET_ABI = [
  {
    name: "execute",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "executeBatch",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: "entryPoint",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const

// EntryPoint v0.7 ABI (subset needed for UserOp)
export const ENTRYPOINT_ABI = [
  {
    name: "getNonce",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "sender", type: "address" },
      { name: "key", type: "uint192" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const

/**
 * Compute userOpHash client-side per ERC-4337 v0.7 spec.
 * hash = keccak256(abi.encode(userOp.hash(), entryPointAddress, chainId))
 * where userOp.hash() = keccak256(pack(sender, nonce, hashInitCode, hashCallData,
 *   accountGasLimits, preVerificationGas, gasFees, hashPaymasterAndData))
 */
export function computeUserOpHash(
  userOp: {
    sender: Address
    nonce: Hex
    initCode: Hex
    callData: Hex
    accountGasLimits: Hex
    preVerificationGas: Hex
    gasFees: Hex
    paymasterAndData: Hex
  },
  entryPoint: Address,
  chainId: number,
): Hex {
  // Lazy import to keep this at the top of the file
  const { keccak256, encodeAbiParameters, type Address, type Hex } = require("viem")

  const hashInitCode = keccak256(userOp.initCode as Hex)
  const hashCallData = keccak256(userOp.callData as Hex)
  const hashPaymasterAndData = keccak256(userOp.paymasterAndData as Hex)

  const packed = encodeAbiParameters(
    [
      { type: "address" },  // sender
      { type: "uint256" },  // nonce
      { type: "bytes32" },  // hashInitCode
      { type: "bytes32" },  // hashCallData
      { type: "bytes32" },  // accountGasLimits
      { type: "uint256" },  // preVerificationGas
      { type: "bytes32" },  // gasFees
      { type: "bytes32" },  // hashPaymasterAndData
    ],
    [
      userOp.sender,
      BigInt(userOp.nonce),
      hashInitCode,
      hashCallData,
      userOp.accountGasLimits,
      BigInt(userOp.preVerificationGas),
      userOp.gasFees,
      hashPaymasterAndData,
    ],
  )

  const userOpHash = keccak256(packed)

  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
      [userOpHash, entryPoint, BigInt(chainId)],
    ),
  )
}

// NOTE: The actual implementation should use proper ESM imports at the top of the file,
// not require(). The code above shows the algorithm; the real constants.ts will use:
//   import { keccak256, encodeAbiParameters, type Address, type Hex } from "viem"
```

- [ ] **Step 4: Create empty index.ts with placeholder exports**

```typescript
// packages/evm-wallet/src/index.ts
export { flowEvmMainnet, flowEvmTestnet, ENTRYPOINT_V07_ADDRESS, FACTORY_ADDRESS } from "./constants"
```

- [ ] **Step 5: Install dependencies**

```bash
cd packages/evm-wallet && bun install
```

- [ ] **Step 6: Verify build**

```bash
cd packages/evm-wallet && bun run build
```

Expected: Compiles with no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/evm-wallet/
git commit -m "feat(evm-wallet): scaffold package with chain config and contract ABIs"
```

---

### Task 4: Factory — Counterfactual Address Computation

**Files:**
- Create: `packages/evm-wallet/src/factory.ts`
- Create: `packages/evm-wallet/test/factory.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/evm-wallet/test/factory.test.ts
import { describe, it, expect } from "vitest"
import { encodeOwnerBytes, parsePublicKey } from "../src/factory"

describe("factory", () => {
  // Known P-256 SEC1 public key (uncompressed, 65 bytes hex with 04 prefix)
  const testPubKeyHex =
    "04" +
    "a]b".repeat(0) + // placeholder
    "0000000000000000000000000000000000000000000000000000000000000001" + // x
    "0000000000000000000000000000000000000000000000000000000000000002"   // y

  describe("parsePublicKey", () => {
    it("extracts x and y coordinates from SEC1 hex", () => {
      const { x, y } = parsePublicKey(testPubKeyHex)
      expect(x).toBe(1n)
      expect(y).toBe(2n)
    })

    it("throws on invalid prefix", () => {
      expect(() => parsePublicKey("05" + "00".repeat(64))).toThrow()
    })

    it("throws on wrong length", () => {
      expect(() => parsePublicKey("04" + "00".repeat(10))).toThrow()
    })
  })

  describe("encodeOwnerBytes", () => {
    it("ABI-encodes x,y as two uint256", () => {
      const encoded = encodeOwnerBytes(1n, 2n)
      // abi.encode(uint256, uint256) = 64 bytes
      expect(encoded.length).toBe(2 + 128) // 0x prefix + 128 hex chars
      // First 32 bytes = x (padded)
      expect(encoded.slice(2, 66)).toBe("0000000000000000000000000000000000000000000000000000000000000001")
      // Second 32 bytes = y (padded)
      expect(encoded.slice(66, 130)).toBe("0000000000000000000000000000000000000000000000000000000000000002")
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/evm-wallet && bun run test`
Expected: FAIL — `parsePublicKey` and `encodeOwnerBytes` not found

- [ ] **Step 3: Implement factory.ts**

```typescript
// packages/evm-wallet/src/factory.ts
import {
  type Address,
  type Hex,
  createPublicClient,
  http,
  encodeAbiParameters,
  encodeFunctionData,
  concat,
} from "viem"
import { FACTORY_ABI, FACTORY_ADDRESS } from "./constants"

/**
 * Parse SEC1 uncompressed P-256 public key into x, y coordinates.
 * Input: "04" + 32-byte x hex + 32-byte y hex (130 hex chars total)
 */
export function parsePublicKey(sec1Hex: string): { x: bigint; y: bigint } {
  const clean = sec1Hex.startsWith("0x") ? sec1Hex.slice(2) : sec1Hex
  if (!clean.startsWith("04")) {
    throw new Error("Expected uncompressed SEC1 public key (04 prefix)")
  }
  if (clean.length !== 130) {
    throw new Error(`Expected 130 hex chars (65 bytes), got ${clean.length}`)
  }
  const x = BigInt("0x" + clean.slice(2, 66))
  const y = BigInt("0x" + clean.slice(66, 130))
  return { x, y }
}

/**
 * ABI-encode P-256 coordinates as Coinbase Smart Wallet owner bytes.
 * Returns: abi.encode(uint256 x, uint256 y) — 64 bytes as hex
 */
export function encodeOwnerBytes(x: bigint, y: bigint): Hex {
  return encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }],
    [x, y],
  )
}

/**
 * Build the owners array for a single passkey owner.
 */
export function buildOwners(sec1Hex: string): Hex[] {
  const { x, y } = parsePublicKey(sec1Hex)
  return [encodeOwnerBytes(x, y)]
}

/**
 * Compute the counterfactual Smart Wallet address by calling factory.getAddress() on-chain.
 */
export async function getSmartWalletAddress(
  sec1Hex: string,
  opts: {
    factoryAddress?: Address
    rpcUrl: string
    nonce?: bigint
  },
): Promise<Address> {
  const { rpcUrl, nonce = 0n } = opts
  const factoryAddress = opts.factoryAddress ?? FACTORY_ADDRESS as Address
  const owners = buildOwners(sec1Hex)

  const client = createPublicClient({ transport: http(rpcUrl) })
  const address = await client.readContract({
    address: factoryAddress,
    abi: FACTORY_ABI,
    functionName: "getAddress",
    args: [owners, nonce],
  })
  return address
}

/**
 * Build the initCode for first-time wallet deployment via EntryPoint.
 * initCode = factory address + factory.createAccount(owners, nonce) calldata
 */
export function buildInitCode(
  sec1Hex: string,
  opts?: { factoryAddress?: Address; nonce?: bigint },
): Hex {
  const factoryAddress = opts?.factoryAddress ?? FACTORY_ADDRESS as Address
  const nonce = opts?.nonce ?? 0n
  const owners = buildOwners(sec1Hex)

  const callData = encodeFunctionData({
    abi: FACTORY_ABI,
    functionName: "createAccount",
    args: [owners, nonce],
  })

  return concat([factoryAddress, callData])
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/evm-wallet && bun run test`
Expected: All tests PASS

- [ ] **Step 5: Update index.ts exports**

```typescript
// Add to packages/evm-wallet/src/index.ts
export { parsePublicKey, encodeOwnerBytes, buildOwners, getSmartWalletAddress, buildInitCode } from "./factory"
```

- [ ] **Step 6: Commit**

```bash
git add packages/evm-wallet/src/factory.ts packages/evm-wallet/test/factory.test.ts packages/evm-wallet/src/index.ts
git commit -m "feat(evm-wallet): add counterfactual address computation"
```

---

### Task 5: Signer — Passkey to ERC-4337 Signature Encoding

**Files:**
- Create: `packages/evm-wallet/src/signer.ts`
- Create: `packages/evm-wallet/test/signer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/evm-wallet/test/signer.test.ts
import { describe, it, expect } from "vitest"
import {
  derToRS,
  findChallengeIndex,
  findTypeIndex,
  encodeWebAuthnSignature,
} from "../src/signer"

describe("signer", () => {
  describe("derToRS", () => {
    it("extracts r and s from a DER-encoded P-256 signature", () => {
      // Example DER signature: 0x30 <len> 0x02 <rlen> <r> 0x02 <slen> <s>
      // r = 1, s = 2 (32 bytes each, zero-padded)
      const r32 = "0000000000000000000000000000000000000000000000000000000000000001"
      const s32 = "0000000000000000000000000000000000000000000000000000000000000002"
      // Minimal DER: 30 44 02 20 <r32> 02 20 <s32>
      const der = new Uint8Array(
        Buffer.from("3044" + "0220" + r32 + "0220" + s32, "hex"),
      )
      const { r, s } = derToRS(der)
      expect(r).toBe(1n)
      expect(s).toBe(2n)
    })
  })

  describe("findChallengeIndex", () => {
    it("finds byte offset of challenge in clientDataJSON", () => {
      const clientDataJSON = '{"type":"webauthn.get","challenge":"dGVzdA","origin":"https://example.com"}'
      const idx = findChallengeIndex(clientDataJSON)
      const expected = clientDataJSON.indexOf('"challenge":"') + '"challenge":"'.length
      expect(idx).toBe(expected)
    })
  })

  describe("findTypeIndex", () => {
    it("finds byte offset of type in clientDataJSON", () => {
      const clientDataJSON = '{"type":"webauthn.get","challenge":"dGVzdA","origin":"https://example.com"}'
      const idx = findTypeIndex(clientDataJSON)
      const expected = clientDataJSON.indexOf('"type":"') + '"type":"'.length
      expect(idx).toBe(expected)
    })
  })

  describe("encodeWebAuthnSignature", () => {
    it("ABI-encodes SignatureWrapper struct", () => {
      const result = encodeWebAuthnSignature({
        ownerIndex: 0n,
        authenticatorData: new Uint8Array([0x01, 0x02]),
        clientDataJSON: '{"type":"webauthn.get","challenge":"dGVzdA"}',
        r: 1n,
        s: 2n,
      })
      // Should be a valid hex string
      expect(result).toMatch(/^0x[0-9a-f]+$/i)
      // Should be long (ABI encoding of nested structs)
      expect(result.length).toBeGreaterThan(200)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/evm-wallet && bun run test`
Expected: FAIL — signer functions not found

- [ ] **Step 3: Implement signer.ts**

```typescript
// packages/evm-wallet/src/signer.ts
import {
  type Hex,
  encodeAbiParameters,
  toHex,
} from "viem"

/**
 * Extract r, s as bigint from a DER-encoded ECDSA signature.
 * DER: 0x30 <totalLen> 0x02 <rLen> <r> 0x02 <sLen> <s>
 */
export function derToRS(der: Uint8Array): { r: bigint; s: bigint } {
  // Skip: 0x30 <len>
  let offset = 2
  // r
  if (der[offset] !== 0x02) throw new Error("Expected 0x02 tag for r")
  offset++
  const rLen = der[offset]
  offset++
  const rBytes = der.slice(offset, offset + rLen)
  offset += rLen
  // s
  if (der[offset] !== 0x02) throw new Error("Expected 0x02 tag for s")
  offset++
  const sLen = der[offset]
  offset++
  const sBytes = der.slice(offset, offset + sLen)

  // Convert to bigint (browser-compatible, no Buffer dependency)
  const toHexStr = (bytes: Uint8Array) =>
    Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("")
  const r = BigInt("0x" + toHexStr(rBytes))
  const s = BigInt("0x" + toHexStr(sBytes))
  return { r, s }
}

/**
 * Find the byte offset of the challenge value in clientDataJSON.
 * Looks for `"challenge":"` and returns the index after the last `"`.
 */
export function findChallengeIndex(clientDataJSON: string): number {
  const needle = '"challenge":"'
  const idx = clientDataJSON.indexOf(needle)
  if (idx === -1) throw new Error("challenge not found in clientDataJSON")
  return idx + needle.length
}

/**
 * Find the byte offset of the type value in clientDataJSON.
 * Looks for `"type":"` and returns the index after the last `"`.
 */
export function findTypeIndex(clientDataJSON: string): number {
  const needle = '"type":"'
  const idx = clientDataJSON.indexOf(needle)
  if (idx === -1) throw new Error("type not found in clientDataJSON")
  return idx + needle.length
}

/**
 * ABI-encode a WebAuthn assertion as Coinbase Smart Wallet SignatureWrapper.
 *
 * On-chain struct:
 *   SignatureWrapper { uint256 ownerIndex, bytes signatureData }
 *   WebAuthnAuth { bytes authenticatorData, string clientDataJSON,
 *                  uint256 challengeIndex, uint256 typeIndex,
 *                  uint256 r, uint256 s }
 */
export function encodeWebAuthnSignature(params: {
  ownerIndex: bigint
  authenticatorData: Uint8Array
  clientDataJSON: string
  r: bigint
  s: bigint
}): Hex {
  const { ownerIndex, authenticatorData, clientDataJSON, r, s } = params
  const challengeIndex = BigInt(findChallengeIndex(clientDataJSON))
  const typeIndex = BigInt(findTypeIndex(clientDataJSON))

  // Inner: WebAuthnAuth struct
  const signatureData = encodeAbiParameters(
    [
      { type: "bytes" },   // authenticatorData
      { type: "string" },  // clientDataJSON
      { type: "uint256" }, // challengeIndex
      { type: "uint256" }, // typeIndex
      { type: "uint256" }, // r
      { type: "uint256" }, // s
    ],
    [
      toHex(authenticatorData),
      clientDataJSON,
      challengeIndex,
      typeIndex,
      r,
      s,
    ],
  )

  // Outer: SignatureWrapper struct
  return encodeAbiParameters(
    [
      { type: "uint256" }, // ownerIndex
      { type: "bytes" },   // signatureData
    ],
    [ownerIndex, signatureData],
  )
}

/**
 * Sign a userOpHash using the browser's WebAuthn API.
 * Returns the encoded SignatureWrapper ready for the UserOperation.
 */
export async function signUserOpWithPasskey(
  userOpHash: Hex,
  credentialId: string,
  ownerIndex = 0n,
): Promise<Hex> {
  // Challenge = raw bytes of userOpHash (strip 0x, convert to ArrayBuffer)
  const challengeBytes = new Uint8Array(
    (userOpHash.slice(2).match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)),
  )

  // Decode base64url credential ID (WebAuthn uses base64url, not standard base64)
  const base64urlToBytes = (b64url: string): Uint8Array => {
    const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/")
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4)
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
  }

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: challengeBytes,
      allowCredentials: [
        {
          id: base64urlToBytes(credentialId),
          type: "public-key",
        },
      ],
      userVerification: "preferred",
    },
  })) as PublicKeyCredential

  const response = assertion.response as AuthenticatorAssertionResponse
  const authenticatorData = new Uint8Array(response.authenticatorData)
  const clientDataJSON = new TextDecoder().decode(response.clientDataJSON)
  const signature = new Uint8Array(response.signature)

  const { r, s } = derToRS(signature)

  return encodeWebAuthnSignature({
    ownerIndex,
    authenticatorData,
    clientDataJSON,
    r,
    s,
  })
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/evm-wallet && bun run test`
Expected: All signer tests PASS (note: `signUserOpWithPasskey` requires browser, tested manually in Step 3 of validation)

- [ ] **Step 5: Update index.ts**

```typescript
// Add to packages/evm-wallet/src/index.ts
export { derToRS, encodeWebAuthnSignature, signUserOpWithPasskey } from "./signer"
```

- [ ] **Step 6: Commit**

```bash
git add packages/evm-wallet/src/signer.ts packages/evm-wallet/test/signer.test.ts packages/evm-wallet/src/index.ts
git commit -m "feat(evm-wallet): add passkey signature encoding for Coinbase Smart Wallet"
```

---

### Task 6: Bundler Client — Alto JSON-RPC

**Files:**
- Create: `packages/evm-wallet/src/bundler-client.ts`
- Create: `packages/evm-wallet/test/bundler-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/evm-wallet/test/bundler-client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createBundlerClient } from "../src/bundler-client"

// Mock fetch
const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

describe("bundler-client", () => {
  let client: ReturnType<typeof createBundlerClient>

  beforeEach(() => {
    client = createBundlerClient("http://localhost:4337")
    mockFetch.mockReset()
  })

  it("sends eth_sendUserOperation with correct params", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: "0xhash123" }),
    })

    const result = await client.sendUserOperation(
      { sender: "0xabc" } as any,
      "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    )

    expect(mockFetch).toHaveBeenCalledOnce()
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.method).toBe("eth_sendUserOperation")
    expect(body.params[1]).toBe("0x0000000071727De22E5E9d8BAf0edAc6f37da032")
    expect(result).toBe("0xhash123")
  })

  it("sends eth_estimateUserOperationGas", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: {
          preVerificationGas: "0xc350",
          verificationGasLimit: "0x186a0",
          callGasLimit: "0x493e0",
        },
      }),
    })

    const result = await client.estimateUserOperationGas(
      { sender: "0xabc" } as any,
      "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    )

    expect(result.preVerificationGas).toBe("0xc350")
  })

  it("throws on JSON-RPC error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "AA21 account not deployed" },
      }),
    })

    await expect(
      client.sendUserOperation({} as any, "0x123"),
    ).rejects.toThrow("AA21 account not deployed")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/evm-wallet && bun run test`
Expected: FAIL — `createBundlerClient` not found

- [ ] **Step 3: Implement bundler-client.ts**

```typescript
// packages/evm-wallet/src/bundler-client.ts
import type { Hex, Address } from "viem"

export interface PackedUserOperation {
  sender: Address
  nonce: Hex
  initCode: Hex
  callData: Hex
  accountGasLimits: Hex
  preVerificationGas: Hex
  gasFees: Hex
  paymasterAndData: Hex
  signature: Hex
}

export interface GasEstimate {
  preVerificationGas: Hex
  verificationGasLimit: Hex
  callGasLimit: Hex
}

export interface UserOpReceipt {
  userOpHash: Hex
  sender: Address
  nonce: Hex
  success: boolean
  actualGasCost: Hex
  actualGasUsed: Hex
  receipt: {
    transactionHash: Hex
    blockNumber: Hex
  }
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0"
  id: number
  result?: T
  error?: { code: number; message: string }
}

export function createBundlerClient(bundlerUrl: string) {
  let nextId = 1

  async function rpc<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(bundlerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: nextId++,
        method,
        params,
      }),
    })

    const json: JsonRpcResponse<T> = await res.json()
    if (json.error) {
      throw new Error(`Bundler RPC error: ${json.error.message}`)
    }
    return json.result!
  }

  return {
    async sendUserOperation(
      userOp: PackedUserOperation,
      entryPoint: Address,
    ): Promise<Hex> {
      return rpc<Hex>("eth_sendUserOperation", [userOp, entryPoint])
    },

    async estimateUserOperationGas(
      userOp: Partial<PackedUserOperation>,
      entryPoint: Address,
    ): Promise<GasEstimate> {
      return rpc<GasEstimate>("eth_estimateUserOperationGas", [
        userOp,
        entryPoint,
      ])
    },

    async getUserOperationReceipt(
      userOpHash: Hex,
    ): Promise<UserOpReceipt | null> {
      return rpc<UserOpReceipt | null>("eth_getUserOperationReceipt", [
        userOpHash,
      ])
    },

    async supportedEntryPoints(): Promise<Address[]> {
      return rpc<Address[]>("eth_supportedEntryPoints", [])
    },
  }
}

export type BundlerClient = ReturnType<typeof createBundlerClient>
```

- [ ] **Step 4: Run tests**

Run: `cd packages/evm-wallet && bun run test`
Expected: All bundler-client tests PASS

- [ ] **Step 5: Update index.ts**

```typescript
// Add to packages/evm-wallet/src/index.ts
export { createBundlerClient, type BundlerClient, type PackedUserOperation, type GasEstimate } from "./bundler-client"
```

- [ ] **Step 6: Commit**

```bash
git add packages/evm-wallet/src/bundler-client.ts packages/evm-wallet/test/bundler-client.test.ts packages/evm-wallet/src/index.ts
git commit -m "feat(evm-wallet): add Alto bundler JSON-RPC client"
```

---

### Task 7: UserOp Construction

**Files:**
- Create: `packages/evm-wallet/src/user-op.ts`
- Create: `packages/evm-wallet/test/user-op.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/evm-wallet/test/user-op.test.ts
import { describe, it, expect } from "vitest"
import { packGasLimits, packGasFees, buildCallData } from "../src/user-op"

describe("user-op", () => {
  describe("packGasLimits", () => {
    it("packs verificationGasLimit and callGasLimit into bytes32", () => {
      const packed = packGasLimits(100000n, 300000n)
      // bytes32 = uint128(verificationGasLimit) || uint128(callGasLimit)
      expect(packed).toMatch(/^0x[0-9a-f]{64}$/i)
    })
  })

  describe("packGasFees", () => {
    it("packs maxPriorityFeePerGas and maxFeePerGas into bytes32", () => {
      const packed = packGasFees(0n, 1000000n)
      expect(packed).toMatch(/^0x[0-9a-f]{64}$/i)
    })
  })

  describe("buildCallData", () => {
    it("encodes a single execute call", () => {
      const callData = buildCallData({
        target: "0x1234567890abcdef1234567890abcdef12345678",
        value: 0n,
        data: "0x",
      })
      // Should start with execute function selector
      expect(callData).toMatch(/^0x/)
      expect(callData.length).toBeGreaterThan(10)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/evm-wallet && bun run test`
Expected: FAIL

- [ ] **Step 3: Implement user-op.ts**

```typescript
// packages/evm-wallet/src/user-op.ts
import {
  type Address,
  type Hex,
  encodeFunctionData,
  pad,
  concat,
  toHex,
  createPublicClient,
  http,
} from "viem"
import { SMART_WALLET_ABI, ENTRYPOINT_ABI, ENTRYPOINT_V07_ADDRESS } from "./constants"
import { buildInitCode } from "./factory"
import type { BundlerClient, PackedUserOperation, GasEstimate } from "./bundler-client"

export interface CallParams {
  target: Address
  value: bigint
  data: Hex
}

/**
 * Pack verificationGasLimit and callGasLimit into bytes32.
 * Format: uint128(verificationGasLimit) || uint128(callGasLimit)
 */
export function packGasLimits(
  verificationGasLimit: bigint,
  callGasLimit: bigint,
): Hex {
  const vgl = pad(toHex(verificationGasLimit), { size: 16 })
  const cgl = pad(toHex(callGasLimit), { size: 16 })
  return concat([vgl, cgl])
}

/**
 * Pack maxPriorityFeePerGas and maxFeePerGas into bytes32.
 * Format: uint128(maxPriorityFeePerGas) || uint128(maxFeePerGas)
 */
export function packGasFees(
  maxPriorityFeePerGas: bigint,
  maxFeePerGas: bigint,
): Hex {
  const mpfpg = pad(toHex(maxPriorityFeePerGas), { size: 16 })
  const mfpg = pad(toHex(maxFeePerGas), { size: 16 })
  return concat([mpfpg, mfpg])
}

/**
 * Encode callData for CoinbaseSmartWallet.execute()
 */
export function buildCallData(call: CallParams): Hex {
  return encodeFunctionData({
    abi: SMART_WALLET_ABI,
    functionName: "execute",
    args: [call.target, call.value, call.data],
  })
}

/**
 * Encode callData for CoinbaseSmartWallet.executeBatch()
 */
export function buildBatchCallData(calls: CallParams[]): Hex {
  return encodeFunctionData({
    abi: SMART_WALLET_ABI,
    functionName: "executeBatch",
    args: [calls],
  })
}

/**
 * Build a complete unsigned UserOperation (v0.7 packed format).
 */
export async function buildUserOperation(opts: {
  sender: Address
  call: CallParams | CallParams[]
  publicKeySec1Hex: string
  isDeployed: boolean
  rpcUrl: string
  bundlerClient: BundlerClient
  entryPoint?: Address
}): Promise<PackedUserOperation> {
  const {
    sender,
    call,
    publicKeySec1Hex,
    isDeployed,
    rpcUrl,
    bundlerClient,
    entryPoint = ENTRYPOINT_V07_ADDRESS,
  } = opts

  const client = createPublicClient({ transport: http(rpcUrl) })

  // 1. Get nonce from EntryPoint
  const nonce = await client.readContract({
    address: entryPoint,
    abi: ENTRYPOINT_ABI,
    functionName: "getNonce",
    args: [sender, 0n],
  })

  // 2. Build initCode (only for first tx when wallet not deployed)
  const initCode: Hex = isDeployed ? "0x" : buildInitCode(publicKeySec1Hex)

  // 3. Build callData
  const callData = Array.isArray(call)
    ? buildBatchCallData(call)
    : buildCallData(call)

  // 4. Estimate gas via bundler
  const dummySignature = "0x" + "ff".repeat(65) as Hex // placeholder for estimation
  const gasEstimate: GasEstimate = await bundlerClient.estimateUserOperationGas(
    {
      sender,
      nonce: toHex(nonce),
      initCode,
      callData,
      signature: dummySignature,
      paymasterAndData: "0x",
      // Use placeholder gas values for estimation
      accountGasLimits: packGasLimits(500000n, 500000n),
      preVerificationGas: toHex(100000n),
      gasFees: packGasFees(0n, 1000000n),
    },
    entryPoint,
  )

  // 5. Get gas prices
  const block = await client.getBlock()
  const baseFee = block.baseFeePerGas ?? 1n
  const maxFeePerGas = baseFee * 2n > 1000000n ? baseFee * 2n : 1000000n
  const maxPriorityFeePerGas = 0n

  return {
    sender,
    nonce: toHex(nonce),
    initCode,
    callData,
    accountGasLimits: packGasLimits(
      BigInt(gasEstimate.verificationGasLimit),
      BigInt(gasEstimate.callGasLimit),
    ),
    preVerificationGas: gasEstimate.preVerificationGas,
    gasFees: packGasFees(maxPriorityFeePerGas, maxFeePerGas),
    paymasterAndData: "0x",
    signature: "0x", // to be filled by signer
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/evm-wallet && bun run test`
Expected: All user-op tests PASS

- [ ] **Step 5: Update index.ts**

```typescript
// Add to packages/evm-wallet/src/index.ts
export { buildUserOperation, buildCallData, buildBatchCallData, type CallParams } from "./user-op"
```

- [ ] **Step 6: Commit**

```bash
git add packages/evm-wallet/src/user-op.ts packages/evm-wallet/test/user-op.test.ts packages/evm-wallet/src/index.ts
git commit -m "feat(evm-wallet): add UserOperation construction and gas packing"
```

---

## Chunk 3: Backend Integration + EIP-1193 Provider

### Task 8: Database Migration

**Files:**
- Create: `supabase/migrations/20260317000000_evm_address.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Add EVM smart wallet address to passkey credentials
ALTER TABLE public.passkey_credentials
  ADD COLUMN IF NOT EXISTS evm_address TEXT;

CREATE INDEX IF NOT EXISTS idx_passkey_credentials_evm_address
  ON public.passkey_credentials(evm_address);
```

- [ ] **Step 2: Apply migration on local Supabase**

```bash
# Apply manually via psql (migrations are run by run-migrations.sh, not auto-applied on restart)
docker compose exec supabase-db psql -U supabase_admin -d postgres \
  -f /docker-entrypoint-initdb.d/20260317000000_evm_address.sql
```

Or if using `run-migrations.sh`:
```bash
bash supabase/run-migrations.sh
```

Expected: Migration applied, no errors.

- [ ] **Step 3: Verify column exists**

```bash
docker compose exec supabase-db psql -U supabase_admin -d postgres \
  -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name='passkey_credentials' AND column_name='evm_address';"
```

Expected: Returns `evm_address | text`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260317000000_evm_address.sql
git commit -m "feat: add evm_address column to passkey_credentials"
```

---

### Task 9: Edge Function — /wallet/save-evm-address + /wallet/accounts Update

**Files:**
- Modify: `supabase/functions/passkey-auth/index.ts:627-648` (add new endpoint after provision-save)
- Modify: `supabase/functions/passkey-auth/index.ts:760-789` (update /wallet/accounts)

- [ ] **Step 1: Add /wallet/save-evm-address case to switch statement**

The edge function uses a `switch (endpoint)` pattern (line 188). Add a new case after the existing `/wallet/provision-save` case (after line 648):

```typescript
      case '/wallet/save-evm-address': {
        const user = await getAuthenticatedUser();
        if (!user) { result = error('UNAUTHORIZED', 'Authentication required'); break; }

        const { credentialId: evmCredId, evmAddress } = data as { credentialId: string; evmAddress: string };
        if (!evmCredId || !evmAddress) {
          result = error('INVALID_INPUT', 'Missing credentialId or evmAddress');
          break;
        }

        // Verify credential belongs to user
        const { data: cred, error: credErr } = await supabaseAdmin
          .from('passkey_credentials')
          .select('public_key_sec1_hex')
          .eq('id', evmCredId)
          .eq('user_id', user.id)
          .single();

        if (credErr || !cred) { result = error('NOT_FOUND', 'Credential not found'); break; }

        // Log for audit (full server-side re-derivation via eth_call deferred to follow-up)
        console.log(`[passkey-auth] Saving EVM address: ${evmAddress} for credential: ${evmCredId}`);

        const normalizedAddress = evmAddress.toLowerCase();
        const { error: updateErr } = await supabaseAdmin
          .from('passkey_credentials')
          .update({ evm_address: normalizedAddress })
          .eq('id', evmCredId)
          .eq('user_id', user.id);

        if (updateErr) { result = error('INTERNAL', 'Failed to save EVM address'); break; }
        result = success({ evmAddress: normalizedAddress });
        break;
      }
```

> **Implementation note:** Full server-side re-derivation via `factory.getAddress()` eth_call requires complex ABI encoding in Deno without viem. Initial implementation logs + trusts the client. Add eth_call validation in a follow-up once factory is deployed.

- [ ] **Step 2: Update /wallet/accounts case to include evm_address**

In the existing `/wallet/accounts` case (line 760-789), make two changes:

**Change 1 — line 773-777:** Update `.select()` and filter:

Before:
```typescript
        const { data: credentials } = await supabaseAdmin.from('passkey_credentials')
          .select('id, public_key_sec1_hex, flow_address, authenticator_name, created_at')
          .eq('user_id', user.id)
          .not('flow_address', 'is', null)
          .order('created_at', { ascending: false });
```

After:
```typescript
        const { data: credentials } = await supabaseAdmin.from('passkey_credentials')
          .select('id, public_key_sec1_hex, flow_address, evm_address, authenticator_name, created_at')
          .eq('user_id', user.id)
          .or('flow_address.not.is.null,evm_address.not.is.null')
          .order('created_at', { ascending: false });
```

**Change 2 — line 780-786:** Add `evmAddress` to response mapping:

Before:
```typescript
          accounts: credentials?.map((c) => ({
            credentialId: c.id,
            publicKeySec1Hex: c.public_key_sec1_hex,
            flowAddress: c.flow_address,
            authenticatorName: c.authenticator_name,
            createdAt: c.created_at,
          })) || []
```

After:
```typescript
          accounts: credentials?.map((c) => ({
            credentialId: c.id,
            publicKeySec1Hex: c.public_key_sec1_hex,
            flowAddress: c.flow_address,
            evmAddress: c.evm_address,
            authenticatorName: c.authenticator_name,
            createdAt: c.created_at,
          })) || []
```

- [ ] **Step 3: Add EVM_WALLET_FACTORY_ADDRESS and EVM_RPC_URL to passkey-auth environment**

In `docker-compose.yml`, add to the passkey-auth service's environment:

```yaml
      - EVM_WALLET_FACTORY_ADDRESS=${EVM_WALLET_FACTORY_ADDRESS:-}
      - EVM_RPC_URL=${EVM_RPC_URL:-https://mainnet.evm.nodes.onflow.org}
```

- [ ] **Step 4: Test endpoints manually**

```bash
# Test save-evm-address (requires auth token)
curl -X POST http://localhost:54321/functions/v1/passkey-auth/wallet/save-evm-address \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"credentialId":"test-id","evmAddress":"0x1234..."}'

# Test wallet/accounts returns evm_address
curl http://localhost:54321/functions/v1/passkey-auth/wallet/accounts \
  -H "Authorization: Bearer <token>"
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/passkey-auth/index.ts docker-compose.yml
git commit -m "feat: add /wallet/save-evm-address endpoint and update /wallet/accounts"
```

---

### Task 10: auth-core Type + Client Updates

**Files:**
- Modify: `packages/auth-core/src/types.ts:22-28`
- Modify: `packages/auth-core/src/passkey-client.ts:212-215`

- [ ] **Step 1: Add evmAddress to PasskeyAccount type + make flowAddress optional**

In `packages/auth-core/src/types.ts`, update the `PasskeyAccount` interface (line 22-28):

Before:
```typescript
export interface PasskeyAccount {
  credentialId: string
  flowAddress: string
  flowAddressTestnet?: string
  publicKeySec1Hex: string
  authenticatorName?: string
}
```

After:
```typescript
export interface PasskeyAccount {
  credentialId: string
  flowAddress?: string
  flowAddressTestnet?: string
  evmAddress?: string
  publicKeySec1Hex: string
  authenticatorName?: string
}
```

> **Note:** `flowAddress` becomes optional because the updated `/wallet/accounts` filter returns credentials with only an EVM address (no Flow address). Check all call sites that access `.flowAddress` and handle the optional case.

- [ ] **Step 2: Add saveEvmAddress method to passkey-client.ts**

In `packages/auth-core/src/passkey-client.ts`, add after `saveProvisionedAddress` (line 199). Follow the existing pattern — `passkeyApi(endpoint, data, accessToken)`:

```typescript
    /**
     * Save a computed EVM smart wallet address for a passkey credential.
     */
    async saveEvmAddress(accessToken: string, credentialId: string, evmAddress: string): Promise<void> {
      await passkeyApi('/wallet/save-evm-address', { credentialId, evmAddress }, accessToken);
    },
```

- [ ] **Step 3: Update listAccounts — no signature change needed**

The existing `listAccounts` (line 212-215) already returns whatever the edge function sends. Since the edge function response now includes `evmAddress` in each account object, and `passkeyApi` parses JSON and returns `data.accounts`, the client method passes it through automatically. No code change needed — the `PasskeyAccount` type update in Step 1 is sufficient.

Verify by reading the current code:
```typescript
    // Existing code — no change needed:
    async listAccounts(accessToken: string): Promise<PasskeyAccount[]> {
      const data = await passkeyApi('/wallet/accounts', {}, accessToken);
      return Array.isArray(data.accounts) ? data.accounts : [];
    },
```

The edge function returns `{ accounts: [{ ..., evmAddress: "0x..." }] }` and the client passes it through as-is.

- [ ] **Step 3: Verify build**

```bash
cd packages/auth-core && bun run build
```

Expected: No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add packages/auth-core/src/types.ts packages/auth-core/src/passkey-client.ts
git commit -m "feat(auth-core): add evmAddress to PasskeyAccount and saveEvmAddress method"
```

---

### Task 11: EIP-1193 Provider

**Files:**
- Create: `packages/evm-wallet/src/provider.ts`
- Create: `packages/evm-wallet/test/provider.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/evm-wallet/test/provider.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createEvmWalletProvider } from "../src/provider"

describe("provider", () => {
  let provider: ReturnType<typeof createEvmWalletProvider>

  beforeEach(() => {
    provider = createEvmWalletProvider({
      smartWalletAddress: "0xabc123" as any,
      rpcUrl: "https://mainnet.evm.nodes.onflow.org",
      bundlerUrl: "http://localhost:4337",
      publicKeySec1Hex: "04" + "00".repeat(64),
      credentialId: "test-cred",
      isDeployed: true,
    })
  })

  it("returns chain ID for eth_chainId", async () => {
    const result = await provider.request({ method: "eth_chainId" })
    expect(result).toBe("0x2eb") // 747
  })

  it("returns smart wallet address for eth_accounts", async () => {
    const result = await provider.request({ method: "eth_accounts" })
    expect(result).toEqual(["0xabc123"])
  })

  it("returns smart wallet address for eth_requestAccounts", async () => {
    const result = await provider.request({ method: "eth_requestAccounts" })
    expect(result).toEqual(["0xabc123"])
  })

  it("rejects wallet_switchEthereumChain", async () => {
    await expect(
      provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x1" }],
      }),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/evm-wallet && bun run test`
Expected: FAIL

- [ ] **Step 3: Implement provider.ts**

```typescript
// packages/evm-wallet/src/provider.ts
import {
  type Address,
  type Hex,
  createPublicClient,
  http,
  toHex,
} from "viem"
import { createBundlerClient } from "./bundler-client"
import { buildUserOperation, type CallParams } from "./user-op"
import { signUserOpWithPasskey } from "./signer"
import { ENTRYPOINT_V07_ADDRESS, computeUserOpHash } from "./constants"

type EventName = "accountsChanged" | "chainChanged" | "disconnect"
type EventHandler = (...args: any[]) => void

export interface EvmWalletProviderConfig {
  smartWalletAddress: Address
  rpcUrl: string
  bundlerUrl: string
  publicKeySec1Hex: string
  credentialId: string
  isDeployed: boolean
  chainId?: number
}

export function createEvmWalletProvider(config: EvmWalletProviderConfig) {
  const {
    smartWalletAddress,
    rpcUrl,
    bundlerUrl,
    publicKeySec1Hex,
    credentialId,
    chainId = 747,
  } = config
  let isDeployed = config.isDeployed

  const bundlerClient = createBundlerClient(bundlerUrl)
  const publicClient = createPublicClient({ transport: http(rpcUrl) })
  const listeners = new Map<EventName, Set<EventHandler>>()

  function emit(event: EventName, ...args: any[]) {
    listeners.get(event)?.forEach((fn) => fn(...args))
  }

  // Proxy read-only methods directly to the RPC
  async function proxyToRpc(method: string, params?: any[]): Promise<any> {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }),
    })
    const json = await res.json()
    if (json.error) throw new Error(json.error.message)
    return json.result
  }

  const readMethods = new Set([
    "eth_call",
    "eth_estimateGas",
    "eth_getBalance",
    "eth_getTransactionReceipt",
    "eth_blockNumber",
    "eth_getCode",
    "eth_getTransactionByHash",
    "eth_getBlockByNumber",
    "eth_getBlockByHash",
    "eth_getLogs",
    "eth_gasPrice",
    "eth_getTransactionCount",
    "net_version",
  ])

  return {
    isMetaMask: false,

    async request({ method, params }: { method: string; params?: any[] }): Promise<any> {
      // Account methods
      if (method === "eth_accounts" || method === "eth_requestAccounts") {
        return [smartWalletAddress]
      }
      if (method === "eth_chainId") {
        return toHex(chainId)
      }

      // Read methods — proxy to RPC
      if (readMethods.has(method)) {
        return proxyToRpc(method, params)
      }

      // Write methods — convert to UserOp
      if (method === "eth_sendTransaction") {
        const [tx] = params ?? []
        const call: CallParams = {
          target: tx.to as Address,
          value: tx.value ? BigInt(tx.value) : 0n,
          data: (tx.data ?? "0x") as Hex,
        }

        const userOp = await buildUserOperation({
          sender: smartWalletAddress,
          call,
          publicKeySec1Hex,
          isDeployed,
          rpcUrl,
          bundlerClient,
        })

        // Compute userOpHash client-side (ERC-4337 v0.7 spec)
        const userOpHash = computeUserOpHash(userOp, ENTRYPOINT_V07_ADDRESS, chainId)

        // Sign with passkey
        userOp.signature = await signUserOpWithPasskey(
          userOpHash as Hex,
          credentialId,
        )

        // Submit to bundler
        const opHash = await bundlerClient.sendUserOperation(
          userOp,
          ENTRYPOINT_V07_ADDRESS,
        )

        // After first successful tx, wallet is deployed
        if (!isDeployed) isDeployed = true

        // Poll for receipt and return the transaction hash
        let receipt = null
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 2000))
          receipt = await bundlerClient.getUserOperationReceipt(opHash)
          if (receipt) break
        }

        return receipt?.receipt.transactionHash ?? opHash
      }

      // Signing methods (requires deployed wallet for ERC-1271)
      if (method === "personal_sign" || method === "eth_signTypedData_v4") {
        if (!isDeployed) {
          throw new Error(
            "Wallet must be deployed before signing messages. Send a transaction first.",
          )
        }
        // TODO: Implement ERC-1271 signing in follow-up
        throw new Error(`${method} not yet implemented`)
      }

      // Chain switching — reject for MVP
      if (method === "wallet_switchEthereumChain") {
        throw new Error("Chain switching not supported. This wallet operates on Flow EVM only.")
      }

      // Fallback: proxy unknown methods to RPC
      return proxyToRpc(method, params)
    },

    on(event: EventName, handler: EventHandler) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(handler)
    },

    removeListener(event: EventName, handler: EventHandler) {
      listeners.get(event)?.delete(handler)
    },
  }
}

export type EvmWalletProvider = ReturnType<typeof createEvmWalletProvider>
```

- [ ] **Step 4: Run tests**

Run: `cd packages/evm-wallet && bun run test`
Expected: All provider tests PASS

- [ ] **Step 5: Update index.ts**

```typescript
// Add to packages/evm-wallet/src/index.ts
export { createEvmWalletProvider, type EvmWalletProvider, type EvmWalletProviderConfig } from "./provider"
```

- [ ] **Step 6: Commit**

```bash
git add packages/evm-wallet/src/provider.ts packages/evm-wallet/test/provider.test.ts packages/evm-wallet/src/index.ts
git commit -m "feat(evm-wallet): add EIP-1193 provider with UserOp wrapping"
```

---

## Chunk 4: WalletConnect Integration

### Task 12: WalletConnect Session Manager

**Files:**
- Create: `packages/evm-wallet/src/walletconnect.ts`

- [ ] **Step 1: Implement walletconnect.ts**

```typescript
// packages/evm-wallet/src/walletconnect.ts
import type { Address } from "viem"
import type { EvmWalletProvider } from "./provider"

// WalletConnect types (from @walletconnect/web3wallet)
// These are peer dependencies — imported at runtime only
interface Web3WalletType {
  on: (event: string, handler: (...args: any[]) => void) => void
  approveSession: (params: any) => Promise<any>
  rejectSession: (params: any) => Promise<void>
  respondSessionRequest: (params: any) => Promise<void>
  pair: (params: { uri: string }) => Promise<void>
  getActiveSessions: () => Record<string, any>
  disconnectSession: (params: { topic: string; reason: any }) => Promise<void>
}

export interface WalletConnectConfig {
  projectId: string
  provider: EvmWalletProvider
  smartWalletAddress: Address
  chainId?: number
  metadata?: {
    name: string
    description: string
    url: string
    icons: string[]
  }
}

/**
 * Create a WalletConnect v2 session manager that bridges
 * dApp requests to the EVM wallet provider.
 */
export async function createWalletConnectManager(config: WalletConnectConfig) {
  const {
    projectId,
    provider,
    smartWalletAddress,
    chainId = 747,
    metadata = {
      name: "FlowIndex Wallet",
      description: "Passkey-powered smart wallet on Flow EVM",
      url: "https://flowindex.io",
      icons: ["https://flowindex.io/icon.png"],
    },
  } = config

  // Dynamic import — @walletconnect/web3wallet is a peer dependency
  const { Web3Wallet } = await import("@walletconnect/web3wallet")
  const { Core } = await import("@walletconnect/core")

  const core = new Core({ projectId })
  const web3wallet: Web3WalletType = await Web3Wallet.init({
    core,
    metadata,
  })

  // Handle session proposals from dApps
  web3wallet.on("session_proposal", async (proposal: any) => {
    const { id, params } = proposal
    const { requiredNamespaces, optionalNamespaces } = params

    // Build approved namespaces for Flow EVM
    const eip155Chain = `eip155:${chainId}`
    const accounts = [`${eip155Chain}:${smartWalletAddress}`]

    try {
      await web3wallet.approveSession({
        id,
        namespaces: {
          eip155: {
            chains: [eip155Chain],
            accounts,
            methods: [
              "eth_sendTransaction",
              "personal_sign",
              "eth_signTypedData_v4",
              "eth_accounts",
              "eth_chainId",
            ],
            events: ["accountsChanged", "chainChanged"],
          },
        },
      })
    } catch (err) {
      console.error("[WalletConnect] Failed to approve session:", err)
      await web3wallet.rejectSession({
        id,
        reason: { code: 5000, message: "User rejected" },
      })
    }
  })

  // Handle session requests from dApps
  web3wallet.on("session_request", async (event: any) => {
    const { topic, params, id } = event
    const { request } = params

    try {
      const result = await provider.request({
        method: request.method,
        params: request.params,
      })

      await web3wallet.respondSessionRequest({
        topic,
        response: {
          id,
          jsonrpc: "2.0",
          result,
        },
      })
    } catch (err: any) {
      await web3wallet.respondSessionRequest({
        topic,
        response: {
          id,
          jsonrpc: "2.0",
          error: {
            code: err.code ?? 5000,
            message: err.message ?? "Request failed",
          },
        },
      })
    }
  })

  return {
    /**
     * Pair with a dApp using a WalletConnect URI (from QR code scan or deep link).
     */
    async pair(uri: string) {
      await web3wallet.pair({ uri })
    },

    /**
     * Get all active WalletConnect sessions.
     */
    getActiveSessions() {
      return web3wallet.getActiveSessions()
    },

    /**
     * Disconnect a specific session.
     */
    async disconnect(topic: string) {
      await web3wallet.disconnectSession({
        topic,
        reason: { code: 6000, message: "User disconnected" },
      })
    },

    /**
     * Disconnect all sessions.
     */
    async disconnectAll() {
      const sessions = web3wallet.getActiveSessions()
      await Promise.all(
        Object.keys(sessions).map((topic) =>
          web3wallet.disconnectSession({
            topic,
            reason: { code: 6000, message: "Wallet disconnected" },
          }),
        ),
      )
    },
  }
}

export type WalletConnectManager = Awaited<
  ReturnType<typeof createWalletConnectManager>
>
```

- [ ] **Step 2: Update index.ts**

```typescript
// Add to packages/evm-wallet/src/index.ts
export { createWalletConnectManager, type WalletConnectManager, type WalletConnectConfig } from "./walletconnect"
```

- [ ] **Step 3: Verify build**

```bash
cd packages/evm-wallet && bun run build
```

Expected: Compiles (WalletConnect types are dynamic imports, peer dependency)

- [ ] **Step 4: Commit**

```bash
git add packages/evm-wallet/src/walletconnect.ts packages/evm-wallet/src/index.ts
git commit -m "feat(evm-wallet): add WalletConnect v2 session manager"
```

---

### Task 13: End-to-End Validation Script

**Files:**
- Create: `scripts/test-evm-wallet.ts`

This is a manual test script to validate the full flow on testnet (Steps 0-3 of the validation order).

- [ ] **Step 1: Create validation script**

```typescript
// scripts/test-evm-wallet.ts
// Run: bun scripts/test-evm-wallet.ts
//
// Validates the evm-wallet package against Flow-EVM testnet:
// 1. Compute counterfactual address from a test public key
// 2. Submit a UserOp via the bundler
// 3. Verify transaction on-chain

import {
  getSmartWalletAddress,
  createBundlerClient,
  ENTRYPOINT_V07_ADDRESS,
} from "@flowindex/evm-wallet"

const RPC_URL = process.env.EVM_RPC_URL ?? "https://testnet.evm.nodes.onflow.org"
const BUNDLER_URL = process.env.BUNDLER_URL ?? "http://localhost:4337"
const FACTORY_ADDRESS = process.env.EVM_WALLET_FACTORY_ADDRESS

async function main() {
  console.log("=== EVM Wallet E2E Validation ===\n")

  // Step 1: Verify bundler is running
  console.log("1. Checking bundler...")
  const bundler = createBundlerClient(BUNDLER_URL)
  const entryPoints = await bundler.supportedEntryPoints()
  console.log("   Supported EntryPoints:", entryPoints)

  if (!entryPoints.includes(ENTRYPOINT_V07_ADDRESS as any)) {
    throw new Error("Bundler does not support EntryPoint v0.7!")
  }
  console.log("   ✓ Bundler OK\n")

  // Step 2: Compute counterfactual address
  if (FACTORY_ADDRESS) {
    console.log("2. Computing counterfactual address...")
    // Test public key (not a real passkey — just for validation)
    const testPubKey =
      "04" +
      "a]b".repeat(0) +
      "1111111111111111111111111111111111111111111111111111111111111111" +
      "2222222222222222222222222222222222222222222222222222222222222222"

    const address = await getSmartWalletAddress(testPubKey, {
      factoryAddress: FACTORY_ADDRESS as any,
      rpcUrl: RPC_URL,
    })
    console.log("   Smart Wallet Address:", address)
    console.log("   ✓ Address computation OK\n")
  } else {
    console.log("2. Skipping address computation (EVM_WALLET_FACTORY_ADDRESS not set)\n")
  }

  console.log("=== Validation Complete ===")
}

main().catch(console.error)
```

- [ ] **Step 2: Run validation**

```bash
BUNDLER_URL=http://localhost:4337 bun scripts/test-evm-wallet.ts
```

Expected: Bundler check passes. Address computation passes (if factory is deployed).

- [ ] **Step 3: Commit**

```bash
git add scripts/test-evm-wallet.ts
git commit -m "feat: add e2e validation script for evm-wallet"
```

---

## Summary: Execution Order

| Task | Description | Dependencies |
|------|-------------|--------------|
| 1 | Foundry deployment script | None |
| 2 | Alto bundler Docker setup | Task 1 (needs factory address for full test) |
| 3 | Package scaffold + constants | None |
| 4 | Factory (address computation) | Task 3 |
| 5 | Signer (passkey encoding) | Task 3 |
| 6 | Bundler client (JSON-RPC) | Task 3 |
| 7 | UserOp construction | Tasks 4, 5, 6 |
| 8 | Database migration | None |
| 9 | Edge function updates | Task 8 |
| 10 | auth-core type updates | Task 9 |
| 11 | EIP-1193 provider | Tasks 6, 7 |
| 12 | WalletConnect | Task 11 |
| 13 | E2E validation | All |

**Parallel groups:**
- Tasks 1, 3, 8 can all start in parallel
- Tasks 4, 5, 6 can run in parallel (all depend only on Task 3)
- Tasks 9, 10 are sequential after 8
- Task 7 depends on 4+5+6 completing

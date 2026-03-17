# Passkey EVM Wallet — ERC-4337 on Flow-EVM

**Date:** 2026-03-17
**Status:** Draft

## Problem

The existing passkey wallet supports Flow Cadence transactions (FLIP-264) but has no Flow-EVM support. Users cannot interact with EVM contracts or connect to external EVM dApps using their passkey identity.

## Goal

Unified passkey identity across Cadence and EVM — same P-256 key pair controls both a Flow Cadence account and an ERC-4337 smart wallet on Flow-EVM. The wallet must work with external EVM dApps (WalletConnect) and be portable to other EVM chains in the future.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| EVM wallet standard | ERC-4337 (not COA) | Cross-chain portability — COA is Flow-only |
| Smart account | Coinbase Smart Wallet | Production-grade, audited (Code4rena), multi-owner, passkey-native |
| P256 verification | RIP-7212 precompile | Live on Flow-EVM since Osaka fork (2025-12-03), ~3.4k gas vs ~300k for Solidity |
| Bundler | Self-hosted Alto (Pimlico) | No hosted service supports Flow-EVM; Alto is lightweight TypeScript |
| EntryPoint | v0.7 (already deployed) | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` — no deployment needed |
| Chain priority | Flow-EVM first, then expand | Validate on Flow-EVM before multi-chain rollout |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    User (Passkey)                     │
│              same P-256 key pair for both             │
└──────────┬──────────────────────┬────────────────────┘
           │                      │
     ┌─────▼─────┐        ┌──────▼──────┐
     │  Cadence   │        │  Flow-EVM   │
     │  (existing)│        │   (new)     │
     └─────┬─────┘        └──────┬──────┘
           │                      │
   FLIP-264 sig            UserOperation
   via PasskeySigner       via EVM Provider
           │                      │
   Flow Account            Coinbase Smart Wallet
   (Lilico provisioned)    (deterministic from pubkey)
           │                      │
           └──────────┬───────────┘
                      │
              Unified Identity
         (same passkey → both addresses)
```

### Infrastructure Layer

```
┌──────────┐     UserOp      ┌─────────┐    bundle tx    ┌────────────┐
│  Client   │ ──────────────► │  Alto   │ ──────────────► │ EntryPoint │
│ (browser) │                 │ Bundler │                 │  (v0.7)    │
└──────────┘                 └─────────┘                 └─────┬──────┘
                                                               │
                                                    ┌──────────▼──────────┐
                                                    │ CoinbaseSmartWallet │
                                                    │  verifies P-256 sig │
                                                    │  via RIP-7212       │
                                                    └─────────────────────┘
```

### Contracts to Deploy (one-time)

| Contract | Source | Purpose |
|----------|--------|---------|
| `CoinbaseSmartWalletFactory` | coinbase/smart-wallet | CREATE2 account factory |
| `CoinbaseSmartWallet` | coinbase/smart-wallet | Account implementation |
| `WebAuthn.sol` | base-org/webauthn-sol | Passkey signature verification (calls RIP-7212) |

**Already deployed (no action needed):**
- EntryPoint v0.7: `0x0000000071727De22E5E9d8BAf0edAc6f37da032`
- EntryPoint v0.6: `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`
- CREATE2 Deployer: `0x4e59b44847b379578588920cA78FbF26c0B4956C`

**Not needed:**
- P256Verifier contract — RIP-7212 precompile handles this natively
- MagicSpend paymaster — deferred to future iteration for gas sponsoring

### Bundler (Alto) Deployment

Self-hosted on GCP (`flowindex-backend` VM or dedicated container).

```bash
alto \
  --entrypoints "0x0000000071727De22E5E9d8BAf0edAc6f37da032" \
  --rpc-url "https://mainnet.evm.nodes.onflow.org" \
  --executor-private-keys "<funded-key>" \
  --utility-private-key "<funded-key>" \
  --safe-mode false \
  --chain-type default \
  --deploy-simulations-contract true \
  --log-level debug
```

**Requirements:**
- 2 funded wallets: executor (submits bundles) + utility (auto-refills executor)
- ~256MB memory, minimal CPU
- Flow-EVM supports `debug_traceCall`, EIP-1559, state/code overrides

**Potential issues:**
- Gas pricing: Flow-EVM baseFee is 1 wei — may need `--floor-max-fee-per-gas` tuning
- viem chain definition: Flow-EVM (chain ID 747) may need custom chain config in Alto
- Simulation contracts auto-deploy on first startup via CREATE2

## User Flows

### Registration (new user)

```
1. User creates passkey (existing WebAuthn ceremony)
   → P-256 public key (publicKeySec1Hex)

2. Cadence side (existing, unchanged):
   → Lilico API creates Flow account
   → Stored in passkey_credentials.flow_address

3. EVM side (new):
   → Compute counterfactual Smart Wallet address locally
     (pubkey + factory address → CREATE2 deterministic address)
   → Store in passkey_credentials.evm_address (new column)
   → Contract NOT deployed yet (lazy deployment on first UserOp)
```

### Send EVM Transaction (via FlowIndex UI)

```
1. Frontend constructs UserOperation (target, calldata, gas)
2. Compute userOpHash
3. Trigger passkey signature (WebAuthn assertion)
4. Send signed UserOp to Alto bundler (JSON-RPC)
5. Alto submits bundle → EntryPoint → Smart Wallet executes
```

### Connect to External dApp (WalletConnect)

```
1. User clicks "Connect" in wallet UI
2. Scans dApp's WalletConnect QR code
3. dApp sends eth_sendTransaction request
4. Wallet wraps as UserOperation
5. Trigger passkey signature (reuses existing approval UI)
6. Submit via Alto bundler
```

### Key Insight

The passkey signature is the same underlying P-256 operation. Cadence uses FLIP-264 format (authenticatorData + clientDataJSON extension), EVM uses WebAuthn assertion encoded per Coinbase Smart Wallet's signature format. Same key, different encoding.

## Signature Encoding (Coinbase Smart Wallet)

Coinbase Smart Wallet requires a specific ABI-encoded structure for passkey signatures:

```solidity
// On-chain verification path:
// EntryPoint → SmartWallet.validateUserOp() → WebAuthn.verify()

abi.encode(
  CoinbaseSmartWallet.SignatureWrapper({
    ownerIndex: uint256,        // index of the passkey owner in the owners array
    signatureData: abi.encode(
      WebAuthn.WebAuthnAuth({
        authenticatorData: bytes, // raw authenticatorData from WebAuthn assertion
        clientDataJSON: string,   // raw clientDataJSON string
        challengeIndex: uint256,  // byte offset of "challenge" in clientDataJSON
        typeIndex: uint256,       // byte offset of "type" in clientDataJSON
        r: uint256,               // P-256 signature r component
        s: uint256                // P-256 signature s component
      })
    )
  })
)
```

**`signer.ts` must:**
1. Trigger WebAuthn `navigator.credentials.get()` with `userOpHash` as the challenge
2. Extract `r`, `s` from the DER-encoded signature (reuse `derToP256Raw` pattern from `flow-passkey`)
3. Parse `clientDataJSON` to find `challengeIndex` and `typeIndex` byte offsets
4. ABI-encode the full `SignatureWrapper` struct using viem's `encodeAbiParameters`

## Counterfactual Address Computation

The Smart Wallet address is deterministic from the passkey public key:

```typescript
// factory.ts — compute address without deploying

// 1. Extract P-256 public key coordinates from SEC1 uncompressed format
//    publicKeySec1Hex = "04" + x (32 bytes) + y (32 bytes)
const x = BigInt("0x" + publicKeySec1Hex.slice(2, 66))
const y = BigInt("0x" + publicKeySec1Hex.slice(66, 130))

// 2. Encode as Coinbase Smart Wallet owner (abi.encode(x, y) = 64 bytes)
const ownerBytes = encodeAbiParameters(
  [{ type: "uint256" }, { type: "uint256" }],
  [x, y]
)

// 3. Compute CREATE2 address
//    Factory.createAccount(owners, nonce) → uses CREATE2 internally
//    address = keccak256(0xff ++ factory ++ salt ++ keccak256(initCode))
//    where salt = keccak256(abi.encode(owners, nonce))
const owners = [ownerBytes]  // single passkey owner
const nonce = 0n             // always 0 for first wallet per passkey
const address = getCreate2Address(factoryAddress, owners, nonce)
```

**Nonce strategy:** Always `0` for the first wallet per passkey. If a user needs multiple wallets (unlikely), increment nonce.

**EVM address computation happens client-side** in `evm-wallet/factory.ts` (not in the Deno edge function, to avoid adding viem to the edge function). After computation, the client calls a new `/wallet/save-evm-address` endpoint to persist it, similar to the existing `/wallet/provision-save` flow.

**In practice**, use the factory's `getAddress(owners, nonce)` view function (a `staticCall` against the deployed factory on Flow-EVM) rather than reimplementing CREATE2 math locally. This avoids needing to know the exact ERC-1967 proxy bytecode hash from `LibClone`. The pseudocode above illustrates the concept; the real call is:

```typescript
const predictedAddress = await factoryContract.read.getAddress([owners, nonce])
```

**`/wallet/save-evm-address` validation:** The endpoint uses `supabaseAdmin` (service role, bypasses RLS) to UPDATE the credential row. Since the client-submitted address could be arbitrary, the server should **re-derive** the address by calling `factory.getAddress()` on Flow-EVM RPC using the stored `public_key_sec1_hex`. This is a single `eth_call` (no viem dependency needed — raw JSON-RPC fetch) and prevents a compromised client from associating a wrong EVM address.

**Factory address configuration:** Store the deployed `CoinbaseSmartWalletFactory` address as an environment variable (`EVM_WALLET_FACTORY_ADDRESS`) in both the edge function and the `evm-wallet` package config.

## Code Changes

### Database

```sql
-- Add EVM address to passkey credentials
ALTER TABLE public.passkey_credentials
  ADD COLUMN IF NOT EXISTS evm_address TEXT;

CREATE INDEX IF NOT EXISTS idx_passkey_credentials_evm_address
  ON public.passkey_credentials(evm_address);
```

### Backend (minimal changes)

| Change | Location | Description |
|--------|----------|-------------|
| `evm_address` column | `passkey_credentials` table | Store counterfactual smart wallet address |
| `/wallet/save-evm-address` | `passkey-auth` edge function | New endpoint — client computes address, server persists it |
| Return EVM address | `/wallet/accounts` response | Add `evm_address` to `.select()`, change filter from `.not('flow_address', 'is', null)` to `.or('flow_address.not.is.null,evm_address.not.is.null')` |
| `PasskeyAccount` type | `packages/auth-core/src/types.ts` | Add `evmAddress?: string` field |
| `listAccounts` parser | `packages/auth-core/src/passkey-client.ts` | Map `evm_address` from response |

### New Package: `packages/evm-wallet`

```
packages/evm-wallet/
├── src/
│   ├── provider.ts        # EIP-1193 provider, wraps UserOp logic
│   ├── bundler-client.ts  # Alto bundler JSON-RPC client
│   ├── user-op.ts         # UserOperation construction + gas estimation
│   ├── signer.ts          # Passkey signature → ERC-4337 signature format
│   ├── factory.ts         # Counterfactual address computation
│   ├── walletconnect.ts   # WalletConnect v2 session management
│   └── index.ts
├── package.json
└── tsconfig.json
```

**Relationship to existing packages:**

```
packages/flow-passkey (existing)     packages/evm-wallet (new)
        │                                │
        │  signFlowTransaction()         │  signUserOperation()
        │                                │
        └──────────┬─────────────────────┘
                   │
            Same passkey
         (WebAuthn assertion)
```

- `flow-passkey` and `evm-wallet` are independent — no cross-dependency
- Both call WebAuthn API directly with their own encoding
- `auth-core`'s `PasskeyAccount` type extended with `evmAddress` field
- Frontend wallet UI displays both addresses: Flow + EVM

### Bundler Deployment

- New Docker service `alto-bundler` in docker-compose and GCP deploy
- Runs on `flowindex-backend` VM (or dedicated)
- Environment variables: `BUNDLER_RPC_URL`, `BUNDLER_EXECUTOR_KEY`, `BUNDLER_UTILITY_KEY`

### Contract Deployment

- One-time Foundry script: `scripts/deploy-smart-wallet/`
- `forge script` to deploy CoinbaseSmartWalletFactory to Flow-EVM
- Record deployed addresses in config / environment

## ERC-1271 Limitation (Undeployed Wallets)

Smart wallets have a known limitation: `personal_sign` and `eth_signTypedData` require on-chain ERC-1271 `isValidSignature()` verification, which fails if the contract isn't deployed yet (counterfactual address).

**Workaround strategy:**
- For **`eth_sendTransaction`**: No issue — the first UserOp triggers wallet deployment via `initCode`
- For **`personal_sign` / `eth_signTypedData` before any transaction**: Force-deploy the wallet first by sending a no-op UserOp (or skip support until first tx)
- MVP approach: Only support signing after the wallet is deployed (first transaction). Document this as a known limitation.

## EIP-1193 Provider Scope

The `provider.ts` must implement these JSON-RPC methods:

**Write methods (intercepted → UserOp):**
- `eth_sendTransaction` → construct UserOp, sign with passkey, submit to bundler
- `eth_signTypedData_v4` → ERC-1271 signature (requires deployed wallet)
- `personal_sign` → ERC-1271 signature (requires deployed wallet)

**Read methods (proxy to Flow-EVM RPC):**
- `eth_call`, `eth_estimateGas`, `eth_getBalance`, `eth_getTransactionReceipt`
- `eth_blockNumber`, `eth_chainId`, `eth_getCode`, `eth_getTransactionByHash`

**Account methods:**
- `eth_requestAccounts` → return Smart Wallet address
- `eth_accounts` → return Smart Wallet address
- `wallet_switchEthereumChain` → reject (Flow-EVM only for MVP)

**Events:** Emit `accountsChanged`, `chainChanged` per EIP-1193.

## WalletConnect Integration

**Requirements:**
- WalletConnect v2 SDK (`@walletconnect/web3wallet`)
- Project ID from cloud.walletconnect.com (free tier)
- Session persistence: `localStorage` (browser) — WalletConnect SDK handles this by default

**MVP scope:**
- Pair via QR code scan or deep link
- Handle `eth_sendTransaction` requests (→ UserOp pipeline)
- Handle `personal_sign` (→ ERC-1271, requires deployed wallet)
- Reject `wallet_switchEthereumChain` to unsupported chains
- Session auto-expiry managed by WalletConnect SDK

**Deferred:** Multi-tab sync, push notifications, chain switching.

## Bundler Operations

### Key Management

- **Generation:** `cast wallet new` or viem `generatePrivateKey()` — two keys (executor + utility)
- **Storage:** GCP Secret Manager (production) or `.env` file on VM (initial setup)
- **Funding:** Manual transfer of FLOW to both EVM addresses via Flow-EVM bridge
- **Monitoring:** Cron job checking executor/utility balance; alert via Discord webhook if below threshold (e.g., 1 FLOW)
- **Recovery:** If executor runs dry, all UserOps queue in Alto until refunded. Utility wallet auto-refills executor; only utility running dry requires manual intervention.

### Gas Parameters for Flow-EVM

Flow-EVM baseFee is ~1 wei. Recommended starting config (validate on testnet):

```bash
--floor-max-fee-per-gas 1000000    # 1M wei floor (still negligible cost)
--floor-max-priority-fee-per-gas 0 # no priority fee needed
```

`preVerificationGas` and `callGasLimit` use Alto's built-in estimation via simulation contracts. Tune after testnet validation in Step 2.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Alto bundler incompatible with Flow-EVM | UserOp submission fails | Start with `--safe-mode false`; test on Flow-EVM testnet first; fallback to Skandha |
| Coinbase Smart Wallet contracts behave differently on Flow-EVM | Signature verification failure, gas miscalculation | Deploy on testnet first, run full e2e tests; Flow-EVM's `COINBASE`/`PREVRANDAO` differences don't affect 4337 core |
| WalletConnect integration complexity | External dApp compatibility issues | MVP: `eth_sendTransaction` + `personal_sign`; expand as needed |
| Gas estimation inaccuracy | Transactions fail or overpay | Alto has built-in estimation; tune floor gas params for Flow-EVM's low baseFee |
| viem missing Flow-EVM chain definition | Alto fails to start | Add custom chain config; viem supports arbitrary chains via `defineChain()` |
| `personal_sign` on undeployed wallet | ERC-1271 check fails, dApp rejects signature | Force-deploy on first sign request or only support after first tx |
| Bundler executor runs out of funds | All UserOps fail | Monitor balance via cron + Discord alert; utility wallet auto-refills |

## Validation Order

Validate bottom-up — fail fast on infrastructure before building UI:

```
Step 0: Deploy Coinbase Smart Wallet contracts on Flow-EVM testnet
Step 1: Manually construct and submit a UserOp via cast → verify contract execution
Step 2: Start Alto bundler, submit UserOp via JSON-RPC → verify bundler compatibility
Step 3: Browser passkey sign → UserOp → bundler → on-chain execution → full e2e
Step 4: WalletConnect integration with external dApp
```

## Gas Strategy

- **Phase 1:** Users self-fund their Smart Wallet with FLOW (bridged to EVM)
- **Phase 2:** Add MagicSpend paymaster for gas sponsoring (project pays gas, users transact for free)

## Future Expansion

- **Multi-chain:** Same Coinbase Smart Wallet contracts deployed on Base, Arbitrum, etc. Same passkey → same deterministic address on every chain.
- **Hosted bundler:** Use Pimlico/Alchemy hosted bundlers for chains they support, self-host Alto only for Flow-EVM.
- **Session keys:** Coinbase Smart Wallet supports adding temporary session keys for dApp permissions without passkey prompt per tx.

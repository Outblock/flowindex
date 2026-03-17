# EVM Smart Account Comparison: Coinbase Smart Wallet vs Kernel (ZeroDev)

> Decision doc for FlowIndex passkey wallet on Flow-EVM (ERC-4337).

## Current State

We currently use **Coinbase Smart Wallet** (CoinbaseSmartWalletFactory) deployed on Flow-EVM Testnet (chain 545):

| Contract | Address |
|----------|---------|
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| CoinbaseSmartWalletFactory | `0xAc396ed9a5E949C685C3799657E26fE1d6fFf7E7` |
| CoinbaseSmartWallet (impl) | `0x0d956a72774534DE5bFc0dA88Fca589ba2378De0` |
| VerifyingPaymaster | `0x348C96e048A6A01B1bD75b6218b65986717CC15a` |

Infrastructure: Alto bundler + paymaster signer at `bundler.flowindex.io`.

## Architecture Comparison

### Coinbase Smart Wallet

**Monolithic, minimal, audited.** 786 lines of Solidity. Multi-owner 1-of-N model where any single owner can independently execute any operation.

```
CoinbaseSmartWallet
├── MultiOwnable (owner management)
│   ├── 32-byte owners: ETH address (EOA or contract, ERC-1271)
│   └── 64-byte owners: P-256 public key (passkey/WebAuthn)
├── ERC-4337 validateUserOp
├── executeBatch(Call[])
├── UUPS upgradeable
└── Cross-chain replay (nonce key 8453)
```

### Kernel (ZeroDev)

**Modular, plugin-based, ERC-7579.** Functionality is composed from swappable modules. One sudo validator (primary owner) + any number of regular validators (session keys, guardians, etc.).

```
Kernel
├── Sudo Validator (primary signer — ECDSA, passkey, multisig, etc.)
├── Regular Validators (session keys, social recovery, etc.)
├── Executors (custom execution logic)
├── Hooks (pre/post execution guards — gas limits, rate limits, etc.)
├── Fallback handlers
└── ERC-7579 module install/uninstall
```

## Feature Comparison

| Feature | Coinbase Smart Wallet | Kernel v3 (ZeroDev) |
|---------|----------------------|---------------------|
| **Standard** | ERC-4337 | ERC-4337 + ERC-7579 |
| **EntryPoint** | v0.6 (canonical) | **v0.7** (canonical) |
| **Architecture** | Monolithic | Modular plugin system |
| **Owner model** | 1-of-N (any owner = full access) | Sudo + N regular validators |
| **Passkeys (P-256)** | Native (WebAuthnSol) | Plugin (duo mode: RIP-7212 + fallback) |
| **Key weights / threshold** | ❌ None | ✅ Weighted validator plugin |
| **Session keys** | ❌ None | ✅ Full permissions system |
| **Social recovery** | ❌ (implicit via multi-owner) | ✅ Guardian-weighted recovery plugin |
| **Spending limits** | ❌ | ✅ Via hook policies |
| **Time-locked operations** | ❌ | ✅ Timestamp policy |
| **Rate limiting** | ❌ | ✅ Rate limit policy |
| **Contract call restrictions** | ❌ | ✅ Call policy (per-function, per-arg) |
| **Multi-sig** | ❌ (1-of-N only) | ✅ m-of-n with weights |
| **Batch execution** | ✅ `executeBatch` | ✅ |
| **ERC-1271 signatures** | ✅ (anti-replay) | ✅ |
| **Cross-chain replay** | ✅ (owner mgmt ops) | ✅ (universal address) |
| **Upgradability** | UUPS | Diamond-like proxy |
| **EIP-7702** | Not documented | ✅ |
| **Attack surface** | Minimal (786 lines) | Larger (plugin system) |
| **Audits** | Code4rena, Cantina, Certora | 12 reports (Kalos, ChainLight) |
| **Backed by** | Coinbase | Offchain Labs (Arbitrum) |
| **License** | MIT | MIT |

## Key Capabilities We Need

### 1. Multi-Device Passkeys

**Both support this.** User registers passkeys on multiple devices (phone, laptop, hardware key). Any passkey can sign transactions.

- Coinbase: `addOwnerPublicKey(x, y)` — each passkey is an equal owner
- Kernel: WebAuthn validator plugin — each passkey added as a signer

### 2. Key Weights & Thresholds

**Only Kernel.** Example configuration:

```
Passkey A (primary device):  weight 3
Passkey B (phone):           weight 2
Guardian EOA (backup):       weight 1
Threshold: 3

→ Primary passkey alone can operate (3 >= 3)
→ Phone + guardian together can operate (2+1 >= 3)
→ Guardian alone cannot operate (1 < 3)
```

Use cases:
- High-value transfers require 2 passkeys
- Recovery requires guardian + any device
- Daily operations with just primary passkey

### 3. Session Keys (Delegated Permissions)

**Only Kernel.** Grant a temporary key limited authority:

```
Session key for AI agent:
  - Can call: DEX router contract only
  - Methods: swap(), addLiquidity()
  - Max value: 100 FLOW per tx
  - Rate limit: 10 tx/hour
  - Expires: 2026-03-20T00:00:00Z

Session key for game:
  - Can call: game contract only
  - Methods: move(), attack(), craft()
  - No value transfers
  - Expires: end of session
```

This enables:
- **Skip confirmation prompts** in trusted dApps
- **AI agent automation** with scoped permissions
- **Backend operations** without exposing master key
- **Subscription/recurring payments** with spending caps

### 4. Social Recovery

**Only Kernel has a dedicated recovery plugin.**

```
Guardians:
  - Friend A: weight 1
  - Friend B: weight 1
  - Hardware key: weight 2
Threshold: 2
Delay: 48 hours

Lost all passkeys → Friend A + Friend B initiate recovery
→ 48h timelock → New passkey registered → Old keys revoked
```

Coinbase workaround: add an EOA as a backup owner. But if all owners are lost, the account is permanently inaccessible.

### 5. EntryPoint Compatibility

Our bundler and paymaster already use **EntryPoint v0.7**. Kernel v3 is native v0.7. Coinbase Smart Wallet is designed for v0.6 (our current deployment works but is non-standard).

## Migration Path: Coinbase → Kernel

Since both are ERC-4337, infrastructure stays the same:

| Component | Change needed? |
|-----------|---------------|
| Alto Bundler | ❌ No change (EntryPoint v0.7, chain-agnostic) |
| VerifyingPaymaster | ❌ No change (validates any smart account) |
| Bundler VM / Caddy | ❌ No change |
| `packages/evm-wallet/` SDK | ✅ Replace factory/signer logic |
| Wallet UI | ✅ Add session key management, recovery setup |
| Smart contracts | ✅ Deploy Kernel factory + modules to Flow-EVM |

### What changes in `packages/evm-wallet/`:

| File | Coinbase (current) | Kernel (new) |
|------|-------------------|--------------|
| `factory.ts` | `CoinbaseSmartWalletFactory.createAccount(owners, nonce)` | `KernelFactory.createAccount(impl, initData, salt)` |
| `signer.ts` | `WebAuthnAuth` struct encoding | Same (P-256 stays the same, different wrapper) |
| `user-op.ts` | Pack signature with `ownerIndex` | Pack signature with `validatorAddress` + mode |
| `constants.ts` | Coinbase contract addresses | Kernel contract addresses |
| `provider.ts` | No change (EIP-1193 is the same) |  |
| `walletconnect.ts` | No change | |

### Counterfactual address computation

Both use CREATE2 deterministic addressing. The address derivation changes but the concept is identical — address is determined by the user's public key before deployment.

### Existing accounts

Accounts already created with CoinbaseSmartWallet will continue to work. New accounts would use Kernel. Users can migrate by transferring assets, or we could build a migration helper.

## SDK / Tooling

### ZeroDev SDK

```ts
import { createKernelAccount, createKernelAccountClient } from '@zerodev/sdk'
import { toWebAuthnValidator } from '@zerodev/webauthn-validator'
import { toWeightedValidator } from '@zerodev/weighted-validator'
```

Two integration paths:
1. **ZeroDev SDK** — batteries-included, hosted bundler/paymaster available
2. **permissionless.js** (Pimlico) — vendor-neutral, BYO bundler (our Alto setup)

Since we self-host Alto bundler, we'd use **permissionless.js** + Kernel:

```ts
import { toKernelSmartAccount } from 'permissionless/accounts'
import { createBundlerClient } from 'viem/account-abstraction'
```

### Deployed Kernel Addresses (need to deploy on Flow-EVM)

| Contract | Role |
|----------|------|
| KernelFactory | Account creation |
| Kernel v3.3 implementation | Account logic |
| WebAuthn Validator | Passkey signing |
| Weighted Validator | Key weights |
| Recovery Plugin | Social recovery |
| ECDSAValidator | EOA backup keys |

## Recommendation

**Migrate to Kernel v3** for new accounts. Reasons:

1. **EntryPoint v0.7** — our infra already uses v0.7, Kernel is native v0.7
2. **Session keys** — critical for AI agent integration and game UX
3. **Key weights** — proper security model (primary device > backup > guardian)
4. **Social recovery** — users can recover without us being a single point of failure
5. **ERC-7579** — industry standard for modular accounts, future-proof
6. **Plugin extensibility** — add new features without redeploying accounts

### Migration phases

1. **Phase 1**: Deploy Kernel contracts to Flow-EVM testnet
2. **Phase 2**: Update `packages/evm-wallet/` to use Kernel factory + WebAuthn validator
3. **Phase 3**: Add session key support in wallet UI
4. **Phase 4**: Add weighted key / recovery setup in wallet UI
5. **Phase 5**: Deploy to mainnet, offer migration for existing Coinbase accounts

## Deployment Status (2026-03-18)

### Strategy: Two-track approach

1. **Coinbase Smart Wallet** — primary, ship first. Simple, audited, already deployed and coded.
2. **Kernel (ZeroDev)** — secondary, paused. Wait for official validator deployment before continuing.

### Coinbase Smart Wallet (active)

Fully deployed and functional. PRs merged to main.

**Testnet (545):**

| Contract | Address |
|----------|---------|
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| CoinbaseSmartWalletFactory | `0xAc396ed9a5E949C685C3799657E26fE1d6fFf7E7` |
| CoinbaseSmartWallet (impl) | `0x0d956a72774534DE5bFc0dA88Fca589ba2378De0` |
| VerifyingPaymaster | `0x348C96e048A6A01B1bD75b6218b65986717CC15a` |

**Related PRs:** #192-#203 (all merged to main)

### Kernel v3 (ZeroDev) — paused, waiting on upstream

We deployed Kernel core + validators to both networks, but **validator addresses differ from ZeroDev's canonical addresses** on other chains because we used `forge create` (regular CREATE) instead of the exact bytecode via Arachnid proxy. This means wallets created with our validator addresses won't have the same address on other EVM chains.

**Why paused:**
- Cross-chain wallet portability requires canonical validator addresses
- ZeroDev needs to deploy validators from their deployer key (`0x9775...`) for address consistency
- Kernel has more dependencies and complexity — higher risk than Coinbase for initial launch
- Better to ship Coinbase version first, add Kernel as an upgrade path later

**Issue filed:** https://github.com/zerodevapp/kernel/issues/148
- Asked ZeroDev to deploy validators to Flow-EVM with canonical addresses
- Sent 110 FLOW to their deployer on testnet for gas
- Their deployer has ~114 FLOW on mainnet already

**Testnet (545) — our deployment (non-canonical addresses):**

| Contract | Address | Cross-chain? |
|----------|---------|:---:|
| Kernel impl | `0x94F097E1ebEB4ecA3AAE54cabb08905B239A7D27` | ✅ Arachnid CREATE2 |
| KernelFactory | `0x6723b44Abeec4E71eBE3232BD5B455805baDD22f` | ✅ Arachnid CREATE2 |
| FactoryStaker (ours) | `0xbe2d2385c721e147315a2bfad60b6de8cc3a71f9` | ❌ |
| ECDSAValidator | `0x6Ec801D3e7888d930f48Eb1e3bbD48C81d1423e0` | ❌ |
| WeightedECDSAValidator | `0x36eA63Ec67405DF8AdA442b785cA1301D016B859` | ❌ |
| WebAuthnValidator | `0xDf6C7AC7343448E23C2CA069F998884581A72653` | ❌ |
| P256Verifier | `0x264689BCfFBCE942d2e510c1AAd97Ff9c4767F57` | ❌ |

**Mainnet (747) — our deployment (non-canonical addresses):**

| Contract | Address | Cross-chain? |
|----------|---------|:---:|
| Kernel impl | `0x94F097E1ebEB4ecA3AAE54cabb08905B239A7D27` | ✅ ZeroDev deployed |
| KernelFactory | `0x6723b44Abeec4E71eBE3232BD5B455805baDD22f` | ✅ ZeroDev deployed |
| FactoryStaker (ours) | `0x476b7b297d8Cb0DDbC5F68339b27ca273d3c6737` | ❌ |
| ECDSAValidator | `0x9aE33cCBd904e39313100fcEF7fBBA629C87Ac5a` | ❌ |
| WeightedECDSAValidator | `0xb4d0B2767856b9Ee7c8B982565Ab1299921FE2D9` | ❌ |
| WebAuthnValidator | `0x348C96e048A6A01B1bD75b6218b65986717CC15a` | ❌ |
| P256Verifier | `0xa862747EB070d713B3277A8e5E686E55BAd0c76E` | ❌ |

**ZeroDev canonical addresses (what we need them to deploy):**

| Contract | Canonical Address |
|----------|---------|
| ECDSAValidator | `0x845ADb2C711129d4f3966735eD98a9F09fC4cE57` |
| WebAuthnValidator | `0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69` |

**Next steps (when ZeroDev responds):**
1. They deploy validators → we get canonical addresses
2. Update `packages/evm-wallet/` constants to use Kernel
3. Implement session keys, weighted keys, recovery in wallet UI

### Wallet SDK + Chrome Extension (shipped)

**PR #202** (merged): `packages/wallet-sdk/` + `wallet/extension/`

Three integration methods for external dApps:
1. **Chrome Extension** — zero dApp changes, injects EIP-1193 via EIP-6963
2. **RainbowKit config** — `flowIndexWallet()` in `connectorsForWallets`
3. **EIP-6963 announcement** — `announceFlowIndexWallet()` at app startup

### Deploy Infrastructure (PR #203, merged)

`deploy-infra.yml` changed to manual-only trigger (`workflow_dispatch`). Bundler/paymaster are stable infra.

## References

- [Kernel GitHub](https://github.com/zerodevapp/kernel)
- [ZeroDev Docs](https://docs.zerodev.app/)
- [ERC-7579 Spec](https://eips.ethereum.org/EIPS/eip-7579)
- [Coinbase Smart Wallet GitHub](https://github.com/coinbase/smart-wallet)
- [permissionless.js](https://docs.pimlico.io/)
- [ZeroDev Passkeys](https://docs.zerodev.app/sdk/advanced/passkeys)
- [ZeroDev Session Keys](https://docs.zerodev.app/sdk/permissions/intro)
- [ZeroDev Weighted Multisig](https://docs.zerodev.app/sdk/advanced/multisig)

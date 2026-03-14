# Solidity & Flow EVM Support for Runner

**Date:** 2026-03-15
**Status:** Approved
**Based on:** PR #159 (reimplemented on current main)

## Goal

Add Solidity smart contract editing, compilation, deployment, and interaction to the Cadence Runner — making it a dual-language IDE for both Cadence and Solidity on Flow.

## Architecture Overview

Dual-language, dual-wallet playground. Cadence side unchanged. EVM side added in parallel.

```
┌─────────────────────────────────────────────────────┐
│  Runner Frontend (React)                            │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │ CadenceEditor │  │SolidityEditor│  ← file ext    │
│  │  (useLsp)     │  │(useSolLsp)   │    switches     │
│  └──────┬───────┘  └──────┬───────┘                 │
│         │                  │                         │
│  ┌──────┴───────┐  ┌──────┴───────┐                 │
│  │ FCL / LocalKey│  │wagmi+viem   │                  │
│  │ (Flow wallet) │  │(EVM wallet) │                  │
│  └──────┬───────┘  └──────┬───────┘                 │
│         │                  │                         │
│  ┌──────┴───────┐  ┌──────┴───────┐                 │
│  │ FCL send tx   │  │solc WASM    │                  │
│  │               │  │+ viem deploy│                  │
│  └───────────────┘  └─────────────┘                 │
└─────────────────────────────────────────────────────┘
         │                    │
    ┌────┴────┐         ┌────┴────┐
    │/lsp     │         │/lsp-sol │   ← nginx proxy
    │(Cadence)│         │(Solidity)│
    └────┬────┘         └────┬────┘
         │                    │
    ┌────┴────┐         ┌────┴─────────────────┐
    │cadence- │         │solidity-language-     │
    │lang-srv │         │server (Rust binary)   │
    │(WASM)   │         │--stdio                │
    └─────────┘         └──────────────────────┘
```

## 1. Solidity LSP (Server-side)

- **Binary:** `mmsaki/solidity-language-server` (Rust, prebuilt from GitHub releases)
- **Mode:** `solidity-language-server --stdio` spawned per WebSocket connection
- **Endpoint:** `/lsp-sol` WebSocket (nginx proxied to runner server)
- **Server code:** `SolidityLspClient` class mirrors `CadenceLspClient` pattern
- **Workspace:** Temp directory per session with minimal config

### New files
- `runner/server/src/solidityLspClient.ts` — spawn + JSON-RPC over stdio
- `runner/server/src/solidityWorkspace.ts` — temp workspace management

### Modified files
- `runner/server/src/index.ts` — add `/lsp-sol` WebSocket handler
- `runner/nginx.conf` — add `/lsp-sol` proxy block

## 2. Editor Multi-language Support

- `MonacoLspAdapter` already mostly language-agnostic — parameterize language ID in registration
- Monaco has built-in `sol` language ID with syntax highlighting
- File extension detection: `.sol` → Solidity mode, `.cdc` → Cadence mode
- Editor component switches LSP provider based on active file

### New files
- `runner/src/editor/useSolidityLsp.ts` — Solidity LSP React hook (connects `/lsp-sol`)

### Modified files
- `runner/src/editor/monacoLspAdapter.ts` — accept language ID parameter in `register()`
- `runner/src/editor/CadenceEditor.tsx` — conditional LSP based on file extension
- `runner/src/components/FileExplorer.tsx` — `.sol` file icon (blue FileCode2)

## 3. Compilation (Client-side solc WASM)

- Browser loads `solc-js` WASM — single version (latest stable, e.g. 0.8.28)
- Compile produces ABI + bytecode, displayed in result panel
- No server-side compilation dependency

### New files
- `runner/src/flow/evmExecute.ts` — solc WASM compile + viem deployContract

## 4. Wallet — wagmi + viem + Local Key

### Chain config
- Flow EVM Mainnet: chain ID 747, RPC `https://mainnet.evm.nodes.onflow.org`
- Flow EVM Testnet: chain ID 545, RPC `https://testnet.evm.nodes.onflow.org`
- Network selector toggle switches both Flow network and EVM chain simultaneously

### Wallet options
- **External wallets:** MetaMask and others via wagmi connectors
- **Local Key:** Existing local key manager extended to support EVM EOA
  - Same private key → Flow COA (via FCL) + EVM EOA (via viem `privateKeyToAccount`)
  - wagmi custom connector wraps local key for EVM side

### UI
- WalletButton shows context-aware wallet based on active file type
- `.cdc` active → Flow wallet (FCL / Local Key) — current behavior
- `.sol` active → EVM wallet (MetaMask / Local Key EOA)
- Both addresses visible when connected

### New files
- `runner/src/flow/evmWallet.ts` — wagmi config, chain definitions, custom local-key connector
- `runner/src/flow/networks.ts` — Flow EVM chain definitions for wagmi

### Modified files
- `runner/src/App.tsx` — wrap with WagmiProvider, dual-language run logic
- `runner/src/components/WalletButton.tsx` — dual wallet UI
- `runner/src/auth/localKeyManager.ts` — EOA key derivation/management

## 5. Execution Flow

### Cadence files (.cdc) — unchanged
Existing FCL transaction/script execution path.

### Solidity files (.sol)
1. User clicks Run
2. Client-side solc WASM compiles `.sol` → ABI + bytecode
3. Result panel shows compilation output (errors or ABI/bytecode)
4. If wallet connected: button shows "Compile & Deploy"
   - Uses viem `deployContract` with connected signer
   - Shows deployed contract address in result panel
5. If no wallet: button shows "Compile" (compile only)

### Cross-VM
- Template with `.sol` (Counter contract) + `.cdc` (script calling `EVM.run()`)
- Deploy Solidity via EVM wallet, call from Cadence via FCL

## 6. Templates

Add to existing template picker:
- **Simple Storage (Solidity)** — basic getter/setter contract
- **ERC-20 Token (Solidity)** — minimal fungible token
- **Cross-VM (Cadence ↔ EVM)** — Solidity contract + Cadence script calling it

## 7. Docker Changes

Runner Dockerfile adds:
```dockerfile
# Download solidity-language-server binary
RUN curl -L https://github.com/mmsaki/solidity-language-server/releases/latest/download/solidity-language-server-x86_64-unknown-linux-gnu.tar.gz \
    | tar xz -C /usr/local/bin/
```

## 8. Dependencies

### Frontend (runner/package.json)
- `wagmi` — React EVM wallet hooks
- `viem` — EVM client library (wagmi peer dep)
- `@tanstack/react-query` — wagmi peer dep (may already exist)
- `solc` — Solidity compiler (WASM, browser-side)

### Server (runner/server/package.json)
- No new deps (Solidity LSP is a binary, not npm package)

## 9. Implementation Phases

### Phase 1: Server-side Solidity LSP + nginx
New files only, minimal conflict risk. Validates LSP integration.

### Phase 2: Editor multi-language support
Parameterize existing code, add Solidity LSP hook and templates.

### Phase 3: wagmi + viem + EVM wallet
Add wallet provider, chain config, local key EOA support, dual wallet UI.

### Phase 4: Client-side compilation + deployment
solc WASM in browser, compile/deploy flow, run button context switching.

### Phase 5: Cross-VM template + polish
Cross-VM template, file type icons, run button styling.

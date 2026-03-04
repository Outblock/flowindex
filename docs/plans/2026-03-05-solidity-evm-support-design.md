# Solidity & Flow EVM Support for Runner

**Date:** 2026-03-05
**Status:** Approved

## Goal

Add Solidity smart contract editing, compilation, deployment, and interaction to the Cadence Runner — making it a dual-language IDE for both Cadence and Solidity on Flow.

## Architecture

### Server-Side Solidity LSP

Same pattern as existing Cadence LSP — new WebSocket endpoint, per-connection LSP process.

```
Client (Monaco) ──WebSocket──▶ runner/server ──stdio──▶ solidity-language-server
                    /lsp-sol                              (Nomic Foundation)
```

- Spawn `@nomicfoundation/solidity-language-server --stdio` per connection
- Create temp workspace per session with `foundry.toml` (Flow EVM chain IDs: mainnet=747, testnet=545)
- Sync user's `.sol` files to workspace directory via LSP `textDocument/didOpen` and `textDocument/didChange`
- Proxy JSON-RPC over WebSocket (identical to existing Cadence LSP proxy pattern)
- Server deps: `@nomicfoundation/solidity-language-server` + platform-specific `@nomicfoundation/slang` binaries

### Editor Integration

- **File detection**: `.sol` → Solidity mode, `.cdc` → Cadence mode
- Monaco has built-in `sol` language ID with basic syntax highlighting — no custom tokenizer needed
- New `SolidityLspAdapter` (mirrors existing `MonacoLspAdapter`) for completions, hover, go-to-def, diagnostics
- New `useSolidityLsp` hook — connects to `/lsp-sol` WebSocket, same lifecycle as `useLsp`
- Extend existing dark/light themes with Solidity token colors
- `CadenceEditor.tsx` becomes language-agnostic — switches LSP providers based on file extension

### Compilation & Deployment

- **Compile**: `solc-js` on server — produce ABI + bytecode
- New server endpoint: `POST /compile-sol` — takes source map, compiler version, returns ABI/bytecode/errors
- **Deploy**: ethers.js or viem on client side, connected to Flow EVM RPC
  - Mainnet: `https://mainnet.evm.nodes.onflow.org` (chain 747)
  - Testnet: `https://testnet.evm.nodes.onflow.org` (chain 545)
- **Wallet**: MetaMask / WalletConnect via standard EVM wallet connection (separate from FCL)
- **Result**: contract address + ABI stored in project state

### Contract Interaction

- After deployment (or manual ABI import), show function list in param panel
- Read functions (view/pure): call via ethers provider, show return values
- Write functions: build tx, sign with EVM wallet, show receipt + events
- Reuse existing `ResultPanel` with EVM-specific formatting

### Cross-VM (Cadence ↔ EVM)

- Templates for cross-VM patterns: "Call EVM contract from Cadence", "Wrap FLOW", etc.
- AI assistant updated with cross-VM knowledge (system prompt + EVM contract docs)
- Mixed projects: file explorer supports `.cdc` + `.sol` files in same project

### UI Changes

- **Network selector**: already exists — auto-detect language from file type, show relevant network
- **Wallet area**: dual wallet — FCL wallet (Cadence) + MetaMask (EVM)
- **Execute button**: context-aware — Cadence run vs Solidity compile/deploy
- **File explorer**: icons differentiate `.cdc` and `.sol` files
- **Templates**: new EVM templates (ERC-20, ERC-721, Simple Storage, Cross-VM Bridge)

## Files to Modify/Create

### Server (runner/server/src/)
- `index.ts` — Add `/lsp-sol` WebSocket endpoint
- `solidityLspClient.ts` (new) — Spawn and manage solidity-language-server process
- `solidityWorkspace.ts` (new) — Temp workspace with foundry.toml, file sync
- `compileSolidity.ts` (new) — solc-js compilation endpoint

### Client (runner/src/)
- `editor/CadenceEditor.tsx` → `editor/CodeEditor.tsx` — Language-agnostic editor
- `editor/solidityLspAdapter.ts` (new) — Solidity LSP ↔ Monaco bridge
- `editor/useSolidityLsp.ts` (new) — Solidity LSP lifecycle hook
- `editor/solidityTheme.ts` (new) — Solidity-specific theme extensions
- `flow/evmExecute.ts` (new) — EVM compilation, deployment, interaction via ethers.js
- `flow/evmWallet.ts` (new) — MetaMask/WalletConnect connection
- `flow/networks.ts` — Add EVM RPC endpoints
- `fs/fileSystem.ts` — Add Solidity templates, language detection
- `components/FileExplorer.tsx` — File type icons
- `components/ParamPanel.tsx` — ABI-based function inputs for Solidity
- `components/ResultPanel.tsx` — EVM tx result formatting
- `components/WalletButton.tsx` — Dual wallet UI (FCL + MetaMask)
- `components/AIPanel.tsx` — Solidity-aware AI tools
- `App.tsx` — Wire up Solidity LSP, EVM wallet, compile/deploy flows

### AI (ai/chat/web/)
- `app/api/runner-chat/route.ts` — Update system prompt with Solidity/EVM knowledge

### Docker
- `runner/Dockerfile` — Install solidity-language-server + solc in runtime image

## Dependencies to Add

### Server
- `@nomicfoundation/solidity-language-server` — Full LSP
- `solc` (solc-js) — Solidity compiler

### Client
- `ethers` or `viem` — EVM interaction
- `@web3modal/ethers` or `@rainbow-me/rainbowkit` — EVM wallet connection

## Phasing

### Phase 1: LSP + Editor (MVP)
- Server-side Solidity LSP via WebSocket
- Monaco Solidity editing with full language intelligence
- `.sol` file support in file explorer and templates
- Basic compilation (diagnostics from LSP)

### Phase 2: Compile + Deploy
- solc-js compilation endpoint
- EVM wallet connection (MetaMask)
- Contract deployment to Flow EVM
- Deployment results in ResultPanel

### Phase 3: Interaction + Cross-VM
- ABI-based contract interaction UI
- Read/write function calls
- Cross-VM templates (Cadence ↔ EVM)
- AI assistant Solidity/EVM knowledge

## Open Questions

1. **Wallet library**: ethers.js vs viem? RainbowKit vs Web3Modal?
2. **Compiler version management**: pin a single solc version or let users choose?
3. **Import resolution**: how to handle OpenZeppelin and other library imports in the LSP workspace?
4. **Foundry vs Hardhat**: which project config to scaffold for the LSP workspace?

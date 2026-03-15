# EVM Contract Interact Page — Design Spec

**Date:** 2026-03-15
**Status:** Approved

## Overview

A standalone page (`/interact`) for testing and interacting with deployed EVM contracts on Flow EVM. Users input a contract address, the page fetches the ABI from Blockscout (or accepts manual ABI paste), and presents all read/write methods for execution.

## Entry Point

- New sidebar ActivityBar tab: `interact` (icon: `Terminal` or `Play`)
- Extends `SidebarTab` union in `ActivityBar.tsx` to include `'interact'`
- Click behavior: hard navigation via `window.location.href = '/interact'` (same pattern as `deploy` tab — intercepted in `onTabChange` before `setSidebarTab` runs)
- New route in `Router.tsx`: `<Route path="/interact" element={<InteractPage />} />`
- URL supports deep-linking: `/interact?address=0x...&network=mainnet`

## Page Flow

### Step 1 — Load Contract

- Address input field + network selector (mainnet / testnet)
- Network defaults: reads `?network` URL param first, falls back to `localStorage.getItem('runner:network')`, then `'mainnet'`
- Press Enter or click "Load" to fetch
- Calls `/api/evm-contracts/:address` endpoint — **must be extended** to also return `abi` from Blockscout's `/api/v2/smart-contracts/:address` response (currently only returns `files`)
- **Testnet support:** Endpoint accepts `?network=testnet` param. Server uses `BLOCKSCOUT_TESTNET_URL` env var (default: `https://evm-testnet.flowscan.io`) when `network=testnet`
- **If verified:** Auto-populates contract name + ABI, proceeds to Step 2
- **If not verified:** Shows info message + textarea for manual ABI JSON paste
  - Validation: must be valid JSON, must be an array, each entry must have a `type` field
  - Error message if malformed: "Invalid ABI format. Paste a valid JSON ABI array."
- Loading/error states with appropriate feedback

### Step 2 — Method List

- Reuses `ContractInteraction` component — make `DeployedContract.deployTxHash` optional (it's not available for contracts loaded by address)
- **Read functions:** Grouped together, callable without wallet
- **Write functions:** Grouped together, require wallet connection (MetaMask via wagmi — `WagmiProvider` from `main.tsx` covers this page)
- Each method is an expandable card with:
  - Function name + signature
  - Parameter inputs (reuses `SolidityParamInput`)
  - Execute button
  - Result display area

### Step 3 — Results

- **Read calls:** Display return value inline
- **Write calls:** Display tx hash (clickable link to FlowIndex: `https://evm.flowindex.io/tx/{hash}` for mainnet, `https://evm-testnet.flowindex.io/tx/{hash}` for testnet), gas used
- Error states: revert reasons decoded via existing `evmRevert.ts`

## Recent Contracts

- Stored in localStorage at key `runner:recent-contracts`
- Max 10 entries, TypeScript interface:
  ```typescript
  interface RecentContract {
    address: string;
    network: 'mainnet' | 'testnet';
    name: string;
    timestamp: number;
  }
  ```
- ABI NOT stored (too large) — re-fetched on load
- Displayed as a list below the address input when no contract is loaded
- Click to auto-fill address + network and fetch

## URL Sharing

- Pattern: `/interact?address=0x...&network=mainnet`
- On page load: if URL has `address` param, auto-fill and fetch
- `network` defaults per the fallback chain described in Step 1

## Required Changes to Existing Code

| File | Change |
|------|--------|
| `ActivityBar.tsx` | Add `'interact'` to `SidebarTab` union + tabs array |
| `App.tsx` | Intercept `'interact'` in `onTabChange` → `window.location.href = '/interact'` |
| `Router.tsx` | Add `<Route path="/interact" element={<InteractPage />} />` |
| `server/src/http.ts` | Extend `/api/evm-contracts/:address` to return `abi` field; add `?network` param for testnet Blockscout URL |
| `src/flow/evmContract.ts` | Make `DeployedContract.deployTxHash` optional |
| `src/components/ContractInteraction.tsx` | Handle optional `deployTxHash` (don't render tx link if missing) |

## New Components

| Component | Purpose |
|-----------|---------|
| `InteractPage` | Page component at `/interact` route |
| `ContractLoader` | Address input + network selector + Blockscout fetch + manual ABI fallback |
| `RecentContracts` | Recent contracts list from localStorage |

## Components to Reuse

| Component | Location | Purpose |
|-----------|----------|---------|
| `ContractInteraction` | `src/components/ContractInteraction.tsx` | Method list + execution (direct import) |
| `SolidityParamInput` | `src/components/SolidityParamInput.tsx` | Typed parameter inputs |
| `callContractRead` | `src/flow/evmContract.ts` | Read function calls |
| `callContractWrite` | `src/flow/evmContract.ts` | Write function calls |
| `evmChains` | `src/flow/evmChains.ts` | Chain config (747/545) |

## Not In Scope

- Event log display (future iteration)
- Multi-contract tabs (future iteration)
- Unit test runner
- Contract verification/submission

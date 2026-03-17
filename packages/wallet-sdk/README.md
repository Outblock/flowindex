# @flowindex/wallet-sdk

Lightweight SDK for integrating FlowIndex Wallet into any EVM dApp. Passkey-powered smart wallet on Flow EVM via ERC-4337.

## How It Works

```
Your dApp                          FlowIndex Wallet (popup)
  │                                       │
  ├─ User clicks "FlowIndex Wallet"       │
  ├─ SDK opens popup ──────────────────────►
  │                                 User signs in with passkey
  │                                 Selects account
  │◄─────── postMessage: connected ────────┤
  │                                        │
  ├─ eth_sendTransaction ──────────────────►
  │                                 Passkey signs UserOp
  │                                 Bundler submits to chain
  │◄─────── postMessage: tx hash ──────────┤
```

Zero dependencies. Works with any EVM dApp framework.

## Integration

### Option 1: RainbowKit (Recommended)

Add FlowIndex Wallet to your RainbowKit config — one line:

```ts
import { connectorsForWallets } from '@rainbow-me/rainbowkit'
import { flowIndexWallet } from '@flowindex/wallet-sdk'

const connectors = connectorsForWallets([
  {
    groupName: 'Recommended',
    wallets: [
      flowIndexWallet({ walletUrl: 'https://wallet.flowindex.io/connect/popup' }),
      // ...other wallets
    ],
  },
], { appName: 'My App', projectId: 'your-wc-project-id' })
```

FlowIndex Wallet will appear in the wallet list. Clicking it opens a popup where the user authenticates with their passkey.

### Option 2: EIP-6963 Auto-Discovery

For dApps that support EIP-6963 (wagmi, ethers.js v6+, RainbowKit), announce the wallet at app startup:

```ts
import { announceFlowIndexWallet } from '@flowindex/wallet-sdk'

// Call once at app startup
announceFlowIndexWallet({
  walletUrl: 'https://wallet.flowindex.io/connect/popup',
})
```

The wallet will automatically appear in any EIP-6963-compatible wallet selector.

### Option 3: Direct EIP-1193 Provider

For custom integrations, use the provider directly:

```ts
import { createFlowIndexProvider } from '@flowindex/wallet-sdk'

const provider = createFlowIndexProvider({
  walletUrl: 'https://wallet.flowindex.io/connect/popup',
})

// Standard EIP-1193 — works with ethers.js, web3.js, viem, etc.
const accounts = await provider.request({ method: 'eth_requestAccounts' })
const balance = await provider.request({ method: 'eth_getBalance', params: [accounts[0], 'latest'] })
```

## Supported RPC Methods

| Method | Description |
|--------|-------------|
| `eth_requestAccounts` | Opens popup, returns smart wallet address |
| `eth_accounts` | Returns connected address (no popup) |
| `eth_chainId` | Returns Flow-EVM chain ID |
| `eth_sendTransaction` | Signs via passkey, submits as ERC-4337 UserOp |
| `eth_call` | Read-only call (proxied to RPC) |
| `eth_getBalance` | Balance query (proxied to RPC) |
| `eth_getTransactionReceipt` | Tx receipt (proxied to RPC) |
| All read methods | Proxied directly to Flow-EVM RPC |

### Coming Soon

- `personal_sign` — ERC-1271 signature (requires deployed wallet)
- `eth_signTypedData_v4` — EIP-712 typed data signing

## Configuration

```ts
interface FlowIndexProviderConfig {
  /** Wallet popup URL. Default: https://wallet.flowindex.io/connect/popup */
  walletUrl?: string
  /** Custom popup window features */
  popupFeatures?: string
}
```

## Architecture

The SDK uses a **popup-based** architecture (same as Coinbase Smart Wallet):

1. SDK opens wallet in a popup window
2. User authenticates with passkey in the popup
3. All RPC requests are proxied via `postMessage` to the popup
4. The popup's ERC-4337 provider handles UserOp construction, signing, and bundler submission
5. Results are sent back via `postMessage`

This means:
- **No private keys leave the wallet** — signing happens in the popup
- **No browser extension needed** — works in any browser with passkey support
- **dApp never sees credentials** — only receives transaction results

## Local Development

```bash
# Wallet popup (port 5174)
cd wallet && bun dev

# Your dApp
# Add flowIndexWallet({ walletUrl: 'http://localhost:5174/connect/popup' }) to config
```

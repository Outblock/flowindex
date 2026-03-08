# @flowindex/agent-wallet

MCP server that gives AI agents a Flow blockchain wallet -- local keys, cloud wallet, or passkey signing with 70 built-in Cadence templates.

## Quick Start

Add to `claude_desktop_config.json`:

### Zero-config (cloud wallet, interactive login)

```json
{
  "mcpServers": {
    "flow-wallet": {
      "command": "npx",
      "args": ["@flowindex/agent-wallet"]
    }
  }
}
```

### Mnemonic (headless, local signing)

```json
{
  "mcpServers": {
    "flow-wallet": {
      "command": "npx",
      "args": ["@flowindex/agent-wallet"],
      "env": {
        "FLOW_MNEMONIC": "your twelve word mnemonic phrase ...",
        "FLOW_ADDRESS": "0x1234567890abcdef",
        "FLOW_NETWORK": "mainnet",
        "APPROVAL_REQUIRED": "false"
      }
    }
  }
}
```

### Private Key (headless, local signing)

```json
{
  "mcpServers": {
    "flow-wallet": {
      "command": "npx",
      "args": ["@flowindex/agent-wallet"],
      "env": {
        "FLOW_PRIVATE_KEY": "deadbeef...",
        "FLOW_ADDRESS": "0x1234567890abcdef",
        "FLOW_SIG_ALGO": "ECDSA_secp256k1",
        "FLOW_HASH_ALGO": "SHA2_256",
        "FLOW_NETWORK": "mainnet"
      }
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `FLOW_NETWORK` | `mainnet` | `mainnet` or `testnet` |
| `FLOW_MNEMONIC` | -- | BIP-39 mnemonic for local signing |
| `FLOW_PRIVATE_KEY` | -- | Hex private key for local signing |
| `FLOW_ADDRESS` | -- | Flow address (required for local signing) |
| `FLOW_KEY_INDEX` | `0` | Account key index |
| `FLOW_SIG_ALGO` | `ECDSA_secp256k1` | `ECDSA_P256` or `ECDSA_secp256k1` |
| `FLOW_HASH_ALGO` | `SHA2_256` | `SHA2_256` or `SHA3_256` |
| `EVM_PRIVATE_KEY` | -- | Separate EVM key (derives from Flow key if unset) |
| `EVM_ACCOUNT_INDEX` | `0` | BIP-44 account index for EVM key derivation |
| `FLOWINDEX_TOKEN` | -- | FlowIndex API token for cloud wallet |
| `FLOWINDEX_URL` | `https://flowindex.io` | FlowIndex API base URL |
| `APPROVAL_REQUIRED` | `true` | Require confirmation before signing transactions |
| `ETHERSCAN_API_KEY` | -- | For EVM contract ABI lookup |

## Available Tools (23)

### Wallet (3)

| Tool | Description |
|---|---|
| `wallet_status` | Show current wallet address, network, and signer type |
| `wallet_login` | Start cloud wallet login (returns URL for user to open) |
| `wallet_login_status` | Check if cloud wallet login completed |

### Templates (4)

| Tool | Description |
|---|---|
| `list_templates` | List available Cadence templates by category |
| `get_template` | Read a template's Cadence source code |
| `execute_script` | Run a read-only Cadence script (no signing) |
| `execute_template` | Execute a transaction template (requires signing) |

### Approval (3)

| Tool | Description |
|---|---|
| `confirm_transaction` | Approve a pending transaction for signing |
| `cancel_transaction` | Reject a pending transaction |
| `list_pending` | List all transactions waiting for approval |

### Flow Queries (5)

| Tool | Description |
|---|---|
| `get_account` | Get account info (balance, keys, contracts) |
| `get_flow_balance` | Get FLOW token balance for an address |
| `get_ft_balance` | Get fungible token balance by vault path |
| `get_nft_collection` | List NFTs in a collection |
| `get_transaction` | Get transaction result and status |

### EVM (8)

| Tool | Description |
|---|---|
| `evm_wallet_address` | Show the EVM (COA) address |
| `evm_get_balance` | Get native FLOW balance on EVM |
| `evm_get_token_balance` | Get ERC-20 token balance |
| `evm_transfer` | Transfer FLOW on EVM |
| `evm_transfer_erc20` | Transfer ERC-20 tokens |
| `evm_read_contract` | Call a read-only EVM contract function |
| `evm_write_contract` | Call a state-changing EVM contract function |
| `evm_get_transaction` | Get EVM transaction receipt |

## Signing Modes

| Mode | Config | Headless | Description |
|---|---|---|---|
| Local (mnemonic) | `FLOW_MNEMONIC` + `FLOW_ADDRESS` | Yes | BIP-39 HD wallet, key never leaves process |
| Local (private key) | `FLOW_PRIVATE_KEY` + `FLOW_ADDRESS` | Yes | Raw hex key, key never leaves process |
| Cloud (token) | `FLOWINDEX_TOKEN` | Yes | FlowIndex-managed custodial wallet |
| Cloud (interactive) | (no key env vars) | No | Browser-based login, user approves in wallet |

## Approval Flow

When `APPROVAL_REQUIRED=true` (the default), transactions follow a two-step flow:

1. **Agent calls `execute_template`** -- the transaction is queued as "pending" and returns a `pendingId`
2. **Agent calls `confirm_transaction`** with the `pendingId` -- the transaction is signed, sent, and the result returned

The agent can also call `cancel_transaction` to reject, or `list_pending` to see all queued transactions. Set `APPROVAL_REQUIRED=false` for fully autonomous headless operation.

## Template Categories (70 templates)

| Category | Count | Examples |
|---|---|---|
| `base` | 10 | create-account, transfer-flow, add-key, remove-key |
| `token` | 14 | setup-ft-vault, transfer-ft, get-ft-balance, get-ft-supply |
| `collection` | 12 | setup-nft-collection, transfer-nft, get-nft-ids, get-nft-metadata |
| `bridge` | 10 | bridge-nft-to-evm, bridge-ft-to-evm, bridge-nft-from-evm |
| `evm` | 10 | create-coa, fund-coa, call-evm-contract, get-coa-balance |
| `hybrid-custody` | 8 | setup-child-account, publish-to-parent, redeem-account |
| `lost-and-found` | 6 | get-redeemable-types, redeem-all, deposit-ft-to-lost-and-found |

## Security

- **Keys never leave the process.** Local signing uses in-memory keys derived from mnemonic or raw key. No keys are sent over the network.
- **Template-based execution.** Transactions use audited Cadence templates from the Flow Reference Wallet, not arbitrary user code.
- **Two-step approval.** By default, every transaction requires explicit confirmation before signing.
- **Network isolation.** FCL is configured per-network with correct contract addresses -- no cross-network accidents.
- **No persistent state.** The server is stateless between restarts. Pending approvals are lost on restart.

## Development

```bash
# Install dependencies
bun install

# Build
bun run build

# Dev mode (watch)
bun run dev

# Run directly (without build)
bun run start

# Type check
bun run lint

# Inspect with MCP Inspector
bun run inspect
```

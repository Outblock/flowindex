# Smart Wallet Contract Deployment

Foundry project for deploying Coinbase Smart Wallet + VerifyingPaymaster to Flow-EVM.

## Contracts

| Script | Deploys | Description |
|--------|---------|-------------|
| `DeployFactory.s.sol` | CoinbaseSmartWallet + CoinbaseSmartWalletFactory | ERC-4337 smart account with passkey (P-256) support |
| `DeployPaymaster.s.sol` | VerifyingPaymaster | Gas sponsoring — trusted signer approves UserOps |

## Deployed Addresses (Flow-EVM Testnet, chain 545)

| Contract | Address |
|----------|---------|
| CoinbaseSmartWallet (impl) | `0x0d956a72774534DE5bFc0dA88Fca589ba2378De0` |
| CoinbaseSmartWalletFactory | `0xAc396ed9a5E949C685C3799657E26fE1d6fFf7E7` |
| VerifyingPaymaster | `0x348C96e048A6A01B1bD75b6218b65986717CC15a` |

Already deployed (canonical, no action needed):
- EntryPoint v0.7: `0x0000000071727De22E5E9d8BAf0edAc6f37da032`
- CREATE2 Deployer: `0x4e59b44847b379578588920cA78FbF26c0B4956C`

## Setup

```bash
# Install dependencies (Foundry must be installed: https://getfoundry.sh)
forge install foundry-rs/forge-std coinbase/smart-wallet --no-git

# Copy env
cp .env.example .env
# Edit .env with deployer private key and paymaster signer address
```

## Deploy

### Smart Wallet Factory

```bash
source .env
forge script script/DeployFactory.s.sol:DeployFactory \
  --rpc-url $FLOW_EVM_TESTNET_RPC \
  --broadcast
```

### Paymaster

```bash
source .env
forge script script/DeployPaymaster.s.sol:DeployPaymaster \
  --rpc-url $FLOW_EVM_TESTNET_RPC \
  --broadcast
```

The paymaster script also:
- Deposits 10 FLOW to EntryPoint (for sponsoring user gas)
- Stakes 1 FLOW (required by ERC-4337 for paymasters)

### Mainnet

Same commands, use `$FLOW_EVM_MAINNET_RPC` instead.

## Verify Deployment

```bash
# Check factory works
cast call <FACTORY_ADDRESS> \
  "getAddress(bytes[],uint256)(address)" \
  "[0x$(python3 -c 'print(\"00\"*64)')]" 0 \
  --rpc-url $FLOW_EVM_TESTNET_RPC

# Check paymaster deposit
cast call 0x0000000071727De22E5E9d8BAf0edAc6f37da032 \
  "balanceOf(address)(uint256)" <PAYMASTER_ADDRESS> \
  --rpc-url $FLOW_EVM_TESTNET_RPC
```

## Security

- `.env` is gitignored — never commit private keys
- `broadcast/` and `cache/` are gitignored — they contain deployment transaction data with key material
- Deployer key and paymaster signer key are backed up in GitHub Secrets

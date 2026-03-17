# ERC-4337 Bundler + Paymaster

Alto bundler and VerifyingPaymaster signing service for the FlowIndex passkey wallet on Flow-EVM.

## Architecture

```
bundler.flowindex.io (Caddy TLS)
├── /          → Alto bundler    (:4337)  — ERC-4337 UserOp submission
└── /paymaster → Paymaster signer (:4338) — gas sponsoring signatures
```

## Infrastructure

| Component | Detail |
|-----------|--------|
| **VM** | `flowindex-bundler` (GCE e2-micro, COS, us-central1-a) |
| **IP** | `136.112.57.126` (static) |
| **DNS** | `bundler.flowindex.io` |
| **Network** | `flowindex-vpc` (internal: `10.128.0.6`) |

## Deployed Contracts (Flow-EVM Testnet, chain 545)

| Contract | Address |
|----------|---------|
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| CoinbaseSmartWallet (impl) | `0x0d956a72774534DE5bFc0dA88Fca589ba2378De0` |
| CoinbaseSmartWalletFactory | `0xAc396ed9a5E949C685C3799657E26fE1d6fFf7E7` |
| VerifyingPaymaster | `0x348C96e048A6A01B1bD75b6218b65986717CC15a` |

## Wallet Addresses

| Wallet | Address | Purpose |
|--------|---------|---------|
| Executor | `0x4E33289dC575167045d276bA7C5F56Fd6eB1D1Eb` | Submits bundle transactions |
| Utility | `0xbB13e9207935D5Cb4dFD7193dd21756292976c67` | Auto-refills executor |
| Paymaster Signer | `0xB9FB2E7B2635c6ee81020427f325d2655C07C97c` | Signs paymaster approvals |

## Setup

### 1. Environment

Copy `.env.example` to `.env` and fill in private keys:

```bash
cp .env.example .env
# Edit .env with actual private keys
```

**Keys are stored in:**
- VM: `/mnt/stateful_partition/alto-bundler.env`
- GitHub Secrets (backup): `ALTO_EXECUTOR_PRIVATE_KEY`, `ALTO_UTILITY_PRIVATE_KEY`, `PAYMASTER_SIGNER_KEY`

### 2. Local Development

```bash
# Start bundler + paymaster via docker-compose (from repo root)
docker compose up alto-bundler -d

# Or run paymaster service directly
cd wallet/bundler
bun install
bun run paymaster-service.ts
```

### 3. Verify

```bash
# Test bundler
curl https://bundler.flowindex.io \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","method":"eth_supportedEntryPoints","id":1}'

# Test paymaster (requires a UserOp body)
curl https://bundler.flowindex.io/paymaster \
  -H 'Content-Type: application/json' \
  -d '{"userOp":{"sender":"0x...","nonce":"0x0",...}}'
```

### 4. VM Management

```bash
# SSH into bundler VM
gcloud compute ssh flowindex-bundler --zone=us-central1-a

# Check container logs
docker logs alto-bundler
docker logs paymaster
docker logs caddy

# Restart services
docker restart alto-bundler paymaster

# Update env
sudo vim /mnt/stateful_partition/alto-bundler.env
```

### 5. Funding

The executor and utility wallets need FLOW on Flow-EVM for gas. The paymaster contract needs a deposit at the EntryPoint for sponsoring user gas.

```bash
# Check executor balance
cast balance 0x4E33289dC575167045d276bA7C5F56Fd6eB1D1Eb --rpc-url https://testnet.evm.nodes.onflow.org

# Check paymaster deposit at EntryPoint
cast call 0x0000000071727De22E5E9d8BAf0edAc6f37da032 \
  "balanceOf(address)(uint256)" 0x348C96e048A6A01B1bD75b6218b65986717CC15a \
  --rpc-url https://testnet.evm.nodes.onflow.org

# Top up paymaster deposit (from deployer wallet)
cast send 0x348C96e048A6A01B1bD75b6218b65986717CC15a \
  "deposit()" --value 10ether \
  --private-key <DEPLOYER_KEY> \
  --rpc-url https://testnet.evm.nodes.onflow.org
```

## Deployment

Deployed automatically via `build-wallet` job in `.github/workflows/deploy.yml` when changes to `wallet/**` or `packages/**` are pushed to `main`.

The startup script on the VM handles:
- iptables rules for ports 80, 443, 4337
- Alto bundler container
- Paymaster signing service container
- Caddy reverse proxy with auto-TLS

## Security

- Private keys are **never** committed to the repo (`.env` is gitignored)
- Keys stored on VM at `/mnt/stateful_partition/alto-bundler.env` (persistent across reboots)
- Keys backed up in GitHub Secrets: `ALTO_EXECUTOR_PRIVATE_KEY`, `ALTO_UTILITY_PRIVATE_KEY`, `PAYMASTER_SIGNER_KEY`
- Foundry broadcast/cache dirs (contain deploy tx data) are gitignored

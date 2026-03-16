/**
 * E2E validation script for evm-wallet package against Flow-EVM.
 *
 * Usage:
 *   BUNDLER_URL=http://localhost:4337 bun scripts/test-evm-wallet.ts
 *
 * Validates:
 *   1. Bundler connectivity and EntryPoint support
 *   2. Counterfactual address computation (if factory deployed)
 */

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
  try {
    const entryPoints = await bundler.supportedEntryPoints()
    console.log("   Supported EntryPoints:", entryPoints)

    if (!entryPoints.map(e => e.toLowerCase()).includes(ENTRYPOINT_V07_ADDRESS.toLowerCase())) {
      console.error("   ERROR: Bundler does not support EntryPoint v0.7!")
      process.exit(1)
    }
    console.log("   OK: Bundler responding\n")
  } catch (err: any) {
    console.error("   ERROR: Cannot reach bundler at", BUNDLER_URL)
    console.error("  ", err.message)
    console.log("   (Is Alto running? Start with: docker compose up alto-bundler)\n")
  }

  // Step 2: Compute counterfactual address
  if (FACTORY_ADDRESS) {
    console.log("2. Computing counterfactual address...")
    const testPubKey =
      "04" +
      "1111111111111111111111111111111111111111111111111111111111111111" +
      "2222222222222222222222222222222222222222222222222222222222222222"

    try {
      const address = await getSmartWalletAddress(testPubKey, {
        factoryAddress: FACTORY_ADDRESS as `0x${string}`,
        rpcUrl: RPC_URL,
      })
      console.log("   Smart Wallet Address:", address)
      console.log("   OK: Address computation works\n")
    } catch (err: any) {
      console.error("   ERROR: Address computation failed:", err.message, "\n")
    }
  } else {
    console.log("2. Skipping address computation (EVM_WALLET_FACTORY_ADDRESS not set)\n")
  }

  console.log("=== Validation Complete ===")
}

main().catch(console.error)

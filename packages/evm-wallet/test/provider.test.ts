import { describe, it, expect, vi, beforeEach } from "vitest"
import { createEvmWalletProvider } from "../src/provider"

describe("provider", () => {
  let provider: ReturnType<typeof createEvmWalletProvider>

  beforeEach(() => {
    provider = createEvmWalletProvider({
      smartWalletAddress: "0xabc123" as any,
      rpcUrl: "https://mainnet.evm.nodes.onflow.org",
      bundlerUrl: "http://localhost:4337",
      publicKeySec1Hex: "04" + "00".repeat(64),
      credentialId: "test-cred",
      isDeployed: true,
    })
  })

  it("returns chain ID for eth_chainId", async () => {
    const result = await provider.request({ method: "eth_chainId" })
    expect(result).toBe("0x2eb") // 747
  })

  it("returns smart wallet address for eth_accounts", async () => {
    const result = await provider.request({ method: "eth_accounts" })
    expect(result).toEqual(["0xabc123"])
  })

  it("returns smart wallet address for eth_requestAccounts", async () => {
    const result = await provider.request({ method: "eth_requestAccounts" })
    expect(result).toEqual(["0xabc123"])
  })

  it("rejects wallet_switchEthereumChain", async () => {
    await expect(
      provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] }),
    ).rejects.toThrow("Chain switching not supported")
  })

  it("rejects personal_sign on undeployed wallet", async () => {
    const undeployedProvider = createEvmWalletProvider({
      smartWalletAddress: "0xabc123" as any,
      rpcUrl: "https://mainnet.evm.nodes.onflow.org",
      bundlerUrl: "http://localhost:4337",
      publicKeySec1Hex: "04" + "00".repeat(64),
      credentialId: "test-cred",
      isDeployed: false,
    })
    await expect(
      undeployedProvider.request({ method: "personal_sign", params: ["0xdeadbeef", "0xabc123"] }),
    ).rejects.toThrow("Wallet must be deployed")
  })

  it("supports event listeners", () => {
    const handler = vi.fn()
    provider.on("accountsChanged", handler)
    // No error thrown - event listener registered
    provider.removeListener("accountsChanged", handler)
  })
})

import type { Address } from "viem"
import type { EvmWalletProvider } from "./provider"

export interface WalletConnectConfig {
  projectId: string
  provider: EvmWalletProvider
  smartWalletAddress: Address
  chainId?: number
  metadata?: {
    name: string
    description: string
    url: string
    icons: string[]
  }
}

export async function createWalletConnectManager(config: WalletConnectConfig) {
  const {
    projectId,
    provider,
    smartWalletAddress,
    chainId = 747,
    metadata = {
      name: "FlowIndex Wallet",
      description: "Passkey-powered smart wallet on Flow EVM",
      url: "https://flowindex.io",
      icons: ["https://flowindex.io/icon.png"],
    },
  } = config

  // Dynamic imports — optional peer dependencies resolved at runtime
  const { Web3Wallet } = await import("@walletconnect/web3wallet") as any
  const { Core } = await import("@walletconnect/core") as any

  const core = new (Core as any)({ projectId })
  const web3wallet: any = await (Web3Wallet as any).init({ core, metadata })

  const eip155Chain = `eip155:${chainId}`
  const accounts = [`${eip155Chain}:${smartWalletAddress}`]

  web3wallet.on("session_proposal", async (proposal: any) => {
    const { id } = proposal
    try {
      await web3wallet.approveSession({
        id,
        namespaces: {
          eip155: {
            chains: [eip155Chain],
            accounts,
            methods: [
              "eth_sendTransaction",
              "personal_sign",
              "eth_signTypedData_v4",
              "eth_accounts",
              "eth_chainId",
            ],
            events: ["accountsChanged", "chainChanged"],
          },
        },
      })
    } catch (err) {
      console.error("[WalletConnect] Failed to approve session:", err)
      await web3wallet.rejectSession({
        id,
        reason: { code: 5000, message: "User rejected" },
      })
    }
  })

  web3wallet.on("session_request", async (event: any) => {
    const { topic, params, id } = event
    const { request } = params
    try {
      const result = await provider.request({
        method: request.method,
        params: request.params,
      })
      await web3wallet.respondSessionRequest({
        topic,
        response: { id, jsonrpc: "2.0", result },
      })
    } catch (err: any) {
      await web3wallet.respondSessionRequest({
        topic,
        response: {
          id,
          jsonrpc: "2.0",
          error: { code: err.code ?? 5000, message: err.message ?? "Request failed" },
        },
      })
    }
  })

  return {
    async pair(uri: string) {
      await web3wallet.pair({ uri })
    },
    getActiveSessions() {
      return web3wallet.getActiveSessions()
    },
    async disconnect(topic: string) {
      await web3wallet.disconnectSession({
        topic,
        reason: { code: 6000, message: "User disconnected" },
      })
    },
    async disconnectAll() {
      const sessions = web3wallet.getActiveSessions()
      await Promise.all(
        Object.keys(sessions).map((topic) =>
          web3wallet.disconnectSession({
            topic,
            reason: { code: 6000, message: "Wallet disconnected" },
          }),
        ),
      )
    },
  }
}

export type WalletConnectManager = Awaited<ReturnType<typeof createWalletConnectManager>>

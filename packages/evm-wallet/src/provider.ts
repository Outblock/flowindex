import {
  type Address,
  type Hex,
  toHex,
} from "viem"
import { createBundlerClient } from "./bundler-client"
import { buildUserOperation, type CallParams } from "./user-op"
import { signUserOpWithPasskey } from "./signer"
import { ENTRYPOINT_V07_ADDRESS, computeUserOpHash } from "./constants"

type EventName = "accountsChanged" | "chainChanged" | "disconnect"
type EventHandler = (...args: any[]) => void

export interface EvmWalletProviderConfig {
  smartWalletAddress: Address
  rpcUrl: string
  bundlerUrl: string
  publicKeySec1Hex: string
  credentialId: string
  isDeployed: boolean
  chainId?: number
  paymasterUrl?: string
}

export function createEvmWalletProvider(config: EvmWalletProviderConfig) {
  const {
    smartWalletAddress,
    rpcUrl,
    bundlerUrl,
    publicKeySec1Hex,
    credentialId,
    chainId = 747,
    paymasterUrl,
  } = config
  let isDeployed = config.isDeployed

  const bundlerClient = createBundlerClient(bundlerUrl)
  const listeners = new Map<EventName, Set<EventHandler>>()

  function emit(event: EventName, ...args: any[]) {
    listeners.get(event)?.forEach((fn) => fn(...args))
  }

  async function proxyToRpc(method: string, params?: any[]): Promise<any> {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }),
    })
    const json = await res.json()
    if (json.error) throw new Error(json.error.message)
    return json.result
  }

  const readMethods = new Set([
    "eth_call",
    "eth_estimateGas",
    "eth_getBalance",
    "eth_getTransactionReceipt",
    "eth_blockNumber",
    "eth_getCode",
    "eth_getTransactionByHash",
    "eth_getBlockByNumber",
    "eth_getBlockByHash",
    "eth_getLogs",
    "eth_gasPrice",
    "eth_getTransactionCount",
    "net_version",
  ])

  return {
    isMetaMask: false,

    async request({ method, params }: { method: string; params?: any[] }): Promise<any> {
      if (method === "eth_accounts" || method === "eth_requestAccounts") {
        return [smartWalletAddress]
      }
      if (method === "eth_chainId") {
        return toHex(chainId)
      }

      if (readMethods.has(method)) {
        return proxyToRpc(method, params)
      }

      if (method === "eth_sendTransaction") {
        const [tx] = params ?? []
        const call: CallParams = {
          target: tx.to as Address,
          value: tx.value ? BigInt(tx.value) : 0n,
          data: (tx.data ?? "0x") as Hex,
        }

        const userOp = await buildUserOperation({
          sender: smartWalletAddress,
          call,
          publicKeySec1Hex,
          isDeployed,
          rpcUrl,
          bundlerClient,
          paymasterUrl,
        })

        const userOpHash = computeUserOpHash(userOp, ENTRYPOINT_V07_ADDRESS, chainId)

        userOp.signature = await signUserOpWithPasskey(userOpHash, credentialId)

        const opHash = await bundlerClient.sendUserOperation(userOp, ENTRYPOINT_V07_ADDRESS)

        if (!isDeployed) isDeployed = true

        let receipt = null
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 2000))
          receipt = await bundlerClient.getUserOperationReceipt(opHash)
          if (receipt) break
        }

        return receipt?.receipt.transactionHash ?? opHash
      }

      if (method === "personal_sign" || method === "eth_signTypedData_v4") {
        if (!isDeployed) {
          throw new Error("Wallet must be deployed before signing messages. Send a transaction first.")
        }
        throw new Error(`${method} not yet implemented`)
      }

      if (method === "wallet_switchEthereumChain") {
        throw new Error("Chain switching not supported. This wallet operates on Flow EVM only.")
      }

      return proxyToRpc(method, params)
    },

    on(event: EventName, handler: EventHandler) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(handler)
    },

    removeListener(event: EventName, handler: EventHandler) {
      listeners.get(event)?.delete(handler)
    },
  }
}

export type EvmWalletProvider = ReturnType<typeof createEvmWalletProvider>

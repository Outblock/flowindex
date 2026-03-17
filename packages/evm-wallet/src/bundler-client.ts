import type { Hex, Address } from "viem"

export interface PackedUserOperation {
  sender: Address
  nonce: Hex
  initCode: Hex
  callData: Hex
  accountGasLimits: Hex
  preVerificationGas: Hex
  gasFees: Hex
  paymasterAndData: Hex
  signature: Hex
}

export interface GasEstimate {
  preVerificationGas: Hex
  verificationGasLimit: Hex
  callGasLimit: Hex
}

export interface UserOpReceipt {
  userOpHash: Hex
  sender: Address
  nonce: Hex
  success: boolean
  actualGasCost: Hex
  actualGasUsed: Hex
  receipt: { transactionHash: Hex; blockNumber: Hex }
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0"
  id: number
  result?: T
  error?: { code: number; message: string }
}

export function createBundlerClient(bundlerUrl: string) {
  let nextId = 1

  async function rpc<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(bundlerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    })
    const json: JsonRpcResponse<T> = await res.json()
    if (json.error) throw new Error(`Bundler RPC error: ${json.error.message}`)
    return json.result!
  }

  return {
    async sendUserOperation(userOp: PackedUserOperation, entryPoint: Address): Promise<Hex> {
      return rpc<Hex>("eth_sendUserOperation", [userOp, entryPoint])
    },
    async estimateUserOperationGas(userOp: Partial<PackedUserOperation>, entryPoint: Address): Promise<GasEstimate> {
      return rpc<GasEstimate>("eth_estimateUserOperationGas", [userOp, entryPoint])
    },
    async getUserOperationReceipt(userOpHash: Hex): Promise<UserOpReceipt | null> {
      return rpc<UserOpReceipt | null>("eth_getUserOperationReceipt", [userOpHash])
    },
    async supportedEntryPoints(): Promise<Address[]> {
      return rpc<Address[]>("eth_supportedEntryPoints", [])
    },
  }
}

export type BundlerClient = ReturnType<typeof createBundlerClient>

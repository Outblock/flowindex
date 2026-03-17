import {
  type Address,
  type Hex,
  encodeFunctionData,
  pad,
  concat,
  toHex,
  createPublicClient,
  http,
} from "viem"
import { SMART_WALLET_ABI, ENTRYPOINT_ABI, ENTRYPOINT_V07_ADDRESS } from "./constants"
import { buildInitCode } from "./factory"
import type { BundlerClient, PackedUserOperation, GasEstimate } from "./bundler-client"

export interface CallParams {
  target: Address
  value: bigint
  data: Hex
}

/**
 * Pack verificationGasLimit and callGasLimit into bytes32.
 * Format: uint128(verificationGasLimit) || uint128(callGasLimit)
 */
export function packGasLimits(verificationGasLimit: bigint, callGasLimit: bigint): Hex {
  const vgl = pad(toHex(verificationGasLimit), { size: 16 })
  const cgl = pad(toHex(callGasLimit), { size: 16 })
  return concat([vgl, cgl])
}

/**
 * Pack maxPriorityFeePerGas and maxFeePerGas into bytes32.
 * Format: uint128(maxPriorityFeePerGas) || uint128(maxFeePerGas)
 */
export function packGasFees(maxPriorityFeePerGas: bigint, maxFeePerGas: bigint): Hex {
  const mpfpg = pad(toHex(maxPriorityFeePerGas), { size: 16 })
  const mfpg = pad(toHex(maxFeePerGas), { size: 16 })
  return concat([mpfpg, mfpg])
}

/**
 * Encode callData for CoinbaseSmartWallet.execute()
 */
export function buildCallData(call: CallParams): Hex {
  return encodeFunctionData({
    abi: SMART_WALLET_ABI,
    functionName: "execute",
    args: [call.target, call.value, call.data],
  })
}

/**
 * Encode callData for CoinbaseSmartWallet.executeBatch()
 */
export function buildBatchCallData(calls: CallParams[]): Hex {
  return encodeFunctionData({
    abi: SMART_WALLET_ABI,
    functionName: "executeBatch",
    args: [calls],
  })
}

/**
 * Build a complete unsigned UserOperation (v0.7 packed format).
 */
export async function buildUserOperation(opts: {
  sender: Address
  call: CallParams | CallParams[]
  publicKeySec1Hex: string
  isDeployed: boolean
  rpcUrl: string
  bundlerClient: BundlerClient
  entryPoint?: Address
}): Promise<PackedUserOperation> {
  const {
    sender,
    call,
    publicKeySec1Hex,
    isDeployed,
    rpcUrl,
    bundlerClient,
    entryPoint = ENTRYPOINT_V07_ADDRESS,
  } = opts

  const client = createPublicClient({ transport: http(rpcUrl) })

  const nonce = await client.readContract({
    address: entryPoint,
    abi: ENTRYPOINT_ABI,
    functionName: "getNonce",
    args: [sender, 0n],
  })

  const initCode: Hex = isDeployed ? "0x" : buildInitCode(publicKeySec1Hex)

  const callData = Array.isArray(call) ? buildBatchCallData(call) : buildCallData(call)

  const dummySignature = ("0x" + "ff".repeat(65)) as Hex
  const gasEstimate: GasEstimate = await bundlerClient.estimateUserOperationGas(
    {
      sender,
      nonce: toHex(nonce),
      initCode,
      callData,
      signature: dummySignature,
      paymasterAndData: "0x",
      accountGasLimits: packGasLimits(500000n, 500000n),
      preVerificationGas: toHex(100000n),
      gasFees: packGasFees(0n, 1000000n),
    },
    entryPoint,
  )

  const block = await client.getBlock()
  const baseFee = block.baseFeePerGas ?? 1n
  const maxFeePerGas = baseFee * 2n > 1000000n ? baseFee * 2n : 1000000n
  const maxPriorityFeePerGas = 0n

  return {
    sender,
    nonce: toHex(nonce),
    initCode,
    callData,
    accountGasLimits: packGasLimits(
      BigInt(gasEstimate.verificationGasLimit),
      BigInt(gasEstimate.callGasLimit),
    ),
    preVerificationGas: gasEstimate.preVerificationGas,
    gasFees: packGasFees(maxPriorityFeePerGas, maxFeePerGas),
    paymasterAndData: "0x",
    signature: "0x",
  }
}

import {
  type Address,
  type Hex,
  createPublicClient,
  http,
  encodeAbiParameters,
  encodeFunctionData,
  concat,
} from "viem"
import { FACTORY_ABI, FACTORY_ADDRESS } from "./constants"

export function parsePublicKey(sec1Hex: string): { x: bigint; y: bigint } {
  const clean = sec1Hex.startsWith("0x") ? sec1Hex.slice(2) : sec1Hex
  if (!clean.startsWith("04")) {
    throw new Error("Expected uncompressed SEC1 public key (04 prefix)")
  }
  if (clean.length !== 130) {
    throw new Error(`Expected 130 hex chars (65 bytes), got ${clean.length}`)
  }
  const x = BigInt("0x" + clean.slice(2, 66))
  const y = BigInt("0x" + clean.slice(66, 130))
  return { x, y }
}

export function encodeOwnerBytes(x: bigint, y: bigint): Hex {
  return encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }],
    [x, y],
  )
}

export function buildOwners(sec1Hex: string): Hex[] {
  const { x, y } = parsePublicKey(sec1Hex)
  return [encodeOwnerBytes(x, y)]
}

export async function getSmartWalletAddress(
  sec1Hex: string,
  opts: { factoryAddress?: Address; rpcUrl: string; nonce?: bigint },
): Promise<Address> {
  const { rpcUrl, nonce = 0n } = opts
  const factoryAddress = opts.factoryAddress ?? (FACTORY_ADDRESS as Address)
  const owners = buildOwners(sec1Hex)
  const client = createPublicClient({ transport: http(rpcUrl) })
  const address = await client.readContract({
    address: factoryAddress,
    abi: FACTORY_ABI,
    functionName: "getAddress",
    args: [owners, nonce],
  })
  return address
}

export function buildInitCode(
  sec1Hex: string,
  opts?: { factoryAddress?: Address; nonce?: bigint },
): Hex {
  const factoryAddress = opts?.factoryAddress ?? (FACTORY_ADDRESS as Address)
  const nonce = opts?.nonce ?? 0n
  const owners = buildOwners(sec1Hex)
  const callData = encodeFunctionData({
    abi: FACTORY_ABI,
    functionName: "createAccount",
    args: [owners, nonce],
  })
  return concat([factoryAddress, callData])
}

import { type Address, type Hex, defineChain, keccak256, encodeAbiParameters } from "viem"

export const flowEvmMainnet = defineChain({
  id: 747,
  name: "Flow EVM",
  nativeCurrency: { name: "Flow", symbol: "FLOW", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://mainnet.evm.nodes.onflow.org"] },
  },
  blockExplorers: {
    default: { name: "FlowDiver", url: "https://evm.flowdiver.io" },
  },
})

export const flowEvmTestnet = defineChain({
  id: 545,
  name: "Flow EVM Testnet",
  nativeCurrency: { name: "Flow", symbol: "FLOW", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://testnet.evm.nodes.onflow.org"] },
  },
  testnet: true,
})

export const ENTRYPOINT_V07_ADDRESS = "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as const
export const FACTORY_ADDRESS = "0x_PLACEHOLDER_FACTORY" as const

export const FACTORY_ABI = [
  {
    name: "getAddress",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owners", type: "bytes[]" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "createAccount",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "owners", type: "bytes[]" },
      { name: "nonce", type: "uint256" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
] as const

export const SMART_WALLET_ABI = [
  {
    name: "execute",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "executeBatch",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
] as const

export const ENTRYPOINT_ABI = [
  {
    name: "getNonce",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "sender", type: "address" },
      { name: "key", type: "uint192" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const

/**
 * Compute userOpHash client-side per ERC-4337 v0.7 spec.
 */
export function computeUserOpHash(
  userOp: {
    sender: Address
    nonce: Hex
    initCode: Hex
    callData: Hex
    accountGasLimits: Hex
    preVerificationGas: Hex
    gasFees: Hex
    paymasterAndData: Hex
  },
  entryPoint: Address,
  chainId: number,
): Hex {
  const hashInitCode = keccak256(userOp.initCode)
  const hashCallData = keccak256(userOp.callData)
  const hashPaymasterAndData = keccak256(userOp.paymasterAndData)

  const packed = encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint256" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint256" },
      { type: "bytes32" },
      { type: "bytes32" },
    ],
    [
      userOp.sender,
      BigInt(userOp.nonce),
      hashInitCode,
      hashCallData,
      userOp.accountGasLimits as Hex,
      BigInt(userOp.preVerificationGas),
      userOp.gasFees as Hex,
      hashPaymasterAndData,
    ],
  )

  const innerHash = keccak256(packed)

  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
      [innerHash, entryPoint, BigInt(chainId)],
    ),
  )
}

import {
  keccak256,
  encodeAbiParameters,
  concat,
  pad,
  toHex,
  type Hex,
  type Address,
} from "viem"
import { privateKeyToAccount } from "viem/accounts"

const PAYMASTER_ADDRESS: Address = "0x348C96e048A6A01B1bD75b6218b65986717CC15a"
const PAYMASTER_SIGNER_KEY =
  process.env.PAYMASTER_SIGNER_KEY ||
  "0x17d377392e3cc989464bb287984ea61060f1373effdf125de4d09e9b03af200b"
const CHAIN_ID = 545 // Flow-EVM testnet
const PORT = parseInt(process.env.PAYMASTER_PORT || "4338")

const signer = privateKeyToAccount(PAYMASTER_SIGNER_KEY as Hex)

function computePaymasterHash(
  userOp: any,
  validUntil: number,
  validAfter: number,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" }, // sender
        { type: "uint256" }, // nonce
        { type: "bytes32" }, // keccak256(initCode)
        { type: "bytes32" }, // keccak256(callData)
        { type: "bytes32" }, // accountGasLimits
        { type: "uint256" }, // preVerificationGas
        { type: "bytes32" }, // gasFees
        { type: "uint256" }, // chainId
        { type: "address" }, // paymaster address
        { type: "uint48" }, // validUntil
        { type: "uint48" }, // validAfter
      ],
      [
        userOp.sender,
        BigInt(userOp.nonce),
        keccak256(userOp.initCode || "0x"),
        keccak256(userOp.callData || "0x"),
        userOp.accountGasLimits,
        BigInt(userOp.preVerificationGas),
        userOp.gasFees,
        BigInt(CHAIN_ID),
        PAYMASTER_ADDRESS,
        validUntil,
        validAfter,
      ],
    ),
  )
}

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    })
  }

  if (req.method !== "POST") {
    return Response.json({ error: "POST only" }, { status: 405 })
  }

  try {
    const body = await req.json()
    const userOp = body.userOp
    if (!userOp?.sender) {
      return Response.json({ error: "missing userOp" }, { status: 400 })
    }

    // Valid for 10 minutes
    const validAfter = 0
    const validUntil = Math.floor(Date.now() / 1000) + 600

    // Compute hash and sign
    const hash = computePaymasterHash(userOp, validUntil, validAfter)
    const signature = await signer.signMessage({ message: { raw: hash } })

    // Build paymasterAndData
    const paymasterVerificationGas = pad(toHex(100000n), { size: 16 })
    const paymasterPostOpGas = pad(toHex(50000n), { size: 16 })
    const validityData = encodeAbiParameters(
      [{ type: "uint48" }, { type: "uint48" }],
      [validUntil, validAfter],
    )

    const paymasterAndData = concat([
      PAYMASTER_ADDRESS,
      paymasterVerificationGas,
      paymasterPostOpGas,
      validityData,
      signature,
    ])

    return Response.json(
      { paymasterAndData, validUntil, validAfter },
      { headers: { "Access-Control-Allow-Origin": "*" } },
    )
  } catch (e: any) {
    console.error("[paymaster] Error:", e.message)
    return Response.json({ error: e.message }, { status: 500 })
  }
}

const server = Bun.serve({ port: PORT, fetch: handleRequest })
console.log(`[paymaster] Signing service running on port ${PORT}`)
console.log(`[paymaster] Signer: ${signer.address}`)
console.log(`[paymaster] Paymaster: ${PAYMASTER_ADDRESS}`)

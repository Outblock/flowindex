import { type Hex, encodeAbiParameters, toHex } from "viem"

export function derToRS(der: Uint8Array): { r: bigint; s: bigint } {
  let offset = 2
  if (der[offset] !== 0x02) throw new Error("Expected 0x02 tag for r")
  offset++
  const rLen = der[offset]
  offset++
  const rBytes = der.slice(offset, offset + rLen)
  offset += rLen
  if (der[offset] !== 0x02) throw new Error("Expected 0x02 tag for s")
  offset++
  const sLen = der[offset]
  offset++
  const sBytes = der.slice(offset, offset + sLen)

  const toHexStr = (bytes: Uint8Array) =>
    Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("")
  const r = BigInt("0x" + toHexStr(rBytes))
  const s = BigInt("0x" + toHexStr(sBytes))
  return { r, s }
}

export function findChallengeIndex(clientDataJSON: string): number {
  const needle = '"challenge":"'
  const idx = clientDataJSON.indexOf(needle)
  if (idx === -1) throw new Error("challenge not found in clientDataJSON")
  return idx + needle.length
}

export function findTypeIndex(clientDataJSON: string): number {
  const needle = '"type":"'
  const idx = clientDataJSON.indexOf(needle)
  if (idx === -1) throw new Error("type not found in clientDataJSON")
  return idx + needle.length
}

export function encodeWebAuthnSignature(params: {
  ownerIndex: bigint
  authenticatorData: Uint8Array
  clientDataJSON: string
  r: bigint
  s: bigint
}): Hex {
  const { ownerIndex, authenticatorData, clientDataJSON, r, s } = params
  const challengeIndex = BigInt(findChallengeIndex(clientDataJSON))
  const typeIndex = BigInt(findTypeIndex(clientDataJSON))

  const signatureData = encodeAbiParameters(
    [
      { type: "bytes" },
      { type: "string" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    [toHex(authenticatorData), clientDataJSON, challengeIndex, typeIndex, r, s],
  )

  return encodeAbiParameters(
    [{ type: "uint256" }, { type: "bytes" }],
    [ownerIndex, signatureData],
  )
}

export async function signUserOpWithPasskey(
  userOpHash: Hex,
  credentialId: string,
  ownerIndex = 0n,
): Promise<Hex> {
  const challengeBytes = new Uint8Array(
    (userOpHash.slice(2).match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)),
  )

  const base64urlToBytes = (b64url: string): Uint8Array => {
    const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/")
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4)
    return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
  }

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: challengeBytes,
      allowCredentials: [{ id: base64urlToBytes(credentialId), type: "public-key" }],
      userVerification: "preferred",
    },
  })) as PublicKeyCredential

  const response = assertion.response as AuthenticatorAssertionResponse
  const authenticatorData = new Uint8Array(response.authenticatorData)
  const clientDataJSON = new TextDecoder().decode(response.clientDataJSON)
  const signature = new Uint8Array(response.signature)
  const { r, s } = derToRS(signature)

  return encodeWebAuthnSignature({ ownerIndex, authenticatorData, clientDataJSON, r, s })
}

import { describe, it, expect } from "vitest"
import { derToRS, findChallengeIndex, findTypeIndex, encodeWebAuthnSignature } from "../src/signer"

describe("signer", () => {
  describe("derToRS", () => {
    it("extracts r and s from a DER-encoded P-256 signature", () => {
      const r32 = "0000000000000000000000000000000000000000000000000000000000000001"
      const s32 = "0000000000000000000000000000000000000000000000000000000000000002"
      const der = new Uint8Array(
        Array.from(Buffer.from("3044" + "0220" + r32 + "0220" + s32, "hex")),
      )
      const { r, s } = derToRS(der)
      expect(r).toBe(1n)
      expect(s).toBe(2n)
    })
  })

  describe("findChallengeIndex", () => {
    it("finds byte offset of challenge in clientDataJSON", () => {
      const clientDataJSON = '{"type":"webauthn.get","challenge":"dGVzdA","origin":"https://example.com"}'
      const idx = findChallengeIndex(clientDataJSON)
      const expected = clientDataJSON.indexOf('"challenge":"') + '"challenge":"'.length
      expect(idx).toBe(expected)
    })
  })

  describe("findTypeIndex", () => {
    it("finds byte offset of type in clientDataJSON", () => {
      const clientDataJSON = '{"type":"webauthn.get","challenge":"dGVzdA","origin":"https://example.com"}'
      const idx = findTypeIndex(clientDataJSON)
      const expected = clientDataJSON.indexOf('"type":"') + '"type":"'.length
      expect(idx).toBe(expected)
    })
  })

  describe("encodeWebAuthnSignature", () => {
    it("ABI-encodes SignatureWrapper struct", () => {
      const result = encodeWebAuthnSignature({
        ownerIndex: 0n,
        authenticatorData: new Uint8Array([0x01, 0x02]),
        clientDataJSON: '{"type":"webauthn.get","challenge":"dGVzdA"}',
        r: 1n,
        s: 2n,
      })
      expect(result).toMatch(/^0x[0-9a-f]+$/i)
      expect(result.length).toBeGreaterThan(200)
    })
  })
})

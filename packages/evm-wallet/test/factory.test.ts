import { describe, it, expect } from "vitest"
import { encodeOwnerBytes, parsePublicKey } from "../src/factory"

describe("factory", () => {
  const testPubKeyHex =
    "04" +
    "0000000000000000000000000000000000000000000000000000000000000001" +
    "0000000000000000000000000000000000000000000000000000000000000002"

  describe("parsePublicKey", () => {
    it("extracts x and y coordinates from SEC1 hex", () => {
      const { x, y } = parsePublicKey(testPubKeyHex)
      expect(x).toBe(1n)
      expect(y).toBe(2n)
    })

    it("throws on invalid prefix", () => {
      expect(() => parsePublicKey("05" + "00".repeat(64))).toThrow()
    })

    it("throws on wrong length", () => {
      expect(() => parsePublicKey("04" + "00".repeat(10))).toThrow()
    })
  })

  describe("encodeOwnerBytes", () => {
    it("ABI-encodes x,y as two uint256", () => {
      const encoded = encodeOwnerBytes(1n, 2n)
      expect(encoded.length).toBe(2 + 128)
      expect(encoded.slice(2, 66)).toBe("0000000000000000000000000000000000000000000000000000000000000001")
      expect(encoded.slice(66, 130)).toBe("0000000000000000000000000000000000000000000000000000000000000002")
    })
  })
})

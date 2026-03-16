import { describe, it, expect } from "vitest"
import { packGasLimits, packGasFees, buildCallData } from "../src/user-op"

describe("user-op", () => {
  describe("packGasLimits", () => {
    it("packs verificationGasLimit and callGasLimit into bytes32", () => {
      const packed = packGasLimits(100000n, 300000n)
      expect(packed).toMatch(/^0x[0-9a-f]{64}$/i)
    })

    it("places verificationGasLimit in high 128 bits", () => {
      const packed = packGasLimits(1n, 2n)
      // high 16 bytes = 1, low 16 bytes = 2
      expect(packed.slice(2, 34)).toBe("00000000000000000000000000000001")
      expect(packed.slice(34, 66)).toBe("00000000000000000000000000000002")
    })
  })

  describe("packGasFees", () => {
    it("packs maxPriorityFeePerGas and maxFeePerGas into bytes32", () => {
      const packed = packGasFees(0n, 1000000n)
      expect(packed).toMatch(/^0x[0-9a-f]{64}$/i)
    })
  })

  describe("buildCallData", () => {
    it("encodes a single execute call", () => {
      const callData = buildCallData({
        target: "0x1234567890abcdef1234567890abcdef12345678",
        value: 0n,
        data: "0x",
      })
      expect(callData).toMatch(/^0x/)
      expect(callData.length).toBeGreaterThan(10)
    })
  })
})

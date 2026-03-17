import { describe, it, expect, vi, beforeEach } from "vitest"
import { createBundlerClient } from "../src/bundler-client"

const mockFetch = vi.fn()
vi.stubGlobal("fetch", mockFetch)

describe("bundler-client", () => {
  let client: ReturnType<typeof createBundlerClient>

  beforeEach(() => {
    client = createBundlerClient("http://localhost:4337")
    mockFetch.mockReset()
  })

  it("sends eth_sendUserOperation with correct params", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: "0xhash123" }),
    })
    const result = await client.sendUserOperation(
      { sender: "0xabc" } as any,
      "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    )
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.method).toBe("eth_sendUserOperation")
    expect(result).toBe("0xhash123")
  })

  it("sends eth_estimateUserOperationGas", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0", id: 1,
        result: { preVerificationGas: "0xc350", verificationGasLimit: "0x186a0", callGasLimit: "0x493e0" },
      }),
    })
    const result = await client.estimateUserOperationGas(
      { sender: "0xabc" } as any,
      "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    )
    expect(result.preVerificationGas).toBe("0xc350")
  })

  it("throws on JSON-RPC error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0", id: 1,
        error: { code: -32000, message: "AA21 account not deployed" },
      }),
    })
    await expect(client.sendUserOperation({} as any, "0x123")).rejects.toThrow("AA21 account not deployed")
  })
})

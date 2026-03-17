/**
 * FlowIndex Wallet EIP-1193 Provider
 *
 * Opens the wallet in a popup, communicates via postMessage.
 * The popup handles passkey auth and ERC-4337 UserOp submission.
 */

export interface FlowIndexProviderConfig {
  /** URL of the wallet popup endpoint. Default: https://wallet.flowindex.io/connect/popup */
  walletUrl?: string
  /** Popup window features */
  popupFeatures?: string
}

type EventName = "accountsChanged" | "chainChanged" | "connect" | "disconnect"
type Handler = (...args: any[]) => void

interface PendingRequest {
  resolve: (value: any) => void
  reject: (error: any) => void
}

export function createFlowIndexProvider(config: FlowIndexProviderConfig = {}) {
  const {
    walletUrl = "http://localhost:5174/connect/popup",
    popupFeatures = "width=420,height=640,left=100,top=100,scrollbars=yes",
  } = config

  let popup: Window | null = null
  let connectedAddress: string | null = null
  let chainId: number | null = null
  let requestId = 0
  const pending = new Map<number, PendingRequest>()
  const listeners = new Map<EventName, Set<Handler>>()

  function emit(event: EventName, ...args: any[]) {
    listeners.get(event)?.forEach((fn) => fn(...args))
  }

  // Listen for messages from the popup
  function onMessage(event: MessageEvent) {
    const { data } = event
    if (!data?.type?.startsWith("flowindex_")) return

    if (data.type === "flowindex_connected") {
      connectedAddress = data.address
      chainId = data.chainId
      emit("connect", { chainId: `0x${chainId!.toString(16)}` })
      emit("accountsChanged", [connectedAddress])
    }

    if (data.type === "flowindex_disconnected") {
      connectedAddress = null
      chainId = null
      emit("disconnect", { code: 4900, message: "Disconnected" })
      emit("accountsChanged", [])
    }

    if (data.type === "flowindex_rpc_response") {
      const req = pending.get(data.id)
      if (!req) return
      pending.delete(data.id)
      if (data.error) {
        req.reject(data.error)
      } else {
        req.resolve(data.result)
      }
    }
  }

  if (typeof window !== "undefined") {
    window.addEventListener("message", onMessage)
  }

  function openPopup(): Window {
    if (popup && !popup.closed) return popup
    popup = window.open(walletUrl, "flowindex-wallet", popupFeatures)
    if (!popup) throw new Error("Popup blocked. Please allow popups for this site.")
    return popup
  }

  function sendRequest(method: string, params?: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!popup || popup.closed) {
        reject(new Error("Wallet popup is closed"))
        return
      }
      const id = ++requestId
      pending.set(id, { resolve, reject })
      popup.postMessage({ type: "flowindex_rpc_request", id, method, params: params ?? [] }, "*")
    })
  }

  const provider = {
    isFlowIndex: true,
    isMetaMask: false,

    async request({ method, params }: { method: string; params?: any[] }): Promise<any> {
      // eth_requestAccounts — open popup if not connected
      if (method === "eth_requestAccounts") {
        if (connectedAddress) return [connectedAddress]

        openPopup()

        // Wait for the connected message
        return new Promise<string[]>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Connection timed out"))
          }, 120_000) // 2 min timeout

          const handler = (event: MessageEvent) => {
            if (event.data?.type === "flowindex_connected") {
              clearTimeout(timeout)
              window.removeEventListener("message", handler)
              resolve([event.data.address])
            }
            if (event.data?.type === "flowindex_disconnected") {
              clearTimeout(timeout)
              window.removeEventListener("message", handler)
              reject(new Error("User rejected connection"))
            }
          }
          window.addEventListener("message", handler)
        })
      }

      if (method === "eth_accounts") {
        return connectedAddress ? [connectedAddress] : []
      }

      if (method === "eth_chainId") {
        return chainId ? `0x${chainId.toString(16)}` : "0x221" // 545
      }

      // All other methods — proxy to popup
      if (!popup || popup.closed) {
        throw new Error("Wallet not connected")
      }
      return sendRequest(method, params)
    },

    on(event: EventName, handler: Handler) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(handler)
    },

    removeListener(event: EventName, handler: Handler) {
      listeners.get(event)?.delete(handler)
    },

    disconnect() {
      connectedAddress = null
      chainId = null
      if (popup && !popup.closed) popup.close()
      popup = null
      emit("disconnect", { code: 4900, message: "Disconnected" })
      emit("accountsChanged", [])
    },
  }

  return provider
}

export type FlowIndexProvider = ReturnType<typeof createFlowIndexProvider>

/**
 * Injected into every page. Provides EIP-1193 provider + EIP-6963 announcement.
 * Communicates with content-script via window.postMessage.
 */
(function () {
  "use strict";

  if (window.__flowIndexInjected) return;
  window.__flowIndexInjected = true;

  const CHAIN_ID = 545; // Flow-EVM testnet
  let connectedAddress = null;
  let requestId = 0;
  const pending = new Map();
  const listeners = new Map();

  function emit(event, ...args) {
    const set = listeners.get(event);
    if (set) set.forEach((fn) => fn(...args));
  }

  // Listen for responses from content-script
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const { data } = event;
    if (!data || data.target !== "flowindex-inpage") return;

    if (data.type === "rpc_response") {
      const req = pending.get(data.id);
      if (!req) return;
      pending.delete(data.id);
      if (data.error) {
        req.reject(new Error(data.error.message || "RPC error"));
      } else {
        req.resolve(data.result);
      }
    }

    if (data.type === "connected") {
      connectedAddress = data.address;
      emit("connect", { chainId: "0x" + CHAIN_ID.toString(16) });
      emit("accountsChanged", [connectedAddress]);
    }

    if (data.type === "disconnected") {
      connectedAddress = null;
      emit("disconnect", { code: 4900, message: "Disconnected" });
      emit("accountsChanged", []);
    }

    if (data.type === "chainChanged") {
      emit("chainChanged", "0x" + (data.chainId || CHAIN_ID).toString(16));
    }
  });

  function sendRpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      pending.set(id, { resolve, reject });
      window.postMessage(
        {
          target: "flowindex-content-script",
          type: "rpc_request",
          id,
          method,
          params: params || [],
        },
        "*"
      );

      // Timeout after 5 minutes (long for passkey interaction)
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error("Request timed out"));
        }
      }, 300000);
    });
  }

  const provider = {
    isFlowIndex: true,
    isMetaMask: false,

    async request({ method, params }) {
      if (method === "eth_accounts") {
        return connectedAddress ? [connectedAddress] : [];
      }
      if (method === "eth_chainId") {
        return "0x" + CHAIN_ID.toString(16);
      }
      // Everything else goes through the extension
      return sendRpc(method, params);
    },

    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
    },

    removeListener(event, handler) {
      const set = listeners.get(event);
      if (set) set.delete(handler);
    },

    // Legacy
    enable() {
      return this.request({ method: "eth_requestAccounts" });
    },
  };

  // Expose as window.flowindex (don't override window.ethereum if another wallet exists)
  window.flowindex = provider;

  // Also set as window.ethereum if no other wallet claimed it
  if (!window.ethereum) {
    window.ethereum = provider;
  }

  // EIP-6963: Announce provider so RainbowKit/wagmi auto-discover it
  const info = {
    uuid: "flowindex-wallet-extension",
    name: "FlowIndex Wallet",
    icon: "data:image/svg+xml," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="8" fill="#00EF8B"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-family="monospace" font-size="14" font-weight="bold" fill="#000">FI</text></svg>'
    ),
    rdns: "io.flowindex.wallet",
  };

  function announce() {
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({ info, provider }),
      })
    );
  }

  announce();
  window.addEventListener("eip6963:requestProvider", announce);
})();

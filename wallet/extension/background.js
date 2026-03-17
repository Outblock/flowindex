/**
 * Background service worker.
 *
 * Routes RPC requests to the wallet popup and relays responses back.
 * Opens the wallet popup when eth_requestAccounts is called.
 */

const WALLET_URL = "http://localhost:5174/connect/popup";
// For production: "https://wallet.flowindex.io/connect/popup"

let walletPopupId = null;
let connectedAddress = null;
let connectedChainId = null;

// Pending RPC requests waiting for popup responses
const pendingRequests = new Map();
let nextId = 0;

// Track which tabs have content scripts
const activeTabs = new Set();

// Open (or focus) the wallet popup
async function openWalletPopup(action) {
  // Check if existing popup is still open
  if (walletPopupId !== null) {
    try {
      const existing = await chrome.windows.get(walletPopupId);
      if (existing) {
        await chrome.windows.update(walletPopupId, { focused: true });
        return;
      }
    } catch {
      walletPopupId = null;
    }
  }

  const url = action ? `${WALLET_URL}?action=${action}` : WALLET_URL;
  const popup = await chrome.windows.create({
    url,
    type: "popup",
    width: 420,
    height: 640,
    left: 100,
    top: 100,
  });
  walletPopupId = popup.id;
}

// Broadcast a message to all tabs with content scripts
function broadcastToTabs(message) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, message).catch(() => {
        // Tab might not have content script
      });
    }
  });
}

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "rpc_request") {
    handleRpcRequest(message, sender).then(sendResponse).catch((err) => {
      sendResponse({
        type: "rpc_response",
        id: message.id,
        error: { code: -32603, message: err.message },
      });
    });
    return true; // async response
  }

  // Messages from wallet popup (connected/disconnected/rpc_response)
  if (message.type === "wallet_connected") {
    connectedAddress = message.address;
    connectedChainId = message.chainId;
    // Save to storage for persistence
    chrome.storage.local.set({ connectedAddress, connectedChainId });
    // Broadcast to all tabs
    broadcastToTabs({
      target: "flowindex-inpage",
      type: "connected",
      address: connectedAddress,
      chainId: connectedChainId,
    });
    return;
  }

  if (message.type === "wallet_disconnected") {
    connectedAddress = null;
    connectedChainId = null;
    chrome.storage.local.remove(["connectedAddress", "connectedChainId"]);
    broadcastToTabs({
      target: "flowindex-inpage",
      type: "disconnected",
    });
    return;
  }

  if (message.type === "wallet_rpc_response") {
    const req = pendingRequests.get(message.id);
    if (req) {
      pendingRequests.delete(message.id);
      req.resolve({
        type: "rpc_response",
        id: message.requestId,
        result: message.result,
        error: message.error,
      });
    }
    return;
  }
});

async function handleRpcRequest(message, sender) {
  const { method, params, id } = message;

  // eth_requestAccounts — need to open popup
  if (method === "eth_requestAccounts") {
    if (connectedAddress) {
      return {
        type: "rpc_response",
        id,
        result: [connectedAddress],
      };
    }

    // Open popup and wait for connection
    await openWalletPopup();

    return new Promise((resolve) => {
      // Wait for wallet_connected message
      const timeout = setTimeout(() => {
        resolve({
          type: "rpc_response",
          id,
          error: { code: 4001, message: "User rejected request" },
        });
      }, 120000);

      const handler = (msg) => {
        if (msg.type === "wallet_connected") {
          clearTimeout(timeout);
          chrome.runtime.onMessage.removeListener(handler);
          resolve({
            type: "rpc_response",
            id,
            result: [msg.address],
          });
        }
        if (msg.type === "wallet_disconnected") {
          clearTimeout(timeout);
          chrome.runtime.onMessage.removeListener(handler);
          resolve({
            type: "rpc_response",
            id,
            error: { code: 4001, message: "User rejected" },
          });
        }
      };
      chrome.runtime.onMessage.addListener(handler);
    });
  }

  // eth_accounts — return cached
  if (method === "eth_accounts") {
    return {
      type: "rpc_response",
      id,
      result: connectedAddress ? [connectedAddress] : [],
    };
  }

  // eth_chainId — return cached
  if (method === "eth_chainId") {
    return {
      type: "rpc_response",
      id,
      result: "0x" + (connectedChainId || 545).toString(16),
    };
  }

  // All other methods — proxy to wallet popup
  if (!connectedAddress) {
    return {
      type: "rpc_response",
      id,
      error: { code: 4100, message: "Not connected. Call eth_requestAccounts first." },
    };
  }

  // Make sure popup is open — use signing action so popup auto-connects
  await openWalletPopup("sign");

  // Send RPC request to popup via injected postMessage
  const internalId = ++nextId;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(internalId);
      resolve({
        type: "rpc_response",
        id,
        error: { code: -32603, message: "Request timed out" },
      });
    }, 300000);

    pendingRequests.set(internalId, {
      resolve: (response) => {
        clearTimeout(timeout);
        resolve({ ...response, id });
      },
    });

    // Send to the wallet popup tab
    if (walletPopupId !== null) {
      chrome.windows.get(walletPopupId, { populate: true }, (win) => {
        if (chrome.runtime.lastError || !win || !win.tabs || !win.tabs[0]) {
          pendingRequests.delete(internalId);
          clearTimeout(timeout);
          resolve({
            type: "rpc_response",
            id,
            error: { code: -32603, message: "Wallet popup not available" },
          });
          return;
        }
        chrome.tabs.sendMessage(win.tabs[0].id, {
          target: "flowindex-popup",
          type: "rpc_request",
          id: internalId,
          requestId: id,
          method,
          params,
        }).catch(() => {
          pendingRequests.delete(internalId);
          clearTimeout(timeout);
          resolve({
            type: "rpc_response",
            id,
            error: { code: -32603, message: "Failed to reach wallet popup" },
          });
        });
      });
    }
  });
}

// Restore state on startup
chrome.storage.local.get(["connectedAddress", "connectedChainId"], (data) => {
  if (data.connectedAddress) {
    connectedAddress = data.connectedAddress;
    connectedChainId = data.connectedChainId;
  }
});

// Clean up when popup window closes
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === walletPopupId) {
    walletPopupId = null;
  }
});

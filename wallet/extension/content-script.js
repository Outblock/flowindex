/**
 * Content script — bridge between inpage.js (page context) and background.js (extension context).
 *
 * Injects inpage.js into the page and relays messages bidirectionally.
 */

// Inject inpage.js into the page context
const script = document.createElement("script");
script.src = chrome.runtime.getURL("inpage.js");
script.setAttribute("data-flowindex-extension", chrome.runtime.id);
(document.head || document.documentElement).appendChild(script);
script.onload = () => script.remove();

// Page → Content Script → Background
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const { data } = event;
  if (!data || data.target !== "flowindex-content-script") return;

  // Forward to background service worker
  chrome.runtime.sendMessage(data).then((response) => {
    if (response) {
      window.postMessage({ ...response, target: "flowindex-inpage" }, "*");
    }
  }).catch((err) => {
    // If background isn't ready yet, send error back
    if (data.type === "rpc_request") {
      window.postMessage({
        target: "flowindex-inpage",
        type: "rpc_response",
        id: data.id,
        error: { code: -32603, message: err.message || "Extension not ready" },
      }, "*");
    }
  });
});

// Background → Content Script → Page (for push events like connected/disconnected)
chrome.runtime.onMessage.addListener((message) => {
  if (message.target === "flowindex-inpage") {
    window.postMessage(message, "*");
  }
});

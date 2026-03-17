/**
 * Extension toolbar popup script.
 * Shows connection status and lets user connect/disconnect.
 */

const WALLET_URL = "http://localhost:5174/connect/popup";

const statusEl = document.getElementById("status");
const addressSection = document.getElementById("address-section");
const addressEl = document.getElementById("address");
const connectBtn = document.getElementById("connect-btn");
const disconnectBtn = document.getElementById("disconnect-btn");

function updateUI(address) {
  if (address) {
    statusEl.textContent = "Connected";
    statusEl.className = "status-value connected";
    addressSection.style.display = "block";
    addressEl.textContent = address;
    connectBtn.style.display = "none";
    disconnectBtn.style.display = "block";
  } else {
    statusEl.textContent = "Not connected";
    statusEl.className = "status-value disconnected";
    addressSection.style.display = "none";
    addressEl.textContent = "";
    connectBtn.style.display = "block";
    disconnectBtn.style.display = "none";
  }
}

// Load state
chrome.storage.local.get(["connectedAddress"], (data) => {
  updateUI(data.connectedAddress || null);
});

// Connect button — open wallet popup
connectBtn.addEventListener("click", () => {
  chrome.windows.create({
    url: WALLET_URL,
    type: "popup",
    width: 420,
    height: 640,
    left: 100,
    top: 100,
  });
  window.close();
});

// Disconnect button
disconnectBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "wallet_disconnected" });
  chrome.storage.local.remove(["connectedAddress", "connectedChainId"]);
  updateUI(null);
});

// Listen for state changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.connectedAddress) {
    updateUI(changes.connectedAddress.newValue || null);
  }
});

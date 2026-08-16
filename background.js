// Applies the user's preferred UI mode (popup vs. sidebar) to the toolbar button.
// A non-empty action popup always wins over openPanelOnActionClick, so the
// popup must be cleared when sidebar mode is active.
const DEFAULT_MODE = "popup";

async function applyMode(mode) {
  if (mode === "sidebar") {
    await chrome.action.setPopup({ popup: "" });
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } else {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
    await chrome.action.setPopup({ popup: "popup/popup.html" });
  }
}

async function init() {
  const { mode } = await chrome.storage.sync.get({ mode: DEFAULT_MODE });
  await applyMode(mode);
}

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.mode) {
    applyMode(changes.mode.newValue || DEFAULT_MODE);
  }
});

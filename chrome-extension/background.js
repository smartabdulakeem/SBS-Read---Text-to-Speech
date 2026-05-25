// Create context menu on installation
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "read-selection",
    title: "Read Selection Aloud",
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: "read-page",
    title: "Read Whole Article Aloud",
    contexts: ["page"]
  });
});

// Try to message the content script; if it isn't injected yet
// (tab existed before extension was loaded, or just-opened tab),
// inject it on demand then retry.
async function sendToTab(tabId, payload) {
  try {
    await chrome.tabs.sendMessage(tabId, payload);
  } catch (e) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"]
      });
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["content.css"]
      });
      await chrome.tabs.sendMessage(tabId, payload);
    } catch (err) {
      // Restricted URL (chrome://, web store, PDF viewer, etc.)
      console.warn("VoxRead: cannot inject into this tab:", err.message);
    }
  }
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;

  if (info.menuItemId === "read-selection") {
    sendToTab(tab.id, {
      action: "read-text",
      text: info.selectionText
    });
  } else if (info.menuItemId === "read-page") {
    sendToTab(tab.id, { action: "read-article" });
  }
});

async function sendToActiveTab(payload) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return false;

  try {
    await chrome.tabs.sendMessage(tab.id, payload);
    return true;
  } catch (e) {
    // Content script not in this tab yet — inject and retry.
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["content.css"]
      });
      await chrome.tabs.sendMessage(tab.id, payload);
      return true;
    } catch (err) {
      alert("VoxRead AI cannot run on this page (chrome://, web store, or PDF viewer). Try a regular web page.");
      return false;
    }
  }
}

document.getElementById('btn-read-page').addEventListener('click', async () => {
  if (await sendToActiveTab({ action: "read-article" })) window.close();
});

document.getElementById('btn-read-selection').addEventListener('click', async () => {
  // Empty text = content.js will fall back to window.getSelection()
  if (await sendToActiveTab({ action: "read-text", text: "" })) window.close();
});

document.getElementById('btn-read-custom').addEventListener('click', async () => {
  const text = document.getElementById('custom-text').value.trim();
  if (!text) {
    alert("Please enter some text to speak.");
    return;
  }
  if (await sendToActiveTab({ action: "read-text", text })) window.close();
});

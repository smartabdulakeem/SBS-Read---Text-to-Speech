const { contextBridge, ipcRenderer } = require('electron');

// Forward "speak this text" messages from the main process (global hotkey →
// copied selection) into a DOM event the React app listens for.
ipcRenderer.on('speak-text', (_event, text) => {
  window.dispatchEvent(new CustomEvent('voxreadSpeak', { detail: text }));
});

// Small marker so the web app can tell it's running inside the desktop shell.
contextBridge.exposeInMainWorld('voxreadDesktop', {
  isDesktop: true,
  synthesizeSpeech: (text, speed, modelName) => ipcRenderer.invoke('piper-synthesize', text, speed, modelName),
  stopSpeech: () => ipcRenderer.invoke('piper-stop')
});

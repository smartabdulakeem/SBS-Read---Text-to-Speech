const {
  app, BrowserWindow, Menu, Tray, globalShortcut, clipboard, ipcMain, nativeImage,
} = require('electron');
const path = require('path');
const { exec, spawn } = require('child_process');
const fs = require('fs');

let mainWindow;
let tray;
const READ_HOTKEY = 'CommandOrControl+Shift+R';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

const piperDir = isDev
  ? path.join(__dirname, 'resources/piper')
  : path.join(process.resourcesPath, 'piper');
const piperExe = path.join(piperDir, 'piper.exe');
const piperModel = path.join(piperDir, 'en_US-amy-medium.onnx');

let activePiperProcess = null;
let tempFiles = [];

function iconPath() {
  // public/ is copied to dist/ at build time.
  return isDev
    ? path.join(__dirname, 'public/icon-192.png')
    : path.join(__dirname, 'dist/icon-192.png');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'VoxRead AI',
    backgroundColor: '#0b071e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'electron-preload.cjs'),
    },
  });

  Menu.setApplicationMenu(null);

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  // Keep the app alive in the tray instead of quitting on window close.
  mainWindow.on('close', (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// Copy the current selection from whatever app is focused (we never take focus
// from a global shortcut), then return the clipboard text.
function copySelection() {
  return new Promise((resolve) => {
    const tempVbs = path.join(app.getPath('temp'), 'voxread_copy.vbs');
    if (!fs.existsSync(tempVbs)) {
      try {
        fs.writeFileSync(tempVbs, 'Set WshShell = CreateObject("WScript.Shell")\nWshShell.SendKeys "^c"\n', 'utf-8');
      } catch (err) {
        // Fallback to powershell if writing fails
        const ps =
          'powershell -NoProfile -WindowStyle Hidden -Command ' +
          '"Add-Type -AssemblyName System.Windows.Forms; ' +
          "[System.Windows.Forms.SendKeys]::SendWait('^c')\"";
        exec(ps, () => setTimeout(resolve, 300));
        return;
      }
    }
    // Execute VBScript using wscript.exe (starts instantly)
    exec(`wscript.exe //B "${tempVbs}"`, (err) => {
      if (err) {
        // Fallback to powershell if execution fails
        const ps =
          'powershell -NoProfile -WindowStyle Hidden -Command ' +
          '"Add-Type -AssemblyName System.Windows.Forms; ' +
          "[System.Windows.Forms.SendKeys]::SendWait('^c')\"";
        exec(ps, () => setTimeout(resolve, 300));
      } else {
        setTimeout(resolve, 150);
      }
    });
  });
}

async function readSelectionAloud() {
  const before = clipboard.readText();
  clipboard.clear(); // Clear so we know if a new copy succeeds
  await copySelection();
  const text = clipboard.readText();
  if (text && text.trim() && text !== ' ') {
    showMainWindow();
    // give the window a tick to be ready before sending
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('speak-text', text);
      }
    }, 150);
  } else {
    // If nothing was copied, restore previous clipboard contents
    if (before) {
      clipboard.writeText(before);
    }
  }
}

function createTray() {
  let img = nativeImage.createFromPath(iconPath());
  if (!img.isEmpty()) img = img.resize({ width: 16, height: 16 });
  tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  tray.setToolTip('VoxRead AI');
  const menu = Menu.buildFromTemplate([
    { label: `Read selection (${READ_HOTKEY})`, click: () => readSelectionAloud() },
    { label: 'Show VoxRead', click: () => showMainWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => showMainWindow());
}

app.on('ready', () => {
  createWindow();
  createTray();
  globalShortcut.register(READ_HOTKEY, () => { readSelectionAloud(); });
  // Allow the renderer to trigger a read too.
  ipcMain.handle('read-selection', () => readSelectionAloud());

  // Piper neural TTS generation handler
  ipcMain.handle('piper-synthesize', async (event, text, rate, modelName) => {
    if (activePiperProcess) {
      try {
        activePiperProcess.kill();
      } catch (e) {}
      activePiperProcess = null;
    }

    return new Promise((resolve, reject) => {
      try {
        const tempWav = path.join(app.getPath('temp'), `voxread_${Date.now()}.wav`);
        const lengthScale = 1.0 / (rate || 1.0);

        const selectedModel = modelName || 'en_US-amy-medium.onnx';
        const targetModelPath = path.join(piperDir, selectedModel);
        const activeModelPath = fs.existsSync(targetModelPath) ? targetModelPath : piperModel;

        const args = [
          '--model', activeModelPath,
          '--output_file', tempWav,
          '--length_scale', lengthScale.toFixed(2)
        ];

        activePiperProcess = spawn(piperExe, args, { cwd: piperDir });
        tempFiles.push(tempWav);

        activePiperProcess.stdin.write(text, 'utf-8');
        activePiperProcess.stdin.end();

        activePiperProcess.on('close', (code) => {
          activePiperProcess = null;
          if (code === 0) {
            resolve(`file://${tempWav.replace(/\\/g, '/')}`);
          } else {
            reject(new Error(`Piper exited with code ${code}`));
          }
        });

        activePiperProcess.on('error', (err) => {
          activePiperProcess = null;
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  });

  // Stop Piper speech
  ipcMain.handle('piper-stop', () => {
    if (activePiperProcess) {
      try {
        activePiperProcess.kill();
      } catch (e) {}
      activePiperProcess = null;
    }
    return true;
  });
});

app.on('window-all-closed', () => {
  // Stay in the tray; do not quit on Windows/Linux.
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();

  // Clean up temporary WAV files
  tempFiles.forEach(file => {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (e) {
      console.error('Failed to delete temp file:', file, e);
    }
  });
});


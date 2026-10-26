// electron/main.cjs - Electron Main Process for AniFlix Desktop
const { app, BrowserWindow, shell, session, Menu, MenuItem, Notification, ipcMain } = require('electron');
const path = require('path');
const http = require('http');

const fs = require('fs');

// Read saved user settings to apply optimal GPU acceleration & Super Resolution flags
let appSettings = {
  gpuProfile: 'igpu',
  enableUpscale: false,
  uiScale: 1.0
};

try {
  const userDataDir = app.getPath('userData');
  process.env.ANIFLIX_USER_DATA = userDataDir;
  // All server-side persistence (SQLite DB, user profiles, media/subtitle cache) must live
  // in the writable userData folder. Without this the packaged app resolved paths against
  // the install directory / read-only asar, so user sync failed and every replay missed
  // the cache.
  if (!process.env.ANIFLIX_DATA_DIR) {
    process.env.ANIFLIX_DATA_DIR = userDataDir;
  }
  const settingsPath = path.join(userDataDir, 'settings.json');
  const fallbackPath = path.join(__dirname, '..', 'server', 'data', 'settings.json');

  if (fs.existsSync(settingsPath)) {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    appSettings = { ...appSettings, ...JSON.parse(raw) };
  } else if (fs.existsSync(fallbackPath)) {
    const raw = fs.readFileSync(fallbackPath, 'utf8');
    appSettings = { ...appSettings, ...JSON.parse(raw) };
  }
} catch (e) {
  console.warn('Could not read settings.json in main process:', e.message);
}

// Configure GPU Acceleration Flags
if (appSettings.gpuProfile === 'software') {
  // Pure CPU Compatibility Mode
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
} else {
  // Hardware Acceleration (Intel QuickSync / Direct3D 11)
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-accelerated-video-decode');
  // DirectComposition overlays pass decoded video frames straight to DWM overlay planes without 3D shaders
  app.commandLine.appendSwitch('enable-direct-composition-video-overlays');

  const enabledFeatures = ['PlatformHEVCDecoderSupport'];
  const disabledFeatures = [];

  // If Upscaling is disabled (recommended for iGPUs like Intel Iris Xe / Arc to prevent 98% 3D spike):
  if (!appSettings.enableUpscale) {
    disabledFeatures.push('IntelVpSuperResolution', 'IntelVideoSuperResolution', 'VpSuperResolution');
  }

  if (enabledFeatures.length > 0) {
    app.commandLine.appendSwitch('enable-features', enabledFeatures.join(','));
  }
  if (disabledFeatures.length > 0) {
    app.commandLine.appendSwitch('disable-features', disabledFeatures.join(','));
  }
}

// Ensure Scoop shims are in PATH dynamically so yt-dlp, aria2c, and mpv work seamlessly
const os = require('os');
const scoopShims = path.join(os.homedir(), 'scoop', 'shims');
if (fs.existsSync(scoopShims)) {
  process.env.PATH = `${scoopShims};${process.env.PATH}`;
}

// Windows uses the AppUserModelID for taskbar grouping and toast attribution.
// Without it the window groups under "Electron" and toasts may be silently dropped.
const APP_ID = 'com.aniflix.desktop';
app.setName('AniFlix');
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID);
}

const PORT = 3001;
let mainWindow = null;

// UI Zoom Scale persistence helper
function saveZoomSetting(scale) {
  try {
    appSettings.uiScale = scale;
    const userDataDir = process.env.ANIFLIX_USER_DATA || app.getPath('userData');
    const settingsPath = path.join(userDataDir, 'settings.json');
    let current = {};
    if (fs.existsSync(settingsPath)) {
      try { current = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {}
    }
    current.uiScale = scale;
    fs.writeFileSync(settingsPath, JSON.stringify(current, null, 2), 'utf8');
  } catch (err) {
    console.warn('Failed to persist uiScale in settings.json:', err.message);
  }
}

// Native notification IPC (renderer -> main)
ipcMain.handle('desktop:notifications-supported', () => Notification.isSupported());

// UI Scale & Zoom IPC (renderer <-> main)
ipcMain.handle('desktop:get-zoom-factor', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow.webContents.getZoomFactor();
  }
  return Number(appSettings.uiScale) || 1.0;
});

ipcMain.handle('desktop:set-zoom-factor', (_event, factor) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const f = Math.max(0.6, Math.min(2.0, Math.round((Number(factor) || 1.0) * 100) / 100));
    mainWindow.webContents.setZoomFactor(f);
    saveZoomSetting(f);
    mainWindow.webContents.send('desktop:zoom-changed', f);
    return f;
  }
  return 1.0;
});

ipcMain.handle('desktop:notify', (_event, payload = {}) => {
  try {
    if (!Notification.isSupported()) return false;
    const notification = new Notification({
      title: String(payload.title || 'AniFlix'),
      body: String(payload.body || ''),
      icon: payload.icon || path.join(__dirname, '..', 'build', 'icon.png'),
      silent: false
    });

    notification.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('desktop:notification-clicked', {
          animeId: payload.animeId || null,
          episode: payload.episode || null
        });
      }
    });

    notification.show();
    return true;
  } catch (err) {
    console.warn('Failed to show native notification:', err.message);
    return false;
  }
});

// Start embedded Express server
async function startServer() {
  const isPortOpen = await checkServerRunning(PORT);
  if (isPortOpen) {
    console.log(`AniFlix backend already active on port ${PORT}`);
    return;
  }

  try {
    const serverEntry = path.join(__dirname, '..', 'server', 'index.js');
    const serverUrl = `file://${serverEntry.replace(/\\/g, '/')}`;
    await import(serverUrl);
    console.log(`AniFlix backend initialized on port ${PORT}`);
  } catch (err) {
    console.error('Failed to import backend server:', err);
  }
}

// Check if server is answering HTTP requests
function checkServerRunning(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/settings`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

// Wait until server is ready
async function waitForServer(port, maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    const isUp = await checkServerRunning(port);
    if (isUp) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Server did not respond on port ${port}`);
}

async function createWindow() {
  // Windows/Linux accept .ico for crisp title-bar + taskbar rendering; macOS uses .png.
  const windowIcon = process.platform === 'win32'
    ? path.join(__dirname, '..', 'build', 'icon.ico')
    : path.join(__dirname, '..', 'build', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1024,
    minHeight: 650,
    title: 'AniFlix',
    icon: windowIcon,
    backgroundColor: '#141414',
    show: false, // Show once ready-to-show to prevent white flash
    // Integrated title bar: web content extends into the title bar area, native window
    // buttons (and Windows 11 Snap Layouts) stay available as an overlay.
    ...(process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden',
          titleBarOverlay: {
            color: '#12111a',
            symbolColor: '#cbd5e1',
            height: 34
          }
        }
      : process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 12 } }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false // allow streaming m3u8 playlists without CORS issues
    }
  });

  mainWindow.setMenuBarVisibility(false);

  // If remote server URL is configured (e.g. NAS Docker Server), load that; otherwise load local server
  const targetUrl = process.env.ANIFLIX_SERVER_URL || `http://localhost:${PORT}`;
  console.log(`Loading AniFlix interface from: ${targetUrl}`);
  await mainWindow.loadURL(targetUrl);

  mainWindow.once('ready-to-show', () => {
    if (appSettings.uiScale && typeof appSettings.uiScale === 'number' && appSettings.uiScale > 0) {
      mainWindow.webContents.setZoomFactor(appSettings.uiScale);
    }
    mainWindow.show();
  });

  // Open external links (like github) in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      if (!url.includes('localhost:')) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
    }
    return { action: 'allow' };
  });

  // Handle F12 and Ctrl+Shift+I to toggle DevTools Log Console
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown') {
      if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
        mainWindow.webContents.toggleDevTools();
        event.preventDefault();
        return;
      }
      // UI scale: Ctrl +/-/0 (menu bar is hidden, so wire the shortcuts manually).
      if ((input.control || input.meta) && !input.alt) {
        const wc = mainWindow.webContents;
        const cur = wc.getZoomFactor();
        let next = null;
        if (input.key === '+' || input.key === '=') next = Math.min(2, cur + 0.1);
        else if (input.key === '-' || input.key === '_') next = Math.max(0.6, cur - 0.1);
        else if (input.key === '0') next = 1;
        if (next !== null) {
          const factor = Math.round(next * 100) / 100;
          wc.setZoomFactor(factor);
          saveZoomSetting(factor);
          wc.send('desktop:zoom-changed', factor);
          event.preventDefault();
        }
      }
    }
  });

  // Global helper for backend API to toggle DevTools
  global.__openDevTools = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.toggleDevTools();
      return true;
    }
    return false;
  };

  // Global helper for backend API to open native folder selection dialog
  global.__selectFolder = async (defaultPath) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const { dialog } = require('electron');
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '選擇下載目的地目錄 (Select Download Directory)',
        defaultPath: defaultPath || app.getPath('downloads'),
        properties: ['openDirectory', 'createDirectory']
      });
      if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
        return result.filePaths[0];
      }
    }
    return null;
  };

  // Native Right-Click Mouse Context Menu (Cut, Copy, Paste, DevTools)
  mainWindow.webContents.on('context-menu', (event, params) => {
    const menu = new Menu();
    if (params.isEditable) {
      menu.append(new MenuItem({ label: 'Undo', role: 'undo' }));
      menu.append(new MenuItem({ label: 'Redo', role: 'redo' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ label: 'Cut', role: 'cut' }));
      menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
      menu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
      menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));
      menu.append(new MenuItem({ type: 'separator' }));
    } else if (params.selectionText && params.selectionText.trim().length > 0) {
      menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
      menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));
      menu.append(new MenuItem({ type: 'separator' }));
    }

    menu.append(new MenuItem({
      label: '開啟開發人員主控台 (Inspect / DevTools)',
      accelerator: 'F12',
      click: () => mainWindow.webContents.toggleDevTools()
    }));

    menu.popup({ window: mainWindow });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    // Intercept media headers to guarantee correct Referer on protected anime CDN domains
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const url = details.url.toLowerCase();
      if (url.includes('dramahot.top') || url.includes('drama1.cfd') || url.includes('zokoanime')) {
        details.requestHeaders['Referer'] = 'https://zokoanime.video/';
        details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
      }
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    });

    await startServer();
    await waitForServer(PORT);
    await createWindow();
  } catch (err) {
    console.error('Application failed to initialize:', err);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

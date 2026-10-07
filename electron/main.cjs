// electron/main.cjs - Electron Main Process for AniFlix Desktop
const { app, BrowserWindow, shell, session, Menu, MenuItem } = require('electron');
const path = require('path');
const http = require('http');

const fs = require('fs');

// Read saved user settings to apply optimal GPU acceleration & Super Resolution flags
let appSettings = {
  gpuProfile: 'igpu',
  enableUpscale: false
};

try {
  const userDataDir = app.getPath('userData');
  process.env.ANIFLIX_USER_DATA = userDataDir;
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

// Ensure Scoop shims are in PATH so yt-dlp, aria2c, and mpv work seamlessly
process.env.PATH = `C:\\Users\\Atszl\\scoop\\shims;${process.env.PATH}`;

const PORT = 3001;
let mainWindow = null;

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
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 850,
    minWidth: 1024,
    minHeight: 650,
    title: 'AniFlix',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#141414',
    show: false, // Show once ready-to-show to prevent white flash
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false // allow streaming m3u8 playlists without CORS issues
    }
  });

  mainWindow.setMenuBarVisibility(false);

  // Once server is confirmed, load the local URL
  await mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.once('ready-to-show', () => {
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

  // Native Right-Click Mouse Context Menu (Cut, Copy, Paste, Select All)
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
      menu.popup({ window: mainWindow });
    } else if (params.selectionText && params.selectionText.trim().length > 0) {
      menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
      menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));
      menu.popup({ window: mainWindow });
    }
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
